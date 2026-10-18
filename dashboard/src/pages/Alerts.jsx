import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import Layout from "./Layout";
import { useData } from "../state/DataContext";
import { filterAlerts, sortAlerts } from "../lib/filters";
import { formatUtc } from "../lib/constants";
import "./Alerts.css";

const TYPES = { all: "All alerts", ring: "Ring alerts", victim_warning: "Likely victims flagged" };
const SEVERITIES = { all: "Any severity", high: "High", medium: "Medium", low: "Low" };

// The filters live in the address bar, so a filtered view can be linked to and the browser's back button works.
export default function Alerts() {
  const { alerts, loaded, mode } = useData();
  const [sp, setSp] = useSearchParams();
  const type = TYPES[sp.get("type")] ? sp.get("type") : "all";
  const severity = SEVERITIES[sp.get("severity")] ? sp.get("severity") : "all";
  const sort = sp.get("sort") === "severity" ? "severity" : "time";
  const q = sp.get("q") || "";
  const set = (patch) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) (v === "" || v === "all" || (k === "sort" && v === "time") ? next.delete(k) : next.set(k, v));
    setSp(next, { replace: true });
  };

  const rows = useMemo(() => sortAlerts(filterAlerts(alerts, { type, severity, query: q }), sort), [alerts, type, severity, q, sort]);
  const nRing = alerts.filter((a) => a.type === "ring").length;
  const nVictim = alerts.length - nRing;

  return (
    <Layout title="Alerts" subtitle="Ring alerts and likely victims flagged">
      <div className="al">
        <div className="al-bar">
          <label className="al-search">
            <Search size={14} aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => set({ q: e.target.value })} placeholder="Search ring, account or message" aria-label="Search alerts" />
          </label>
          <select value={type} onChange={(e) => set({ type: e.target.value })} aria-label="Alert type">
            {Object.entries(TYPES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          <select value={severity} onChange={(e) => set({ severity: e.target.value })} aria-label="Severity">
            {Object.entries(SEVERITIES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          <div className="seg" role="group" aria-label="Sort">
            <button aria-pressed={sort === "time"} onClick={() => set({ sort: "time" })}>Newest</button>
            <button aria-pressed={sort === "severity"} onClick={() => set({ sort: "severity" })}>Severity</button>
          </div>
          <span className="faint al-count">
            <span className="num">{rows.length}</span> of <span className="num">{alerts.length}</span> ({nRing} ring, {nVictim} victim)
          </span>
        </div>

        <div className="al-table">
          {!loaded && mode !== "unreachable" ? (
            <div className="al-skel">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skel" />)}</div>
          ) : alerts.length === 0 ? (
            <div className="empty"><strong>{mode === "unreachable" ? "No data: the API is not reachable." : "No alerts."}</strong>{mode === "unreachable" ? "See the banner above." : "Alerts appear when the model flags a ring or an account pays into one."}</div>
          ) : rows.length === 0 ? (
            <div className="empty"><strong>No alert matches.</strong>Clear the search or loosen the filters.</div>
          ) : (
            <table className="tbl al-tbl">
              <thead>
                <tr><th>Time (UTC)</th><th>Type</th><th>Severity</th><th>Ring</th><th>Account</th><th>Paid account</th><th>Message</th></tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.alert_id}>
                    <td className="when">{formatUtc(a.ts)}</td>
                    <td>{a.type === "ring" ? "Ring" : <span className="tag accent">Likely victim</span>}</td>
                    <td><span className="al-sev"><span className={`dot ${a.severity}`} />{a.severity}</span></td>
                    <td className="id"><Link to={`/ring/${a.ring_id}`}>{a.ring_id}</Link></td>
                    <td className="id">{a.account_id ? <Link to={`/account/${a.account_id}`}>{a.account_id}</Link> : <span className="faint">—</span>}</td>
                    <td className="id">
                      {a.recipient_id ? (
                        <>
                          <Link to={`/account/${a.recipient_id}`}>{a.recipient_id}</Link>{" "}
                          <Link to={`/warning/${a.recipient_id}`} className="al-pre" title="Preview the pre-payment screen for the account that was paid">pre-check</Link>
                        </>
                      ) : <span className="faint">—</span>}
                    </td>
                    <td className="al-msg" title={a.message}>{a.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="faint al-note">
          "Likely victim flagged" means the account recently paid into a flagged ring. We flag; nothing is sent to anyone, and the rule has not been evaluated for accuracy.
        </p>
      </div>
    </Layout>
  );
}
