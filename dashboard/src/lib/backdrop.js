/**
 * Layout of the decorative network behind the landing and sign-in pages (pure functions, no DOM).
 *
 * The picture is built from tiles of the same structure as the ring graph: payers on the left, then collectors,
 * pass-through accounts and a cash-out, joined by straight links. A tile is made from its index, so the same
 * tile is always the same picture, and tiles are stacked down the page so the effect continues as you scroll.
 * It is decoration. It is not data.
 */
export const TILE_H = 760;

/** A small seeded random number generator (mulberry32), so a tile never changes between visits. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLUMNS = [
  { role: "victim", at: 0.06, count: [6, 8], r: 4.5 },
  { role: "collector", at: 0.3, count: [3, 4], r: 7.5 },
  { role: "mule", at: 0.6, count: [3, 4], r: 5.5 },
  { role: "cashout", at: 0.92, count: [1, 2], r: 7 },
];

/** The nodes and links of one tile for a page `width` pixels wide. */
export function makeTile(index, width) {
  const r = rng(1013 + index * 7919);
  const narrow = width < 700;
  const cols = narrow ? COLUMNS.filter((c) => c.role !== "mule") : COLUMNS;
  const nodes = [];
  const byRole = {};
  cols.forEach((c, ci) => {
    const n = c.count[0] + Math.floor(r() * (c.count[1] - c.count[0] + 1));
    const slot = (TILE_H - 120) / n;
    byRole[c.role] = [];
    for (let k = 0; k < n; k++) {
      const node = {
        id: `${index}:${c.role}${k}`,
        role: c.role,
        r: c.r,
        x: width * c.at + (r() - 0.5) * width * 0.05,
        y: 60 + slot * (k + 0.5) + (r() - 0.5) * slot * 0.5,
      };
      nodes.push(node);
      byRole[c.role].push(node);
    }
    void ci;
  });
  const nearest = (from, list, k = 1) => [...list].sort((a, b) => Math.abs(a.y - from.y) - Math.abs(b.y - from.y)).slice(0, k);
  const links = [];
  const next = narrow ? { victim: "collector", collector: "cashout" } : { victim: "collector", collector: "mule", mule: "cashout" };
  for (const node of nodes) {
    const to = next[node.role];
    if (!to || !byRole[to]) continue;
    const many = node.role === "collector" ? 2 : 1;
    for (const target of nearest(node, byRole[to], many)) links.push({ a: node, b: target, kind: node.role === "victim" ? "deposit" : "flow" });
  }
  return { nodes, links };
}

/** Which tile indexes cover the vertical range [top, bottom] of the page after the parallax shift. */
export function visibleTiles(top, bottom) {
  const first = Math.floor(top / TILE_H);
  const last = Math.floor(bottom / TILE_H);
  const out = [];
  for (let i = first; i <= last; i++) out.push(i);
  return out;
}
