import { describe, it, expect } from "vitest";
import { COLUMNS, curvePath, curvePoint, layoutMembers, radiusFor, strokeFor, visibleGraph } from "../lib/graphLayout";
import { DEFAULTS, along, makeNodes, settled, stepNodes } from "../lib/heroPhysics";

const members = [
  { id: "ACC-V1", role: "victim", score: 0.1 }, { id: "ACC-V2", role: "victim", score: 0.1 }, { id: "ACC-V3", role: "victim", score: 0.1 },
  { id: "ACC-C1", role: "collector", score: 0.95 }, { id: "ACC-C2", role: "collector", score: 0.9 },
  { id: "ACC-M1", role: "mule", score: 0.8 }, { id: "ACC-X1", role: "cashout", score: 0.7 }, { id: "ACC-U1", role: "weird" },
];
const edges = [
  { src: "ACC-V1", dst: "ACC-C1", amount: 100, ts: "2022-09-01T10:00:00Z" },
  { src: "ACC-V2", dst: "ACC-C1", amount: 300, ts: "2022-09-01T10:05:00Z" },
  { src: "ACC-V2", dst: "ACC-C1", amount: 200, ts: "2022-09-01T10:06:00Z" },
  { src: "ACC-C1", dst: "ACC-M1", amount: 500, ts: "2022-09-01T11:00:00Z" },
  { src: "ACC-M1", dst: "ACC-X1", amount: 450, ts: "2022-09-01T12:00:00Z" },
];

describe("graph layout", () => {
  it("puts payers left of collectors, mules and the cash-out, in that order", () => {
    const pos = layoutMembers(members, 560, 360);
    const x = (id) => pos.get(id).x;
    expect(x("ACC-V1")).toBeLessThan(x("ACC-C1"));
    expect(x("ACC-C1")).toBeLessThan(x("ACC-M1"));
    expect(x("ACC-M1")).toBeLessThan(x("ACC-X1"));
    expect(COLUMNS.victim).toBeLessThan(COLUMNS.collector);
  });

  it("is deterministic, so a replay never moves an account", () => {
    const a = layoutMembers(members, 560, 360);
    const b = layoutMembers([...members].reverse(), 560, 360);
    for (const m of members) expect(a.get(m.id)).toEqual(b.get(m.id));
  });

  it("keeps every account inside the picture and apart from its neighbours in a column", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `ACC-${String(i).padStart(3, "0")}`, role: "victim" }));
    const pos = layoutMembers(many, 560, 360);
    const ys = [...pos.values()].map((p) => p.y).sort((a, b) => a - b);
    expect(ys[0]).toBeGreaterThan(0);
    expect(ys[ys.length - 1]).toBeLessThan(360);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThan(8);
  });

  it("an account with an unknown role still gets a place", () => {
    expect(layoutMembers(members, 560, 360).get("ACC-U1")).toBeTruthy();
  });
});

describe("what is visible at a moment", () => {
  it("shows an account only once its first payment has arrived", () => {
    const early = visibleGraph(members, edges, "2022-09-01T10:00:30Z");
    expect(early.nodes.map((n) => n.id).sort()).toEqual(["ACC-C1", "ACC-V1"]);
    expect(early.links).toHaveLength(1);
    const later = visibleGraph(members, edges, "2022-09-01T11:30:00Z");
    expect(later.nodes.map((n) => n.id)).toContain("ACC-M1");
    expect(later.nodes.map((n) => n.id)).not.toContain("ACC-X1");
  });

  it("shows everything with no cutoff, and merges repeated payments between the same pair", () => {
    const all = visibleGraph(members, edges, null);
    expect(all.nodes.map((n) => n.id).sort()).toEqual(["ACC-C1", "ACC-M1", "ACC-V1", "ACC-V2", "ACC-X1"]); // accounts with no payment never appear
    const merged = all.links.find((l) => l.source === "ACC-V2");
    expect(merged).toMatchObject({ count: 2, amount: 500 });
  });

  it("ignores a payment whose account is not a ring member", () => {
    const g = visibleGraph(members, [...edges, { src: "ACC-ZZ", dst: "ACC-C1", amount: 1, ts: "2022-09-01T10:00:00Z" }], null);
    expect(g.nodes.map((n) => n.id)).not.toContain("ACC-ZZ");
    expect(g.links.every((l) => l.source !== "ACC-ZZ")).toBe(true);
  });

  it("copes with no members and no payments", () => {
    expect(visibleGraph([], [], null)).toEqual({ nodes: [], links: [] });
    expect(visibleGraph(undefined, undefined, null)).toEqual({ nodes: [], links: [] });
  });
});

describe("sizes and paths", () => {
  it("bigger flow gives a bigger mark, never beyond the cap", () => {
    expect(radiusFor("collector", 1000, 1000)).toBeGreaterThan(radiusFor("collector", 10, 1000));
    expect(radiusFor("collector", 1000, 1000)).toBeLessThanOrEqual(20);
    expect(radiusFor("victim", 0, 0)).toBeGreaterThan(0);
    expect(strokeFor(100, 100)).toBeGreaterThan(strokeFor(1, 100));
    expect(strokeFor(5, 0)).toBeGreaterThan(0);
  });

  it("a curve starts and ends where it is told to, and its midpoint is off the straight line", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    expect(curvePath(a, b)).toMatch(/^M0\.0,0\.0 Q/);
    expect(curvePoint(a, b, 0)).toEqual(a);
    expect(curvePoint(a, b, 1)).toEqual(b);
    expect(Math.abs(curvePoint(a, b, 0.5).y)).toBeGreaterThan(1);
  });
});

describe("cursor physics", () => {
  const field = () => makeNodes([{ id: "a", x: 100, y: 100, r: 7 }, { id: "b", x: 400, y: 300, r: 12 }]);
  const run = (nodes, pointer, steps) => { for (let i = 0; i < steps; i++) stepNodes(nodes, pointer); return nodes; };

  it("a node near the cursor is pulled toward it, a far one is left alone", () => {
    const n = run(field(), { x: 140, y: 100 }, 20);
    expect(n[0].x).toBeGreaterThan(100);
    expect(n[1].x).toBeCloseTo(400, 5);
    expect(n[1].y).toBeCloseTo(300, 5);
  });

  it("never moves further from home than the cap, however long the cursor stays", () => {
    const n = run(field(), { x: 110, y: 100 }, 500);
    expect(Math.hypot(n[0].x - n[0].rx, n[0].y - n[0].ry)).toBeLessThanOrEqual(DEFAULTS.maxShift + 1e-9);
  });

  it("springs back and settles once the cursor leaves", () => {
    const n = run(field(), { x: 130, y: 100 }, 60);
    expect(settled(n)).toBe(false);
    run(n, null, 400);
    expect(settled(n)).toBe(true);
    expect(n[0].x).toBeCloseTo(100, 1);
  });

  it("smaller accounts move more than bigger ones for the same pull", () => {
    const n = makeNodes([{ id: "s", x: 100, y: 100, r: 6 }, { id: "l", x: 100, y: 200, r: 18 }]);
    run(n, { x: 130, y: 150 }, 15);
    const small = Math.hypot(n[0].x - 100, n[0].y - 100);
    const large = Math.hypot(n[1].x - 100, n[1].y - 200);
    expect(small).toBeGreaterThan(large);
  });

  it("a dot travels in a straight line from one account to the other", () => {
    expect(along({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
  });
});
