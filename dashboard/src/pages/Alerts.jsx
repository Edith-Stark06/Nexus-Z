import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, RefreshCw, Search } from "lucide-react";
import Layout from "./Layout";
import { useData } from "../state/DataContext";
import { filterAlerts, sortAlerts } from "../lib/filters";
import { formatUtc } from "../lib/constants";
import "./Alerts.css";

const TYPES = { all: "All alert types", ring: "Ring alert", victim_warning: "Likely victim flagged" };
const SEVERITIES = { all: "Any severity", high: "High", medium: "Medium", low: "Low" };
const SEV_LABEL = { high: "High", medium: "Medium", low: "Low" };

// The filters live in the address bar, so a filtered view can be linked to and the browser's back button works.
export default function Alerts() {
  const { alerts, loaded, mode, lastError, refresh } = useData();
  const navigate = useNavigate();
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
  const filtered = type !== "all" || severity !== "all" || q !== "";

  const rows = useMemo(() => sortAlerts(filterAlerts(alerts, { type, severity, query: q }), sort), [alerts, type, severity, q, sort]);
  const nRing = alerts.filter((a) => a.type === "ring").length;
  const nVictim = alerts.length - nRing;
  const waiting = !loaded && mode !== "unreachable";

  return (
    <Layout title="Alerts" subtitle="Review flagged transaction networks and potential victim-payment signals.">
      <div className="al">
        {loaded && lastError && mode === "live" && (
          <div className="notice warn" role="alert">
            <div className="grow">
              <strong>Some data could not be refreshed.</strong> {lastError} The alerts below may be out of date.
              <div className="notice-actions">
                <button onClick={refresh}>
                  <RefreshCw size={14} aria-hidden="true" /> Retry
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="al-bar" role="search" aria-label="Filter alerts">
          <label className="al-search">
            <Search size={14} aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => set({ q: e.target.value })} placeholder="Search ring id, account id or message" aria-label="Search alerts" />
          </label>
          <select value={type} onChange={(e) => set({ type: e.target.value })} aria-label="Alert type">
            {Object.entries(TYPES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          <select value={severity} onChange={(e) => set({ severity: e.target.value })} aria-label="Severity">
            {Object.entries(SEVERITIES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          <div className="seg" role="group" aria-label="Sort by">
            <button aria-pressed={sort === "time"} onClick={() => set({ sort: "time" })}>Newest first</button>
            <button aria-pressed={sort === "severity"} onClick={() => set({ sort: "severity" })}>Severity first</button>
          </div>
          {filtered && <button className="ghost" onClick={() => setSp({}, { replace: true })}>Clear filters</button>}
          <span className="al-count" aria-live="polite">
            Showing <span className="num">{rows.length}</span> of <span className="num">{alerts.length}</span>
            {alerts.length > 0 && <span className="faint"> ({nRing} ring, {nVictim} likely victim)</span>}
          </span>
        </div>

        <div className="al-table">
          {waiting ? (
            <div className="al-skel" aria-busy="true">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skel" />)}</div>
          ) : alerts.length === 0 ? (
            <div className="empty">
              <strong>{mode === "unreachable" ? "No alerts: the API is not reachable." : "The API returned no alerts."}</strong>
              {mode === "unreachable" ? "See the notice above to retry." : "Alerts appear when the model flags a ring or an account pays into one."}
            </div>
          ) : rows.length === 0 ? (
            <div className="empty"><strong>No alert matches these filters.</strong>Clear the search, or loosen the type and severity.</div>
          ) : (
            <table className="tbl al-tbl">
              <caption className="sr-only">Alerts, {sort === "time" ? "newest first" : "highest severity first"}</caption>
              <thead>
                <tr>
                  <th scope="col">Time (UTC)</th>
                  <th scope="col">Alert</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Ring</th>
                  <th scope="col">Accounts</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.alert_id} className="al-row" onClick={(e) => { if (!e.target.closest("a")) navigate(`/ring/${a.ring_id}`); }}>
                    <td className="when">{formatUtc(a.ts)}</td>
                    <td>{a.type === "ring" ? "Ring alert" : "Likely victim flagged"}</td>
                    <td><span className="al-sev"><span className={`dot ${a.severity}`} aria-hidden="true" />{SEV_LABEL[a.severity] || a.severity}</span></td>
                    <td className="id"><Link to={`/ring/${a.ring_id}`}>{a.ring_id}</Link></td>
                    <td className="al-acc">
                      {a.type === "victim_warning" ? (
                        <>
                          <Link to={`/account/${a.account_id}`} className="mono">{a.account_id}</Link>
                          <ArrowRight size={12} aria-label="paid" className="faint" />
                          {a.recipient_id ? <Link to={`/account/${a.recipient_id}`} className="mono">{a.recipient_id}</Link> : <span className="faint">an account in the ring</span>}
                          {a.recipient_id && <Link to={`/warning/${a.recipient_id}`} className="al-pre" title="Preview the prototype pre-payment screen for the account that was paid">pre-check</Link>}
                        </>
                      ) : (
                        <span className="faint">Whole ring</span>
                      )}
                    </td>
                    <td className="al-msg" title={a.message}>{a.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="al-notes">
          <p>
            <strong>Coverage.</strong> The API raises alerts only for its 10 highest-scored rings, and lists at most 3 likely victims per ring, so this is not every
            flagged ring or every account.
          </p>
          <p>
            <strong>Likely victim flagged</strong> means an account outside a ring recently paid an account inside it. It is a heuristic that has not been evaluated
            for accuracy, its severity is fixed at medium, and nothing is sent to anyone. An alert is a signal for review, not a finding of fraud.
          </p>
        </div>
      </div>
    </Layout>
  );
}
