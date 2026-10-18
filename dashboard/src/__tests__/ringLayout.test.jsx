import { describe, it, expect } from "vitest";
import { crossings, flowPath, flowPoint, heightFor, layoutRing } from "../lib/graphLayout";
import { arcPath, nodePrimitives, pillWidth } from "../lib/nodeStyle";

const chain = [
  { id: "V1", role: "victim" }, { id: "V2", role: "victim" }, { id: "V3", role: "victim" }, { id: "V4", role: "victim" },
  { id: "C1", role: "collector" }, { id: "C2", role: "collector" },
  { id: "M1", role: "mule" }, { id: "M2", role: "mule" }, { id: "M3", role: "mule" }, { id: "X1", role: "cashout" },
];
const flows = [
  ["V1", "C1"], ["V2", "C1"], ["V3", "C2"], ["V4", "C2"], ["C1", "M1"], ["C2", "M2"], ["M1", "M3"], ["M2", "M3"], ["M3", "X1"],
].map(([src, dst], i) => ({ src, dst, amount: 100 + i, ts: `2022-09-01T10:0${i}:00Z` }));

describe("ring layout that follows the money", () => {
  it("a chain of mule accounts runs left to right, with payers first and the cash-out last", () => {
    const { pos, columns } = layoutRing(chain, flows, 640, 380);
    const x = (id) => pos.get(id).x;
    expect(x("V1")).toBeLessThan(x("C1"));
    expect(x("C1")).toBeLessThan(x("M1"));
    expect(x("M1")).toBeLessThan(x("M3"));
    expect(x("M3")).toBeLessThan(x("X1"));
    expect(columns[0].label).toBe("Likely victims");
    expect(columns[2].label).toBe("Mules");
    expect(columns[columns.length - 1].label).toBe("Cash-out");
    expect(columns).toHaveLength(5);
  });

  it("does not depend on the order the payments are listed in", () => {
    const a = layoutRing(chain, flows, 640, 380).pos;
    const b = layoutRing([...chain].reverse(), [...flows].reverse(), 640, 380).pos;
    for (const m of chain) expect(a.get(m.id)).toEqual(b.get(m.id));
  });

  it("keeps every account inside the picture with room between accounts in a column", () => {
    const many = [{ id: "X", role: "cashout" }, { id: "C", role: "collector" }, ...Array.from({ length: 24 }, (_, i) => ({ id: `P${String(i).padStart(2, "0")}`, role: "victim" }))];
    const fl = many.filter((m) => m.role === "victim").map((m, i) => ({ src: m.id, dst: "C", amount: 1, ts: `2022-09-01T10:00:0${i % 10}Z` }))
      .concat([{ src: "C", dst: "X", amount: 5, ts: "2022-09-01T11:00:00Z" }]);
    const probe = layoutRing(many, fl, 640, 1000);
    expect(probe.maxPerColumn).toBe(24);
    const h = heightFor(probe.maxPerColumn);
    const { pos } = layoutRing(many, fl, 640, h);
    const ys = [...pos.values()].filter((p) => p.x < 100).map((p) => p.y).sort((a, b) => a - b);
    expect(ys[0]).toBeGreaterThan(20);
    expect(ys[ys.length - 1]).toBeLessThan(h - 20);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThan(8);
  });

  it("the graph is as tall as its busiest column needs, within limits", () => {
    expect(heightFor(1)).toBe(340);
    expect(heightFor(7)).toBeGreaterThan(heightFor(3));
    expect(heightFor(500)).toBe(900);
  });

  it("orders accounts so that links do not cross when they need not", () => {
    const ms = [{ id: "A1", role: "victim" }, { id: "A2", role: "victim" }, { id: "A3", role: "victim" }, { id: "B1", role: "collector" }, { id: "B2", role: "collector" }, { id: "B3", role: "collector" }];
    const fl = [["A1", "B3"], ["A2", "B2"], ["A3", "B1"]].map(([src, dst]) => ({ src, dst, amount: 1, ts: "2022-09-01T10:00:00Z" }));
    const links = fl.map((e) => ({ source: e.src, target: e.dst }));
    const ordered = layoutRing(ms, fl, 640, 380).pos;
    const naive = new Map(ms.map((m, i) => [m.id, { x: m.role === "victim" ? 50 : 500, y: 40 + (i % 3) * 100 }]));
    expect(crossings(links, naive)).toBeGreaterThan(0);
    expect(crossings(links, ordered)).toBe(0);
  });

  it("copes with a ring with no payers, no cash-out, or no payments at all", () => {
    expect(layoutRing([{ id: "C", role: "collector" }], [], 640, 380).pos.get("C")).toBeTruthy();
    expect(layoutRing([], [], 640, 380).pos.size).toBe(0);
    expect(layoutRing(undefined, undefined, 640, 380).columns).toEqual([]);
  });
});

describe("links and marks", () => {
  it("a forward link leaves and enters horizontally; a backward link bows out to the side", () => {
    const a = { x: 100, y: 50 };
    const b = { x: 300, y: 150 };
    expect(flowPath(a, b, 10, 10)).toMatch(/^M111\.0,50\.0 C/);
    expect(flowPath(b, { x: 300, y: 250 }, 10, 10, 1)).toMatch(/^M311\.0,150\.0 C3\d\d/);
    expect(flowPoint(a, b, 10, 10, 0).x).toBeCloseTo(111, 5);
    const end = flowPoint(a, b, 10, 10, 1);
    expect(end.x).toBeCloseTo(283, 5);
    expect(end.y).toBeCloseTo(150, 5);
  });

  it("a collector gets a risk ring that fills with its score; other roles get none", () => {
    expect(nodePrimitives("collector", 12, 0.5).filter((p) => p.type === "path")).toHaveLength(1);
    expect(nodePrimitives("collector", 5, 0.9).some((p) => p.type === "path")).toBe(false);
    expect(nodePrimitives("mule", 8, 0.9).some((p) => p.type === "path")).toBe(false);
    expect(nodePrimitives("cashout", 12, 0.9)[0].type).toBe("rect");
    expect(arcPath(10, 0)).toBe("");
    expect(arcPath(10, 0.25)).toMatch(/^M0,-10 A10,10 0 0 1 10\.00,0\.00/);
    expect(arcPath(10, 0.75)).toMatch(/ 0 1 1 /);
  });

  it("every role has its own look, so colour is never the only difference", () => {
    const look = (role) => JSON.stringify(nodePrimitives(role, 10, 0.5).map((p) => [p.type, p.fill, p.stroke]));
    expect(new Set(["victim", "collector", "mule", "cashout", "unknown"].map(look)).size).toBe(5);
    expect(pillWidth("0078E6")).toBeGreaterThan(pillWidth("12"));
  });
});
