/**
 * Mock data loader. Reads the example JSON files shipped with the dashboard.
 *
 * These files are copies of api/examples/*.json — the source of truth for the
 * response shapes. They let the dashboard work with no server running.
 * If the API is reachable we prefer live data; otherwise we fall back here.
 */
import rings from "../mock/rings.json";
import alerts from "../mock/alerts.json";

// Build a map of ring_id → full ring detail from the per-ring example files.
// We import them lazily so the dashboard still builds if one is missing.
async function loadRingDetail(ringId) {
  const mod = await import(`../mock/ring_${ringId}.json`);
  return mod.default;
}

export async function loadMockRings() {
  return rings;
}

export async function loadMockAlerts() {
  return alerts;
}

export async function loadMockAccount(accountId) {
  try {
    const mod = await import(`../mock/account_${accountId}.json`);
    return mod.default;
  } catch {
    return null;
  }
}

// Some loaders (rings/alerts) always return an array. For an unknown account
// we return null so callers can distinguish "no record" from "empty record".
export async function loadMockRing(ringId) {
  try {
    const mod = await import(`../mock/ring_${ringId}.json`);
    return mod.default;
  } catch {
    return null;
  }
}