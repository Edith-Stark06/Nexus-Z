import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Network, ShieldAlert, RefreshCw } from "lucide-react";
import Layout from "./Layout";
import GraphCanvas from "../components/GraphCanvas";
import ReasonList from "../components/ReasonList";
import RiskMeter from "../components/RiskMeter";
import RoleGlyph from "../components/RoleGlyph";
import PaymentTable from "../components/PaymentTable";
import { useData } from "../state/DataContext";
import { useAccountRecord, useRing } from "../state/hooks";
import { egoRing } from "../lib/graph";
import { formatUtc } from "../lib/constants";
import { ACCOUNT_SCORE_NOTE, ROLE_NOTE } from "../lib/scores";
import "./AccountDetail.css";

// Four kinds of statement, kept in separate sections so they are not read as one verdict:
//   observed           what the API reports about payments and neighbours
//   model-generated    the account score and the reasons behind it
//   inferred           the estimated role
//   available actions  what an analyst can do next from here (the pre-check is a prototype)
export default function AccountDetail() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  const { alerts, refresh } = useData();
  const rec = useAccountRecord(accountId);
  const account = rec.account;
  const { ring, state: ringState } = useRing(account?.ring_id || null);
  const ego = useMemo(() => (ring && account ? egoRing(ring, account.account_id) : null), [ring, account]);
  const related = (alerts || []).filter((a) => a.account_id === accountId || a.recipient_id === accountId);
  const own = ring ? (ring.edges || []).filter((e) => e.src === accountId || e.dst === accountId) : [];
  const counterparties = useMemo(() => {
    const m = new Map();
    for (const e of own) {
      const other = e.src === accountId ? e.dst : e.src;
      const cur = m.get(other) || { id: other, in: 0, out: 0 };
      if (e.src === accountId) cur.out += 1;
      else cur.in += 1;
      m.set(other, cur);
    }
    return [...m.values()].sort((a, b) => b.in + b.out - (a.in + a.out) || (a.id < b.id ? -1 : 1));
  }, [own, accountId]);
  const role = account?.role || "unknown";
  const memberRole = (id) => (ring?.members || []).find((m) => m.id === id)?.role || "unknown";

  return (
    <Layout title="Account" subtitle="One account as the API describes it: what was observed, what the model says, and what is only an estimate.">
      <div className="ac">
        <nav className="ac-crumb" aria-label="Breadcrumb">
          <Link to="/accounts">Accounts</Link>
          {account?.ring_id && <> / <Link to={`/ring/${account.ring_id}`} className="mono">{account.ring_id}</Link></>} / <span className="mono">{accountId}</span>
        </nav>

        {rec.state === "loading" && <div className="ac-loading" aria-busy="true"><div className="skel" style={{ width: 240 }} /><div className="skel" style={{ width: 360 }} /></div>}
        {rec.state === "notfound" && (
          <div className="notice warn" role="status">
            <div className="grow">
              <strong>No record for <span className="mono">{accountId}</span>.</strong> The API has no current score for this account. That is not the same as safe: it only
              scores accounts active in its window.
              <div className="notice-actions"><Link to="/accounts" className="btn tertiary">Look up another account</Link></div>
            </div>
          </div>
        )}
        {rec.state === "error" && (
          <div className="notice danger" role="alert">
            <div className="grow">
              <strong>Could not load the account.</strong> {rec.message}
              <div className="notice-actions"><button onClick={refresh}><RefreshCw size={14} aria-hidden="true" /> Retry</button></div>
            </div>
          </div>
        )}

        {account && (
          <>
            <header className="ac-head">
              <div className="mono ac-id">{account.account_id}</div>
              <div className="ac-sum">
                <div>
                  <div className="eyebrow">Account score</div>
                  <RiskMeter kind="account" value={account.risk} />
                </div>
                <div>
                  <div className="eyebrow">Estimated role</div>
                  <RoleGlyph role={role} label />
                </div>
                <div>
                  <div className="eyebrow">Ring</div>
                  {account.ring_id ? <Link to={`/ring/${account.ring_id}?account=${encodeURIComponent(account.account_id)}`} className="mono">{account.ring_id}</Link> : <span className="faint">Not in a flagged ring</span>}
                </div>
              </div>
            </header>

            <div className="ac-grid">
              <section className="ac-card" aria-labelledby="ac-model">
                <h2 id="ac-model">Model-generated signal</h2>
                <p className="ac-hint">{ACCOUNT_SCORE_NOTE}</p>
                <h3 className="ac-h3">Reasons behind the score</h3>
                <p className="ac-hint">How far each feature pushed this account's score up (+) or down (−). These are model contributions, not probabilities.</p>
                <ReasonList reasons={account.reasons} />
              </section>

              <section className="ac-card" aria-labelledby="ac-obs">
                <h2 id="ac-obs">Observed in the data</h2>
                <dl className="ac-kv">
                  <div><dt>Counterparties paying in</dt><dd className="num">{account.neighborhood?.in_degree ?? "—"}</dd></div>
                  <div><dt>Counterparties paid</dt><dd className="num">{account.neighborhood?.out_degree ?? "—"}</dd></div>
                  <div><dt>Ring size</dt><dd className="num">{account.neighborhood?.ring_size ?? "—"}</dd></div>
                  <div><dt>Payments in its ring</dt><dd className="num">{own.length}</dd></div>
                </dl>
                <h3 className="ac-h3">Connected accounts in its ring</h3>
                {!account.ring_id ? (
                  <div className="empty">Not in a flagged ring, so there is no ring network to show.</div>
                ) : ringState === "loading" ? (
                  <div className="skel" style={{ width: 200 }} />
                ) : counterparties.length === 0 ? (
                  <div className="empty">The ring's payments do not include this account.</div>
                ) : (
                  <table className="tbl ac-cp">
                    <thead><tr><th scope="col">Account</th><th scope="col">Estimated role</th><th scope="col" className="r">Paid in</th><th scope="col" className="r">Paid out</th></tr></thead>
                    <tbody>
                      {counterparties.map((c) => (
                        <tr key={c.id}>
                          <td className="id"><Link to={`/account/${encodeURIComponent(c.id)}`}>{c.id}</Link></td>
                          <td><RoleGlyph role={memberRole(c.id)} label /></td>
                          <td className="r num">{c.in}</td>
                          <td className="r num">{c.out}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="ac-card" aria-labelledby="ac-inf">
                <h2 id="ac-inf">Inferred</h2>
                <div className="ac-role"><RoleGlyph role={role} label /></div>
                <p className="ac-hint">{ROLE_NOTE} An estimated role is not an established fact about this account, and a likely-victim role is a heuristic that has not been validated.</p>
              </section>

              <section className="ac-card" aria-labelledby="ac-act">
                <h2 id="ac-act">Available actions</h2>
                <div className="ac-actions">
                  {account.ring_id && <Link className="btn tertiary" to={`/ring/${account.ring_id}?account=${encodeURIComponent(account.account_id)}`}><Network size={16} aria-hidden="true" /> Show in ring graph</Link>}
                  <Link className="btn tertiary" to={`/warning/${encodeURIComponent(account.account_id)}`}><ShieldAlert size={16} aria-hidden="true" /> Payment pre-check preview</Link>
                </div>
                <p className="ac-hint">The pre-check preview is a prototype of a customer screen. Nothing is sent to anyone.</p>
              </section>

              <section className="ac-card ac-graph" aria-labelledby="ac-graph">
                <h2 id="ac-graph">Direct connections in its ring</h2>
                {!account.ring_id ? (
                  <div className="empty">Not in a flagged ring.</div>
                ) : !ego ? (
                  <div className="ac-loading"><div className="skel" style={{ width: 200 }} /></div>
                ) : (
                  <div className="ac-canvas">
                    <GraphCanvas
                      ring={ego}
                      layout="force"
                      labels="all"
                      selectedNodeId={account.account_id}
                      onSelectNode={(id) => id !== account.account_id && navigate(`/account/${encodeURIComponent(id)}`)}
                      ariaLabel={`Connections of ${account.account_id}`}
                    />
                  </div>
                )}
              </section>

              <section className="ac-card ac-wide" aria-labelledby="ac-pay">
                <h2 id="ac-pay">Payments involving this account (inside its ring)</h2>
                <PaymentTable edges={own} accountId={accountId} />
              </section>

              <section className="ac-card ac-wide" aria-labelledby="ac-al">
                <h2 id="ac-al">Related alerts</h2>
                {related.length === 0 ? (
                  <div className="empty">No alert references this account. Alerts cover only the 10 highest-scored rings.</div>
                ) : (
                  <table className="tbl">
                    <thead><tr><th scope="col">Time (UTC)</th><th scope="col">This account's part</th><th scope="col">Ring</th><th scope="col">Message</th></tr></thead>
                    <tbody>
                      {related.map((a) => (
                        <tr key={a.alert_id}>
                          <td className="when">{formatUtc(a.ts)}</td>
                          <td>{a.account_id === accountId ? "Likely victim flagged (paid in)" : "Account that was paid"}</td>
                          <td className="id"><Link to={`/ring/${a.ring_id}`}>{a.ring_id}</Link></td>
                          <td className="muted">{a.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
