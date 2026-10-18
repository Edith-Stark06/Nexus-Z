import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "../../state/DataContext";
import { sortRings } from "../../lib/filters";
import { mergeRings } from "../../lib/graph";

/**
 * Where the homepage gets its rings from, and what it may call them.
 *
 *   live          the API answered and returned rings from its model backend
 *   stub          the API answered, but its stub backend serves invented sample data
 *   illustrative  no usable API data (unreachable, no rings, or the demo sample): the invented rings bundled with the
 *                 dashboard, drawn as an "Illustrative transaction network". Never presented as findings.
 *   connecting    still waiting for the first answer
 */
let bundled = null;
async function loadBundled() {
  if (!bundled) {
    const m = await import("../../lib/mock.js");
    const rings = await m.loadMockRings();
    bundled = {
      rings,
      async getDetail(id) {
        const d = await m.loadMockRing(id);
        return d ? { status: "ok", data: d } : { status: "notfound" };
      },
    };
  }
  return bundled;
}

export function useHomeSource() {
  const data = useData();
  const [sample, setSample] = useState(null);
  const live = (data.mode === "live" || data.mode === "stale") && data.rings.length > 0;
  const waiting = !data.loaded && (data.mode === "connecting" || data.mode === "standalone");

  useEffect(() => {
    if (!live && !waiting && !sample) {
      let cancelled = false;
      loadBundled().then((b) => !cancelled && setSample(b));
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [live, waiting, sample]);

  return useMemo(() => {
    if (live) {
      const stub = data.health?.backend === "stub";
      return {
        source: stub ? "stub" : "live",
        backend: data.health?.backend || null,
        summaries: sortRings(data.rings, "risk"),
        getDetail: data.getRing,
        reason: null,
      };
    }
    if (waiting || !sample) return { source: "connecting", backend: null, summaries: [], getDetail: async () => ({ status: "error" }), reason: null };
    const reason = data.mode === "demo" ? "demo" : data.mode === "live" || data.mode === "stale" ? "no-rings" : "unreachable";
    return { source: "illustrative", backend: null, summaries: sortRings(sample.rings, "risk"), getDetail: sample.getDetail, reason };
  }, [live, waiting, sample, data.health, data.rings, data.getRing, data.mode]);
}

/**
 * The hero picture: the top flagged rings merged into one graph, each ring its own cluster. Reloads only when the set of top
 * rings changes (not on every refresh), so a selection is not lost every few seconds while payments stream in.
 */
export function useHeroNetwork(home, count = 3) {
  const { refresh } = useData();
  const [state, setState] = useState({ phase: "loading", network: null, changed: false, error: "" });
  const top = home.summaries.slice(0, count);
  const key = `${home.source}:${top.map((r) => r.ring_id).join(",")}`;
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

  return state;
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

// Fades a section in once when it scrolls into view. Content is visible by default; this only adds the transition, and not at all
// when the viewer prefers reduced motion or the browser cannot observe intersections.
export function useReveal() {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || typeof IntersectionObserver === "undefined") return undefined;
    el.dataset.reveal = "pending";
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.dataset.reveal = "done";
          io.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);
  return ref;
}
