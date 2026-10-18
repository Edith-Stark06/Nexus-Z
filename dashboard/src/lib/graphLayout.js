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
  if (role === "collector") return 9 + 11 * share;
  if (role === "mule") return 7 + 6 * share;
  if (role === "cashout") return 11 + 5 * share;
  return 7 + 4 * share;
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
