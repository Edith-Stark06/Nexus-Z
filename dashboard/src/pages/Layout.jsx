import { Link, useLocation } from "react-router-dom";
import "./Layout.css";

const NAV = [
  { to: "/", label: "Rings" },
  { to: "/alerts", label: "Alerts" },
  { to: "/assistant", label: "Assistant" },
];

export default function Layout({ children, usingMock }) {
  const loc = useLocation();
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">NZ</div>
          <div>
            <div className="brand-title">NEXUS Z</div>
            <div className="brand-sub">Fraud ring detection</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={`nav-link${loc.pathname === n.to ? " active" : ""}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          {usingMock ? (
            <span className="badge">Using sample data</span>
          ) : (
            <span className="badge badge-live">Live API</span>
          )}
          <div className="sidebar-note">
            Synthetic data: IBM AML transactions with simulated pig-butchering
            rings. Accuracy is modest; many laundering groups are still missed.
            See docs/ML_RESULTS.md.
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <h1 className="topbar-title">
            {loc.pathname === "/" ? "Flagged rings" : loc.pathname === "/alerts" ? "Alerts" : loc.pathname === "/assistant" ? "Assistant" : ""}
          </h1>
        </header>
        {children}
        <footer className="app-footer">
          Accuracy is modest; many laundering groups are still missed. See docs/ML_RESULTS.md.
        </footer>
      </main>
    </div>
  );
}