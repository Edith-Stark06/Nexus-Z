import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import Logo from "../components/Logo";
import { ROLES, ROLE_LIST, homeFor, signIn, signOut, useSession } from "../auth/session";
import "./Login.css";

function Shell({ children }) {
  return (
    <div className="login">
      <aside className="login-side">
        <Link to="/" className="login-brand" aria-label="NEXUS Z home"><Logo size={30} onDark /></Link>
        <div>
          <h1>See the ring behind the payment.</h1>
          <p>Choose how you will use the demo. Each role sees a different set of screens.</p>
        </div>
        <p className="login-side-note">Synthetic data. IBM Z Datathon 2026.</p>
      </aside>
      <main className="login-main">{children}</main>
    </div>
  );
}

function DemoNotice() {
  return (
    <p className="demo-notice" role="note">
      <b>Demo sign-in.</b> No password is asked, checked or stored. Your choice only selects which screens you see and stays in this
      browser tab. A real deployment would use your institution's single sign-on.
    </p>
  );
}

export function RoleChooser() {
  const session = useSession();
  return (
    <Shell>
      <div className="login-card">
        <h2>Sign in</h2>
        <p className="login-sub">Who are you signing in as?</p>
        {session ? (
          <p className="signed-in">
            Signed in as <b>{ROLES[session.role].label}</b>. <Link to={homeFor(session.role)}>Continue</Link> or{" "}
            <button type="button" className="link-btn" onClick={signOut}>sign out</button>.
          </p>
        ) : null}
        <ul className="role-list">
          {ROLE_LIST.map((r) => (
            <li key={r.id}>
              <Link to={`/login/${r.id}`} className="role-choice">
                <span className="role-name">{r.label}</span>
                <span className="role-blurb">{r.blurb}</span>
                <span className="role-go" aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
        <DemoNotice />
        <p className="login-back"><Link to="/">← Back to the overview</Link></p>
      </div>
    </Shell>
  );
}

export function RoleLogin() {
  const { role } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState("");
  const cfg = ROLES[role];
  if (!cfg) return <Navigate to="/login" replace />;

  const submit = (e) => {
    e.preventDefault(); // never a native form post
    signIn(role, name);
    const from = location.state && location.state.from;
    navigate(from && from !== "/login" ? from : cfg.home, { replace: true });
  };

  return (
    <Shell>
      <form className="login-card" onSubmit={submit} aria-labelledby="role-title">
        <p className="login-crumb"><Link to="/login">← All roles</Link></p>
        <h2 id="role-title">{cfg.label}</h2>
        <p className="login-sub">{cfg.blurb}</p>
        <div className="role-sees">
          <span>You will see</span>
          <ul>{cfg.sees.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
        <label className="field">
          <span>Your name <em>(optional, shown in the top bar)</em></span>
          <input type="text" name="display-name" autoComplete="off" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" className="btn-primary login-submit">Continue as {cfg.short.toLowerCase()}</button>
        <DemoNotice />
      </form>
    </Shell>
  );
}
