import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { ROLE_LABEL, ROLE_TEXT, flowPath, heightFor, layoutRing, radiusFor, strokeFor, visibleGraph } from "../lib/graphLayout";
import { INK, LAV, LAV_DARK, ROSE, nodePrimitives, pillWidth } from "../lib/nodeStyle";
import "./D3Graph.css";

// The money flow of one ring, drawn the way link-analysis tools draw it: columns that follow the money from
// the payers on the left to the cash-out on the right, thin smooth links with small arrowheads, and flat
// account marks (see lib/nodeStyle.js). Size shows how much money passed through an account; the thin ring
// around a collector fills with its risk score. Roles are estimated.
//
// `cutoff` (ISO string, number or Date) shows only the payments that had arrived by then, and an account
// appears with its first payment ("no peeking into the future"). With no cutoff everything is shown.
const W = 640;
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
    return draw(svgRef.current, wrapRef.current, tipRef.current, ring, cutoff, dragged.current);
  }, [ring, ringId, cutoff]);

  if (!ring) return <div className="empty">Loading graph…</div>;

  return (
    <div className="graph-wrap" ref={wrapRef}>
      <svg ref={svgRef} className="d3-graph" preserveAspectRatio="xMidYMid meet" role="img"
        aria-label={`Money flow of ring ${ring.ring_id || ""}: payers on the left, then the collectors and pass-through accounts, and the cash-out on the right.`} />
      <div ref={tipRef} className="graph-tooltip" hidden />
    </div>
  );
}

function drawMarks(group, d, r, scoreVisible) {
  for (const p of nodePrimitives(d.role, r, scoreVisible ? d.score : null)) {
    if (p.type === "path") {
      group.append("path").attr("d", p.d).attr("fill", p.fill).attr("stroke", p.stroke).attr("stroke-width", p.strokeWidth).attr("stroke-linecap", p.linecap || "butt");
    } else if (p.type === "rect") {
      group.append("rect").attr("x", -p.r).attr("y", -p.r).attr("width", 2 * p.r).attr("height", 2 * p.r).attr("rx", Math.min(3.5, p.r * 0.3))
        .attr("fill", p.fill).attr("stroke", p.stroke || "none").attr("stroke-width", p.strokeWidth || 0).attr("opacity", p.opacity ?? 1);
    } else {
      group.append("circle").attr("r", p.r).attr("fill", p.fill).attr("stroke", p.stroke || "none").attr("stroke-width", p.strokeWidth || 0)
        .attr("stroke-dasharray", p.dash || null).attr("opacity", p.opacity ?? 1);
    }
  }
}

function draw(svgEl, wrapEl, tipEl, ring, cutoff, dragged) {
  const svg = d3.select(svgEl);
  const H = heightFor(layoutRing(ring.members || [], ring.edges || [], W, 1000).maxPerColumn);
  svg.attr("viewBox", `0 0 ${W} ${H}`);
  const { pos: base, columns } = layoutRing(ring.members || [], ring.edges || [], W, H);
  const dur = reduced() ? 0 : 360;
  let focus = null;

  const defs = svg.selectAll("defs").data([0]).join("defs");
  defs.selectAll("filter").data([0]).join((enter) => {
    const f = enter.append("filter").attr("id", "nz-shadow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    f.append("feDropShadow").attr("dx", 0).attr("dy", 1.2).attr("stdDeviation", 1.8).attr("flood-color", INK).attr("flood-opacity", 0.2);
    return f;
  });
  defs.selectAll("marker").data([["arrow-rose", ROSE], ["arrow-lav", LAV_DARK]], (d) => d[0]).join((enter) => {
    const m = enter.append("marker").attr("id", (d) => d[0]).attr("viewBox", "0 0 10 10").attr("refX", 9).attr("refY", 5)
      .attr("markerUnits", "userSpaceOnUse").attr("markerWidth", 8).attr("markerHeight", 8).attr("orient", "auto");
    m.append("path").attr("d", "M0,1.2 L9,5 L0,8.8 z").attr("fill", (d) => d[1]);
    return m;
  });
  const layers = svg.selectAll("g.layer").data(["guides", "edges", "nodes", "legend", "note"]).join("g").attr("class", (d) => `layer ${d}`);
  const layer = (name) => layers.filter((d) => d === name);

  layer("guides").selectAll("g.col").data(columns, (d) => d.label + d.x).join((enter) => {
    const g = enter.append("g").attr("class", "col");
    g.append("line").attr("y1", 30).attr("y2", H - 34).attr("stroke", "#E6E8F0").attr("stroke-dasharray", "1 5").attr("stroke-linecap", "round");
    g.append("text").attr("y", 16).attr("text-anchor", "middle").attr("font-size", 10).attr("font-weight", 700).attr("letter-spacing", "0.09em").attr("fill", "#7A8095");
    return g;
  }).attr("transform", (d) => `translate(${d.x},0)`).call((g) => g.select("text").text((d) => d.label.toUpperCase()));

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
  const fromPayer = (d) => roleOf.get(d.source) === "victim";
  const linkWidth = (d) => 0.9 + (strokeFor(d.amount, maxAmount) - 1.1) * 0.62;
  const linkOpacity = (d) => (focus == null ? (fromPayer(d) ? 0.75 : 0.55) : d.source === focus || d.target === focus ? 1 : 0.07);
  const nodeOpacity = (d) => (focus == null || d.id === focus || (neighbours.get(focus) && neighbours.get(focus).has(d.id)) ? 1 : 0.2);

  function pathOf(l) {
    const a = where(l.source);
    return flowPath(a, where(l.target), radii.get(l.source), radii.get(l.target), a.x > W / 2 ? 1 : -1);
  }

  function paint(animate) {
    const t = animate ? dur : 0;
    const sel = layer("edges").selectAll("path").data(graph.links, (d) => `${d.source}>${d.target}`);
    sel.exit().remove();
    sel.enter().append("path").attr("fill", "none").attr("opacity", 0).merge(sel)
      .attr("d", pathOf)
      .attr("stroke", (d) => (fromPayer(d) ? LAV : ROSE))
      .attr("stroke-width", linkWidth)
      .attr("stroke-linecap", "round")
      .attr("marker-end", (d) => `url(#${fromPayer(d) ? "arrow-lav" : "arrow-rose"})`)
      .transition().duration(t).attr("opacity", linkOpacity);

    const nsel = layer("nodes").selectAll("g.node").data(graph.nodes, (d) => d.id);
    nsel.exit().remove();
    const enter = nsel.enter().append("g").attr("class", "node").attr("tabindex", 0).attr("role", "img").attr("filter", "url(#nz-shadow)")
      .attr("transform", (d) => `translate(${where(d.id).x},${where(d.id).y}) scale(${animate ? 0.3 : 1})`).attr("opacity", animate ? 0 : 1);
    const all = enter.merge(nsel);
    all.attr("aria-label", (d) => `${d.id}, ${ROLE_LABEL[d.role] || d.role}`)
      .each(function (d) {
        const g = d3.select(this);
        g.selectAll("*").remove();
        const r = radii.get(d.id);
        drawMarks(g, d, r, true);
        if (d.role === "collector" || d.role === "cashout") {
          const text = shortId(d.id);
          const w = pillWidth(text);
          const y = r + (d.role === "collector" ? 10 : 8);
          const label = g.append("g").attr("transform", `translate(0,${y})`).attr("filter", "none");
          label.append("rect").attr("x", -w / 2).attr("y", 0).attr("width", w).attr("height", 15).attr("rx", 7.5).attr("fill", "#fff").attr("stroke", "#E3E5EE");
          label.append("text").attr("y", 10.6).attr("text-anchor", "middle").attr("font-size", 9.5).attr("fill", "#4F566B").attr("font-family", "ui-monospace, monospace").text(text);
        }
      })
      .transition().duration(t).attr("opacity", nodeOpacity).attr("transform", (d) => `translate(${where(d.id).x},${where(d.id).y}) scale(1)`);

    all.on("pointerenter focus", (event, d) => setFocus(d, event))
      .on("pointermove", (event) => moveTip(event))
      .on("pointerleave blur", () => setFocus(null))
      .call(d3.drag().on("start", () => tipHide()).on("drag", (event, d) => {
        dragged.set(d.id, { x: clamp(event.x, 16, W - 16), y: clamp(event.y, 30, H - 22) });
        paint(false);
      }));

    const shown = ["victim", "collector", "mule", "cashout"].filter((r) => graph.nodes.some((n) => n.role === r));
    const items = layer("legend").selectAll("g.item").data(shown, (d) => d);
    items.exit().remove();
    items.enter().append("g").attr("class", "item").merge(items).attr("transform", (d, i) => `translate(${16 + i * 96},${H - 12})`).each(function (role) {
      const g = d3.select(this);
      g.selectAll("*").remove();
      drawMarks(g.append("g").attr("transform", "translate(7,-4)"), { role }, { collector: 7, mule: 5.5, cashout: 6, victim: 5 }[role] || 5, false);
      g.append("text").attr("x", 17).attr("y", 0).attr("font-size", 11).attr("fill", "#4F566B")
        .text(role === "victim" ? "Payer" : role === "cashout" ? "Cash-out" : role === "mule" ? "Pass-through" : "Collector");
    });
    layer("note").selectAll("text").data(graph.nodes.length ? [] : [0]).join("text").attr("x", W / 2).attr("y", H / 2)
      .attr("text-anchor", "middle").attr("font-size", 13).attr("fill", "#666D82").text("No payment has reached this ring at this moment.");
  }

  function setFocus(d, event) {
    focus = d ? d.id : null;
    layer("nodes").selectAll("g.node").attr("opacity", (n) => nodeOpacity(n));
    layer("edges").selectAll("path").attr("opacity", linkOpacity)
      .attr("stroke-width", (l) => linkWidth(l) + (focus != null && (l.source === focus || l.target === focus) ? 1.1 : 0));
    if (d) { showTip(d); if (event && event.clientX != null) moveTip(event); } else tipHide();
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
    tipEl.style.left = `${clamp(event.clientX - box.left + 14, 4, Math.max(4, box.width - 240))}px`;
    tipEl.style.top = `${clamp(event.clientY - box.top + 14, 4, Math.max(4, box.height - 100))}px`;
  }
  function tipHide() { tipEl.hidden = true; }

  paint(true);
  return () => { tipEl.hidden = true; };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const shortId = (id) => String(id).replace(/^ACC-/, "");
