import { Link, useLocation, useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import { ROLES, signOut, useSession } from "../auth/session";
import "./Layout.css";
import InfoTip from "../components/InfoTip";
import FloatingAssistant from "../components/FloatingAssistant";

const HELP_KEY = { "/monitor": "pageMonitor", "/alerts": "pageAlerts", "/assistant": "pageAssistant", "/admin": "pageAdmin", "/oversight": "pageOversight", "/protect": "pageProtect" };
const TITLES = {
  "/monitor": "Flagged rings",
  "/alerts": "Alerts",
  "/assistant": "Assistant",
  "/admin": "System",
  "/oversight": "Oversight",
  "/protect": "Payment protection",
};

export default function Layout({ children, usingMock, title }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const role = session ? ROLES[session.role] : null;
  const nav = role ? role.nav : [];
  const section = "/" + (loc.pathname.split("/")[1] || "");
  const heading = title || TITLES[section] || "";
  const helpKey = HELP_KEY[section];

  const leave = () => {
    signOut();
    navigate("/login");
  };

  return (
    <div className="layout">
      <header className="topbar">
        <Link to={role ? role.home : "/"} className="topbar-brand" aria-label="NEXUS Z home">
          <Logo size={28} />
        </Link>
        <nav className="nav" aria-label="Main">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={`nav-link${loc.pathname === n.to || (n.to !== "/" && loc.pathname.startsWith(n.to + "/")) ? " active" : ""}`}
              aria-current={loc.pathname === n.to ? "page" : undefined}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="topbar-right">
          {usingMock ? <span className="badge">Sample data</span> : <span className="badge badge-live">Live API</span>}
          {role ? (
            <>
              <span className="user-chip" title={role.label}>
                <span className="user-role">{role.short}</span>
                {session.name ? <span className="user-name">{session.name}</span> : null}
              </span>
              <button type="button" className="signout" onClick={leave}>Sign out</button>
            </>
          ) : (
            <Link to="/login" className="btn-ghost signin-small">Sign in</Link>
          )}
        </div>
      </header>
      <main className="main">
        {heading ? <h1 className="page-title">{heading}{helpKey ? <InfoTip k={helpKey} /> : null}</h1> : null}
        {children}
      </main>
      <footer className="app-footer">
        Synthetic data and simulated rings made by our own team (data/rings.py). Results on them are optimistic, and most laundering
        groups in IBM's own data are still missed. Flags are for review, not verdicts. See docs/ML_RESULTS.md.
      </footer>
      <FloatingAssistant />
    </div>
  );
}
