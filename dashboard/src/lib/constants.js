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

// Colour for a ring or account role. Roles are *estimated*: they are guessed from an account's position in the
// ring's payments (the data has no role labels), so every place that shows one says so. Values match tokens.css.
export const ROLE_COLORS = {
  victim: "#7fa6d1",
  collector: "#d9a66f",
  mule: "#a3b0c0",
  cashout: "#cf8fa6",
  unknown: "#6b7b8c",
};

export const ROLE_LABELS = {
  victim: "Likely victim",
  collector: "Collector",
  mule: "Mule",
  cashout: "Cash-out",
  unknown: "Unknown",
};

// Left-to-right order of the "flow" layout: money enters from victims and leaves at a cash-out.
export const ROLE_ORDER = ["victim", "collector", "mule", "cashout"];

export const SEVERITY_COLORS = {
  high: "#e87970",
  medium: "#e5af62",
  low: "#64b5c8",
};

// Ring risk is 0 to 100. The cut-offs are the ones ml/service.py uses for alert severity (HIGH_RISK 50, MEDIUM_RISK 25).
export const HIGH_RISK = 50;
export const MEDIUM_RISK = 25;
export function riskTone(riskPct) {
  if (riskPct == null || Number.isNaN(Number(riskPct))) return "none";
  if (riskPct >= HIGH_RISK) return "high";
  if (riskPct >= MEDIUM_RISK) return "medium";
  return "low";
}

// Absolute time in UTC, for example "2022-09-10 12:55 UTC". The data is from 2022 and the browser clock is not, so a
// relative label ("3 years ago") would be meaningless here.
export function formatUtc(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

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