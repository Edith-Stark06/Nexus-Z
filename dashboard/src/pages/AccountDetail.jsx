import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Network, ShieldAlert } from "lucide-react";
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
import "./AccountDetail.css";

export default function AccountDetail() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  const { alerts } = useData();
  const rec = useAccountRecord(accountId);
  const account = rec.account;
  const { ring } = useRing(account?.ring_id || null);
  const ego = useMemo(() => (ring && account ? egoRing(ring, account.account_id) : null), [ring, account]);
  const related = (alerts || []).filter((a) => a.account_id === accountId || a.recipient_id === accountId);
  const own = ring ? (ring.edges || []).filter((e) => e.src === accountId || e.dst === accountId) : [];
  const role = account?.role || "unknown";
  const title = accountId;

  return (
    <Layout title="Account" subtitle={title}>
      <div className="ac">
        <nav className="ac-crumb faint" aria-label="Breadcrumb">
          <Link to="/rings">Ring explorer</Link>
          {account?.ring_id && <> / <Link to={`/ring/${account.ring_id}`} className="mono">{account.ring_id}</Link></>} / <span className="mono">{accountId}</span>
        </nav>

        {rec.state === "loading" && <div className="ac-loading"><div className="skel" style={{ width: 240 }} /><div className="skel" style={{ width: 360 }} /></div>}
        {rec.state === "notfound" && (
          <div className="notice warn" role="status">
            <div className="grow"><strong>No record for <span className="mono">{accountId}</span>.</strong> The API has no current score for this account. That is not the same as safe: it only knows accounts active in its window.</div>
          </div>
        )}
        {rec.state === "error" && <div className="notice danger" role="alert"><div className="grow">Could not load the account: {rec.message}</div></div>}

        {account && (
          <>
            <header className="ac-head">
              <div>
                <div className="eyebrow">Account</div>
                <div className="mono ac-id">{account.account_id}</div>
                <div className="ac-role"><RoleGlyph role={role} label /> <span className="faint">estimated role, guessed from position in the ring</span></div>
              </div>
              <div className="ac-risk">
                <div className="eyebrow">Account risk (automated signal)</div>
                <RiskMeter value={account.risk * 100} label="account risk" />
              </div>
              <div className="ac-actions">
                {account.ring_id && <Link className="btnlink" to={`/ring/${account.ring_id}?account=${encodeURIComponent(account.account_id)}`}><Network size={14} /> Show in ring graph</Link>}
                <Link className="btnlink" to={`/warning/${encodeURIComponent(account.account_id)}`} title="A prototype of the screen a customer would see before paying this account"><ShieldAlert size={14} /> Payment pre-check preview</Link>
              </div>
            </header>

            <div className="ac-grid">
              <section className="ac-card">
                <h2 className="eyebrow">Why it scores this way</h2>
                <p className="ac-hint faint">Per-feature push on this account's score (+ up, − down). It is not a probability.</p>
                <ReasonList reasons={account.reasons} />
              </section>

              <section className="ac-card ac-graph">
                <h2 className="eyebrow">Direct connections in its ring</h2>
                {!account.ring_id ? (
                  <div className="empty"><strong>Not in a flagged ring.</strong>There is no ring network to draw for this account right now.</div>
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
                <div className="ac-nb">
                  <div><span className="eyebrow">Counterparties in</span> <b className="num">{account.neighborhood?.in_degree ?? "—"}</b></div>
                  <div><span className="eyebrow">Counterparties out</span> <b className="num">{account.neighborhood?.out_degree ?? "—"}</b></div>
                  <div><span className="eyebrow">Ring size</span> <b className="num">{account.neighborhood?.ring_size ?? "—"}</b></div>
                </div>
              </section>

              <section className="ac-card ac-wide">
                <h2 className="eyebrow">Payments involving this account (inside its ring)</h2>
                <PaymentTable edges={own} />
              </section>

              <section className="ac-card ac-wide">
                <h2 className="eyebrow">Related alerts</h2>
                {related.length === 0 ? (
                  <div className="empty">No alert references this account.</div>
                ) : (
                  <table className="tbl">
                    <thead><tr><th>Time (UTC)</th><th>Role in alert</th><th>Ring</th><th>Message</th></tr></thead>
                    <tbody>
                      {related.map((a) => (
                        <tr key={a.alert_id}>
                          <td className="when">{formatUtc(a.ts)}</td>
                          <td>{a.account_id === accountId ? "Likely victim (paid in)" : "Account that was paid"}</td>
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
