import { describe, it, expect } from "vitest";
import { edgesUpTo } from "../lib/replay";

const edges = [
  { ts: "2026-10-14T08:00:00Z", amount: 100 },
  { ts: "2026-10-14T09:00:00Z", amount: 200 },
  { ts: "2026-10-14T10:00:00Z", amount: 300 },
  { ts: "2026-10-14T11:00:00Z", amount: 400 },
  { ts: "2026-10-14T12:00:00Z", amount: 500 },
];

describe("edgesUpTo", () => {
  it("returns only edges at or before the cutoff", () => {
    const out = edgesUpTo(edges, "2026-10-14T10:00:00Z");
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.amount)).toEqual([100, 200, 300]);
  });

  it("returns the earliest edge when cutoff is the first timestamp", () => {
    const out = edgesUpTo(edges, "2026-10-14T08:00:00Z");
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(100);
  });

  it("returns the latest edge when cutoff is the last timestamp", () => {
    const out = edgesUpTo(edges, "2026-10-14T12:00:00Z");
    expect(out).toHaveLength(5);
    expect(out[4].amount).toBe(500);
  });

  it("returns all edges when cutoff is after everything", () => {
    const out = edgesUpTo(edges, "2026-10-15T00:00:00Z");
    expect(out).toHaveLength(5);
  });

  it("returns no edges when cutoff is before everything", () => {
    const out = edgesUpTo(edges, "2026-10-13T00:00:00Z");
    expect(out).toHaveLength(0);
  });

  it("accepts a numeric millisecond cutoff", () => {
    const ms = new Date("2026-10-14T10:00:00Z").getTime();
    const out = edgesUpTo(edges, ms);
    expect(out).toHaveLength(3);
  });

  it("preserves original order", () => {
    const out = edgesUpTo(edges, "2026-10-14T11:30:00Z");
    expect(out.map((e) => e.amount)).toEqual([100, 200, 300, 400]);
  });

  it("handles empty input", () => {
    expect(edgesUpTo([], "2026-10-14T10:00:00Z")).toEqual([]);
    expect(edgesUpTo(null, "2026-10-14T10:00:00Z")).toEqual([]);
  });
});