import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { buildGraph, neighborhood, flowLayout, seedPositions, fitTransform, linkPath, nodeRadius, linkId, clusterAnchors, hullGeometry, clusterFocus, labelPlan, DEFAULT_SIZE } from "../lib/graph";
import { ROLE_COLORS, ROLE_LABELS, riskTone } from "../lib/constants";
import { accountScore } from "../lib/scores";
import "./GraphCanvas.css";

const FLOW_BOX = { width: 900, height: 600 };
const riskColor = d3.scaleLinear().domain([0, 0.5, 1]).range(["#8d8d8d", "#ba4e00", "#da1e28"]).clamp(true);

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
function computeForce(nodes, links, prev, anchors = null) {
  const seeds = seedPositions(nodes);
  const at = (n) => (anchors && anchors.get(n.cluster)) || { x: 0, y: 0 };
  const simNodes = nodes.map((n) => {
    const s = prev.get(n.id) || seeds.get(n.id);
    return { id: n.id, cluster: n.cluster, r: nodeRadius(n.score), x: s.x + at(n).x, y: s.y + at(n).y };
  });
  const simLinks = links.map((l) => ({ source: l.source, target: l.target }));
  const sim = d3
    .forceSimulation(simNodes)
    .force("link", d3.forceLink(simLinks).id((d) => d.id).distance(74).strength(0.45))
    .force("charge", d3.forceManyBody().strength(-280))
    .force("collide", d3.forceCollide((d) => d.r + 12))
    .force("x", d3.forceX((d) => at(d).x).strength(anchors ? 0.16 : 0.05))
    .force("y", d3.forceY((d) => at(d).y).strength(anchors ? 0.16 : 0.05))
    .stop();
  const steps = Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()));
  for (let i = 0; i < steps; i++) sim.tick();
  return new Map(simNodes.map((n) => [n.id, { x: n.x, y: n.y }]));
}

function NodeGlyph({ role, r, color, fill }) {
  const common = { stroke: color, strokeWidth: 2 };
  switch (role) {
    case "victim": // hollow circle
      return <circle r={r} fill="var(--graph-bg)" {...common} />;
    case "collector": // filled circle
      return <circle r={r} fill={fill} {...common} />;
    case "mule": // diamond
      return <rect x={-r * 0.82} y={-r * 0.82} width={r * 1.64} height={r * 1.64} rx="1.5" transform="rotate(45)" fill={fill} {...common} />;
    case "cashout": // square
      return <rect x={-r * 0.9} y={-r * 0.9} width={r * 1.8} height={r * 1.8} rx="2" fill={fill} {...common} />;
    default: // unknown: dashed circle
      return <circle r={r} fill="var(--graph-bg)" stroke={color} strokeWidth="1.6" strokeDasharray="3 2" />;
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
    clusters = NO_CLUSTERS, // [{ id, label, risk }]: groups of accounts drawn as outlined regions
    selectedClusterId = null,
    onSelectCluster,
    hoverHighlight = false, // highlight an account's connections while the pointer or keyboard focus is on it
    fitMaxZoom = 1.7, // how far the automatic framing may enlarge a small graph
    softDim = false, // keep what is not selected clearly visible (the homepage), instead of fading it right back
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
  const [focusId, setFocusId] = useState(null);
  const reduced = usePrefersReducedMotion();
  const hidden = hiddenRoles || EMPTY;

  // The picture is laid out from the whole ring, so scrubbing the replay slider does not make nodes jump; the visible
  // payments are the ones at or before the cutoff.
  const full = useMemo(() => buildGraph(ring, { hiddenRoles: hidden }), [ring, hidden]);
  const graph = useMemo(() => buildGraph(ring, { cutoff, hiddenRoles: hidden }), [ring, cutoff, hidden]);
  const nodeKey = full.nodes.map((n) => n.id).join("|");
  const linkKey = full.links.map((l) => l.id).join("|");
  const clusterKey = clusters.map((c) => c.id).join("|");

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
    applyTransform(fitTransform(pts, sizeRef.current, { pad: 40, padRight: labels === "none" ? 60 : 120, padTop: clusters.length ? 64 : 40, maxK: fitMaxZoom }), animate);
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
    pos.current = !full.nodes.length ? new Map() : layout === "flow" ? flowLayout(full.nodes, FLOW_BOX) : computeForce(full.nodes, full.links, new Map(), clusters.length ? clusterAnchors(clusters.map((c) => c.id), anchorRadius(full.nodes, clusters)) : null);
    setVersion((v) => v + 1);
    setFitToken((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ring?.ring_id, layout, nodeKey, linkKey, clusterKey]);

  useLayoutEffect(() => {
    if (fitToken && (measured || typeof ResizeObserver === "undefined")) fit(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken, measured]);

  useImperativeHandle(ref, () => ({
    fit: () => fit(true),
    // frame just some of the accounts (for example one cluster), leaving room for their labels
    fitNodes: (ids) => {
      const pts = ids.map((id) => pos.current.get(id)).filter(Boolean);
      if (pts.length) applyTransform(fitTransform(pts, sizeRef.current, { pad: 60, padRight: 110, padTop: 80, maxK: 3 }));
    },
    // frame an account and the accounts it exchanges payments with
    focusNeighbours: (id) => {
      const nb = neighborhood(graph, id);
      const pts = [...nb.nodeIds].map((x) => pos.current.get(x)).filter(Boolean);
      if (pts.length) applyTransform(fitTransform(pts, sizeRef.current, { pad: 70, padRight: 120, padTop: 70, maxK: 2.4 }));
      return pts.length;
    },
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
    // the account under the pointer (or keyboard focus) previews its connections, even over a selection; leaving restores the selection
    const over = hoverHighlight ? hover?.n?.id || focusId : null;
    if (over && graph.nodes.some((n) => n.id === over)) return neighborhood(graph, over);
    if (selectedLinkId) {
      const l = graph.links.find((x) => x.id === selectedLinkId);
      if (l) return { nodeIds: new Set([l.source, l.target]), linkIds: new Set([l.id]) };
    }
    if (selectedNodeId && graph.nodes.some((n) => n.id === selectedNodeId)) return neighborhood(graph, selectedNodeId);
    if (selectedClusterId && graph.nodes.some((n) => n.cluster === selectedClusterId)) return clusterFocus(graph, selectedClusterId);
    return null;
  }, [graph, selectedNodeId, selectedLinkId, selectedClusterId, hoverHighlight, hover, focusId]);

  // Labels are planned in screen space so that none lands on another label or account. The account under the pointer or keyboard
  // focus, and the selected one, are always named; their connections come next, then the highest-scored accounts.
  const overId = hover?.n?.id || focusId;
  const plan = useMemo(() => {
    if (labels === "none") return { shown: new Set(), hidden: 0, visible: graph.nodes.length };
    if (labels === "all") return { shown: new Set(graph.nodes.map((n) => n.id)), hidden: 0, visible: graph.nodes.length };
    const byScore = [...graph.nodes].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.id < b.id ? -1 : 1));
    const inFocus = focus ? byScore.filter((n) => focus.nodeIds.has(n.id)) : [];
    const priority = [...inFocus, ...byScore].map((n) => n.id);
    return labelPlan({
      nodes: graph.nodes,
      pos: pos.current,
      tf,
      size,
      radius: (n) => nodeRadius(n.score),
      priority,
      forced: [selectedNodeId, overId].filter(Boolean),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, tf, size, version, focus, selectedNodeId, overId, labels]);
  const labelled = (n) => plan.shown.has(n.id);

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
  const arrowSize = Math.max(7, Math.min(22, 9 / tf.k));
  void version;

  return (
    <div className={`gc${softDim ? " gc-soft" : ""}`} ref={wrapRef}>
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
          <marker id="gc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth={arrowSize} markerHeight={arrowSize} markerUnits="userSpaceOnUse" orient="auto">
            <path d="M0,1 L9,5 L0,9 z" fill="#8d8d8d" />
          </marker>
          <marker id="gc-arrow-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth={arrowSize + 1} markerHeight={arrowSize + 1} markerUnits="userSpaceOnUse" orient="auto">
            <path d="M0,1 L9,5 L0,9 z" fill="#0f62fe" />
          </marker>
        </defs>
        <rect data-bg="1" width="100%" height="100%" fill="transparent" />
        <g transform={`translate(${tf.x},${tf.y}) scale(${tf.k})`}>
          <g className="gc-hulls">
            {clusters.map((c) => {
              const members = graph.nodes.filter((n) => n.cluster === c.id);
              const items = members.map((n) => ({ ...pos.current.get(n.id), r: radius(n) })).filter((p) => p.x != null);
              const hull = hullGeometry(items);
              if (!hull) return null;
              const tone = riskTone(c.risk);
              const active = selectedClusterId === c.id;
              const dim = focus && !members.some((n) => focus.nodeIds.has(n.id));
              const select = () => onSelectCluster?.(c.id);
              return (
                <g key={c.id} className={`gc-hull tone-${tone}${active ? " sel" : ""}${dim ? " dim" : ""}`}>
                  <path d={hull.d} className="gc-hullpath" onClick={(e) => { e.stopPropagation(); select(); }} />
                  <g
                    className="gc-cluster-label"
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    aria-label={`Cluster ${c.label}, ${members.length} accounts`}
                    onClick={(e) => { e.stopPropagation(); select(); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } }}
                  >
                    {(() => {
                      // two short lines (the ring id, then its score) are half as wide as one long one, so the label never outgrows its ring
                      const lines = String(c.label).split(" · ");
                      const lh = 12.5 / tf.k;
                      return (
                        <text x={hull.label.x} y={hull.label.y - (lines.length - 1) * lh} textAnchor="middle" style={{ fontSize: 10.5 / tf.k, strokeWidth: 3.5 / tf.k }}>
                          {lines.map((t, i) => <tspan key={i} x={hull.label.x} dy={i === 0 ? 0 : lh}>{t}</tspan>)}
                        </text>
                      );
                    })()}
                  </g>
                </g>
              );
            })}
          </g>
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
                  aria-label={`Account ${n.id}, estimated role ${ROLE_LABELS[n.role] || n.role}${n.score != null ? `, account score ${accountScore(n.score)} on a 0 to 1 scale` : ""}${isSel ? ", selected" : ""}`}
                  aria-pressed={isSel}
                  onPointerDown={(e) => onNodeDown(e, n)}
                  onPointerMove={(e) => { onNodeMove(e); if (!drag.current) tip(e, n); }}
                  onPointerUp={(e) => onNodeUp(e, n)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => { setHover(null); setFocusId(n.id); }}
                  onBlur={() => setFocusId(null)}
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
      {labels === "auto" && plan.hidden > 0 && !empty && (
        <div className="gc-density" role="status">
          Labels shown for {plan.visible - plan.hidden} of {plan.visible} accounts in view, to keep names readable. Zoom in, or select an account, to name more.
        </div>
      )}
      {hover && (
        <div className="gc-tip" style={{ left: hover.x, top: hover.y }}>
          <div className="mono gc-tip-id">{hover.n.id}</div>
          <div>Estimated role: {ROLE_LABELS[hover.n.role] || hover.n.role}</div>
          {hover.n.cluster && <div className="mono">{hover.n.cluster}</div>}
          {hover.n.score != null && <div>Account score {accountScore(hover.n.score)} <span className="faint">(0–1)</span></div>}
          <div className="faint">
            {hover.n.paymentsIn} in · {hover.n.paymentsOut} out in view
          </div>
        </div>
      )}
    </div>
  );
});

// how far apart the cluster anchors sit: enough for the largest cluster, no more
function anchorRadius(nodes, clusters) {
  const size = {};
  for (const n of nodes) if (n.cluster) size[n.cluster] = (size[n.cluster] || 0) + 1;
  const biggest = Math.max(1, ...clusters.map((c) => size[c.id] || 0));
  return Math.max(100, Math.min(260, 55 + 24 * Math.sqrt(biggest)));
}

const EMPTY = new Set();
const NO_CLUSTERS = [];
export default GraphCanvas;
