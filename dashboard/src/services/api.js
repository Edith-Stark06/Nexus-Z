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


// ---------------------------------------------------------------------------------------------------------------
// Live-only calls. Unlike the functions above they never fall back to sample data, and they say *why* a call failed:
// `network` (the API could not be reached) or an HTTP `status` (404 = unknown id, 503 = backend not available, ...).
// The DataProvider uses these, so the screen can tell "this ring changed" apart from "the API is down".
// ---------------------------------------------------------------------------------------------------------------
export class ApiError extends Error {
  constructor(message, { status = 0, network = false } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.network = network;
  }
}

async function request(path, init) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (e) {
    throw new ApiError("Could not reach the API.", { network: true });
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
      else if (Array.isArray(body?.detail)) detail = body.detail.map((d) => `${(d.loc || []).filter((x) => x !== "body").join(".")}: ${d.msg}`).join("; ");
    } catch {
      /* the body is not JSON; the status is enough */
    }
    throw new ApiError(detail || `HTTP ${res.status} on ${path}`, { status: res.status });
  }
  return res.json();
}

export const live = {
  health: () => request("/health"),
  rings: () => request("/rings"),
  ring: (id) => request(`/rings/${encodeURIComponent(id)}`),
  account: (id) => request(`/accounts/${encodeURIComponent(id)}`),
  alerts: (limit = 200) => request(`/alerts?limit=${limit}`),
};

// POST /transactions: one transaction or a list. Resolves with { accepted, backend }.
export function submitTransactions(payload) {
  return request("/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export { API_BASE };