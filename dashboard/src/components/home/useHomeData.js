import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "../../state/DataContext";
import { sortRings } from "../../lib/filters";
import { mergeRings } from "../../lib/graph";
import { describeSystem } from "../../lib/provenance";

/**
 * Where the homepage gets its rings from, and what it may call them. There is no fallback to invented data: when the API cannot
 * supply rings the page says so and offers a retry.
 *
 *   connecting   still waiting for the first answer
 *   live         the API answered and returned rings from its model backend
 *   stale        the API stopped answering; these are the last rings it returned
 *   stub         the API answered, but its stub backend serves invented sample data
 *   demo         the analyst chose the bundled demo sample (invented), on purpose
 *   unreachable  the API has never answered
 *   empty        the API answered with no rings
 */
export function useHomeSource() {
  const data = useData();
  return useMemo(() => {
    const waiting = !data.loaded && (data.mode === "connecting" || data.mode === "standalone");
    const base = { backend: data.health?.backend || null, backendLabel: describeSystem(data).backend.label, summaries: [], getDetail: data.getRing, error: data.lastError || "", retry: data.retryLive };
    if (waiting) return { ...base, source: "connecting", getDetail: async () => ({ status: "error" }) };
    if (data.mode === "unreachable") return { ...base, source: "unreachable" };
    if (data.rings.length === 0) return { ...base, source: "empty" };
    const summaries = sortRings(data.rings, "risk");
    if (data.mode === "demo") return { ...base, source: "demo", summaries };
    if (data.mode === "stale") return { ...base, source: "stale", summaries };
    return { ...base, source: data.health?.backend === "stub" ? "stub" : "live", summaries };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.loaded, data.mode, data.health, data.rings, data.getRing, data.lastError, data.retryLive]);
}

/**
 * The hero picture: the top flagged rings merged into one graph, each ring its own cluster. Reloads only when the set of top
 * rings changes (not on every refresh), so a selection is not lost every few seconds while payments stream in.
 */
export function useHeroNetwork(home, count = 3) {
  const { refresh } = useData();
  const [state, setState] = useState({ phase: "loading", network: null, changed: false, error: "" });
  const [nonce, setNonce] = useState(0);
  const top = home.summaries.slice(0, count);
  const key = `${home.source}:${top.map((r) => r.ring_id).join(",")}:${nonce}`;
  const getDetail = useRef(home.getDetail);
  getDetail.current = home.getDetail;

  useEffect(() => {
    if (home.source === "connecting") return undefined;
    if (top.length === 0) {
      setState({ phase: "empty", network: null, changed: false, error: "" });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, phase: "loading" }));
    Promise.all(top.map((s) => getDetail.current(s.ring_id))).then((results) => {
      if (cancelled) return;
      const ok = results.filter((r) => r.status === "ok").map((r) => r.data);
      const changed = results.some((r) => r.status === "notfound");
      const failed = results.find((r) => r.status === "error");
      if (changed) refresh(); // a ring id changed between the list and the detail: take a fresh list
      if (ok.length === 0) setState({ phase: failed ? "error" : "empty", network: null, changed, error: failed?.message || "" });
      else setState({ phase: "ready", network: mergeRings(ok), changed, error: "" });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}
