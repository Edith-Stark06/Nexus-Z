import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { COLUMNS, ROLE_LABEL, ROLE_ORDER, ROLE_TEXT, curvePath, layoutMembers, radiusFor, strokeFor, visibleGraph } from "../lib/graphLayout";
import "./D3Graph.css";

// The ring's money flow. Node shapes follow the design sheet: payers are hollow circles, collectors are
// filled rose circles, mule accounts are rose rings, and the cash-out is an ink square. Columns follow the
// money from left to right. Size shows how much money passed through an account. Roles are estimated.
//
// `cutoff` (ISO string, number or Date) shows only the payments that had arrived by then, and an account
// appears with its first payment ("no peeking into the future"). With no cutoff everything is shown.
const W = 560;
const H = 360;
const INK = "#0C0F1D";
const ROSE = "#E11D5A";
const LAV = "#9AA0EE";
const reduced = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function D3Graph({ ringId, ring, cutoff }) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const tipRef = useRef(null);
  const dragged = useRef(new Map()); // positions a person dragged accounts to, per ring

  useEffect(() => {
    if (!ring) return undefined;
    dragged.current = new Map();
    return () => d3.select(svgRef.current).selectAll("*").remove();
  }, [ring, ringId]);

  useEffect(() => {
    if (!ring || !svgRef.current) return undefined;
    const stop = draw(svgRef.current, wrapRef.current, tipRef.current, ring, cutoff, dragged.current);
    return stop;
  }, [ring, ringId, cutoff]);

  if (!ring) return <div className="empty">Loading graph…</div>;

  return (
    <div className="graph-wrap" ref={wrapRef}>
      <svg ref={svgRef} className="d3-graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
        aria-label={`Money flow of ring ${ring.ring_id || ""}: payers on the left, collectors, mule accounts and the cash-out on the right.`} />
      <div ref={tipRef} className="graph-tooltip" hidden />
    </div>
  );
}

function shapeFor(group, d, r, selected) {
  const g = group;
  const halo = d.role === "collector" && (d.score ?? 0) >= 0.8;
  if (halo) g.append("circle").attr("r", r + 6).attr("fill", "none").attr("stroke", ROSE).attr("stroke-opacity", 0.25).attr("stroke-width", 2);
  if (d.role === "cashout") {
    g.append("rect").attr("x", -r).attr("y", -r).attr("width", 2 * r).attr("height", 2 * r).attr("rx", 3).attr("fill", INK);
  } else if (d.role === "collector") {
    g.append("circle").attr("r", r).attr("fill", ROSE);
  } else if (d.role === "mule") {
    g.append("circle").attr("r", r).attr("fill", "#fff").attr("stroke", ROSE).attr("stroke-width", 3);
  } else if (d.role === "victim") {
    g.append("circle").attr("r", r).attr("fill", "#fff").attr("stroke", INK).attr("stroke-width", 2);
  } else {
    g.append("circle").attr("r", r).attr("fill", "#fff").attr("stroke", "#8a90a8").attr("stroke-width", 2).attr("stroke-dasharray", "3 2");
  }
  if (selected) g.append("circle").attr("r", r + 4).attr("fill", "none").attr("stroke", "#2430D9").attr("stroke-width", 2);
}

function trim(a, b, ra, rb) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  return { a: { x: a.x + (dx / d) * (ra + 1), y: a.y + (dy / d) * (ra + 1) }, b: { x: b.x - (dx / d) * (rb + 4), y: b.y - (dy / d) * (rb + 4) } };
}

function draw(svgEl, wrapEl, tipEl, ring, cutoff, dragged) {
  const svg = d3.select(svgEl);
  const base = layoutMembers(ring.members || [], W, H);
  const dur = reduced() ? 0 : 380;
  let focus = null;

  // Static parts: arrowheads and one layer per kind of mark.
  const defs = svg.selectAll("defs").data([0]).join("defs");
  defs.selectAll("marker").data([["arrow-rose", ROSE], ["arrow-lav", LAV]], (d) => d[0]).join((enter) => {
    const m = enter.append("marker").attr("id", (d) => d[0]).attr("viewBox", "0 0 10 10").attr("refX", 9).attr("refY", 5)
      .attr("markerUnits", "userSpaceOnUse").attr("markerWidth", 11).attr("markerHeight", 11).attr("orient", "auto");
    m.append("path").attr("d", "M0,0 L10,5 L0,10 z").attr("fill", (d) => d[1]);
    return m;
  });
  const layers = svg.selectAll("g.layer").data(["guides", "edges", "nodes", "legend", "note"]).join("g").attr("class", (d) => `layer ${d}`);
  const layer = (name) => layers.filter((d) => d === name);

  const roles = ROLE_ORDER.filter((r) => (ring.members || []).some((m) => m.role === r));
  layer("guides").selectAll("g.col").data(roles, (d) => d).join((enter) => {
    const g = enter.append("g").attr("class", "col");
    g.append("line").attr("y1", 26).attr("y2", H - 30).attr("stroke", "#E3E5EE").attr("stroke-dasharray", "2 5");
    g.append("text").attr("y", 14).attr("text-anchor", "middle").attr("font-size", 11).attr("font-weight", 600).attr("fill", "#666D82");
    return g;
  }).attr("transform", (d) => `translate(${COLUMNS[d] * W},0)`)
    .call((g) => g.select("text").text((d) => ROLE_LABEL[d]));

  const graph = visibleGraph(ring.members || [], ring.edges || [], cutoff);
  const maxVolume = Math.max(0, ...graph.nodes.map((n) => n.volume));
  const maxAmount = Math.max(0, ...graph.links.map((l) => l.amount));
  const roleOf = new Map(graph.nodes.map((n) => [n.id, n.role]));
  const radii = new Map(graph.nodes.map((n) => [n.id, radiusFor(n.role, n.volume, maxVolume)]));
  const where = (id) => dragged.get(id) || base.get(id) || { x: W / 2, y: H / 2 };
  const neighbours = new Map();
  for (const l of graph.links) {
    (neighbours.get(l.source) || neighbours.set(l.source, new Set()).get(l.source)).add(l.target);
    (neighbours.get(l.target) || neighbours.set(l.target, new Set()).get(l.target)).add(l.source);
  }

  function paths() {
    return graph.links.map((l) => {
      const t = trim(where(l.source), where(l.target), radii.get(l.source), radii.get(l.target));
      return { l, d: curvePath(t.a, t.b, 0.14) };
    });
  }

  function paint(animate) {
    const t = animate ? dur : 0;
    // links
    const sel = layer("edges").selectAll("path").data(graph.links, (d) => `${d.source}>${d.target}`);
    sel.exit().remove();
    const merged = sel.enter().append("path").attr("fill", "none").attr("opacity", 0).merge(sel);
    const dmap = new Map(paths().map((p) => [`${p.l.source}>${p.l.target}`, p.d]));
    merged.attr("d", (d) => dmap.get(`${d.source}>${d.target}`))
      .attr("stroke", (d) => (roleOf.get(d.source) === "victim" ? LAV : ROSE))
      .attr("stroke-width", (d) => strokeFor(d.amount, maxAmount))
      .attr("stroke-linecap", "round")
      .attr("marker-end", (d) => `url(#${roleOf.get(d.source) === "victim" ? "arrow-lav" : "arrow-rose"})`)
      .transition().duration(t).attr("opacity", (d) => linkOpacity(d));

    // accounts
    const nsel = layer("nodes").selectAll("g.node").data(graph.nodes, (d) => d.id);
    nsel.exit().remove();
    const enter = nsel.enter().append("g").attr("class", "node").attr("tabindex", 0).attr("role", "img")
      .attr("transform", (d) => `translate(${where(d.id).x},${where(d.id).y}) scale(${animate ? 0.2 : 1})`).attr("opacity", animate ? 0 : 1);
    const all = enter.merge(nsel);
    all.attr("aria-label", (d) => `${d.id}, ${ROLE_LABEL[d.role] || d.role}`)
      .each(function (d) {
        const g = d3.select(this);
        g.selectAll("*").remove();
        shapeFor(g, d, radii.get(d.id), focus === d.id);
        if (d.role === "collector" || d.role === "cashout") {
          g.append("text").attr("y", radii.get(d.id) + 14).attr("text-anchor", "middle").attr("font-size", 10).attr("fill", "#4F566B")
            .attr("font-family", "ui-monospace, monospace").text(shortId(d.id));
        }
      })
      .transition().duration(t).attr("opacity", (d) => nodeOpacity(d)).attr("transform", (d) => `translate(${where(d.id).x},${where(d.id).y}) scale(1)`);

    all.on("pointerenter focus", (event, d) => setFocus(d, event))
      .on("pointermove", (event, d) => moveTip(event, d))
      .on("pointerleave blur", () => setFocus(null))
      .call(d3.drag().on("start", () => tipHide()).on("drag", (event, d) => { dragged.set(d.id, { x: clamp(event.x, 14, W - 14), y: clamp(event.y, 24, H - 14) }); paint(false); }));

    // legend and the empty state
    const shown = ROLE_ORDER.filter((r) => graph.nodes.some((n) => n.role === r));
    const items = layer("legend").selectAll("g.item").data(shown, (d) => d);
    items.exit().remove();
    items.enter().append("g").attr("class", "item").merge(items).attr("transform", (d, i) => `translate(${14 + i * 92},${H - 10})`).each(function (role) {
      const g = d3.select(this);
      g.selectAll("*").remove();
      const swatch = g.append("g").attr("transform", "translate(6,-4)");
      shapeFor(swatch, { role }, 5, false);
      g.append("text").attr("x", 16).attr("y", 0).attr("font-size", 11).attr("fill", "#4F566B").text(role === "victim" ? "Payer" : role === "cashout" ? "Cash-out" : role === "mule" ? "Mule" : "Collector");
    });
    layer("note").selectAll("text").data(graph.nodes.length ? [] : [0]).join("text").attr("x", W / 2).attr("y", H / 2)
      .attr("text-anchor", "middle").attr("font-size", 13).attr("fill", "#666D82").text("No payment has reached this ring at this moment.");
  }

  const linkOpacity = (d) => (focus == null ? 0.85 : d.source === focus || d.target === focus ? 1 : 0.1);
  const nodeOpacity = (d) => (focus == null || d.id === focus || (neighbours.get(focus) && neighbours.get(focus).has(d.id)) ? 1 : 0.22);

  function setFocus(d, event) {
    focus = d ? d.id : null;
    layer("nodes").selectAll("g.node").attr("opacity", (n) => nodeOpacity(n));
    layer("edges").selectAll("path").attr("opacity", (l) => linkOpacity(l)).attr("stroke-width", (l) => strokeFor(l.amount, maxAmount) + (focus != null && (l.source === focus || l.target === focus) ? 1.2 : 0));
    if (d) { showTip(d); if (event && event.clientX != null) moveTip(event, d); } else tipHide();
  }

  function showTip(d) {
    const inN = graph.links.filter((l) => l.target === d.id).reduce((s, l) => s + l.count, 0);
    const outN = graph.links.filter((l) => l.source === d.id).reduce((s, l) => s + l.count, 0);
    tipEl.replaceChildren();
    const row = (cls, text) => { const el = document.createElement("div"); if (cls) el.className = cls; el.textContent = text; tipEl.appendChild(el); };
    row("tt-id", d.id);
    row("tt-role", ROLE_LABEL[d.role] || d.role);
    row("", ROLE_TEXT[d.role] || "");
    row("", `${inN} payment${inN === 1 ? "" : "s"} in, ${outN} out${d.score != null ? `. Risk score ${Number(d.score).toFixed(2)}` : ""}`);
    tipEl.hidden = false;
  }
  function moveTip(event) {
    const box = wrapEl.getBoundingClientRect();
    const x = clamp(event.clientX - box.left + 14, 4, Math.max(4, box.width - 240));
    const y = clamp(event.clientY - box.top + 14, 4, Math.max(4, box.height - 100));
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y}px`;
  }
  function tipHide() { tipEl.hidden = true; }

  paint(true);
  return () => { tipEl.hidden = true; };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const shortId = (id) => String(id).replace(/^ACC-/, "");
