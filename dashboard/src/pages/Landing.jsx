import { Link } from "react-router-dom";
import Logo from "../components/Logo";
import HeroGraph from "../components/HeroGraph";
import NetworkBackdrop from "../components/NetworkBackdrop";
import { ROLE_LIST } from "../auth/session";
import "./Landing.css";

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
      <NetworkBackdrop />
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
            <h1>Find the ring, not just the payment.</h1>
            <p className="l-lead">
              Pig-butchering scams move money through a few collector accounts to a cash-out. Each payment looks
              ordinary alone. NEXUS Z looks at the flow between accounts, flags the ring, explains why, and shows who recently paid in.
            </p>
            <div className="l-cta">
              <Link to="/login" className="btn-primary">Sign in to the demo</Link>
              <a href="#how" className="btn-ghost">See how it works</a>
            </div>
          </div>
          <div className="l-hero-art">
            <HeroGraph />
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
