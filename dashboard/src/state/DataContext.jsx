import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, live, getRing as legacyGetRing, getAccount as legacyGetAccount } from "../services/api";

/**
 * One place that owns the connection to the API.
 *
 * mode:
 *   connecting   first request in flight
 *   live         /health answered on the last poll; rings and alerts are the API's own
 *   stale        it answered before but the last poll failed; the last results stay on screen, marked as old
 *   unreachable  it has never answered; there is nothing to show yet
 *   demo         the analyst chose the bundled sample. It is invented data, labelled as such on every screen
 *   standalone   no provider (isolated rendering in tests): behaves like the old client, with the sample as fallback
 *
 * A failed request is never turned into sample data on its own. Only the "Use demo sample" action does that.
 */
const POLL_MS = 5000;

const STANDALONE = {
  mode: "standalone",
  health: null,
  rings: [],
  alerts: [],
  lastOk: null,
  lastError: null,
  loaded: false,
  dataVersion: "standalone",
  refresh: () => {},
  retryLive: () => {},
  useDemo: () => {},
  async getRing(id) {
    const r = await legacyGetRing(id);
    return r.data ? { status: "ok", data: r.data } : { status: "notfound" };
  },
  async getAccount(id) {
    const r = await legacyGetAccount(id);
    return r.data ? { status: "ok", data: r.data } : { status: "notfound" };
  },
};

const DataContext = createContext(STANDALONE);
export const useData = () => useContext(DataContext);

function describe(err) {
  if (err instanceof ApiError) {
    if (err.network) return "The API did not answer.";
    return err.status ? `The API answered HTTP ${err.status}${err.message ? `: ${err.message}` : ""}.` : err.message;
  }
  return String(err?.message || err);
}

export function DataProvider({ children, pollMs = POLL_MS }) {
  const [state, setState] = useState({ mode: "connecting", health: null, rings: [], alerts: [], lastOk: null, lastError: null, loaded: false });
  const demo = useRef(false);
  const timer = useRef(null);
  const alive = useRef(true);
  const inFlight = useRef(false);

  const tick = useCallback(async () => {
    if (demo.current || inFlight.current || !alive.current) return;
    inFlight.current = true;
    try {
      const [h, r, a] = await Promise.allSettled([live.health(), live.rings(), live.alerts()]);
      if (!alive.current || demo.current) return;
      setState((prev) => {
        if (h.status === "rejected") {
          return { ...prev, mode: prev.loaded ? "stale" : "unreachable", lastError: describe(h.reason) };
        }
        const problems = [r, a].filter((x) => x.status === "rejected").map((x) => describe(x.reason));
        return {
          mode: "live",
          health: h.value,
          rings: r.status === "fulfilled" ? r.value : prev.rings,
          alerts: a.status === "fulfilled" ? a.value : prev.alerts,
          lastOk: new Date(),
          lastError: problems.length ? problems.join(" ") : null,
          loaded: true,
        };
      });
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const loop = async () => {
      await tick();
      if (alive.current) timer.current = setTimeout(loop, pollMs);
    };
    loop();
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, [tick, pollMs]);

  const refresh = useCallback(() => {
    tick();
  }, [tick]);

  const useDemo = useCallback(async () => {
    demo.current = true;
    const m = await import("../lib/mock.js");
    const [rings, alerts] = await Promise.all([m.loadMockRings(), m.loadMockAlerts()]);
    setState({ mode: "demo", health: null, rings, alerts, lastOk: null, lastError: null, loaded: true });
  }, []);

  const retryLive = useCallback(() => {
    demo.current = false;
    setState((prev) => ({ ...prev, mode: prev.mode === "demo" ? "connecting" : prev.mode, rings: prev.mode === "demo" ? [] : prev.rings, alerts: prev.mode === "demo" ? [] : prev.alerts, loaded: prev.mode === "demo" ? false : prev.loaded }));
    tick();
  }, [tick]);

  // The detail calls return { status: "ok" | "notfound" | "error", data?, message? }. A 404 is not an error: it means the id
  // no longer exists, which is how a ring that changed shape during a refresh shows up.
  const getRing = useCallback(async (id) => {
    if (demo.current) {
      const m = await import("../lib/mock.js");
      const data = await m.loadMockRing(id);
      return data ? { status: "ok", data } : { status: "notfound" };
    }
    try {
      return { status: "ok", data: await live.ring(id) };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return { status: "notfound" };
      return { status: "error", message: describe(e) };
    }
  }, []);

  const getAccount = useCallback(async (id) => {
    if (demo.current) {
      const m = await import("../lib/mock.js");
      const data = await m.loadMockAccount(id);
      return data ? { status: "ok", data } : { status: "notfound" };
    }
    try {
      return { status: "ok", data: await live.account(id) };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return { status: "notfound" };
      return { status: "error", message: describe(e) };
    }
  }, []);

  // Changes when the server published a new state, so open detail views know to reload.
  const h = state.health;
  const dataVersion = `${h?.refreshes_completed ?? ""}|${h?.data_as_of ?? ""}|${state.mode}`;

  const value = useMemo(
    () => ({ ...state, dataVersion, refresh, retryLive, useDemo, getRing, getAccount }),
    [state, dataVersion, refresh, retryLive, useDemo, getRing, getAccount]
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
