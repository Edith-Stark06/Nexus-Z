import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { buildGraph, neighborhood, flowLayout, seedPositions, fitTransform, linkPath, nodeRadius, linkId, DEFAULT_SIZE } from "../lib/graph";
import { ROLE_COLORS, ROLE_LABELS } from "../lib/constants";
import "./GraphCanvas.css";

const FLOW_BOX = { width: 900, height: 600 };
const riskColor = d3.scaleLinear().domain([0, 0.5, 1]).range(["#51657a", "#e5af62", "#e87970"]).clamp(true);

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

// Force layout computed up front (no animation): the same ring always settles into the same picture, and nothing keeps
// moving while the analyst reads. `prev` keeps nodes where they were when only the node set changes slightly.
function computeForce(nodes, links, prev) {
  const seeds = seedPositions(nodes);
  const simNodes = nodes.map((n) => ({ id: n.id, r: nodeRadius(n.score), ...(prev.get(n.id) || seeds.get(n.id)) }));
  const simLinks = links.map((l) => ({ source: l.source, target: l.target }));
  const sim = d3
    .forceSimulation(simNodes)
    .force("link", d3.forceLink(simLinks).id((d) => d.id).distance(74).strength(0.45))
    .force("charge", d3.forceManyBody().strength(-280))
    .force("collide", d3.forceCollide((d) => d.r + 12))
    .force("x", d3.forceX(0).strength(0.05))
    .force("y", d3.forceY(0).strength(0.05))
    .stop();
  const steps = Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()));
  for (let i = 0; i < steps; i++) sim.tick();
  return new Map(simNodes.map((n) => [n.id, { x: n.x, y: n.y }]));
}

function NodeGlyph({ role, r, color, fill }) {
  const common = { stroke: color, strokeWidth: 2 };
  switch (role) {
    case "victim": // hollow circle
      return <circle r={r} fill="var(--bg)" {...common} />;
    case "collector": // filled circle
      return <circle r={r} fill={fill} {...common} />;
    case "mule": // diamond
      return <rect x={-r * 0.82} y={-r * 0.82} width={r * 1.64} height={r * 1.64} rx="1.5" transform="rotate(45)" fill={fill} {...common} />;
    case "cashout": // square
      return <rect x={-r * 0.9} y={-r * 0.9} width={r * 1.8} height={r * 1.8} rx="2" fill={fill} {...common} />;
    default: // unknown: dashed circle
      return <circle r={r} fill="var(--bg)" stroke={color} strokeWidth="1.6" strokeDasharray="3 2" />;
  }
}

/**
 * The interactive transaction graph of one ring.
 *
 * Nodes are accounts (shape = estimated role, size = model score). Each arrow is every payment from one account to another
 * (width = number of payments; amounts mix currencies, so they never set a size). Click a node or an arrow to select it; the
 * rest dims except the direct connections. Wheel zooms, dragging the background pans, dragging a node moves it.
 */
const GraphCanvas = forwardRef(function GraphCanvas(
  {
    ring,
    cutoff = null,
    hiddenRoles,
    layout = "force",
    emphasis = "role",
    labels = "auto",
    selectedNodeId = null,
    selectedLinkId = null,
    onSelectNode,
    onSelectLink,
    onClear,
    ariaLabel = "Transaction graph",
  },
  ref
) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const zoomRef = useRef(null);
  const pos = useRef(new Map());
  const drag = useRef(null);
  const sizeRef = useRef(DEFAULT_SIZE);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [measured, setMeasured] = useState(false); // true once the container has a real size; the first framing waits for it
  const [tf, setTf] = useState({ k: 1, x: 0, y: 0 });
  const [version, setVersion] = useState(0); // any position change: redraw
  const [fitToken, setFitToken] = useState(0); // a new layout: frame it (not on drags)
  const [hover, setHover] = useState(null);
  const reduced = usePrefersReducedMotion();
  const hidden = hiddenRoles || EMPTY;

  // The picture is laid out from the whole ring, so scrubbing the replay slider does not make nodes jump; the visible
  // payments are the ones at or before the cutoff.
  const full = useMemo(() => buildGraph(ring, { hiddenRoles: hidden }), [ring, hidden]);
  const graph = useMemo(() => buildGraph(ring, { cutoff, hiddenRoles: hidden }), [ring, cutoff, hidden]);
  const nodeKey = full.nodes.map((n) => n.id).join("|");
  const linkKey = full.links.map((l) => l.id).join("|");

  // measure the container
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) {
        sizeRef.current = { width: r.width, height: r.height };
        setSize({ width: r.width, height: r.height });
        setMeasured(true);
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const applyTransform = (t, animate = true) => {
    const svg = d3.select(svgRef.current);
    const z = zoomRef.current;
    if (!svg.node() || !z) return;
    const id = d3.zoomIdentity.translate(t.x, t.y).scale(t.k);
    if (animate && !reduced) svg.transition().duration(220).call(z.transform, id);
    else svg.call(z.transform, id);
  };

  const fit = (animate = true) => {
    const pts = graph.nodes.map((n) => pos.current.get(n.id)).filter(Boolean);
    applyTransform(fitTransform(pts, sizeRef.current, { pad: 48, padRight: labels === "none" ? 48 : 120 }), animate);
  };

  // zoom and pan
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const z = d3
      .zoom()
      .scaleExtent([0.15, 6])
      .filter((e) => !e.target.closest?.("[data-node]") && (!e.ctrlKey || e.type === "wheel") && !e.button)
      .on("zoom", (e) => setTf({ k: e.transform.k, x: e.transform.x, y: e.transform.y }));
    svg.call(z).on("dblclick.zoom", null);
    zoomRef.current = z;
    return () => {
      svg.on(".zoom", null);
    };
  }, []);

  // layout, then frame the picture
  useLayoutEffect(() => {
    pos.current = !full.nodes.length ? new Map() : layout === "flow" ? flowLayout(full.nodes, FLOW_BOX) : computeForce(full.nodes, full.links, new Map());
    setVersion((v) => v + 1);
    setFitToken((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ring?.ring_id, layout, nodeKey, linkKey]);

  useLayoutEffect(() => {
    if (fitToken && (measured || typeof ResizeObserver === "undefined")) fit(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken, measured]);

  useImperativeHandle(ref, () => ({
    fit: () => fit(true),
    zoomIn: () => d3.select(svgRef.current).transition().duration(reduced ? 0 : 160).call(zoomRef.current.scaleBy, 1.4),
    zoomOut: () => d3.select(svgRef.current).transition().duration(reduced ? 0 : 160).call(zoomRef.current.scaleBy, 1 / 1.4),
    locate: (id) => {
      const p = pos.current.get(id);
      if (!p) return false;
      const k = Math.max(tf.k, 1.4);
      applyTransform({ k, x: sizeRef.current.width / 2 - k * p.x, y: sizeRef.current.height / 2 - k * p.y });
      return true;
    },
  }));

  // selection: dim everything outside the selected node's connections, or outside the selected arrow
  const focus = useMemo(() => {
    if (selectedLinkId) {
      const l = graph.links.find((x) => x.id === selectedLinkId);
      if (l) return { nodeIds: new Set([l.source, l.target]), linkIds: new Set([l.id]) };
    }
    if (selectedNodeId && graph.nodes.some((n) => n.id === selectedNodeId)) return neighborhood(graph, selectedNodeId);
    return null;
  }, [graph, selectedNodeId, selectedLinkId]);

  const topScored = useMemo(() => new Set([...graph.nodes].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3).map((n) => n.id)), [graph]);
  const labelled = (n) =>
    labels === "all" || (labels !== "none" && (focus?.nodeIds.has(n.id) || graph.nodes.length <= 12 || tf.k >= 1.5 || topScored.has(n.id) || n.id === selectedNodeId));

  const linkSet = useMemo(() => new Set(graph.links.map((l) => l.id)), [graph]);
  const radius = (n) => nodeRadius(n.score);
  const nodeColor = (n) => (emphasis === "risk" ? riskColor(n.score ?? 0) : ROLE_COLORS[n.role] || ROLE_COLORS.unknown);

  // ---- node pointer handling: a short press selects, a drag moves the node
  const onNodeDown = (e, n) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = pos.current.get(n.id) || { x: 0, y: 0 };
    drag.current = { id: n.id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
  };
  const onNodeMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    pos.current.set(d.id, { x: d.ox + dx / tf.k, y: d.oy + dy / tf.k });
    setVersion((v) => v + 1);
  };
  const onNodeUp = (e, n) => {
    const d = drag.current;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (d && !d.moved) onSelectNode?.(n.id);
  };
  const onNodeKey = (e, n) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectNode?.(n.id);
    } else if (e.key === "Escape") onClear?.();
  };

  const tip = (e, n) => {
    const r = wrapRef.current.getBoundingClientRect();
    setHover({ n, x: e.clientX - r.left + 14, y: e.clientY - r.top + 12 });
  };

  const empty = graph.nodes.length === 0;
  void version;

  return (
    <div className="gc" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="gc-svg"
        role="group"
        aria-label={ariaLabel}
        onClick={(e) => {
          if (e.target === svgRef.current || e.target.dataset?.bg) onClear?.();
        }}
      >
        <defs>
          <marker id="gc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M0,1 L9,5 L0,9 z" fill="#5d7287" />
          </marker>
          <marker id="gc-arrow-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M0,1 L9,5 L0,9 z" fill="#a5d9e5" />
          </marker>
        </defs>
        <rect data-bg="1" width="100%" height="100%" fill="transparent" />
        <g transform={`translate(${tf.x},${tf.y}) scale(${tf.k})`}>
          <g className="gc-links">
            {graph.links.map((l) => {
              const a = pos.current.get(l.source), b = pos.current.get(l.target);
              if (!a || !b) return null;
              const na = graph.nodes.find((n) => n.id === l.source), nb = graph.nodes.find((n) => n.id === l.target);
              const { d, mid } = linkPath(a, b, radius(na), radius(nb), { curved: linkSet.has(linkId(l.target, l.source)) });
              const hi = focus?.linkIds.has(l.id);
              const dim = focus && !hi;
              const sel = l.id === selectedLinkId;
              const w = 1.2 + Math.min(3, Math.log2(l.count));
              return (
                <g key={l.id} className={`gc-link${hi ? " hi" : ""}${dim ? " dim" : ""}${sel ? " sel" : ""}`}>
                  <path d={d} className="gc-hit" onClick={(e) => { e.stopPropagation(); onSelectLink?.(l.id); }}>
                    <title>{`${l.source} → ${l.target}: ${l.count} payment${l.count === 1 ? "" : "s"}`}</title>
                  </path>
                  <path d={d} className="gc-line" strokeWidth={sel ? w + 1 : w} markerEnd={hi ? "url(#gc-arrow-hi)" : "url(#gc-arrow)"} />
                  {hi && l.count > 1 && (
                    <text className="gc-count" x={mid.x} y={mid.y - 4} textAnchor="middle">
                      ×{l.count}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
          <g className="gc-nodes">
            {graph.nodes.map((n) => {
              const p = pos.current.get(n.id);
              if (!p) return null;
              const r = radius(n);
              const isSel = n.id === selectedNodeId;
              const dim = focus && !focus.nodeIds.has(n.id);
              const col = nodeColor(n);
              return (
                <g
                  key={n.id}
                  data-node={n.id}
                  className={`gc-node${isSel ? " sel" : ""}${dim ? " dim" : ""}`}
                  transform={`translate(${p.x},${p.y})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`Account ${n.id}, estimated role ${ROLE_LABELS[n.role] || n.role}${n.score != null ? `, model score ${n.score.toFixed(2)}` : ""}${isSel ? ", selected" : ""}`}
                  aria-pressed={isSel}
                  onPointerDown={(e) => onNodeDown(e, n)}
                  onPointerMove={(e) => { onNodeMove(e); if (!drag.current) tip(e, n); }}
                  onPointerUp={(e) => onNodeUp(e, n)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(null)}
                  onKeyDown={(e) => onNodeKey(e, n)}
                >
                  <circle r={r + 6} className="gc-hitarea" />
                  {isSel && <circle r={r + 7} className="gc-halo" />}
                  <NodeGlyph role={n.role} r={r} color={col} fill={col} />
                  {labelled(n) && (
                    <text className="gc-label" x={r + 5} y={3.5 / tf.k} style={{ fontSize: 10.5 / tf.k, strokeWidth: 3.5 / tf.k }}>
                      {n.id}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {empty && (
        <div className="gc-note gc-note-center">
          <strong>No accounts to draw.</strong> This ring has no members in view (a role filter may be hiding them all).
        </div>
      )}
      {!empty && graph.links.length === 0 && (
        <div className="gc-note gc-note-bottom">No payments in view at this point of the replay.</div>
      )}
      {hover && (
        <div className="gc-tip" style={{ left: hover.x, top: hover.y }}>
          <div className="mono gc-tip-id">{hover.n.id}</div>
          <div>Estimated role: {ROLE_LABELS[hover.n.role] || hover.n.role}</div>
          {hover.n.score != null && <div>Model score {hover.n.score.toFixed(2)}</div>}
          <div className="faint">
            {hover.n.paymentsIn} in · {hover.n.paymentsOut} out in view
          </div>
        </div>
      )}
    </div>
  );
});

const EMPTY = new Set();
export default GraphCanvas;
