import { formatUtc } from "./constants";

/**
 * What the application knows about the system behind it, as four separate facts that must never be merged into one
 * "live" light:
 *
 *   api      is the API answering? (an HTTP answer from /health; the time is when this browser received it)
 *   backend  which backend the API says it runs (/health `backend`), and whether it has actually built a state
 *   source   the time of the newest payment in that state (/health `data_as_of`), which is data time, not the clock
 *   refresh  how old the model state was at the last health check, and how many refreshes have completed
 *
 * Nothing here reads the browser clock to invent a data time. The one browser time shown is when the last answer arrived.
 */
const clock = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour12: false }) : null);

export function formatAge(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return null;
  const s = Math.max(0, Math.round(Number(seconds)));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = s / 3600;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${Math.round(h / 24)} days`;
}

/** True only when the model backend has built a state: a bare HTTP 200 from /health is not enough. */
export function modelReady(health) {
  return !!health && health.backend === "model" && health.status !== "degraded" && Number(health.history_transactions) > 0 && !!health.data_as_of;
}

export function describeSystem(data) {
  const { mode, health, lastOk, lastError } = data;
  const checked = clock(lastOk);

  let api;
  switch (mode) {
    case "live":
      api = health?.status === "degraded"
        ? { tone: "warn", label: "Degraded", detail: `The last model refresh failed${health.last_error?.type ? ` (${health.last_error.type})` : ""}; results are from the previous state.` }
        : { tone: "ok", label: "Responding", detail: checked ? `Last answer received ${checked} (this browser's clock).` : "" };
      break;
    case "stale":
      api = { tone: "warn", label: "Not answering", detail: `${lastError || "The last request failed."} Showing results received ${checked || "earlier"}.` };
      break;
    case "unreachable":
      api = { tone: "danger", label: "Unreachable", detail: lastError || "The API has not answered." };
      break;
    case "demo":
      api = { tone: "warn", label: "Not used", detail: "The demo sample is selected: no request goes to the API." };
      break;
    case "connecting":
      api = { tone: "none", label: "Connecting", detail: "" };
      break;
    default:
      api = { tone: "none", label: "Unknown", detail: "" };
  }

  const answered = mode === "live" || mode === "stale";
  let backend;
  if (mode === "demo") backend = { tone: "warn", label: "Demo sample", detail: "Invented example data that ships with the dashboard. Not model output." };
  else if (!answered || !health) backend = { tone: "none", label: "Not known", detail: "The API has not reported its backend." };
  else if (health.backend === "stub") backend = { tone: "warn", label: "Stub backend", detail: "The API serves invented sample data. Nothing shown is model output." };
  else if (modelReady(health)) backend = { tone: "ok", label: "Model backend", detail: `Scoring ${Number(health.history_transactions).toLocaleString()} transactions held in memory.` };
  else if (health.backend === "model") backend = { tone: "warn", label: "Model backend, no state yet", detail: "The model backend has not published a scored state." };
  else backend = { tone: "none", label: String(health.backend || "Not reported"), detail: "" };

  let source;
  if (mode === "demo") source = { tone: "warn", label: "Invented sample", asOf: null, detail: "No source data: the sample is made up." };
  else if (!answered || !health) source = { tone: "none", label: "Not known", asOf: null, detail: "" };
  else if (health.backend === "stub") source = { tone: "warn", label: "No source data", asOf: null, detail: "The stub backend has no transaction history." };
  else if (health.data_as_of)
    source = {
      tone: "none",
      label: `Source data through ${formatUtc(health.data_as_of)}`,
      asOf: health.data_as_of,
      detail: "Historical evaluation data, documented as synthetic (README, docs/ML_RESULTS.md). The time is the newest payment in the data, not the present.",
    };
  else source = { tone: "none", label: "Not reported", asOf: null, detail: "The API did not give the time of its newest payment." };

  let refresh;
  if (!answered || !health || health.backend === "stub" || mode === "demo") refresh = { tone: "none", label: "Not applicable", detail: "" };
  else {
    const age = formatAge(health.state_age_seconds);
    const n = Number(health.refreshes_completed ?? 0);
    refresh = {
      tone: health.last_error ? "warn" : "none",
      label: age ? `Model state built ${age} before the last check` : "Not reported",
      detail:
        n === 0
          ? "No refresh since the first build: no new payments have been ingested since then."
          : `${n} refresh${n === 1 ? "" : "es"} completed${health.last_rebuild_seconds != null ? `; the last rebuild took ${Number(health.last_rebuild_seconds).toFixed(1)} s` : ""}.`,
    };
    if (Number(health.pending_transactions) > 0) refresh.detail += ` ${health.pending_transactions} payment(s) waiting for the next refresh.`;
    if (health.refreshing) refresh.detail += " A refresh is running now.";
  }

  return { api, backend, source, refresh };
}

/** One line for a page header: where the data on this screen comes from. */
export function sourceLine(data) {
  const s = describeSystem(data);
  const parts = [];
  if (s.backend.label !== "Not known") parts.push(s.backend.label);
  if (data.mode === "demo") parts.push("invented sample");
  else if (s.source.asOf) parts.push(s.source.label, "synthetic evaluation data");
  else if (s.source.label !== "Not known") parts.push(s.source.label);
  if (data.mode === "stale") parts.push("last results received, may be out of date");
  return parts.join(" · ");
}
