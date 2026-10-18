/**
 * Layout for the ring flow graph (pure functions, no DOM).
 *
 * Nodes sit in columns that follow the money: payers (victims) on the left, then collectors, mule accounts,
 * and the cash-out on the right. Positions depend only on the member ids and roles, so they do not move
 * while the replay slider moves: an account simply appears once its first payment has arrived.
 */
import { edgesUpTo } from "./replay";

export const COLUMNS = { victim: 0.09, collector: 0.34, unknown: 0.5, mule: 0.62, cashout: 0.92 };
export const ROLE_ORDER = ["victim", "collector", "mule", "cashout"];
export const ROLE_LABEL = { victim: "Payers", collector: "Collectors", mule: "Mule chain", cashout: "Cash-out", unknown: "Unclassified" };
export const ROLE_TEXT = {
  victim: "An account that paid into the ring (estimated role)",
  collector: "Receives payments from many accounts and forwards them (estimated role)",
  mule: "Passes money on between collectors and the cash-out (estimated role)",
  cashout: "Moves money out of the ring (estimated role)",
  unknown: "Role not estimated",
};

function hash(id) {
  let h = 2166136261;
  for (let i = 0; i < String(id).length; i++) {
    h ^= String(id).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** Which accounts have appeared by `cutoff` (an account appears with its first payment), and the aggregated links between them. */
export function visibleGraph(members, edges, cutoff) {
  const shown = edgesUpTo(edges || [], cutoff);
  const volume = new Map();
  const pairs = new Map();
  for (const e of shown) {
    const amount = Number(e.amount) || 0;
    volume.set(e.src, (volume.get(e.src) || 0) + amount);
    volume.set(e.dst, (volume.get(e.dst) || 0) + amount);
    const key = `${e.src}>${e.dst}`;
    const p = pairs.get(key) || { source: e.src, target: e.dst, amount: 0, count: 0 };
    p.amount += amount;
    p.count += 1;
    pairs.set(key, p);
  }
  const byId = new Map((members || []).map((m) => [m.id, m]));
  const nodes = [...volume.keys()]
    .filter((id) => byId.has(id))
    .map((id) => ({ id, role: byId.get(id).role || "unknown", score: byId.get(id).score, volume: volume.get(id) }));
  const ids = new Set(nodes.map((n) => n.id));
  const links = [...pairs.values()].filter((l) => ids.has(l.source) && ids.has(l.target));
  return { nodes, links };
}

/** Fixed positions for every member (shown or not), so a replay never moves a node. */
export function layoutMembers(members, width, height, pad = 34) {
  const groups = {};
  for (const m of members || []) {
    const role = COLUMNS[m.role] != null ? m.role : "unknown";
    (groups[role] = groups[role] || []).push(m.id);
  }
  const pos = new Map();
  for (const [role, ids] of Object.entries(groups)) {
    ids.sort();
    const n = ids.length;
    ids.forEach((id, i) => {
      const y = pad + ((i + 0.5) * (height - 2 * pad)) / n;
      const wobble = role === "victim" || role === "cashout" ? 0 : (hash(id) - 0.5) * 0.09 * width;
      const stagger = role === "victim" ? (i % 2 ? 0.025 : -0.015) * width : 0;
      pos.set(id, { x: COLUMNS[role] * width + wobble + stagger, y });
    });
  }
  return pos;
}

/** Radius from the share of the largest flow (square-root scale, so one huge account does not dwarf the rest). */
export function radiusFor(role, volume, maxVolume) {
  const share = maxVolume > 0 ? Math.sqrt(Math.max(volume, 0) / maxVolume) : 0;
  if (role === "victim") return 5.5 + 2.5 * share;
  if (role === "collector") return 9 + 6 * share;
  if (role === "mule") return 7 + 4 * share;
  if (role === "cashout") return 10 + 4 * share;
  return 7 + 3 * share;
}

/** A gently curved path between two points; `bend` separates two links that run between the same pair. */
export function curvePath(a, b, bend = 0.16) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${(mx - dy * bend).toFixed(1)},${(my + dx * bend).toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
}

/** Stroke width from the amount carried (square root of the share of the largest link). */
export function strokeFor(amount, maxAmount) {
  const share = maxAmount > 0 ? Math.sqrt(Math.max(amount, 0) / maxAmount) : 0;
  return 1.1 + 3.4 * share;
}

/** The point a fraction t along the curve that `curvePath` draws between a and b. */
export function curvePoint(a, b, t, bend = 0.16) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const cx = mx - (b.y - a.y) * bend;
  const cy = my + (b.x - a.x) * bend;
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y };
}

/* ---------- ring layout that follows the money (used by the ring graph) ---------- */

/**
 * Where every account of a ring sits. Payers are on the left and the cash-out on the right; the accounts in
 * between sit in columns by how many steps the money has taken from a collector, so a chain of mule accounts
 * runs left to right instead of piling into one column. Accounts in a column are ordered to cut down crossings
 * (average position of their neighbours, a few sweeps). Everything depends on the whole ring, not on the replay
 * moment, so positions never move while the slider does.
 */
export function layoutRing(members, edges, width, height, pad = 40) {
  const byId = new Map((members || []).map((m) => [m.id, m]));
  const flows = (edges || []).filter((e) => byId.has(e.src) && byId.has(e.dst) && e.src !== e.dst);
  const roleOf = (id) => byId.get(id).role;
  const isPayer = (id) => roleOf(id) === "victim";
  const isCash = (id) => roleOf(id) === "cashout";

  // steps from the collectors (accounts that take payers' money, or have nothing coming in from inside the ring)
  const middle = [...byId.keys()].filter((id) => !isPayer(id) && !isCash(id));
  const fromPayer = new Set(flows.filter((e) => isPayer(e.src)).map((e) => e.dst));
  const hasIn = new Set(flows.filter((e) => !isPayer(e.src)).map((e) => e.dst));
  const rank = new Map();
  const queue = [];
  for (const id of middle) if (fromPayer.has(id) || !hasIn.has(id)) { rank.set(id, 1); queue.push(id); }
  if (!queue.length && middle.length) { rank.set(middle[0], 1); queue.push(middle[0]); }
  while (queue.length) {
    const id = queue.shift();
    for (const e of flows) {
      if (e.src === id && !rank.has(e.dst) && !isPayer(e.dst) && !isCash(e.dst)) { rank.set(e.dst, rank.get(id) + 1); queue.push(e.dst); }
    }
  }
  for (const id of middle) if (!rank.has(id)) rank.set(id, 1);
  const maxRank = Math.max(0, ...middle.map((id) => rank.get(id)));

  const cols = []; // each column: { ids, label }
  const payers = [...byId.keys()].filter(isPayer);
  if (payers.length) cols.push({ ids: payers, label: "Payers" });
  for (let r = 1; r <= maxRank; r++) {
    const ids = middle.filter((id) => rank.get(id) === r);
    if (ids.length) cols.push({ ids, label: ids.filter((id) => roleOf(id) === "collector").length >= ids.length / 2 ? "Collectors" : "Pass-through" });
  }
  const cash = [...byId.keys()].filter(isCash);
  if (cash.length) cols.push({ ids: cash, label: "Cash-out" });
  const placed = new Set(cols.flatMap((c) => c.ids));
  const rest = [...byId.keys()].filter((id) => !placed.has(id));
  if (rest.length) cols.splice(Math.min(1, cols.length), 0, { ids: rest, label: "Other" });

  const colOf = new Map();
  cols.forEach((c, i) => c.ids.forEach((id) => colOf.set(id, i)));
  cols.forEach((c) => c.ids.sort());

  // order inside columns: average position of neighbours in the other columns, swept left to right and back
  const index = new Map();
  const reindex = () => cols.forEach((c) => c.ids.forEach((id, i) => index.set(id, (i + 0.5) / c.ids.length)));
  reindex();
  const weight = new Map();
  for (const e of flows) {
    weight.set(e.src, (weight.get(e.src) || []).concat([[e.dst, Number(e.amount) || 1]]));
    weight.set(e.dst, (weight.get(e.dst) || []).concat([[e.src, Number(e.amount) || 1]]));
  }
  const sweep = (order, towardLeft) => {
    for (const ci of order) {
      const col = cols[ci];
      const score = new Map(col.ids.map((id) => {
        const nb = (weight.get(id) || []).filter(([o]) => (towardLeft ? colOf.get(o) < ci : colOf.get(o) > ci));
        const tw = nb.reduce((s, [, w]) => s + w, 0);
        return [id, tw ? nb.reduce((s, [o, w]) => s + index.get(o) * w, 0) / tw : index.get(id)];
      }));
      col.ids.sort((a, b) => score.get(a) - score.get(b) || (a < b ? -1 : 1));
      col.ids.forEach((id, i) => index.set(id, (i + 0.5) / col.ids.length));
    }
  };
  const forward = cols.map((_, i) => i);
  for (let k = 0; k < 4; k++) { sweep(forward, true); sweep([...forward].reverse(), false); }

  const left = Math.max(pad, width * 0.07);
  const right = width - Math.max(pad, width * 0.07);
  const pos = new Map();
  const columns = [];
  cols.forEach((c, i) => {
    const x = cols.length === 1 ? width / 2 : left + ((right - left) * i) / (cols.length - 1);
    columns.push({ x, label: c.label });
    const n = c.ids.length;
    c.ids.forEach((id, k) => pos.set(id, { x, y: pad + 12 + ((k + 0.5) * (height - 2 * pad - 24)) / n }));
  });
  return { pos, columns, maxPerColumn: Math.max(1, ...cols.map((c) => c.ids.length)) };
}

/** Height of the ring graph: room for the busiest column, with space for the id labels under each account. */
export function heightFor(maxPerColumn) {
  return Math.max(340, Math.min(900, 96 + 60 * maxPerColumn));
}

/** Number of pairs of links that cross, for the given positions (used to check the ordering helps). */
export function crossings(links, pos) {
  let n = 0;
  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) {
      const a = links[i], b = links[j];
      if ([a.source, a.target].some((x) => x === b.source || x === b.target)) continue;
      const a1 = pos.get(a.source), a2 = pos.get(a.target), b1 = pos.get(b.source), b2 = pos.get(b.target);
      if (!a1 || !a2 || !b1 || !b2) continue;
      const d = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      if (d(a1, a2, b1) * d(a1, a2, b2) < 0 && d(b1, b2, a1) * d(b1, b2, a2) < 0) n++;
    }
  }
  return n;
}

/**
 * A smooth link from node a to node b. Left to right it is an S-shaped curve that leaves and enters horizontally.
 * A link that goes back or stays in its column bows out to the side, so it never runs through other accounts.
 */
export function flowPath(a, b, ra, rb, bowSide = -1) {
  const forward = b.x - a.x > 24;
  if (forward) {
    const x0 = a.x + ra + 1, x1 = b.x - rb - 7, mx = (x0 + x1) / 2;
    return `M${x0.toFixed(1)},${a.y.toFixed(1)} C${mx.toFixed(1)},${a.y.toFixed(1)} ${mx.toFixed(1)},${b.y.toFixed(1)} ${x1.toFixed(1)},${b.y.toFixed(1)}`;
  }
  const bow = bowSide * (34 + Math.min(40, Math.abs(b.y - a.y) * 0.18));
  const sx = a.x + bowSide * (ra + 1), ex = b.x + bowSide * (rb + 6);
  return `M${sx.toFixed(1)},${a.y.toFixed(1)} C${(sx + bow).toFixed(1)},${a.y.toFixed(1)} ${(ex + bow).toFixed(1)},${b.y.toFixed(1)} ${ex.toFixed(1)},${b.y.toFixed(1)}`;
}

/** The point a fraction t along the curve `flowPath` draws for a forward link (used for the travelling dots). */
export function flowPoint(a, b, ra, rb, t) {
  const x0 = a.x + ra + 1, x1 = b.x - rb - 7, mx = (x0 + x1) / 2;
  const u = 1 - t;
  return {
    x: u * u * u * x0 + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * x1,
    y: u * u * u * a.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t * t * t * b.y,
  };
}
