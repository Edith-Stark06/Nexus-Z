import { describe, it, expect } from "vitest";
import { aggregateLinks, buildGraph, neighborhood, egoRing, flowLayout, seedPositions, fitTransform, linkPath, linkId, nodeRadius } from "../lib/graph";

const ring = {
  ring_id: "RNG-T",
  members: [
    { id: "V", role: "victim", score: 0.3 },
    { id: "C", role: "collector", score: 0.9 },
    { id: "M", role: "mule", score: 0.7 },
    { id: "O", role: "cashout", score: 0.8 },
  ],
  edges: [
    { src: "V", dst: "C", amount: 100, ts: "2022-09-01T10:00:00Z" },
    { src: "V", dst: "C", amount: 50, ts: "2022-09-01T10:05:00Z" },
    { src: "C", dst: "M", amount: 140, ts: "2022-09-01T10:10:00Z" },
    { src: "M", dst: "O", amount: 130, ts: "2022-09-01T10:20:00Z" },
    { src: "O", dst: "C", amount: 5, ts: "2022-09-01T10:30:00Z" },
    { src: "C", dst: "C", amount: 1, ts: "2022-09-01T10:31:00Z" }, // self-payment: cannot be an arrow
    { src: "X", dst: "C", amount: 9, ts: "2022-09-01T10:32:00Z" }, // X is not a member
  ],
};

describe("aggregateLinks", () => {
  it("folds payments between the same ordered pair and keeps each payment", () => {
    const links = aggregateLinks(ring.edges, new Set(["V", "C", "M", "O"]));
    const vc = links.find((l) => l.id === linkId("V", "C"));
    expect(vc.count).toBe(2);
    expect(vc.payments.map((p) => p.amount)).toEqual([100, 50]);
    expect(vc.first).toBe("2022-09-01T10:00:00Z");
    expect(vc.last).toBe("2022-09-01T10:05:00Z");
    expect(vc.total).toBe(150);
  });

  it("treats A to B and B to A as different links, drops self-payments and unknown accounts", () => {
    const ids = aggregateLinks(ring.edges, new Set(["V", "C", "M", "O"])).map((l) => l.id);
    expect(ids).toEqual(["C>M", "M>O", "O>C", "V>C"]);
  });
});

describe("buildGraph", () => {
  it("builds nodes with in and out payment counts", () => {
    const g = buildGraph(ring);
    expect(g.nodes).toHaveLength(4);
    const c = g.nodes.find((n) => n.id === "C");
    expect(c.paymentsIn).toBe(3); // V twice and O once
    expect(c.paymentsOut).toBe(1);
  });

  it("applies the replay cutoff: only payments at or before it", () => {
    const g = buildGraph(ring, { cutoff: "2022-09-01T10:10:00Z" });
    expect(g.links.map((l) => l.id)).toEqual(["C>M", "V>C"]);
    expect(g.nodes).toHaveLength(4); // accounts stay, so the picture does not jump
  });

  it("hides a role together with its payments", () => {
    const g = buildGraph(ring, { hiddenRoles: new Set(["mule"]) });
    expect(g.nodes.map((n) => n.id)).not.toContain("M");
    expect(g.links.every((l) => l.source !== "M" && l.target !== "M")).toBe(true);
  });

  it("handles a missing ring or no members", () => {
    expect(buildGraph(null)).toEqual({ nodes: [], links: [] });
    expect(buildGraph({ members: [], edges: [] }).nodes).toEqual([]);
  });

  it("falls back to the unknown role and a null score for incomplete members", () => {
    const g = buildGraph({ members: [{ id: "Z" }], edges: [] });
    expect(g.nodes[0]).toMatchObject({ id: "Z", role: "unknown", score: null });
  });
});

describe("neighborhood and egoRing", () => {
  it("returns the node, its direct neighbours and the links between them", () => {
    const n = neighborhood(buildGraph(ring), "C");
    expect([...n.nodeIds].sort()).toEqual(["C", "M", "O", "V"]);
    expect([...n.linkIds].sort()).toEqual(["C>M", "O>C", "V>C"]);
    const leaf = neighborhood(buildGraph(ring), "V");
    expect([...leaf.nodeIds].sort()).toEqual(["C", "V"]);
  });

  it("cuts a ring down to one account and its counterparties", () => {
    const e = egoRing(ring, "V");
    expect(e.members.map((m) => m.id).sort()).toEqual(["C", "V"]);
    expect(e.edges.every((x) => ["V", "C"].includes(x.src) && ["V", "C"].includes(x.dst))).toBe(true);
  });
});

describe("layouts", () => {
  const nodes = buildGraph(ring).nodes;

  it("flow layout puts roles in columns in the order money moves, highest score first", () => {
    const pos = flowLayout(nodes, { width: 900, height: 600 });
    expect(pos.get("V").x).toBeLessThan(pos.get("C").x);
    expect(pos.get("C").x).toBeLessThan(pos.get("M").x);
    expect(pos.get("M").x).toBeLessThan(pos.get("O").x);
    expect([...pos.values()].every((p) => p.x >= 0 && p.x <= 900 && p.y >= 0 && p.y <= 600)).toBe(true);
  });

  it("flow layout is deterministic and stacks several accounts of one role by score", () => {
    const many = [
      { id: "a", role: "collector", score: 0.2 },
      { id: "b", role: "collector", score: 0.9 },
      { id: "c", role: "collector", score: 0.5 },
    ];
    const p1 = flowLayout(many, { width: 400, height: 300 });
    const p2 = flowLayout(many, { width: 400, height: 300 });
    expect([...p1]).toEqual([...p2]);
    expect(p1.get("b").y).toBeLessThan(p1.get("c").y);
    expect(p1.get("c").y).toBeLessThan(p1.get("a").y);
  });

  it("seeds the same starting positions every time", () => {
    expect([...seedPositions(nodes)]).toEqual([...seedPositions(nodes)]);
  });

  it("scales node size with the model score and survives a missing score", () => {
    expect(nodeRadius(1)).toBeGreaterThan(nodeRadius(0));
    expect(Number.isFinite(nodeRadius(null))).toBe(true);
    expect(nodeRadius(5)).toBe(nodeRadius(1)); // clamped
  });
});

describe("fitTransform", () => {
  const size = { width: 800, height: 600 };
  const pts = [{ x: -100, y: -50 }, { x: 100, y: 50 }];

  it("frames every point inside the viewport", () => {
    const t = fitTransform(pts, size, { pad: 40 });
    for (const p of pts) {
      const sx = p.x * t.k + t.x, sy = p.y * t.k + t.y;
      expect(sx).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(sx).toBeLessThanOrEqual(800 - 40 + 1e-6);
      expect(sy).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(sy).toBeLessThanOrEqual(600 - 40 + 1e-6);
    }
  });

  it("does not blow a tiny graph up past maxK", () => {
    expect(fitTransform([{ x: 0, y: 0 }, { x: 5, y: 5 }], size, { maxK: 1.7 }).k).toBe(1.7);
  });

  it("leaves extra room on the right for labels", () => {
    const plain = fitTransform(pts, size, { pad: 40, padRight: 40 });
    const labelled = fitTransform(pts, size, { pad: 40, padRight: 160 });
    const rightEdge = (t) => 100 * t.k + t.x;
    expect(rightEdge(labelled)).toBeLessThanOrEqual(800 - 160 + 1e-6);
    expect(rightEdge(labelled)).toBeLessThan(rightEdge(plain));
  });

  it("returns a centred identity for no points", () => {
    expect(fitTransform([], size)).toEqual({ k: 1, x: 400, y: 300 });
  });
});

describe("linkPath", () => {
  it("stops short of both nodes so the arrowhead sits on the target's edge", () => {
    const { d } = linkPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 10);
    const [x1, , x2] = d.match(/-?\d+(\.\d+)?/g).map(Number);
    expect(x1).toBeGreaterThan(10);
    expect(x2).toBeLessThan(90);
  });

  it("curves a link when its reverse also exists", () => {
    expect(linkPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 8, 8, { curved: true }).d).toContain("Q");
    expect(linkPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 8, 8).d).not.toContain("Q");
  });

  it("does not produce NaN for two nodes at the same point", () => {
    expect(linkPath({ x: 5, y: 5 }, { x: 5, y: 5 }, 8, 8).d).not.toContain("NaN");
  });
});

// ---- clusters (the homepage draws several rings in one picture)
import { clusterAnchors, hullGeometry, clusterFocus, mergeRings, pickFocusAccount } from "../lib/graph";

describe("cluster helpers", () => {
  it("anchors one cluster at the centre and a few in a staggered row", () => {
    expect(clusterAnchors(["a"]).get("a")).toEqual({ x: 0, y: 0 });
    const three = clusterAnchors(["a", "b", "c"], 100);
    expect(three.get("a").x).toBeLessThan(three.get("b").x);
    expect(three.get("b").x).toBeLessThan(three.get("c").x);
    expect(three.get("a").y).toBeLessThan(three.get("b").y); // staggered, not a straight line
    expect([...clusterAnchors(["a", "b", "c"], 100)]).toEqual([...three]); // deterministic
  });

  it("puts many clusters round an ellipse", () => {
    const six = clusterAnchors(["a", "b", "c", "d", "e", "f"], 100);
    expect(new Set([...six.values()].map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)).size).toBe(6);
  });

  it("outlines a group of nodes, with the label above the outline", () => {
    const h = hullGeometry([{ x: 0, y: 0, r: 8 }, { x: 100, y: 0, r: 8 }, { x: 50, y: 80, r: 8 }]);
    expect(h.d).toMatch(/^M/);
    expect(h.d).not.toContain("NaN");
    expect(h.label.y).toBeLessThan(-8); // above the top node
    expect(hullGeometry([])).toBeNull();
    expect(hullGeometry([{ x: 5, y: 5, r: 8 }]).d).toMatch(/^M/); // a single node still gets an outline
  });

  it("returns the nodes and links inside one cluster", () => {
    const merged = mergeRings([
      { ring_id: "R1", risk: 80, accounts: 2, headline: "a", members: [{ id: "A", role: "victim", score: 0.2 }, { id: "B", role: "collector", score: 0.9 }], edges: [{ src: "A", dst: "B", amount: 1, ts: "2022-09-01T10:00:00Z" }] },
      { ring_id: "R2", risk: 40, accounts: 2, headline: "b", members: [{ id: "C", role: "mule", score: 0.5 }, { id: "D", role: "cashout", score: 0.6 }], edges: [{ src: "C", dst: "D", amount: 1, ts: "2022-09-01T11:00:00Z" }] },
    ]);
    const f = clusterFocus(buildGraph(merged), "R2");
    expect([...f.nodeIds].sort()).toEqual(["C", "D"]);
    expect([...f.linkIds]).toEqual(["C>D"]);
  });
});

describe("mergeRings", () => {
  const d = (id, ids) => ({ ring_id: id, risk: 70, accounts: ids.length, headline: id, members: ids.map((x) => ({ id: x, role: "mule", score: 0.5 })), edges: [] });

  it("tags each account with its ring and builds one cluster per ring", () => {
    const m = mergeRings([d("R1", ["A", "B"]), d("R2", ["C"])]);
    expect(m.members.map((x) => [x.id, x.cluster])).toEqual([["A", "R1"], ["B", "R1"], ["C", "R2"]]);
    expect(m.clusters.map((c) => c.id)).toEqual(["R1", "R2"]);
    expect(m.clusters[0].label).toBe("R1 · ring score 70");
    expect(m.ring_id).toBe("merged:R1+R2");
  });

  it("keeps an account that two rings list in the first ring only", () => {
    const m = mergeRings([d("R1", ["A", "B"]), d("R2", ["B", "C"])]);
    expect(m.members.filter((x) => x.id === "B")).toHaveLength(1);
    expect(m.members.find((x) => x.id === "B").cluster).toBe("R1");
  });

  it("handles no rings", () => {
    expect(mergeRings([]).members).toEqual([]);
  });
});

describe("pickFocusAccount", () => {
  it("starts on the highest-scored collector of the first ring", () => {
    const ring = { clusters: [{ id: "R1" }, { id: "R2" }], members: [
      { id: "m", role: "mule", score: 0.99, cluster: "R1" },
      { id: "c1", role: "collector", score: 0.6, cluster: "R1" },
      { id: "c2", role: "collector", score: 0.8, cluster: "R1" },
      { id: "z", role: "collector", score: 0.99, cluster: "R2" },
    ] };
    expect(pickFocusAccount(ring)).toBe("c2");
  });

  it("falls back to the best-scored account when there is no collector, and to null when empty", () => {
    expect(pickFocusAccount({ clusters: [{ id: "R1" }], members: [{ id: "a", role: "mule", score: 0.2, cluster: "R1" }, { id: "b", role: "victim", score: 0.7, cluster: "R1" }] })).toBe("b");
    expect(pickFocusAccount({ clusters: [], members: [] })).toBeNull();
    expect(pickFocusAccount(null)).toBeNull();
  });
});

describe("fitTransform with headroom for labels", () => {
  it("reserves space at the top for cluster labels", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
    const t = fitTransform(pts, { width: 800, height: 600 }, { pad: 40, padTop: 120 });
    expect(0 * t.k + t.y).toBeGreaterThanOrEqual(120 - 1e-6);
  });
});
