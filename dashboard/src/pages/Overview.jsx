import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Flag } from "lucide-react";
import Layout from "./Layout";
import RiskMeter from "../components/RiskMeter";
import { useData } from "../state/DataContext";
import { filterAlerts, sortAlerts, sortRings, victimFlagCounts, overviewNumbers } from "../lib/filters";
import { formatUtc } from "../lib/constants";
import { StatusRows } from "../components/SystemStatus";
import { describeSystem } from "../lib/provenance";
import { RING_SCORE_NOTE } from "../lib/scores";
import "./Overview.css";

function Figure({ value, label, hint, ready }) {
  return (
    <div className="ov-fig" title={hint}>
      <div className="ov-fig-n num">{ready ? value.toLocaleString() : <span className="skel" style={{ width: 46, display: "inline-block" }} />}</div>
      <div className="eyebrow">{label}</div>
    </div>
  );
}

export default function Overview() {
  const data = useData();
  const { rings, alerts, loaded, mode } = data;
  const navigate = useNavigate();
  const nums = useMemo(() => overviewNumbers(rings, alerts), [rings, alerts]);
  const victimCounts = useMemo(() => victimFlagCounts(alerts), [alerts]);
  const top = useMemo(() => sortRings(rings, "risk").slice(0, 10), [rings]);
  const flags = useMemo(() => sortAlerts(filterAlerts(alerts, { type: "victim_warning" }), "time").slice(0, 6), [alerts]);
  const ready = loaded;

  return (
    <Layout title="Overview" subtitle="The highest-scored flagged rings, recent likely-victim flags, and where this data comes from.">
      <div className="ov">
        <div className="ov-figs" aria-label="Summary of the current results">
          <Figure ready={ready} value={nums.rings} label="Rings flagged" hint="Rings in the API's current results" />
          <Figure ready={ready} value={nums.highRisk} label="Ring score 50 or more" hint="Rings with a ring score of 50 or more (the cut-off the API uses for high severity)" />
          <Figure ready={ready} value={nums.accountsInRings} label="Accounts in rings" hint="Sum of ring sizes; an account is in one ring at a time" />
          <Figure ready={ready} value={nums.victimFlags} label="Likely victims flagged" hint="Accounts that recently paid into a flagged ring: a heuristic. Nothing is sent to them." />
        </div>

        <div className="ov-cols">
          <section className="ov-main" aria-labelledby="ov-top">
            <header className="ov-head">
              <h2 id="ov-top">Highest-scored rings</h2>
              <Link to="/rings" className="ov-more">Open investigations <ArrowRight size={13} aria-hidden="true" /></Link>
            </header>
            {!ready ? (
              <div className="ov-skel">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skel" />)}</div>
            ) : top.length === 0 ? (
              <div className="empty">
                <strong>{mode === "unreachable" ? "No data: the API is not reachable." : "The API returned no rings."}</strong>
                {mode === "unreachable" ? "See the banner above to retry." : "When the model flags a group of linked accounts it is listed here."}
              </div>
            ) : (
              <div className="ov-scroll"><table className="tbl ov-tbl">
                <thead>
                  <tr><th title="Ring score, 0 to 100">Ring score</th><th>Ring</th><th className="r">Accounts</th><th className="r" title="Likely victims flagged for the ring. The scorer lists at most 3 per ring, so 3 means 3 or more.">Victims flagged</th><th>Flagged (UTC)</th><th>Why</th></tr>
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
              </table></div>
            )}
            <p className="ov-note faint">
              {RING_SCORE_NOTE} The score tends to favour small rings, so the top of this list is often 3-account rings. Ring ids change when a refresh changes a
              ring's members.
            </p>
          </section>

          <aside className="ov-side">
            <section aria-labelledby="ov-vic">
              <header className="ov-head"><h2 id="ov-vic">Likely victims flagged</h2><Link to="/alerts?type=victim_warning" className="ov-more">All <ArrowRight size={13} aria-hidden="true" /></Link></header>
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
              <p className="ov-note faint">A heuristic (recently paid into a flagged ring) that has not been evaluated for accuracy. Alerts cover only the 10 highest-scored rings.</p>
            </section>

            <section aria-labelledby="ov-pipe">
              <header className="ov-head"><h2 id="ov-pipe">System and data</h2><Link to="/platform" className="ov-more">Details <ArrowRight size={13} aria-hidden="true" /></Link></header>
              <StatusRows sys={describeSystem(data)} />
              <p className="ov-note faint">A new payment shows up after the next background rebuild: the whole history is rescored in micro-batches, not payment by payment.</p>
            </section>
          </aside>
        </div>
      </div>
    </Layout>
  );
}
