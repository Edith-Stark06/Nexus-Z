import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Search } from "lucide-react";
import GraphCanvas from "../GraphCanvas";
import RiskMeter from "../RiskMeter";
import RoleGlyph from "../RoleGlyph";
import { GraphZoom } from "../explorer/GraphToolbar";
import { ROLE_ORDER, ROLE_LABELS, formatUtc, riskTone } from "../../lib/constants";
import { buildGraph, linkId, pickFocusAccount } from "../../lib/graph";
import { useAccountRecord } from "../../state/hooks";
import { useHeroNetwork } from "./useHomeData";
import "./HeroNetwork.css";

const SOURCE_COPY = {
  live: { tone: "ok", title: "Live results", note: (h) => `Top flagged rings from the ${h.backend || "model"} backend. Only flagged rings are drawn; the project's data is synthetic.` },
  stub: { tone: "warn", title: "Stub backend sample", note: () => "The API is serving invented sample data. Nothing here is a model result." },
  illustrative: {
    tone: "warn",
    title: "Illustrative transaction network",
    note: (h) =>
      ({
        unreachable: "The API is not reachable, so this is a bundled, invented sample. It is not data from the system.",
        "no-rings": "The API returned no rings, so this is a bundled, invented sample. It is not data from the system.",
        demo: "Demo sample selected: invented accounts and rings that ship with the dashboard.",
      })[h.reason] || "Invented accounts and rings that ship with the dashboard. Not real data.",
  },
};

const amount = (v) => (v == null || Number.isNaN(Number(v)) ? "—" : Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(2));

/** What the selection is, in a compact strip under the graph. */
function Inspector({ sel, network, graph, source, onClear }) {
  const real = source === "live" || source === "stub";
  const nodeId = sel.kind === "node" ? sel.id : null;
  const rec = useAccountRecord(real ? nodeId : null);

  if (sel.kind === "node") {
    const n = graph.nodes.find((x) => x.id === sel.id);
    if (!n) return null;
    const cluster = network.clusters.find((c) => c.id === n.cluster);
    const reasons = (rec.account?.reasons || []).slice(0, 2);
    return (
      <div className="hi" aria-live="polite">
        <div className="hi-col">
          <div className="eyebrow">Account</div>
          <div className="mono hi-id">{n.id}</div>
          <div className="hi-line"><RoleGlyph role={n.role} label /> <span className="faint">estimated role</span></div>
        </div>
        <div className="hi-col">
          <div className="eyebrow">In view</div>
          <div className="hi-line"><span className="num">{n.paymentsIn}</span> payments in · <span className="num">{n.paymentsOut}</span> out</div>
          {n.score != null && <div className="hi-line">Model score <span className="num mono">{n.score.toFixed(2)}</span></div>}
          {cluster && <div className="hi-line faint mono">{cluster.id}</div>}
        </div>
        <div className="hi-col hi-grow">
          <div className="eyebrow">Why it scores this way</div>
          {!real ? (
            <div className="faint hi-line">Illustrative account: there is no live record behind it.</div>
          ) : rec.state === "loading" ? (
            <div className="skel" style={{ width: "70%" }} />
          ) : reasons.length ? (
            <ul className="hi-reasons">{reasons.map((r) => <li key={r.feature}>{r.label || r.feature}</li>)}</ul>
          ) : (
            <div className="faint hi-line">{rec.state === "notfound" ? "The API has no current record for this account." : "No reasons returned."}</div>
          )}
        </div>
        <div className="hi-col hi-actions">
          {real && <Link to={`/account/${encodeURIComponent(n.id)}`} className="hi-link">Open account <ArrowRight size={13} aria-hidden="true" /></Link>}
          <button className="ghost" onClick={onClear}>Clear</button>
        </div>
      </div>
    );
  }

  if (sel.kind === "link") {
    const l = graph.links.find((x) => x.id === sel.id);
    if (!l) return null;
    return (
      <div className="hi" aria-live="polite">
        <div className="hi-col">
          <div className="eyebrow">Payments between two accounts</div>
          <div className="hi-line mono">{l.source} <ArrowRight size={12} aria-hidden="true" /> {l.target}</div>
          <div className="hi-line"><span className="num">{l.count}</span> payment{l.count === 1 ? "" : "s"}</div>
        </div>
        <div className="hi-col">
          <div className="eyebrow">First · last (UTC)</div>
          <div className="hi-line mono">{formatUtc(l.first)}</div>
          <div className="hi-line mono">{formatUtc(l.last)}</div>
        </div>
        <div className="hi-col hi-grow">
          <div className="eyebrow">Amounts <span className="faint">(mixed currencies)</span></div>
          <div className="hi-line mono">{l.payments.slice(0, 4).map((p) => amount(p.amount)).join(" · ")}{l.payments.length > 4 ? " …" : ""}</div>
        </div>
        <div className="hi-col hi-actions"><button className="ghost" onClick={onClear}>Clear</button></div>
      </div>
    );
  }

  if (sel.kind === "cluster") {
    const c = network.clusters.find((x) => x.id === sel.id);
    if (!c) return null;
    const reasons = (c.detail?.top_reasons || []).slice(0, 2);
    const tone = riskTone(c.risk);
    return (
      <div className="hi" aria-live="polite">
        <div className="hi-col">
          <div className="eyebrow">{source === "illustrative" ? "Illustrative cluster" : "Flagged ring"}</div>
          <div className="mono hi-id">{c.id}</div>
          <div className="hi-line"><RiskMeter value={c.risk} compact /> <span className="faint">{tone === "high" ? "automated signal, high" : "automated signal"}</span></div>
        </div>
        <div className="hi-col hi-grow">
          <div className="eyebrow">Why it was flagged</div>
          <div className="hi-line">{c.headline}</div>
          {reasons.length > 0 && <ul className="hi-reasons">{reasons.map((r) => <li key={r.feature}>{r.label || r.feature}</li>)}</ul>}
        </div>
        <div className="hi-col hi-actions">
          {source !== "illustrative" ? (
            <Link to={`/ring/${encodeURIComponent(c.id)}`} className="hi-link">Inspect this ring <ArrowRight size={13} aria-hidden="true" /></Link>
          ) : (
            <Link to="/rings" className="hi-link">Open the ring explorer <ArrowRight size={13} aria-hidden="true" /></Link>
          )}
          <button className="ghost" onClick={onClear}>Clear</button>
        </div>
      </div>
    );
  }

  return (
    <div className="hi hi-idle">
      <div className="hi-hint"><span className="eyebrow">Inspector</span> Hover an account to see its connections. Click an account, an arrow, or a cluster outline to inspect it.</div>
    </div>
  );
}

/**
 * The hero's transaction network: the top flagged rings, each a cluster, in one interactive graph. With no usable API data it
 * draws the bundled illustrative network instead and says so in its header.
 */
export default function HeroNetwork({ home }) {
  const { phase, network, changed, error } = useHeroNetwork(home, 3);
  const canvas = useRef(null);
  const [sel, setSel] = useState({ kind: "none", id: null });
  const [query, setQuery] = useState("");
  const [miss, setMiss] = useState(false);
  const [hidden, setHidden] = useState(() => new Set());

  // start on one distinctive account: the highest-scored collector of the top ring
  useEffect(() => {
    if (network) {
      const id = pickFocusAccount(network);
      setSel(id ? { kind: "node", id } : { kind: "none", id: null });
      setHidden(new Set());
    }
  }, [network]);

  const graph = useMemo(() => (network ? buildGraph(network, { hiddenRoles: hidden }) : { nodes: [], links: [] }), [network, hidden]);
  const clear = useCallback(() => setSel({ kind: "none", id: null }), []);
  const select = (kind) => (id) => {
    setSel({ kind, id });
    // choosing a cluster brings it up close; the Fit button returns to the whole picture
    if (kind === "cluster" && network) canvas.current?.fitNodes(network.members.filter((m) => m.cluster === id).map((m) => m.id));
  };

  useEffect(() => {
    const on = (e) => e.key === "Escape" && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || "") && clear();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [clear]);

  const find = (e) => {
    e.preventDefault();
    const q = query.trim().toLowerCase();
    if (!q || !network) return;
    const hit = network.members.find((m) => m.id.toLowerCase() === q) || network.members.find((m) => m.id.toLowerCase().includes(q));
    setMiss(!hit);
    if (hit) {
      setSel({ kind: "node", id: hit.id });
      setTimeout(() => canvas.current?.locate(hit.id), 0);
    }
  };

  const toggleRole = (r) =>
    setHidden((p) => {
      const n = new Set(p);
      n.has(r) ? n.delete(r) : n.add(r);
      return n;
    });

  const copy = SOURCE_COPY[home.source];
  const roleCounts = {};
  for (const m of network?.members || []) roleCounts[m.role || "unknown"] = (roleCounts[m.role || "unknown"] || 0) + 1;
  const roles = [...ROLE_ORDER, "unknown"].filter((r) => roleCounts[r]);
  const payments = graph.links.reduce((t, l) => t + l.count, 0);
  const focusNode = sel.kind === "node" ? graph.nodes.find((n) => n.id === sel.id) : null;

  return (
    <section className="hn" aria-label="Transaction network">
      <header className="hn-head">
        <div className="hn-title">
          <span className="eyebrow">Transaction network</span>
          {copy ? (
            <span className={`tag ${copy.tone}`}>
              <span className={`dot ${copy.tone}`} /> {copy.title}
              {home.source === "live" && home.backend ? ` · ${home.backend} backend` : ""}
            </span>
          ) : (
            <span className="tag">Connecting…</span>
          )}
        </div>
        <form className="hn-find" onSubmit={find} role="search">
          <Search size={13} aria-hidden="true" />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setMiss(false); }} placeholder="Find an account" aria-label="Find an account in the network" disabled={!network} />
          {miss && <span className="hn-miss" role="status">No match</span>}
        </form>
      </header>
      {copy && <p className="hn-note">{copy.note(home)}</p>}

      <div className="hn-canvas">
        {phase === "ready" && network && (
          <>
            <GraphCanvas
              ref={canvas}
              ring={network}
              hiddenRoles={hidden}
              clusters={network.clusters}
              hoverHighlight
              softDim
              fitMaxZoom={2.6}
              labels="auto"
              selectedNodeId={sel.kind === "node" ? sel.id : null}
              selectedLinkId={sel.kind === "link" ? sel.id : null}
              selectedClusterId={sel.kind === "cluster" ? sel.id : null}
              onSelectNode={select("node")}
              onSelectLink={select("link")}
              onSelectCluster={select("cluster")}
              onClear={clear}
              ariaLabel={home.source === "illustrative" ? "Illustrative transaction network" : "Network of the top flagged rings"}
            />
            <GraphZoom
              onZoomIn={() => canvas.current?.zoomIn()}
              onZoomOut={() => canvas.current?.zoomOut()}
              onFit={() => canvas.current?.fit()}
              onReset={() => { clear(); canvas.current?.fit(); }}
              canReset={sel.kind !== "none"}
            />
            <div className="hn-annot hn-annot-tl" aria-hidden="true">
              {focusNode ? (
                <>
                  <span className="eyebrow">Selected account</span>
                  <span className="mono">{focusNode.id}</span>
                </>
              ) : (
                <span className="eyebrow">{network.clusters.length} cluster{network.clusters.length === 1 ? "" : "s"} · {graph.nodes.length} accounts · {payments} payments</span>
              )}
            </div>
          </>
        )}
        {phase === "loading" && <div className="hn-state" aria-busy="true"><div className="skel" style={{ width: 180 }} /><span className="faint">Loading the network…</span></div>}
        {phase === "empty" && <div className="hn-state"><strong>No rings to draw.</strong><span className="faint">The API returned no flagged rings.</span></div>}
        {phase === "error" && <div className="hn-state"><strong>Could not load the network.</strong><span className="faint">{error || "The API did not answer."}</span></div>}
      </div>

      {changed && (
        <p className="hn-changed" role="status">A ring changed during a data refresh and was left out. The ring list has been refreshed.</p>
      )}

      <div className="hn-legend" aria-label="Legend">
        <ul>
          {roles.map((r) => (
            <li key={r}>
              <button className="ghost hn-role" aria-pressed={!hidden.has(r)} onClick={() => toggleRole(r)} title={hidden.has(r) ? "Show these accounts" : "Hide these accounts"}>
                <RoleGlyph role={r} dim={hidden.has(r)} />
                <span className={hidden.has(r) ? "hn-off" : ""}>{ROLE_LABELS[r]}</span>
                <span className="num faint">{roleCounts[r]}</span>
              </button>
            </li>
          ))}
          <li className="hn-key"><span className="hn-swatch hn-swatch-hull" aria-hidden="true" /> Outline: one flagged ring</li>
          <li className="hn-key">Arrow: payment direction</li>
        </ul>
        <span className="faint hn-roles-note">Roles are estimated, not labelled.</span>
      </div>

      {network && <Inspector sel={sel} network={network} graph={graph} source={home.source} onClear={clear} />}
    </section>
  );
}

export { linkId };
