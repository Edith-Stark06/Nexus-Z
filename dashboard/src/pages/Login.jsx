import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import Logo from "../components/Logo";
import NetworkBackdrop from "../components/NetworkBackdrop";
import { ROLES, ROLE_LIST, homeFor, signIn, signOut, useSession } from "../auth/session";
import { signUp, strength, validatePassword, validateUsername, verifyLogin } from "../auth/accounts";
import { DEMO_PASSWORD, demoEnabled, demoFor, ensureDemoAccounts } from "../auth/demo";
import "./Login.css";

function Shell({ children }) {
  return (
    <div className="login">
      <aside className="login-side">
        <NetworkBackdrop variant="dark" fill />
        <Link to="/" className="login-brand" aria-label="NEXUS Z home"><Logo size={30} onDark /></Link>
        <div>
          <h1>See the ring behind the payment.</h1>
        </div>
        <p className="login-side-note">Synthetic data. IBM Z Datathon 2026.</p>
      </aside>
      <main className="login-main">{children}</main>
    </div>
  );
}

function AccountNotice() {
  return (
    <p className="demo-notice" role="note">
      <b>Demo accounts.</b> Your account and a salted hash of your password are kept in this browser only, and nothing is sent to a
      server. The system behind this page has no user accounts, so this does not protect its data. Do not use a password you use
      anywhere else.
    </p>
  );
}

function DemoBox({ role, onUse }) {
  const d = demoFor(role);
  if (!d) return null;
  return (
    <div className="demo-box" role="group" aria-label="Demo login">
      <div>
        <strong>Try it with the demo login</strong>
        <dl>
          <dt>Username</dt><dd><code>{d.username}</code></dd>
          <dt>Password</dt><dd><code>{DEMO_PASSWORD}</code></dd>
        </dl>
      </div>
      <button type="button" onClick={() => onUse(d.username, DEMO_PASSWORD)}>Use these</button>
    </div>
  );
}

function PasswordField({ label, value, onChange, autoComplete, id, describedBy }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <span className="pw-wrap">
        <input id={id} name={id} type={shown ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={onChange}
          maxLength={128} required aria-describedby={describedBy} />
        <button type="button" className="pw-toggle" aria-pressed={shown} aria-label={`${shown ? "Hide" : "Show"} ${label.toLowerCase()}`}
          onClick={() => setShown((s) => !s)}>{shown ? "Hide" : "Show"}</button>
      </span>
    </div>
  );
}

export function RoleChooser() {
  const session = useSession();
  useEffect(() => { ensureDemoAccounts(); }, []);
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
        <AccountNotice />
        <p className="login-back"><Link to="/">← Back to the overview</Link></p>
      </div>
    </Shell>
  );
}

export function RoleLogin() {
  const { role } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cfg = ROLES[role];
  useEffect(() => { ensureDemoAccounts(); }, []);
  if (!cfg) return <Navigate to="/login" replace />;

  const submit = async (e) => {
    e.preventDefault(); // never a native form post
    setBusy(true);
    setError("");
    await ensureDemoAccounts();
    const res = await verifyLogin({ username, password, role });
    setBusy(false);
    if (!res.ok) { setError(res.error); setPassword(""); return; }
    signIn(role, res.account.name || res.account.username);
    const from = location.state && location.state.from;
    navigate(from && from !== "/login" ? from : cfg.home, { replace: true });
  };

  return (
    <Shell>
      <form className="login-card" onSubmit={submit} aria-labelledby="role-title">
        <p className="login-crumb"><Link to="/login">← All roles</Link></p>
        <h2 id="role-title">{cfg.label}</h2>
        <p className="login-sub">{cfg.blurb}</p>
        <DemoBox role={role} onUse={(u, p) => { setUsername(u); setPassword(p); setError(""); }} />
        <div className="field">
          <label htmlFor="username">Username</label>
          <input id="username" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32}
            value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <PasswordField id="password" label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button type="submit" className="btn-primary login-submit" disabled={busy || !username.trim() || !password}>{busy ? "Checking…" : "Sign in"}</button>
        <p className="login-switch">New here? <Link to={`/signup/${role}`}>Create an account</Link></p>
        <AccountNotice />
      </form>
    </Shell>
  );
}

const STRENGTH = ["Too weak", "Weak", "Fair", "Good", "Strong"];

export function RoleSignup() {
  const { role } = useParams();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cfg = ROLES[role];
  if (!cfg) return <Navigate to="/login" replace />;

  const problem = username ? validateUsername(username) : null;
  const pwProblem = password ? validatePassword(password, username) : null;
  const mismatch = again && again !== password ? "The two passwords do not match." : null;
  const s = strength(password);

  const submit = async (e) => {
    e.preventDefault(); // never a native form post
    if (problem || pwProblem || mismatch) { setError(problem || pwProblem || mismatch); return; }
    setBusy(true);
    setError("");
    const res = await signUp({ username, name, password, role });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    signIn(role, res.account.name || res.account.username);
    navigate(cfg.home, { replace: true });
  };

  return (
    <Shell>
      <form className="login-card" onSubmit={submit} aria-labelledby="signup-title">
        <p className="login-crumb"><Link to={`/login/${role}`}>← Back to sign in</Link></p>
        <h2 id="signup-title">Create an account</h2>
        <p className="login-sub">As {cfg.label.toLowerCase()}. {cfg.blurb}</p>
        <div className="field">
          <label htmlFor="name">Your name <em>(optional, shown in the top bar)</em></label>
          <input id="name" name="name" type="text" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input id="username" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32}
            value={username} onChange={(e) => setUsername(e.target.value)} required aria-invalid={!!problem} aria-describedby="username-hint" />
          <small id="username-hint" className={`field-hint${problem ? " bad" : ""}`}>{problem || "Not a real email address or anything personal."}</small>
        </div>
        <PasswordField id="new-password" label="Password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} describedBy="pw-hint" />
        <div id="pw-hint" className="pw-meter" aria-live="polite">
          <span className={`pw-bar s${s}`} aria-hidden="true"><i /><i /><i /><i /></span>
          <span>{password ? (pwProblem || STRENGTH[s]) : "At least 8 characters."}</span>
        </div>
        <PasswordField id="confirm-password" label="Repeat the password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} describedBy="match-hint" />
        <small id="match-hint" className="field-hint bad" role={mismatch ? "status" : undefined}>{mismatch || ""}</small>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button type="submit" className="btn-primary login-submit" disabled={busy || !username.trim() || !password || !again}>{busy ? "Creating…" : "Create account"}</button>
        <p className="login-switch">Already have an account? <Link to={`/login/${role}`}>Sign in</Link></p>
        <AccountNotice />
      </form>
    </Shell>
  );
}
