import { useState } from "react";
import { Search, ZoomIn, ZoomOut, Maximize2, RotateCcw } from "lucide-react";
import RoleGlyph from "../RoleGlyph";
import { ROLE_LABELS, ROLE_ORDER } from "../../lib/constants";
import "./GraphToolbar.css";

/** Controls above the graph: layout, colouring, labels, locate-an-account, zoom, reset. Every control changes the picture. */
export function GraphToolbar({ layout, setLayout, emphasis, setEmphasis, labels, setLabels, members, onLocate }) {
  const [q, setQ] = useState("");
  const [miss, setMiss] = useState(false);
  const submit = (e) => {
    e.preventDefault();
    const needle = q.trim().toLowerCase();
    if (!needle) return;
    const hit = members.find((m) => m.id.toLowerCase() === needle) || members.find((m) => m.id.toLowerCase().includes(needle));
    setMiss(!hit);
    if (hit) onLocate(hit.id);
  };
  return (
    <div className="gt" role="toolbar" aria-label="Graph controls">
      <div className="gt-group" role="group" aria-label="Layout">
        <span className="eyebrow">Layout</span>
        <div className="seg">
          <button aria-pressed={layout === "force"} onClick={() => setLayout("force")} title="Force layout: connected accounts pull together">Network</button>
          <button aria-pressed={layout === "flow"} onClick={() => setLayout("flow")} title="Flow layout: columns by estimated role, in the order money moves">Flow</button>
        </div>
      </div>
      <div className="gt-group" role="group" aria-label="Colour by">
        <span className="eyebrow">Colour</span>
        <div className="seg">
          <button aria-pressed={emphasis === "role"} onClick={() => setEmphasis("role")}>Role</button>
          <button aria-pressed={emphasis === "risk"} onClick={() => setEmphasis("risk")} title="Colour each account by its account score (0 to 1)">Score</button>
        </div>
      </div>
      <label className="gt-group">
        <span className="eyebrow">Labels</span>
        <select value={labels} onChange={(e) => setLabels(e.target.value)} aria-label="Account labels">
          <option value="auto">Auto</option>
          <option value="all">All</option>
          <option value="none">None</option>
        </select>
      </label>
      <form className="gt-find" onSubmit={submit} role="search">
        <Search size={13} aria-hidden="true" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setMiss(false); }} placeholder="Find account in this ring" aria-label="Find an account in this ring" />
        {miss && <span className="gt-miss" role="status">No match in this ring</span>}
      </form>
    </div>
  );
}

/** Zoom, fit and clear-selection, stacked in the corner of the canvas. */
export function GraphZoom({ onZoomIn, onZoomOut, onFit, onReset, canReset }) {
  return (
    <div className="gz" role="group" aria-label="Zoom and view">
      <button className="icon" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in"><ZoomIn size={15} /></button>
      <button className="icon" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out"><ZoomOut size={15} /></button>
      <button className="icon" onClick={onFit} aria-label="Fit graph to view" title="Fit to view"><Maximize2 size={15} /></button>
      <button className="icon" onClick={onReset} disabled={!canReset} aria-label="Clear selection" title="Clear selection (Esc)"><RotateCcw size={15} /></button>
    </div>
  );
}

/** Legend and role filter, as a strip under the toolbar so it never covers the graph. Shapes are estimated roles; a role can be hidden. */
export function GraphLegend({ members, hiddenRoles, toggleRole, emphasis }) {
  const counts = {};
  for (const m of members) counts[m.role || "unknown"] = (counts[m.role || "unknown"] || 0) + 1;
  const roles = [...ROLE_ORDER, "unknown"].filter((r) => counts[r]);
  return (
    <div className="gl" aria-label="Legend">
      <span className="eyebrow">Estimated role · accounts in this ring</span>
      <ul>
        {roles.map((r) => {
          const off = hiddenRoles.has(r);
          return (
            <li key={r}>
              <button className="gl-role ghost" aria-pressed={!off} onClick={() => toggleRole(r)} title={off ? "Show these accounts" : "Hide these accounts to see how the rest connects"}>
                <RoleGlyph role={r} color={emphasis === "risk" ? "#6f6f6f" : undefined} dim={off} />
                <span className={off ? "gl-off" : ""}>{ROLE_LABELS[r]}</span>
                <span className="num faint">{counts[r]}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <details className="gl-help">
        <summary>How to read this graph</summary>
        <div className="gl-key">
          <div>Each arrow is every payment from one account to another, pointing the way the money went. Thicker means more payments.</div>
          <div>Shape is the estimated role. Larger means a higher account score (0–1).{emphasis === "risk" ? " Colour is the account score, grey to red." : ""}</div>
          <div>Roles are guessed from an account's position in the ring; the data has no role labels. The API reports no currency, so amounts never set a size.</div>
          <div>Click an account or an arrow to inspect it. Scroll to zoom, drag the background to pan, drag an account to move it.</div>
        </div>
      </details>
    </div>
  );
}
