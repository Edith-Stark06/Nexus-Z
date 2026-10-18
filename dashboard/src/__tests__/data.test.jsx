import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { DataProvider, useData } from "../state/DataContext";

const HEALTH = { status: "ok", backend: "model", refresh_interval_seconds: 5, data_as_of: "2022-09-09T23:59:00+00:00", refreshes_completed: 1 };
const RINGS = [{ ring_id: "RNG-LIVE01", risk: 80, accounts: 4, victims: 1, headline: "live", first_seen: "2022-09-09T00:00:00Z", flagged_at: "2022-09-09T23:59:00Z" }];

// A fake API. `down` makes every request fail like an unreachable server.
function fakeApi({ down = false, ring404 = false } = {}) {
  const state = { down, calls: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      state.calls += 1;
      if (state.down) throw new TypeError("Failed to fetch");
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      const ok = (body) => ({ ok: true, status: 200, json: async () => body });
      if (path === "/health") return ok(HEALTH);
      if (path === "/rings") return ok(RINGS);
      if (path.startsWith("/alerts")) return ok([]);
      if (path === "/rings/RNG-LIVE01") return ring404 ? { ok: false, status: 404, json: async () => ({ detail: "Unknown ring" }) } : ok({ ...RINGS[0], members: [], edges: [], top_reasons: [] });
      if (path.startsWith("/accounts/")) return { ok: false, status: 404, json: async () => ({ detail: "Unknown account" }) };
      return { ok: false, status: 404, json: async () => ({}) };
    })
  );
  return state;
}

let ctx;
function Probe() {
  ctx = useData();
  return (
    <div>
      <span data-testid="mode">{ctx.mode}</span>
      <span data-testid="rings">{ctx.rings.map((r) => r.ring_id).join(",")}</span>
      <span data-testid="error">{ctx.lastError || ""}</span>
    </div>
  );
}
const mount = (pollMs = 60000) => render(<DataProvider pollMs={pollMs}><Probe /></DataProvider>);
const mode = () => screen.getByTestId("mode").textContent;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DataProvider connection modes", () => {
  it("is live only after /health answered, and serves the API's own rings", async () => {
    fakeApi();
    mount();
    expect(mode()).toBe("connecting");
    await waitFor(() => expect(mode()).toBe("live"));
    expect(screen.getByTestId("rings").textContent).toBe("RNG-LIVE01");
    expect(ctx.health.backend).toBe("model");
    expect(ctx.lastOk).toBeInstanceOf(Date);
  });

  it("is unreachable when the API never answered, and shows NO data (no silent sample)", async () => {
    fakeApi({ down: true });
    mount();
    await waitFor(() => expect(mode()).toBe("unreachable"));
    expect(screen.getByTestId("rings").textContent).toBe("");
    expect(ctx.rings).toEqual([]);
    expect(ctx.alerts).toEqual([]);
    expect(screen.getByTestId("error").textContent).toMatch(/did not answer/i);
  });

  it("goes stale, keeping the last real results, when a working API stops answering", async () => {
    const api = fakeApi();
    mount(40);
    await waitFor(() => expect(mode()).toBe("live"));
    api.down = true;
    await waitFor(() => expect(mode()).toBe("stale"));
    expect(screen.getByTestId("rings").textContent).toBe("RNG-LIVE01"); // the last real answer, not a sample
    api.down = false;
    await waitFor(() => expect(mode()).toBe("live")); // and it recovers on its own
  });

  it("switches to the demo sample only when asked, and says so", async () => {
    fakeApi({ down: true });
    mount();
    await waitFor(() => expect(mode()).toBe("unreachable"));
    await act(async () => {
      await ctx.useDemo();
    });
    expect(mode()).toBe("demo");
    expect(ctx.rings.length).toBeGreaterThan(0);
    expect(ctx.rings.every((r) => /^RNG-0\d{3}$/.test(r.ring_id))).toBe(true); // the bundled example ids, not live ones
    expect(ctx.health).toBeNull();
  });

  it("stops polling when it unmounts", async () => {
    const api = fakeApi();
    const { unmount } = mount(30);
    await waitFor(() => expect(mode()).toBe("live"));
    unmount();
    const before = api.calls;
    await new Promise((r) => setTimeout(r, 150));
    expect(api.calls).toBe(before);
  });
});

describe("detail lookups tell a changed id apart from a failure", () => {
  it("returns notfound for HTTP 404 (the ring changed) and error for a network failure", async () => {
    const api = fakeApi({ ring404: true });
    mount();
    await waitFor(() => expect(mode()).toBe("live"));
    expect(await ctx.getRing("RNG-LIVE01")).toEqual({ status: "notfound" });
    expect(await ctx.getAccount("ACC-NOPE")).toEqual({ status: "notfound" });
    api.down = true;
    const res = await ctx.getRing("RNG-LIVE01");
    expect(res.status).toBe("error");
    expect(res.message).toMatch(/did not answer/i);
  });

  it("returns the ring when it exists", async () => {
    fakeApi();
    mount();
    await waitFor(() => expect(mode()).toBe("live"));
    const res = await ctx.getRing("RNG-LIVE01");
    expect(res.status).toBe("ok");
    expect(res.data.ring_id).toBe("RNG-LIVE01");
  });
});
