import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Menu, X } from "lucide-react";
import { Mark, connectionSummary } from "./Layout";
import HeroNetwork from "../components/home/HeroNetwork";
import InsightCompare from "../components/home/InsightCompare";
import Workflow from "../components/home/Workflow";
import WorkspacePreview from "../components/home/WorkspacePreview";
import Architecture from "../components/home/Architecture";
import { useHomeSource, useReveal } from "../components/home/useHomeData";
import { useData } from "../state/DataContext";
import "./Home.css";

const NAV = [
  { href: "#insight", label: "Why networks" },
  { href: "#how", label: "How it works" },
  { href: "#preview", label: "Workspace" },
  { href: "#architecture", label: "Architecture" },
];

const ROUTES = [
  { to: "/rings", text: "Ring explorer: the payment graph, evidence and replay" },
  { to: "/overview", text: "Overview: highest-risk rings and pipeline freshness" },
  { to: "/alerts", text: "Alerts: ring alerts and likely victims flagged" },
  { to: "/assistant", text: "Assistant: questions answered from the data" },
  { to: "/platform", text: "Platform: what the API reports, and a test payment form" },
];

function Section({ id, n, title, lede, children, className = "" }) {
  const ref = useReveal();
  return (
    <section id={id} ref={ref} className={`hm-sec ${className}`} aria-labelledby={`${id}-h`}>
      <header className="hm-sec-head">
        <span className="hm-n mono" aria-hidden="true">{n}</span>
        <div>
          <h2 id={`${id}-h`}>{title}</h2>
          {lede && <p className="hm-lede">{lede}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function Nav() {
  const data = useData();
  const conn = connectionSummary(data);
  const [open, setOpen] = useState(false);
  return (
    <header className="hm-nav">
      <div className="hm-nav-in">
        <Link to="/" className="hm-brand" aria-label="NEXUS Z, top of the page" onClick={() => window.scrollTo({ top: 0 })}>
          <Mark size={26} />
          <span>NEXUS <b>Z</b></span>
        </Link>
        <nav className="hm-links" aria-label="Sections">
          {NAV.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
        </nav>
        <div className="hm-nav-right">
          {conn && conn.tone !== "none" && (
            <span className={`tag ${conn.tone}`} title="The dashboard's connection to the NEXUS Z API">
              <span className={`dot ${conn.tone}`} /> {conn.text}
            </span>
          )}
          <Link to="/rings" className="hm-btn hm-btn-sm primary">Open workspace <ArrowRight size={14} aria-hidden="true" /></Link>
          <button className="icon hm-menu" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="hm-drawer" onClick={() => setOpen((o) => !o)}>
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="hm-drawer" className="hm-drawer" aria-label="Sections">
          {NAV.map((l) => <a key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</a>)}
          <Link to="/rings" onClick={() => setOpen(false)}>Open the workspace</Link>
        </nav>
      )}
    </header>
  );
}

export default function Home() {
  const home = useHomeSource();

  useEffect(() => {
    const before = document.title;
    document.title = "NEXUS Z: Follow the money. Reveal the network.";
    return () => {
      document.title = before;
    };
  }, []);

  return (
    <div className="home">
      <a className="hm-skip" href="#main">Skip to content</a>
      <Nav />
      <main id="main">
        <section className="hm-hero" id="network" aria-label="Introduction">
          <div className="hm-hero-copy">
            <div className="hm-label mono">NEXUS Z <span aria-hidden="true">/</span> FINANCIAL INTELLIGENCE</div>
            <h1>
              Follow the money.
              <span>Reveal the network.</span>
            </h1>
            <p className="hm-sub">
              Discover the connections that individual transactions can hide. NEXUS Z helps investigators explore suspicious financial relationships, examine fraud-ring patterns,
              and turn risk signals into actionable investigations.
            </p>
            <div className="hm-cta">
              <Link to="/rings" className="hm-btn primary">Explore Fraud Networks <ArrowRight size={16} aria-hidden="true" /></Link>
              <a href="#how" className="hm-btn">How NEXUS Z Works</a>
            </div>
            <ul className="hm-strip mono" aria-label="Built with">
              <li>Graph analysis</li>
              <li>Risk scoring</li>
              <li>FastAPI</li>
              <li>IBM LinuxONE target</li>
            </ul>
          </div>
          <div className="hm-hero-graph">
            <HeroNetwork home={home} />
          </div>
        </section>

        <Section id="insight" n="01" title="A transaction is a point. The network is the evidence." lede="Individual transactions tell a story. The connections between them can reveal something much bigger.">
          <InsightCompare />
        </Section>

        <Section id="how" n="02" title="From payment to investigation, in five stages." lede="What the system does today, stage by stage, and where each stage stops.">
          <Workflow />
        </Section>

        <Section id="preview" n="03" title="From suspicious signal to investigation." lede="A working miniature of the ring explorer, fed by the same API as everything else on this page.">
          <WorkspacePreview home={home} />
        </Section>

        <Section id="architecture" n="04" title="Built for enterprise financial workloads.">
          <Architecture />
        </Section>

        <section id="start" className="hm-final" aria-labelledby="start-h">
          <div className="hm-final-in">
            <div>
              <h2 id="start-h">The pattern was always there. <span>Now you can see it.</span></h2>
              <p>Explore connected transactions. Understand suspicious relationships. Give investigators a clearer starting point.</p>
              <div className="hm-cta">
                <Link to="/rings" className="hm-btn primary">Open Investigation Workspace <ArrowRight size={16} aria-hidden="true" /></Link>
                <a href="#architecture" className="hm-btn">Explore the Technical Architecture</a>
              </div>
            </div>
            <nav className="hm-routes" aria-label="Where to go in the workspace">
              <div className="eyebrow">In the workspace</div>
              <ul>
                {ROUTES.map((r) => (
                  <li key={r.to}>
                    <Link to={r.to}><span className="mono">{r.to}</span><span>{r.text}</span></Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </section>
      </main>

      <footer className="hm-foot">
        <div className="hm-foot-in">
          <div>
            <div className="hm-foot-brand"><Mark size={20} /> NEXUS Z</div>
            <p className="faint">An IBM Z Datathon 2026 project. React, FastAPI, XGBoost; IBM LinuxONE is the deployment target.</p>
          </div>
          <nav aria-label="Application">
            <Link to="/rings">Ring explorer</Link>
            <Link to="/overview">Overview</Link>
            <Link to="/alerts">Alerts</Link>
            <Link to="/assistant">Assistant</Link>
            <Link to="/platform">Platform</Link>
          </nav>
        </div>
        <p className="hm-foot-note faint">Synthetic data. A risk score is an automated signal for review, not a finding of fraud. Roles are estimates.</p>
      </footer>
    </div>
  );
}
