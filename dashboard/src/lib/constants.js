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
  victim: "#5b8ff9", // blue
  collector: "#e0502e", // red
  mule: "#e8a600", // amber
  cashout: "#7b2fe8", // purple
  unknown: "#8a8f99",
};

export const SEVERITY_COLORS = {
  high: "#e0502e",
  medium: "#e8a600",
  low: "#5b8ff9",
};

// Convert an ISO timestamp to a short, relative label like "2 hours ago".
export function relativeTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mon} ${day}, ${year} ${hh}:${mm} UTC`;
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