import { Search, SlidersHorizontal, Flag } from "lucide-react";
import RiskMeter from "../RiskMeter";
import { RING_SORTS } from "../../lib/filters";
import { formatUtc, riskTone } from "../../lib/constants";
import "./RingList.css";

const RISK_STEPS = [
  { v: 0, t: "Any ring score" },
  { v: 25, t: "Ring score 25 or more" },
  { v: 50, t: "Ring score 50 or more (high)" },
  { v: 80, t: "Ring score 80 or more" },
];
const SIZE_STEPS = [
  { v: 0, t: "Any size" },
  { v: 3, t: "3 or more accounts" },
  { v: 5, t: "5 or more accounts" },
  { v: 10, t: "10 or more accounts" },
];

/**
 * The ring list of the explorer: search, filters, sorting, and one dense row per ring.
 * `accountResult` is the outcome of an account-id lookup typed into the search box (see Explorer).
 */
export default function RingList({ rings, total, selectedId, onSelect, victimCounts, filters, setFilters, accountResult, onOpenAccount, loading, unreachable = false }) {
  const set = (patch) => setFilters({ ...filters, ...patch });
  const active = filters.minRisk > 0 || filters.minAccounts > 0 || filters.onlyWithVictims;
  return (
    <div className="rl">
      <div className="rl-controls">
        <label className="rl-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="Search rings or an account id"
            aria-label="Search rings or an account id"
          />
        </label>
        <div className="rl-filters">
          <SlidersHorizontal size={13} aria-hidden="true" className="faint" />
          <select aria-label="Minimum ring score" value={filters.minRisk} onChange={(e) => set({ minRisk: Number(e.target.value) })}>
            {RISK_STEPS.map((o) => (
              <option key={o.v} value={o.v}>{o.t}</option>
            ))}
          </select>
          <select aria-label="Minimum ring size" value={filters.minAccounts} onChange={(e) => set({ minAccounts: Number(e.target.value) })}>
            {SIZE_STEPS.map((o) => (
              <option key={o.v} value={o.v}>{o.t}</option>
            ))}
          </select>
          <select aria-label="Sort rings" value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
            {Object.entries(RING_SORTS).map(([k, o]) => (
              <option key={k} value={k}>{o.label}</option>
            ))}
          </select>
        </div>
        <label className="rl-check">
          <input type="checkbox" checked={filters.onlyWithVictims} onChange={(e) => set({ onlyWithVictims: e.target.checked })} />
          Only rings with likely victims flagged
        </label>
        <div className="rl-count faint">
          <span className="num">{rings.length}</span> of <span className="num">{total}</span> rings · ring score is 0–100
          {active && (
            <button className="ghost rl-clear" onClick={() => set({ minRisk: 0, minAccounts: 0, onlyWithVictims: false })}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {accountResult && (
        <div className="rl-account" role="status">
          <div className="eyebrow">Account lookup</div>
          {accountResult.state === "loading" && <div className="faint">Looking up <span className="mono">{accountResult.id}</span>…</div>}
          {accountResult.state === "notfound" && (
            <div>
              No record of <span className="mono">{accountResult.id}</span> in the current results. That is not the same as safe: the API only knows accounts active in its
              window.
            </div>
          )}
          {accountResult.state === "error" && <div className="rl-err">Lookup failed: {accountResult.message}</div>}
          {accountResult.state === "ok" && (
            <div>
              <span className="mono">{accountResult.id}</span>{" "}
              {accountResult.ring_id ? (
                <>
                  is in ring <span className="mono">{accountResult.ring_id}</span>.{" "}
                  <button className="primary rl-open" onClick={() => onOpenAccount(accountResult.id, accountResult.ring_id)}>Show in graph</button>
                </>
              ) : (
                <>
                  is not in a flagged ring right now.{" "}
                  <button className="rl-open" onClick={() => onOpenAccount(accountResult.id, null)}>Open account</button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="rl-skel" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rl-skel-row"><div className="skel" style={{ width: "40%" }} /><div className="skel" style={{ width: "90%" }} /></div>
          ))}
        </div>
      ) : rings.length === 0 ? (
        <div className="empty">
          <strong>{unreachable ? "No data: the API is not reachable." : total === 0 ? "No rings returned by the API." : "No ring matches these filters."}</strong>
          {unreachable ? "See the banner above to retry." : total === 0 ? "When the model flags a group it appears here." : "Loosen the risk or size filter, or clear the search."}
        </div>
      ) : (
        <ol className="rl-list">
          {rings.map((r) => {
            const tone = riskTone(r.risk);
            const flags = victimCounts[r.ring_id] || 0;
            return (
              <li key={r.ring_id}>
                <button className={`rl-row${r.ring_id === selectedId ? " selected" : ""}`} onClick={() => onSelect(r.ring_id)} aria-current={r.ring_id === selectedId ? "true" : undefined}>
                  <span className="rl-risk"><RiskMeter value={r.risk} compact /></span>
                  <span className="rl-main">
                    <span className="rl-top">
                      <span className="mono rl-id">{r.ring_id}</span>
                      <span className="faint rl-size num">{r.accounts} accounts</span>
                    </span>
                    <span className="rl-headline">{r.headline}</span>
                    <span className="rl-foot faint">
                      {flags > 0 && (
                        <span className="rl-flag" title="Accounts that recently paid into this ring, flagged as likely victims. Nothing is sent to them. The scorer lists at most 3 per ring.">
                          <Flag size={11} aria-hidden="true" /> {flags} likely victim{flags === 1 ? "" : "s"} flagged
                        </span>
                      )}
                      <span className="mono">flagged {formatUtc(r.flagged_at)}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
