/**
 * NEXUS Z API client — single source of truth.
 *
 * Combines the low-level ApiClient (lib/api.js) with the polling + mock
 * fallback logic (services/api.js). The base URL is injected at build time
 * via VITE_API_URL. When the server is unreachable we fall back to the
 * bundled example JSON and show the "Using sample data" badge.
 *
 * Every public function returns { data, usingMock } so callers can render
 * live data or the bundled sample without special-casing the shape.
 */
const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_URL) ||
  "http://localhost:8000";

const POLL_MS = 5000;

let _mockPromise = null;
async function mockModule() {
  if (!_mockPromise) {
    _mockPromise = import("../lib/mock.js");
  }
  return _mockPromise;
}

async function _get(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${path}`);
  }
  return res.json();
}

export class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = (baseUrl || API_BASE).replace(/\/$/, "");
  }

  async _get(path) {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} on ${path}`);
    }
    return res.json();
  }

  async health() {
    return this._get("/health");
  }

  async listRings() {
    return this._get("/rings");
  }

  async getRing(ringId) {
    return this._get(`/rings/${encodeURIComponent(ringId)}`);
  }

  async getAccount(accountId) {
    return this._get(`/accounts/${encodeURIComponent(accountId)}`);
  }

  async listAlerts(limit = 50) {
    return this._get(`/alerts?limit=${limit}`);
  }
}

// Try the API; fall back to the provided mock value on any failure.
// The mock value may be a plain value or a promise that resolves to one.
// Returns { data, usingMock }.
export async function withFallback(apiCall, mockValue) {
  try {
    const data = await apiCall();
    return { data, usingMock: false };
  } catch {
    const data = await mockValue;
    return { data, usingMock: true };
  }
}

export async function health() {
  return _get("/health");
}

export async function listRings() {
  const m = await mockModule();
  return withFallback(() => _get("/rings"), m.loadMockRings());
}

export async function getRing(ringId) {
  const m = await mockModule();
  return withFallback(
    () => _get(`/rings/${encodeURIComponent(ringId)}`),
    m.loadMockRing(ringId)
  );
}

export async function getAccount(accountId) {
  const m = await mockModule();
  return withFallback(
    () => _get(`/accounts/${encodeURIComponent(accountId)}`),
    m.loadMockAccount(accountId)
  );
}

export async function listAlerts(limit = 50) {
  const m = await mockModule();
  return withFallback(
    () => _get(`/alerts?limit=${limit}`),
    m.loadMockAlerts()
  );
}

// Returns true when the API is reachable; false when we are on mock data.
export async function checkApiReachable() {
  try {
    await health();
    return true;
  } catch {
    return false;
  }
}

// Start a 5-second poll. Calls onTick with fresh data; returns a stop function.
// onTick receives { rings, alerts, usingMock }.
export function startPolling(onTick, limit = 50) {
  let stopped = false;

  async function poll() {
    if (stopped) return;
    const usingMock = !(await checkApiReachable());
    try {
      const [ringsRes, alertsRes] = await Promise.all([
        listRings(),
        listAlerts(limit),
      ]);
      onTick({
        rings: ringsRes.data,
        alerts: alertsRes.data,
        usingMock: ringsRes.usingMock || alertsRes.usingMock,
      });
    } catch {
      onTick({ rings: [], alerts: [], usingMock: true });
    }
  }

  poll();
  const id = setInterval(poll, POLL_MS);
  return () => {
    stopped = true;
    clearInterval(id);
  };
}

export { API_BASE };