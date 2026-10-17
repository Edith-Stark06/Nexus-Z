import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as api from "../services/api";

describe("fallback to mock on fetch failure", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns mock rings when the API is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    const res = await api.listRings();
    expect(res.usingMock).toBe(true);
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data[0]).toHaveProperty("ring_id");
  });

  it("returns mock alerts when the API is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    const res = await api.listAlerts();
    expect(res.usingMock).toBe(true);
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data.length).toBeGreaterThan(0);
  });

  it("checkApiReachable returns false when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    expect(await api.checkApiReachable()).toBe(false);
  });
});

describe("a 404 is an answer, not an outage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const answer = (status) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status, json: async () => ({}) })));

  it("a ring that no longer exists comes back empty and not as sample data", async () => {
    answer(404);
    const res = await api.getRing("RNG-GONE");
    expect(res).toEqual({ data: null, usingMock: false, notFound: true });
  });

  it("an unknown account comes back empty and not as sample data", async () => {
    answer(404);
    const res = await api.getAccount("ACC-UNKNOWN");
    expect(res.data).toBeNull();
    expect(res.usingMock).toBe(false);
  });

  it("a server error still falls back to the sample data and says so", async () => {
    answer(500);
    const res = await api.listRings();
    expect(res.usingMock).toBe(true);
    expect(res.data.length).toBeGreaterThan(0);
  });
});
