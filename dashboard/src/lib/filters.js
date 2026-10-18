/** List filtering and sorting for rings and alerts. Pure functions; the pages only hold the control state. */
import { HIGH_RISK } from "./constants";

export const RING_SORTS = {
  risk: { label: "Highest risk", cmp: (a, b) => b.risk - a.risk || b.accounts - a.accounts },
  size: { label: "Most accounts", cmp: (a, b) => b.accounts - a.accounts || b.risk - a.risk },
  flagged: { label: "Most recently flagged", cmp: (a, b) => new Date(b.flagged_at) - new Date(a.flagged_at) || b.risk - a.risk },
  first_seen: { label: "Earliest first seen", cmp: (a, b) => new Date(a.first_seen) - new Date(b.first_seen) || b.risk - a.risk },
};

// Number of victim_warning alerts per ring: "likely victims flagged", never "warnings sent" (nothing is sent).
export function victimFlagCounts(alerts) {
  const out = {};
  for (const a of alerts || []) {
    if (a.type === "victim_warning") out[a.ring_id] = (out[a.ring_id] || 0) + 1;
  }
  return out;
}

export function filterRings(rings, { query = "", minRisk = 0, minAccounts = 0, onlyWithVictims = false, victimCounts = {} } = {}) {
  const q = query.trim().toLowerCase();
  return (rings || []).filter((r) => {
    if (q && !r.ring_id.toLowerCase().includes(q) && !(r.headline || "").toLowerCase().includes(q)) return false;
    if (r.risk < minRisk) return false;
    if (r.accounts < minAccounts) return false;
    if (onlyWithVictims && !(victimCounts[r.ring_id] > 0)) return false;
    return true;
  });
}

export function sortRings(rings, key = "risk") {
  const cmp = (RING_SORTS[key] || RING_SORTS.risk).cmp;
  return [...rings].sort(cmp);
}

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

export const ALERT_SORTS = {
  time: (a, b) => new Date(b.ts) - new Date(a.ts),
  severity: (a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0) || new Date(b.ts) - new Date(a.ts),
};

export function filterAlerts(alerts, { type = "all", severity = "all", query = "" } = {}) {
  const q = query.trim().toLowerCase();
  return (alerts || []).filter((a) => {
    if (type !== "all" && a.type !== type) return false;
    if (severity !== "all" && a.severity !== severity) return false;
    if (q) {
      const hay = [a.ring_id, a.account_id, a.recipient_id, a.message, a.alert_id].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sortAlerts(alerts, key = "time") {
  return [...alerts].sort(ALERT_SORTS[key] || ALERT_SORTS.time);
}

// Headline numbers for the overview, all derived from what the API returned (nothing is estimated).
export function overviewNumbers(rings, alerts) {
  const list = rings || [];
  const al = alerts || [];
  return {
    rings: list.length,
    accountsInRings: list.reduce((t, r) => t + (r.accounts || 0), 0),
    highRisk: list.filter((r) => r.risk >= HIGH_RISK).length,
    ringAlerts: al.filter((a) => a.type === "ring").length,
    victimFlags: al.filter((a) => a.type === "victim_warning").length,
  };
}
