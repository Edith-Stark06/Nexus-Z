import { Link } from "react-router-dom";
import Logo from "../components/Logo";
import { ROLE_LIST } from "../auth/session";
import "./Landing.css";

// A static, made-up example of the shape NEXUS Z looks for. It is an illustration, not data.
function RingIllustration() {
  const victims = [[40, 40], [34, 92], [46, 146], [30, 200], [42, 252], [36, 300]];
  const collectors = [[176, 96], [168, 200], [182, 286]];
  const mules = [[290, 70], [300, 160], [286, 250]];
  const cashout = [392, 160];
  const links = [
    ...victims.map((v, i) => [v, collectors[Math.floor(i / 2)], "victim"]),
    [collectors[0], mules[0], "ring"], [collectors[1], mules[1], "ring"], [collectors[2], mules[2], "ring"],
    [collectors[1], mules[0], "ring"], [mules[0], cashout, "ring"], [mules[1], cashout, "ring"], [mules[2], cashout, "ring"],
  ];
  return (
    <svg className="ring-art" viewBox="0 0 440 340" role="img"
      aria-label="Example of a ring: many payers pay a few collector accounts, money passes through mule accounts to one cash-out. Illustration only.">
      <ellipse cx="270" cy="170" rx="170" ry="140" fill="rgba(225,29,90,0.06)" stroke="rgba(225,29,90,0.45)" strokeDasharray="5 5" />
      {links.map(([a, b, kind], i) => (
        <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={kind === "victim" ? "#9aa0ee" : "#E11D5A"} strokeWidth={kind === "victim" ? 1.4 : 2.4} />
      ))}
      {victims.map(([x, y], i) => <circle key={`v${i}`} cx={x} cy={y} r="7" fill="#fff" stroke="#0C0F1D" strokeWidth="2" />)}
      {collectors.map(([x, y], i) => <circle key={`c${i}`} cx={x} cy={y} r={i === 1 ? 14 : 11} fill="#E11D5A" />)}
      {mules.map(([x, y], i) => <circle key={`m${i}`} cx={x} cy={y} r="9" fill="#fff" stroke="#E11D5A" strokeWidth="3" />)}
      <rect x={cashout[0] - 11} y={cashout[1] - 11} width="22" height="22" rx="3" fill="#0C0F1D" />
      <g fontFamily="Hanken Grotesk, sans-serif" fontSize="12" fill="#4F566B">
        <text x="14" y="18">Payers</text>
        <text x="150" y="68">Collectors</text>
        <text x="266" y="40">Mule chain</text>
        <text x="358" y="204">Cash-out</text>
      </g>
    </svg>
  );
}

const STEPS = [
  { n: "1", title: "Watch how money moves", text: "Every payment becomes a link between two accounts. The system looks at who pays whom, how quickly money is passed on, and how groups of accounts connect." },
  { n: "2", title: "Find the ring and say why", text: "Linked high-risk accounts are grouped into rings. Each ring comes with the reasons behind its score, including the signals that are missing, such as no long history." },
  { n: "3", title: "Show who paid in", text: "Accounts that recently paid into a flagged ring are listed, so a person can decide whether to contact them. The list is a flag for review, not a verdict, and nothing is sent automatically." },
];

const LIMITS = [
  { title: "Synthetic data", text: "The background is IBM's synthetic anti-money-laundering data. The pig-butchering rings are simulated by our own team." },
  { title: "Modest accuracy", text: "On IBM's own labels most laundering groups are still missed. Results on our simulated rings are optimistic because the same team built the rings and the model." },
  { title: "Flags, not verdicts", text: "A flagged account is a reason to look closer. Roles such as collector or mule are estimates, and no warnings are sent to anyone." },
];

export default function Landing() {
  return (
    <div className="landing">
      <header className="l-nav">
        <Logo size={30} />
        <nav aria-label="Sections" className="l-links">
          <a href="#how">How it works</a>
          <a href="#who">Who it is for</a>
          <a href="#limits">Limits</a>
        </nav>
        <Link to="/login" className="btn-primary l-signin">Sign in</Link>
      </header>

      <main>
        <section className="l-hero">
          <div className="l-hero-copy">
            <span className="l-pill">Synthetic data, demo environment</span>
            <h1>Find the ring, not just the payment.</h1>
            <p className="l-lead">
              Pig-butchering scams move money through a few collector accounts to a cash-out. Each payment looks
              ordinary alone. NEXUS Z looks at the flow between accounts, flags the ring, explains why, and shows who recently paid in.
            </p>
            <div className="l-cta">
              <Link to="/login" className="btn-primary">Sign in to the demo</Link>
              <a href="#how" className="btn-ghost">See how it works</a>
            </div>
            <p className="l-fine">Runs on IBM LinuxONE. Built for the IBM Z Datathon 2026.</p>
          </div>
          <div className="l-hero-art" aria-hidden={false}>
            <RingIllustration />
            <span className="l-caption">Illustration of the shape we look for. Not real data.</span>
          </div>
        </section>

        <section id="how" className="l-section">
          <h2>How it works</h2>
          <ol className="l-steps">
            {STEPS.map((s) => (
              <li key={s.n} className="l-card">
                <span className="l-step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="who" className="l-section">
          <h2>Who it is for</h2>
          <div className="l-roles">
            {ROLE_LIST.map((r) => (
              <article key={r.id} className="l-card l-role">
                <h3>{r.label}</h3>
                <p>{r.blurb}</p>
                <ul>{r.sees.map((s) => <li key={s}>{s}</li>)}</ul>
                <Link to={`/login/${r.id}`} className="l-role-link">Sign in as {r.label.toLowerCase()} →</Link>
              </article>
            ))}
          </div>
        </section>

        <section id="limits" className="l-section l-limits">
          <h2>What we say up front</h2>
          <div className="l-limit-grid">
            {LIMITS.map((l) => (
              <div key={l.title} className="l-limit">
                <h3>{l.title}</h3>
                <p>{l.text}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="l-foot">
        <Logo size={24} />
        <span>All identifiers are pseudonymised. No real personal data. IBM Z Datathon 2026.</span>
      </footer>
    </div>
  );
}
