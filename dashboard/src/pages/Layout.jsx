import { Link, useLocation } from "react-router-dom";
import { Gauge, Network, ShieldAlert, MessageSquareText, Server, RefreshCw } from "lucide-react";
import { useData } from "../state/DataContext";
import { formatUtc } from "../lib/constants";
import "./Layout.css";

const NAV = [
  { to: "/overview", label: "Overview", Icon: Gauge, match: (p) => p.startsWith("/overview") },
  { to: "/rings", label: "Ring explorer", Icon: Network, match: (p) => p.startsWith("/rings") || p.startsWith("/ring/") || p.startsWith("/account/") },
  { to: "/alerts", label: "Alerts", Icon: ShieldAlert, match: (p) => p.startsWith("/alerts") || p.startsWith("/warning/") },
  { to: "/assistant", label: "Assistant", Icon: MessageSquareText, match: (p) => p.startsWith("/assistant") },
  { to: "/platform", label: "Platform", Icon: Server, match: (p) => p.startsWith("/platform") },
];

// Three accounts joined by payments, drawn as the letter Z.
export function Mark({ size = 28 }) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M6 7h16L6 21h16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="6" cy="7" r="2.6" fill="var(--bg)" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="22" cy="7" r="2.6" fill="currentColor" />
      <circle cx="6" cy="21" r="2.6" fill="var(--bg)" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="22" cy="21" r="2.6" fill="currentColor" />
    </svg>
  );
}

function clock(d) {
  return d ? d.toLocaleTimeString([], { hour12: false }) : "—";
}

// What the connection is, in words. "Connected" is only ever claimed when /health answered on the last poll.
export function connectionSummary(data) {
  const { mode, health, lastOk } = data;
  const backend = health?.backend;
  switch (mode) {
    case "live":
      return backend === "stub"
        ? { tone: "warn", text: "Stub backend", detail: "invented sample data" }
        : { tone: "ok", text: backend ? `${backend} backend` : "API connected", detail: `health check ${clock(lastOk)}` };
    case "stale":
      return { tone: "warn", text: "API not answering", detail: `showing results from ${clock(lastOk)}` };
    case "unreachable":
      return { tone: "danger", text: "API unreachable", detail: "no data yet" };
    case "demo":
      return { tone: "warn", text: "Demo sample", detail: "invented data" };
    case "connecting":
      return { tone: "none", text: "Connecting", detail: "" };
    default:
      return null;
  }
}

function Banner({ data }) {
  const { mode, health, lastError, retryLive, useDemo } = data;
  if (mode === "unreachable") {
    return (
      <div className="notice danger" role="alert">
        <div className="grow">
          <strong>The NEXUS Z API is not reachable.</strong> {lastError || ""} Nothing is shown because there is no data to show: results are never
          replaced with sample data automatically.
          <div className="notice-actions">
            <button className="primary" onClick={retryLive}>
              <RefreshCw size={14} /> Retry
            </button>
            <button onClick={useDemo}>Use the demo sample instead (invented data)</button>
          </div>
        </div>
      </div>
    );
  }
  if (mode === "stale") {
    return (
      <div className="notice warn" role="status">
        <div className="grow">
          <strong>The API stopped answering.</strong> {lastError || ""} The screens show the last results received and may be out of date.
          <div className="notice-actions">
            <button onClick={retryLive}>
              <RefreshCw size={14} /> Retry now
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (mode === "demo") {
    return (
      <div className="notice warn" role="status">
        <div className="grow">
          <strong>Demo sample.</strong> Every ring, account, alert and amount on screen is invented example data that ships with the dashboard. It is not
          model output.
          <div className="notice-actions">
            <button onClick={retryLive}>Try the live API again</button>
          </div>
        </div>
      </div>
    );
  }
  if (mode === "live" && health?.backend === "stub") {
    return (
      <div className="notice warn" role="status">
        <div className="grow">
          <strong>The API is running its stub backend.</strong> Rings, accounts and amounts are invented sample data from the server, not model output. Start it
          with <code>NEXUSZ_BACKEND=model</code> for real results.
        </div>
      </div>
    );
  }
  if (mode === "live" && health?.status === "degraded") {
    return (
      <div className="notice warn" role="status">
        <div className="grow">
          <strong>Degraded.</strong> The last model refresh failed (<code>{health.last_error?.type || "error"}</code>); results are from the previous state.
        </div>
      </div>
    );
  }
  return null;
}

export function StatusStrip({ data }) {
  const c = connectionSummary(data);
  if (!c) return null;
  const asOf = data.health?.data_as_of;
  return (
    <div className="status" aria-label="Connection status">
      <span className={`tag ${c.tone === "none" ? "" : c.tone}`}>
        <span className={`dot ${c.tone === "ok" ? "ok" : c.tone === "danger" ? "danger" : c.tone === "warn" ? "warn" : ""}`} />
        {c.text}
      </span>
      {c.detail && <span className="faint status-detail">{c.detail}</span>}
      {asOf && (
        <span className="status-asof" title="The time of the newest payment in the model's current state (from /health)">
          <span className="eyebrow">Data as of</span> <span className="mono num">{formatUtc(asOf)}</span>
        </span>
      )}
      {data.mode !== "standalone" && (
        <button className="icon ghost" onClick={data.refresh} aria-label="Refresh now" title="Refresh now">
          <RefreshCw size={14} />
        </button>
      )}
    </div>
  );
}

// `flush` gives the page the whole workspace (no padding, no scrolling), for the explorer. `usingMock` is the old prop; the
// connection state now comes from the DataProvider.
export default function Layout({ title, subtitle, actions, flush = false, children }) {
  const loc = useLocation();
  const data = useData();
  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <Link to="/" className="rail-brand" aria-label="NEXUS Z home page">
          <Mark />
        </Link>
        {NAV.map(({ to, label, Icon, match }) => (
          <Link key={to} to={to} className="rail-link" data-label={label} aria-label={label} aria-current={match(loc.pathname) ? "page" : undefined}>
            <Icon size={19} strokeWidth={1.7} />
          </Link>
        ))}
      </nav>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{title || "NEXUS Z"}</h1>
            {subtitle && <span className="faint topbar-sub">{subtitle}</span>}
          </div>
          <div className="topbar-right">
            {actions}
            <StatusStrip data={data} />
          </div>
        </header>
        <Banner data={data} />
        <main className={`page${flush ? " page-flush" : ""}`}>{children}</main>
        <footer className="caveat">
          Synthetic data. A risk score is an automated signal for review, not a finding of fraud. Roles are estimates. Accuracy is modest and many laundering groups are still missed (docs/ML_RESULTS.md).
        </footer>
      </div>
    </div>
  );
}
