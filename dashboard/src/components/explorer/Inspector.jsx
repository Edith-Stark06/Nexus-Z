import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, AlertTriangle, ExternalLink } from "lucide-react";
import ReasonList from "../ReasonList";
import RiskMeter from "../RiskMeter";
import RoleGlyph from "../RoleGlyph";
import { useAccountRecord } from "../../state/hooks";
import { ROLE_LABELS, formatUtc, riskTone } from "../../lib/constants";
import { linkId } from "../../lib/graph";
import { accountScore, RING_SCORE_SHORT, ACCOUNT_SCORE_SHORT, ACCOUNT_SCORE_NOTE, ROLE_NOTE, AMOUNT_NOTE } from "../../lib/scores";
import "./Inspector.css";

const shortTime = (iso) => (iso ? new Date(iso).toISOString().slice(5, 16).replace("T", " ") : "—");
const amount = (v) => (v == null || Number.isNaN(Number(v)) ? "—" : Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(2));

function Section({ title, hint, children, aside }) {
  return (
    <section className="ins-sec">
      <header>
        <h3 className="eyebrow">{title}</h3>
        {aside}
      </header>
      {hint && <p className="ins-hint">{hint}</p>}
      {children}
    </section>
  );
}

function ShowMore({ total, shown, onMore }) {
  if (total <= shown) return null;
  return (
    <button className="ghost ins-more" onClick={onMore}>
      Show all {total}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// A selected ring: what it is, why it was flagged, which accounts and payments support that, and what to look at next.
// ---------------------------------------------------------------------------------------------------------------------
export function RingInspector({ ring, stale, alerts, onSelectNode, onSelectLink }) {
  const [allMembers, setAllMembers] = useState(false);
  const [allPays, setAllPays] = useState(false);
  const members = useMemo(() => [...(ring.members || [])].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)), [ring]);
  const payments = useMemo(() => [...(ring.edges || [])].sort((a, b) => new Date(a.ts) - new Date(b.ts)), [ring]);
  const ringAlerts = (alerts || []).filter((a) => a.ring_id === ring.ring_id);
  const victimFlags = ringAlerts.filter((a) => a.type === "victim_warning");
  const tone = riskTone(ring.risk);

  const byRole = (role) => members.filter((m) => m.role === role);
  const steps = [];
  const collectors = byRole("collector").slice(0, 3);
  if (collectors.length) steps.push({ key: "c", text: "Review the highest-scored collector accounts first:", ids: collectors.map((m) => m.id) });
  const cashouts = byRole("cashout").slice(0, 2);
  if (cashouts.length) steps.push({ key: "o", text: "Follow the money out: check what happens after payments reach", ids: cashouts.map((m) => m.id) });
  if (victimFlags.length) steps.push({ key: "v", text: `${victimFlags.length} likely victim${victimFlags.length === 1 ? " was" : "s were"} flagged for paying into this ring: see Alerts.`, to: `/alerts?q=${encodeURIComponent(ring.ring_id)}` });
  if (!steps.length) steps.push({ key: "n", text: "Open the accounts in the list below and compare their payment patterns." });

  return (
    <div className="ins">
      {stale && (
        <div className="notice warn" role="status">
          <AlertTriangle size={15} aria-hidden="true" />
          <div className="grow">This is the last copy of the ring that loaded. It is no longer in the current results.</div>
        </div>
      )}
      <header className="ins-head">
        <div className="eyebrow">Ring</div>
        <div className="ins-title">
          <span className="mono ins-id">{ring.ring_id}</span>
        </div>
        <div className="ins-score">
          <div>
            <div className="eyebrow">Ring score</div>
            <RiskMeter value={ring.risk} />
          </div>
          <span className={`tag ${tone === "high" ? "danger" : tone === "medium" ? "warn" : ""}`}>{tone === "high" ? "High signal" : tone === "medium" ? "Medium signal" : "Lower signal"}</span>
        </div>
        <p className="ins-hint">{RING_SCORE_SHORT}</p>
        <dl className="ins-facts">
          <div><dt>Accounts</dt><dd className="num">{ring.accounts}</dd></div>
          <div><dt>Estimated likely victims</dt><dd className="num" title="A heuristic from payment positions, not a validated classification">{ring.victims}</dd></div>
          <div><dt>First payment (UTC)</dt><dd className="mono">{formatUtc(ring.first_seen)}</dd></div>
          <div><dt>Flagged (UTC)</dt><dd className="mono">{formatUtc(ring.flagged_at)}</dd></div>
          <div><dt>Payments in ring</dt><dd className="num">{(ring.edges || []).length}</dd></div>
        </dl>
      </header>

      <Section title="Why it was flagged">
        <p className="ins-headline">{ring.headline}</p>
        {ring.summary && (
          <div className="ins-summary">
            <div className="eyebrow">Case summary</div>
            <p>{ring.summary}</p>
          </div>
        )}
        <div className="ins-sub">
          <div className="eyebrow">Top reasons</div>
          <p className="ins-hint">How far each signal pushed the score up (+) or down (−). These are model contributions, not probabilities.</p>
          <ReasonList reasons={ring.top_reasons} />
        </div>
      </Section>

      <Section title="Accounts in this ring" hint={`${ROLE_NOTE} Account score is on a 0–1 scale.`}>
        <table className="tbl ins-tbl">
          <thead><tr><th>Account</th><th>Estimated role</th><th className="r" title={ACCOUNT_SCORE_NOTE}>Account score</th></tr></thead>
          <tbody>
            {(allMembers ? members : members.slice(0, 8)).map((m) => (
              <tr key={m.id}>
                <td><button className="linkbtn mono" onClick={() => onSelectNode(m.id)}>{m.id}</button></td>
                <td><RoleGlyph role={m.role} label /></td>
                <td className="r num mono">{accountScore(m.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ShowMore total={members.length} shown={allMembers ? members.length : 8} onMore={() => setAllMembers(true)} />
      </Section>

      <Section title="Payments in this ring" hint={`Time order, UTC. ${(ring.edges || []).length >= 500 ? "The API returns at most the 500 most recent payments of a ring, so earlier ones are not listed. " : ""}${AMOUNT_NOTE}`}>
        {payments.length === 0 ? (
          <div className="empty">No payments are recorded for this ring.</div>
        ) : (
          <table className="tbl ins-tbl">
            <thead><tr><th>Time (UTC)</th><th>From → To</th><th className="r" title={AMOUNT_NOTE}>Amount*</th></tr></thead>
            <tbody>
              {(allPays ? payments : payments.slice(0, 10)).map((e, i) => (
                <tr key={`${e.src}${e.dst}${e.ts}${i}`}>
                  <td className="when">{shortTime(e.ts)}</td>
                  <td>
                    <button className="linkbtn mono pair" onClick={() => onSelectLink(linkId(e.src, e.dst))} title={`${e.src} → ${e.dst}`}>
                      {e.src.slice(-6)} <ArrowRight size={11} aria-hidden="true" /> {e.dst.slice(-6)}
                    </button>
                  </td>
                  <td className="r num mono">{amount(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ShowMore total={payments.length} shown={allPays ? payments.length : 10} onMore={() => setAllPays(true)} />
      </Section>

      <Section title="Related alerts">
        {ringAlerts.length === 0 ? (
          <div className="empty">No alerts reference this ring.</div>
        ) : (
          <ul className="ins-alerts">
            {ringAlerts.slice(0, 6).map((a) => (
              <li key={a.alert_id}>
                <span className={`dot ${a.severity}`} />
                <div>
                  <div className="ins-alert-msg">{a.type === "victim_warning" ? `Likely victim flagged: ${a.account_id}${a.recipient_id ? ` paid ${a.recipient_id}` : ""}` : a.message}</div>
                  <div className="faint mono ins-alert-meta">{formatUtc(a.ts)} · {a.severity}</div>
                </div>
                {a.type === "victim_warning" && a.recipient_id && (
                  <Link to={`/warning/${a.recipient_id}`} className="ins-alert-link" title="Preview the pre-payment screen for the account that was paid">Pre-check</Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="What to examine next" hint="A reading order built from the data above, to help decide where to look. It is not a model output and not a conclusion.">
        <ul className="ins-steps">
          {steps.map((s) => (
            <li key={s.key}>
              {s.text}{" "}
              {s.ids?.map((id) => (
                <button key={id} className="linkbtn mono" onClick={() => onSelectNode(id)}>{id}</button>
              ))}
              {s.to && <Link to={s.to}>Open alerts</Link>}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// A selected account: its own record from GET /accounts/{id}, plus what the ring's payments say about it.
// ---------------------------------------------------------------------------------------------------------------------
export function AccountInspector({ accountId, ring, onSelectNode, onBack, onFocusNeighbours }) {
  const rec = useAccountRecord(accountId);
  const payments = ring?.edges || [];
  const out = payments.filter((e) => e.src === accountId);
  const inn = payments.filter((e) => e.dst === accountId);
  const counterparties = (list, key) => [...new Set(list.map((e) => e[key]))];
  const member = (ring?.members || []).find((m) => m.id === accountId);
  const a = rec.account;
  const inThisRing = a && a.ring_id === ring?.ring_id;

  return (
    <div className="ins">
      <header className="ins-head">
        <div className="eyebrow">Account</div>
        <div className="ins-title">
          <span className="mono ins-id">{accountId}</span>
        </div>
        <div className="ins-score">
          <div>
            <div className="eyebrow">Account score</div>
            {a ? <RiskMeter kind="account" value={a.risk} /> : member ? <RiskMeter kind="account" value={member.score} /> : <span className="faint">—</span>}
          </div>
          <div className="ins-flagline">
            <RoleGlyph role={a?.role || member?.role || "unknown"} label />
            <span className="faint">estimated role</span>
          </div>
        </div>
        <p className="ins-hint">{ACCOUNT_SCORE_SHORT} Roles are estimates.</p>
        <div className="ins-rowbtns">
          <button className="ghost ins-back" onClick={onBack}>← Back to ring</button>
          {onFocusNeighbours && <button onClick={() => onFocusNeighbours(accountId)} title="Zoom the graph to this account and the accounts it exchanges payments with">Focus neighbours</button>}
        </div>
      </header>

      {rec.state === "loading" && <div className="ins-loading"><div className="skel" style={{ width: "60%" }} /><div className="skel" /><div className="skel" style={{ width: "80%" }} /></div>}
      {rec.state === "notfound" && (
        <div className="empty"><strong>No record for this account.</strong> The API has no current score for {accountId}. That is not the same as safe.</div>
      )}
      {rec.state === "error" && <div className="notice danger" role="alert"><div className="grow">Could not load the account: {rec.message}</div></div>}

      {a && (
        <>
          {!inThisRing && (
            <div className="notice warn" role="status">
              <AlertTriangle size={15} aria-hidden="true" />
              <div className="grow">
                {a.ring_id ? <>The API now places this account in ring <Link to={`/ring/${a.ring_id}?account=${encodeURIComponent(accountId)}`} className="mono">{a.ring_id}</Link>.</> : "The API no longer places this account in a flagged ring."}
              </div>
            </div>
          )}
          <Section title="Why it scores this way" hint="Per-feature push on this account's score (+ up, − down).">
            <ReasonList reasons={a.reasons} limit={5} />
          </Section>
          <Section title="Connections">
            <dl className="ins-facts">
              <div><dt>Payments in (ring)</dt><dd className="num">{inn.length}</dd></div>
              <div><dt>Payments out (ring)</dt><dd className="num">{out.length}</dd></div>
              <div><dt>Counterparties in</dt><dd className="num">{a.neighborhood?.in_degree ?? "—"}</dd></div>
              <div><dt>Counterparties out</dt><dd className="num">{a.neighborhood?.out_degree ?? "—"}</dd></div>
            </dl>
            {[["Receives from", counterparties(inn, "src")], ["Pays to", counterparties(out, "dst")]].map(([label, ids]) =>
              ids.length ? (
                <div key={label} className="ins-cp">
                  <div className="eyebrow">{label}</div>
                  <div className="ins-cp-list">{ids.map((id) => <button key={id} className="linkbtn mono" onClick={() => onSelectNode(id)}>{id}</button>)}</div>
                </div>
              ) : null
            )}
          </Section>
          <div className="ins-actions">
            <Link to={`/account/${encodeURIComponent(accountId)}`} className="btnlink"><ExternalLink size={13} /> Open account page</Link>
            <Link to={`/warning/${encodeURIComponent(accountId)}`} className="btnlink" title="A prototype of the screen a customer would see before paying this account">Preview payment warning</Link>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// A selected arrow: every payment between two accounts.
// ---------------------------------------------------------------------------------------------------------------------
export function PaymentInspector({ link, onSelectNode, onBack }) {
  if (!link) return null;
  return (
    <div className="ins">
      <header className="ins-head">
        <div className="eyebrow">Payments between two accounts</div>
        <div className="ins-pair">
          <button className="linkbtn mono" onClick={() => onSelectNode(link.source)}>{link.source}</button>
          <ArrowRight size={14} aria-hidden="true" />
          <button className="linkbtn mono" onClick={() => onSelectNode(link.target)}>{link.target}</button>
        </div>
        <dl className="ins-facts">
          <div><dt>Payments</dt><dd className="num">{link.count}</dd></div>
          <div><dt>First</dt><dd className="mono">{formatUtc(link.first)}</dd></div>
          <div><dt>Last</dt><dd className="mono">{formatUtc(link.last)}</dd></div>
        </dl>
        <button className="ghost ins-back" onClick={onBack}>← Back to ring</button>
      </header>
      <Section title="Each payment" hint={AMOUNT_NOTE}>
        <table className="tbl ins-tbl">
          <thead><tr><th>Time (UTC)</th><th className="r" title={AMOUNT_NOTE}>Amount*</th></tr></thead>
          <tbody>
            {link.payments.map((p, i) => (
              <tr key={i}><td className="when">{formatUtc(p.ts)}</td><td className="r num mono">{amount(p.amount)}</td></tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

export { ROLE_LABELS };
