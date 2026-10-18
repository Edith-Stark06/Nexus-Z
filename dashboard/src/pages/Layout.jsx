import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, RefreshCw, X } from "lucide-react";
import { useData } from "../state/DataContext";
import SystemStatus from "../components/SystemStatus";
import { sourceLine } from "../lib/provenance";
import "./Layout.css";

const NAV = [
  { to: "/overview", label: "Overview", match: (p) => p.startsWith("/overview") },
  { to: "/rings", label: "Investigations", match: (p) => p.startsWith("/rings") || p.startsWith("/ring/") },
  { to: "/alerts", label: "Alerts", match: (p) => p.startsWith("/alerts") || p.startsWith("/warning/") },
  { to: "/accounts", label: "Accounts", match: (p) => p.startsWith("/account") },
  { to: "/assistant", label: "Assistant", match: (p) => p.startsWith("/assistant") },
  { to: "/platform", label: "Platform", match: (p) => p.startsWith("/platform") },
];

// Three accounts joined by payments, drawn as the letter Z.
export function Mark({ size = 24 }) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M6 7h16L6 21h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="6" cy="7" r="2.8" fill="var(--mark-bg, #161616)" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="22" cy="7" r="2.8" fill="currentColor" />
      <circle cx="6" cy="21" r="2.8" fill="var(--mark-bg, #161616)" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="22" cy="21" r="2.8" fill="currentColor" />
    </svg>
  );
}

// What the connection is, in words. Kept for callers that need one short label; the full picture is components/SystemStatus.
export function connectionSummary(data) {
  const { mode, health, lastOk } = data;
  const clock = lastOk ? lastOk.toLocaleTimeString([], { hour12: false }) : "—";
  switch (mode) {
    case "live":
      return health?.backend === "stub"
        ? { tone: "warn", text: "Stub backend", detail: "invented sample data" }
        : { tone: "ok", text: health?.backend ? `${health.backend} backend` : "API responding", detail: `answered ${clock}` };
    case "stale":
      return { tone: "warn", text: "API not answering", detail: `showing results from ${clock}` };
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
          <strong>The NEXUS Z API is not reachable.</strong> {lastError || ""} No results are shown, because results are never replaced with sample data
          automatically.
          <div className="notice-actions">
            <button className="primary" onClick={retryLive}>
              <RefreshCw size={14} aria-hidden="true" /> Retry
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
              <RefreshCw size={14} aria-hidden="true" /> Retry now
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
          with <code>NEXUSZ_BACKEND=model</code> for model results.
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

/** Title, a sentence on what the page is for, and where its data comes from. `compact` is for the full-bleed workspace. */
export function PageHeader({ title, description, actions, compact = false, source = true }) {
  const data = useData();
  const line = source && data.mode !== "standalone" && data.mode !== "connecting" ? sourceLine(data) : "";
  return (
    <div className={`ph${compact ? " ph-compact" : ""}`}>
      <div className="ph-text">
        <h1>{title}</h1>
        {description && <p className="ph-desc">{description}</p>}
        {line && <p className="ph-source" data-testid="source-line">{line}</p>}
      </div>
      {actions && <div className="ph-actions">{actions}</div>}
    </div>
  );
}

/**
 * The one application shell: the header (product, navigation, system status), an optional page header, and the content.
 * `flush` gives the page the whole workspace (no padding, no scrolling) for the explorer. `bare` skips the page header and the
 * content width, for the homepage, which lays out its own sections.
 */
export default function Layout({ title, subtitle, actions, flush = false, bare = false, children }) {
  const loc = useLocation();
  const data = useData();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [loc.pathname]);

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <header className="appbar">
        <button className="icon appbar-menu" aria-label={menu ? "Close navigation" : "Open navigation"} aria-expanded={menu} aria-controls="appnav" onClick={() => setMenu((m) => !m)}>
          {menu ? <X size={20} /> : <Menu size={20} />}
        </button>
        <Link to="/" className="appbar-brand" aria-label="NEXUS Z home page">
          <Mark size={22} />
          <span>NEXUS <b>Z</b></span>
        </Link>
        <nav id="appnav" className={`appnav${menu ? " open" : ""}`} aria-label="Main">
          {NAV.map(({ to, label, match }) => (
            <Link key={to} to={to} aria-current={match(loc.pathname) ? "page" : undefined}>{label}</Link>
          ))}
        </nav>
        <div className="appbar-right"><SystemStatus /></div>
      </header>
      <Banner data={data} />
      <main id="main" className={`page${flush ? " page-flush" : ""}${bare ? " page-bare" : ""}`} tabIndex={-1}>
        {!flush && !bare && title && (
          <div className="page-in">
            <PageHeader title={title} description={subtitle} actions={actions} />
            {children}
          </div>
        )}
        {(flush || bare || !title) && children}
      </main>
    </div>
  );
}
