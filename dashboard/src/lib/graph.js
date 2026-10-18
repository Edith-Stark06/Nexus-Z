/**
 * Pure graph helpers for the ring explorer: no React, no DOM, so they can be tested directly.
 *
 * A ring from GET /rings/{id} has `members` (id, estimated role, model score) and `edges` (one row per payment:
 * src, dst, amount, ts). The graph shows members as nodes and *pairs* as links: all payments from A to B are
 * folded into one link that keeps the individual payments, so a busy pair is one clear arrow, not a pile of lines.
 */
import { polygonHull, line as d3line, curveCatmullRomClosed } from "d3";
import { edgesUpTo } from "./replay";
import { ROLE_ORDER } from "./constants";

export const DEFAULT_SIZE = { width: 900, height: 600 };

export function linkId(src, dst) {
  return `${src}>${dst}`;
}

// Fold payments into one link per ordered pair. Payments whose endpoints are not (visible) nodes are dropped, and so
// are self-payments, which cannot be drawn as an arrow between two nodes.
export function aggregateLinks(edges, nodeIds) {
  const byPair = new Map();
  for (const e of edges || []) {
    if (!e || e.src === e.dst || !nodeIds.has(e.src) || !nodeIds.has(e.dst)) continue;
    const id = linkId(e.src, e.dst);
    let l = byPair.get(id);
    if (!l) {
      l = { id, source: e.src, target: e.dst, payments: [] };
      byPair.set(id, l);
    }
    l.payments.push(e);
  }
  const links = [...byPair.values()];
  for (const l of links) {
    l.payments.sort((a, b) => new Date(a.ts) - new Date(b.ts));
    l.count = l.payments.length;
    l.first = l.payments[0].ts;
    l.last = l.payments[l.payments.length - 1].ts;
    // Amounts in a ring can mix currencies, so this sum is a magnitude for ordering only, never a dollar value.
    l.total = l.payments.reduce((t, p) => t + (Number(p.amount) || 0), 0);
  }
  return links.sort((a, b) => (a.id < b.id ? -1 : 1));
}

// Nodes and links of a ring as drawn. `cutoff` applies the replay rule (only payments at or before that time);
// `hiddenRoles` hides members of those estimated roles together with their payments.
export function buildGraph(ring, { cutoff = null, hiddenRoles = new Set() } = {}) {
  const members = (ring?.members || []).filter((m) => !hiddenRoles.has(m.role || "unknown"));
  const ids = new Set(members.map((m) => m.id));
  const edges = cutoff == null ? ring?.edges || [] : edgesUpTo(ring?.edges || [], cutoff);
  const links = aggregateLinks(edges, ids);
  const degIn = new Map();
  const degOut = new Map();
  for (const l of links) {
    degOut.set(l.source, (degOut.get(l.source) || 0) + l.count);
    degIn.set(l.target, (degIn.get(l.target) || 0) + l.count);
  }
  const nodes = members.map((m) => ({
    id: m.id,
    role: m.role || "unknown",
    score: typeof m.score === "number" ? m.score : null,
    cluster: m.cluster ?? null,
    paymentsIn: degIn.get(m.id) || 0,
    paymentsOut: degOut.get(m.id) || 0,
  }));
  return { nodes, links };
}

// The selected node, its direct neighbours, and the links between the node and them.
export function neighborhood(graph, id) {
  const nodeIds = new Set([id]);
  const linkIds = new Set();
  for (const l of graph.links) {
    if (l.source === id || l.target === id) {
      nodeIds.add(l.source);
      nodeIds.add(l.target);
      linkIds.add(l.id);
    }
  }
  return { nodeIds, linkIds };
}

// A smaller ring-shaped object around one account: that account, its direct counterparties inside the ring, and the
// payments between any two of them. Used for the account page's mini graph.
export function egoRing(ring, accountId) {
  const edges = ring?.edges || [];
  const near = new Set([accountId]);
  for (const e of edges) {
    if (e.src === accountId) near.add(e.dst);
    if (e.dst === accountId) near.add(e.src);
  }
  return {
    ...ring,
    members: (ring?.members || []).filter((m) => near.has(m.id)),
    edges: edges.filter((e) => near.has(e.src) && near.has(e.dst)),
  };
}

export function nodeRadius(score) {
  const s = typeof score === "number" ? Math.max(0, Math.min(1, score)) : 0.5;
  return 6 + s * 8;
}

// Deterministic starting positions (a spiral), so the same ring always settles into the same picture.
export function seedPositions(nodes, center = { x: 0, y: 0 }) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out = new Map();
  nodes.forEach((n, i) => {
    const r = 26 * Math.sqrt(i + 0.5);
    out.set(n.id, { x: center.x + r * Math.cos(i * golden), y: center.y + r * Math.sin(i * golden) });
  });
  return out;
}

// "Flow" layout: one column per estimated role in the order money moves (victims, collectors, mules, cash-outs), the
// highest model scores at the top of each column. Roles are estimates, so this is a reading aid, not evidence.
export function flowLayout(nodes, { width, height, pad = 56 } = DEFAULT_SIZE) {
  const present = [...ROLE_ORDER.filter((r) => nodes.some((n) => n.role === r))];
  if (nodes.some((n) => !ROLE_ORDER.includes(n.role))) present.push("unknown");
  const cols = Math.max(1, present.length);
  const out = new Map();
  present.forEach((role, ci) => {
    const group = nodes
      .filter((n) => (role === "unknown" ? !ROLE_ORDER.includes(n.role) : n.role === role))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.id < b.id ? -1 : 1));
    const x = cols === 1 ? width / 2 : pad + (ci * (width - 2 * pad)) / (cols - 1);
    group.forEach((n, i) => {
      const y = group.length === 1 ? height / 2 : pad + (i * (height - 2 * pad)) / (group.length - 1);
      out.set(n.id, { x, y });
    });
  });
  return out;
}

// Zoom/pan that frames all points inside the viewport. `padRight` leaves room for the account labels that sit to the right
// of each node, `padTop` for cluster labels above the outlines; `maxK` stops a small ring from being blown up to fill the screen.
export function fitTransform(points, { width, height }, { pad = 56, padRight = pad, padTop = pad, maxK = 1.7, minK = 0.2 } = {}) {
  if (!points.length) return { k: 1, x: width / 2, y: height / 2 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const availW = Math.max(40, width - pad - padRight);
  const availH = Math.max(40, height - padTop - pad);
  const k = Math.max(minK, Math.min(maxK, availW / w, availH / h));
  return { k, x: pad + availW / 2 - (k * (x0 + x1)) / 2, y: padTop + availH / 2 - (k * (y0 + y1)) / 2 };
}

// Path for one link, shortened so the arrowhead ends at the edge of the target node. When the reverse link also
// exists, both are curved to opposite sides so they do not overlap.
export function linkPath(a, b, rs, rt, { curved = false, gap = 3 } = {}) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist, uy = dy / dist;
  const x1 = a.x + ux * (rs + gap), y1 = a.y + uy * (rs + gap);
  const x2 = b.x - ux * (rt + gap + 2), y2 = b.y - uy * (rt + gap + 2);
  const mid = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  if (!curved) return { d: `M${x1},${y1}L${x2},${y2}`, mid };
  const bend = Math.min(40, dist * 0.18);
  const cx = mid.x - uy * bend, cy = mid.y + ux * bend;
  return { d: `M${x1},${y1}Q${cx},${cy} ${x2},${y2}`, mid: { x: (x1 + 2 * cx + x2) / 4, y: (y1 + 2 * cy + y2) / 4 } };
}

export function hasReverse(link, linkIds) {
  return linkIds.has(linkId(link.target, link.source));
}

// ---- clusters: several rings drawn in one picture, each kept in its own region -----------------------------------------

// Where each cluster is pulled to by the force layout. A few clusters sit in a staggered row (the graph frame is wide);
// more than four go round an ellipse.
export function clusterAnchors(ids, radius = 150) {
  const out = new Map();
  const n = ids.length;
  ids.forEach((id, i) => {
    if (n === 1) out.set(id, { x: 0, y: 0 });
    else if (n <= 4) out.set(id, { x: (i - (n - 1) / 2) * radius * 1.55, y: (i % 2 === 0 ? -1 : 1) * radius * 0.3 });
    else {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      out.set(id, { x: radius * 1.3 * Math.cos(a), y: radius * Math.sin(a) });
    }
  });
  return out;
}

// A smooth outline around a group of nodes ({ x, y, r } each). Returns the SVG path, the label position (above the
// outline) and its size, or null when there is nothing to outline.
export function hullGeometry(items, pad = 16) {
  if (!items.length) return null;
  const pts = [];
  for (const it of items) {
    for (let k = 0; k < 10; k++) {
      const a = (2 * Math.PI * k) / 10;
      pts.push([it.x + (it.r + pad) * Math.cos(a), it.y + (it.r + pad) * Math.sin(a)]);
    }
  }
  const hull = polygonHull(pts);
  if (!hull) return null;
  const d = d3line().curve(curveCatmullRomClosed.alpha(0.6))(hull);
  const top = hull.reduce((m, p) => (p[1] < m[1] ? p : m), hull[0]);
  return { d, label: { x: items.reduce((t, i) => t + i.x, 0) / items.length, y: top[1] - 7 } };
}

// The nodes of one cluster and the links inside it.
export function clusterFocus(graph, clusterId) {
  const nodeIds = new Set(graph.nodes.filter((n) => n.cluster === clusterId).map((n) => n.id));
  const linkIds = new Set(graph.links.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target)).map((l) => l.id));
  return { nodeIds, linkIds };
}

// Several ring details (GET /rings/{id}) as one picture: every ring is a cluster, an account belongs to the first ring that lists it.
export function mergeRings(details) {
  const seen = new Set();
  const members = [];
  const edges = [];
  const clusters = [];
  for (const d of details) {
    clusters.push({ id: d.ring_id, label: `${d.ring_id} · risk ${d.risk}`, risk: d.risk, accounts: d.accounts, headline: d.headline, detail: d });
    for (const m of d.members || []) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      members.push({ ...m, cluster: d.ring_id });
    }
    for (const e of d.edges || []) edges.push(e);
  }
  return { ring_id: `merged:${details.map((d) => d.ring_id).join("+")}`, members, edges, clusters };
}

// The account to start on: the highest model score in the first ring, preferring a collector (the account money gathers at).
export function pickFocusAccount(ring) {
  const first = ring?.clusters?.[0]?.id;
  const pool = (ring?.members || []).filter((m) => !first || m.cluster === first);
  const best = (list) => [...list].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.id < b.id ? -1 : 1))[0];
  return (best(pool.filter((m) => m.role === "collector")) || best(pool) || best(ring?.members || []))?.id ?? null;
}
