/**
 * Feature → plain-English mapping for the "Why flagged" panel.
 *
 * The stub backend uses these five feature names. The real backend may add
 * more; unknown features fall back to their raw name (see FeatureLabel in
 * api/schemas.py). Positive contribution pushes risk up, negative pushes it
 * down. This is a SHAP value, not a probability.
 */
export const FEATURE_LABELS = {
  fan_in_ratio: "Many accounts paying in, few receiving",
  pass_through_minutes: "Money leaves within minutes",
  account_age_days: "Accounts opened recently",
  burst_timing: "Deposits arrive in bursts",
  account_history: "One mule has a long history",
};

// Colour for a ring or account role. Roles are *estimated* — the model guesses
// the function each account plays inside the ring.
export const ROLE_COLORS = {
  victim: "#2430d9", // ultramarine
  collector: "#e11d5a", // signal rose
  mule: "#f08aac", // light rose
  cashout: "#0c0f1d", // ink
  unknown: "#8a8f99",
};

export const SEVERITY_COLORS = {
  high: "#e11d5a",
  medium: "#d98b00",
  low: "#2430d9",
};

// Convert an ISO timestamp to a short, relative label like "2 hours ago".
export function relativeTime(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const now = Date.now();
  const diffMs = now - then;
  const abs = Math.abs(diffMs);
  const future = diffMs < 0;
  const mins = Math.floor(abs / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  let label;
  if (mins < 1) label = "just now";
  else if (mins < 60) label = `${mins} min`;
  else if (hrs < 24) label = `${hrs} hour${hrs === 1 ? "" : "s"}`;
  else if (days < 7) label = `${days} day${days === 1 ? "" : "s"}`;
  else label = new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return future ? `in ${label}` : `${label} ago`;
}

// Format an ISO timestamp to a readable local string.
export function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// The data is replayed from 2022, so "3 hours ago" against today's clock is meaningless. Show the data's own time, in UTC.
export function formatUtc(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const text = d.toLocaleString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${text} UTC`;
}

// Format a duration in minutes as "Xh Ym" or "Ym".
export function formatDurationMinutes(totalMinutes) {
  if (totalMinutes == null || Number.isNaN(totalMinutes)) return "—";
  const abs = Math.abs(totalMinutes);
  const sign = totalMinutes < 0 ? "-" : "";
  const hrs = Math.floor(abs / 60);
  const mins = Math.round(abs % 60);
  if (hrs === 0) return `${sign}${mins} min`;
  return `${sign}${hrs}h ${mins}m`;
}

// Duration between two ISO timestamps, in minutes.
export function minutesBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (Number.isNaN(ms)) return null;
  return ms / 60000;
}

// Plain-English label for a feature name, falling back to the raw name.
export function featureLabel(name) {
  return FEATURE_LABELS[name] || name;
}