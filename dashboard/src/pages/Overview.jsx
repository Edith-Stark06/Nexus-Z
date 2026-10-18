import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Flag } from "lucide-react";
import Layout from "./Layout";
import RiskMeter from "../components/RiskMeter";
import { useData } from "../state/DataContext";
import { filterAlerts, sortAlerts, sortRings, victimFlagCounts, overviewNumbers } from "../lib/filters";
import { formatUtc } from "../lib/constants";
import "./Overview.css";

function Figure({ value, label, hint, ready }) {
  return (
    <div className="ov-fig" title={hint}>
      <div className="ov-fig-n num">{ready ? value.toLocaleString() : <span className="skel" style={{ width: 46, display: "inline-block" }} />}</div>
      <div className="eyebrow">{label}</div>
    </div>
  );
}

function Row({ k, v, title }) {
  return (
    <div className="ov-kv" title={title}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

export default function Overview() {
  const { rings, alerts, loaded, mode, health } = useData();
  const navigate = useNavigate();
  const nums = useMemo(() => overviewNumbers(rings, alerts), [rings, alerts]);
  const victimCounts = useMemo(() => victimFlagCounts(alerts), [alerts]);
  const top = useMemo(() => sortRings(rings, "risk").slice(0, 10), [rings]);
  const flags = useMemo(() => sortAlerts(filterAlerts(alerts, { type: "victim_warning" }), "time").slice(0, 6), [alerts]);
  const ready = loaded;

  return (
    <Layout title="Investigation overview" subtitle="Where to look next">
      <div className="ov">
        <div className="ov-figs" aria-label="Summary of the current results">
          <Figure ready={ready} value={nums.rings} label="Rings flagged" hint="Rings in the API's current results" />
          <Figure ready={ready} value={nums.highRisk} label="High risk (50+)" hint="Rings with an automated risk signal of 50 or more" />
          <Figure ready={ready} value={nums.accountsInRings} label="Accounts in rings" hint="Sum of ring sizes; an account is in one ring at a time" />
          <Figure ready={ready} value={nums.victimFlags} label="Likely victims flagged" hint="Accounts that recently paid into a flagged ring. Nothing is sent to them." />
        </div>

        <div className="ov-cols">
          <section className="ov-main" aria-labelledby="ov-top">
            <header className="ov-head">
              <h2 id="ov-top" className="eyebrow">Highest-risk rings</h2>
              <Link to="/rings" className="ov-more">Open the ring explorer <ArrowRight size={13} aria-hidden="true" /></Link>
            </header>
            {!ready ? (
              <div className="ov-skel">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skel" />)}</div>
            ) : top.length === 0 ? (
              <div className="empty">
                <strong>{mode === "unreachable" ? "No data: the API is not reachable." : "The API returned no rings."}</strong>
                {mode === "unreachable" ? "See the banner above to retry." : "When the model flags a group of linked accounts it is listed here."}
              </div>
            ) : (
              <table className="tbl ov-tbl">
                <thead>
                  <tr><th>Risk</th><th>Ring</th><th className="r">Accounts</th><th className="r" title="Likely victims flagged for the ring. The scorer lists at most 3 per ring, so 3 means 3 or more.">Victims flagged</th><th>Flagged (UTC)</th><th>Why</th></tr>
                </thead>
                <tbody>
                  {top.map((r) => (
                    <tr key={r.ring_id} className="ov-row" onClick={() => navigate(`/ring/${r.ring_id}`)}>
                      <td><RiskMeter value={r.risk} compact /></td>
                      <td className="id"><Link to={`/ring/${r.ring_id}`} onClick={(e) => e.stopPropagation()}>{r.ring_id}</Link></td>
                      <td className="r num">{r.accounts}</td>
                      <td className="r num">{victimCounts[r.ring_id] || <span className="faint">0</span>}</td>
                      <td className="when">{formatUtc(r.flagged_at)}</td>
                      <td><div className="ov-why" title={r.headline}>{r.headline}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="ov-note faint">
              Risk is an automated signal for review, not a finding of fraud. It tends to favour small rings, so the top of this list is often 3-account rings. Ring ids
              change when a refresh changes a ring's members.
            </p>
          </section>

          <aside className="ov-side">
            <section aria-labelledby="ov-vic">
              <header className="ov-head"><h2 id="ov-vic" className="eyebrow">Likely victims flagged</h2><Link to="/alerts?type=victim_warning" className="ov-more">All <ArrowRight size={13} aria-hidden="true" /></Link></header>
              {flags.length === 0 ? (
                <div className="empty">No account has recently paid into a flagged ring.</div>
              ) : (
                <ul className="ov-flags">
                  {flags.map((a) => (
                    <li key={a.alert_id}>
                      <Flag size={13} aria-hidden="true" className="ov-flag-i" />
                      <div>
                        <div className="ov-flag-line">
                          <Link to={`/account/${a.account_id}`} className="mono">{a.account_id}</Link> paid{" "}
                          {a.recipient_id ? <Link to={`/account/${a.recipient_id}`} className="mono">{a.recipient_id}</Link> : "an account"} in{" "}
                          <Link to={`/ring/${a.ring_id}`} className="mono">{a.ring_id}</Link>
                        </div>
                        <div className="faint mono ov-flag-meta">
                          {formatUtc(a.ts)}
                          {a.recipient_id && <> · <Link to={`/warning/${a.recipient_id}`}>payment pre-check</Link></>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="ov-note faint">This rule (recently paid into a flagged ring) has not been evaluated for accuracy.</p>
            </section>

            <section aria-labelledby="ov-pipe">
              <header className="ov-head"><h2 id="ov-pipe" className="eyebrow">Pipeline</h2><Link to="/platform" className="ov-more">Details <ArrowRight size={13} aria-hidden="true" /></Link></header>
              {!health ? (
                <div className="empty">{mode === "demo" ? "Demo sample: there is no backend to report." : "No health data yet."}</div>
              ) : (
                <dl className="ov-kvs">
                  <Row k="Backend" v={<span className={health.backend === "stub" ? "ov-stub" : ""}>{health.backend}{health.backend === "stub" ? " (invented data)" : ""}</span>} />
                  {health.data_as_of && <Row k="Data as of" v={<span className="mono">{formatUtc(health.data_as_of)}</span>} title="Time of the newest payment in the served state" />}
                  {health.state_age_seconds != null && <Row k="State age" v={`${Math.round(health.state_age_seconds)} s`} title="How long ago the served state was built, at the last health check" />}
                  {health.last_rebuild_seconds != null && <Row k="Last rebuild took" v={`${health.last_rebuild_seconds.toFixed(1)} s`} />}
                  {health.refresh_interval_seconds != null && <Row k="Refresh interval" v={`${health.refresh_interval_seconds} s minimum`} />}
                  {health.pending_transactions != null && <Row k="Payments waiting" v={health.pending_transactions.toLocaleString()} title="Accepted, not yet in the served state" />}
                </dl>
              )}
              <p className="ov-note faint">A new payment shows up after the next background rebuild: the whole history is rescored in micro-batches, not payment by payment.</p>
            </section>
          </aside>
        </div>
      </div>
    </Layout>
  );
}
