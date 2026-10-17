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