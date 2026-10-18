import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { ROLE_COLORS } from "../lib/constants";
import { edgesUpTo } from "../lib/replay";

// Render the ring's transaction edges as a force-directed graph.
// Nodes are coloured by estimated role; edges are sized by amount.
//
// `cutoff` (ISO string, number, or Date) slices the edges to only those that
// arrived at or before that moment — the "no peeking into the future" rule.
// When cutoff is null/undefined every edge is shown.
export function D3Graph({ ringId, ring, cutoff }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ring) return;
    draw(ref.current, ring, cutoff);
    return () => d3.select(ref.current).selectAll("*").remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ring, ringId, cutoff]);

  if (!ring) return <div className="empty">Loading graph…</div>;

  return <svg ref={ref} className="d3-graph" />;
}

function draw(svgEl, ring, cutoff) {
  const width = 520;
  const height = 340;
  const svg = d3.select(svgEl).attr("width", width).attr("height", height);

  // An arrowhead on every payment shows which way the money moved.
  svg
    .append("defs")
    .append("marker")
    .attr("id", "payment-arrow")
    .attr("viewBox", "0 -4 8 8")
    .attr("refX", 16)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-4L8,0L0,4")
    .attr("fill", "#6e7681");

  const g = svg.append("g");

  const visibleEdges = edgesUpTo(ring.edges || [], cutoff);

  const nodes = (ring.members || []).map((m) => ({
    id: m.id,
    role: m.role,
    score: m.score,
  }));

  const links = visibleEdges.map((e) => ({
    source: e.src,
    target: e.dst,
    amount: e.amount,
  }));

  const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const sim = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance(55).strength(0.15))
    .force("charge", d3.forceManyBody().strength(-220))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide().radius(16));

  const link = g
    .append("g")
    .attr("stroke", "#30363d")
    .attr("stroke-opacity", 0.7)
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke-width", (d) => Math.max(1, Math.cbrt((d.amount || 0) / 500)))
    .attr("marker-end", "url(#payment-arrow)");

  const node = g
    .append("g")
    .selectAll("circle")
    .data(nodes)
    .join("circle")
    .attr("r", (d) => 5 + (d.score ?? 0.5) * 9)
    .attr("fill", (d) => ROLE_COLORS[d.role] || ROLE_COLORS.unknown)
    .attr("stroke", "#0d1117")
    .attr("stroke-width", 1.5)
    .call(
      d3
        .drag()
        .on("start", dragStarted)
        .on("drag", dragged)
        .on("end", dragEnded)
    );

  // The last characters of the account id, so a node can be matched with the payments table.
  const label = g
    .append("g")
    .selectAll("text")
    .data(nodes)
    .join("text")
    .attr("font-size", 9)
    .attr("fill", "#8b949e")
    .attr("text-anchor", "middle")
    .attr("pointer-events", "none")
    .text((d) => String(d.id).slice(-4));

  const tooltip = g
    .append("text")
    .attr("class", "tt")
    .attr("font-size", 11)
    .attr("fill", "#e6edf3")
    .attr("opacity", 0);

  node
    .on("mouseover", (event, d) => {
      tooltip
        .attr("opacity", 1)
        .attr("x", event.offsetX + 12)
        .attr("y", event.offsetY - 12)
        .text(`${d.id} · ${d.role} · ${(d.score ?? 0).toFixed(2)}`);
    })
    .on("mouseout", () => tooltip.attr("opacity", 0))
    .on("mousemove", (event) => {
      tooltip.attr(
        "x",
        Math.min(width - 220, event.offsetX + 12)
      );
      tooltip.attr("y", Math.max(14, event.offsetY - 12));
    });

  node.append("title").text((d) => `${d.id} (${d.role})\nscore ${(d.score ?? 0).toFixed(2)}`);

  sim.on("tick", () => {
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);
    node.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
    label.attr("x", (d) => d.x).attr("y", (d) => d.y + 5 + (d.score ?? 0.5) * 9 + 10);
  });

  function dragStarted(event, d) {
    if (!event.active) sim.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }
  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }
  function dragEnded(event, d) {
    if (!event.active) sim.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }
}