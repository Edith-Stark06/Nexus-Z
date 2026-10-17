/**
 * Replay helpers for the time-slider.
 *
 * `edgesUpTo` returns only the edges whose timestamp is at or before `t`.
 * This is the same "no peeking into the future" rule the model uses: at
 * scoring time t we may only read edges that have already arrived.
 */

// Parse an ISO timestamp into a numeric millisecond value. Returns NaN on
// bad input so callers can filter it out safely.
function toMs(iso) {
  if (iso == null) return NaN;
  if (typeof iso === "number") return iso;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? NaN : ms;
}

// Return edges with ts <= t, preserving the original order.
// `t` may be an ISO string, a number of milliseconds, or a Date.
export function edgesUpTo(edges, t) {
  if (!Array.isArray(edges) || edges.length === 0) return [];
  const cutoff = toMs(t);
  if (Number.isNaN(cutoff)) return edges.slice();
  return edges.filter((e) => {
    const ts = toMs(e && e.ts);
    return !Number.isNaN(ts) && ts <= cutoff;
  });
}

// Collect the sorted, unique timestamps available to the slider.
export function edgeTimestamps(edges) {
  if (!Array.isArray(edges)) return [];
  const seen = new Set();
  const out = [];
  for (const e of edges) {
    const ts = toMs(e && e.ts);
    if (!Number.isNaN(ts) && !seen.has(ts)) {
      seen.add(ts);
      out.push(ts);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

// Convert a millisecond timestamp back to an ISO string for display.
export function msToIso(ms) {
  if (ms == null || Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

// Time-to-detection: minutes between a ring's first appearance and the moment
// it was flagged. This is the headline metric for the pitch deck.
// Returns null if either timestamp is missing or unparseable.
export function detectionMinutes(firstSeen, flaggedAt) {
  const a = toMs(firstSeen);
  const b = toMs(flaggedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (b - a) / 60000;
}