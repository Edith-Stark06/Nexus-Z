import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import Layout, { Mark } from "./Layout";
import HeroNetwork from "../components/home/HeroNetwork";
import Workflow from "../components/home/Workflow";
import Architecture from "../components/home/Architecture";
import { useHomeSource } from "../components/home/useHomeData";
import { sourceLine } from "../lib/provenance";
import { useData } from "../state/DataContext";
import "./Home.css";

export const HOME_TITLE = "NEXUS Z: Reveal the connections behind suspicious transactions";

export default function Home() {
  const home = useHomeSource();
  const data = useData();
  const line = data.mode === "standalone" || data.mode === "connecting" ? "" : sourceLine(data);

  useEffect(() => {
    const before = document.title;
    document.title = HOME_TITLE;
    return () => {
      document.title = before;
    };
  }, []);

  return (
    <Layout bare>
      <div className="home">
        <section className="hm-hero" aria-labelledby="hm-h1">
          <div className="hm-hero-copy">
            <h1 id="hm-h1">Reveal the connections behind suspicious transactions.</h1>
            <p className="hm-sub">
              NEXUS Z helps investigators explore financial transaction relationships, examine potentially suspicious account groups, and understand the risk signals behind
              alerts.
            </p>
            <div className="hm-cta">
              <Link to="/rings" className="btn primary">Open investigation workspace <ArrowRight size={16} aria-hidden="true" /></Link>
              <a href="#how" className="btn tertiary">How NEXUS Z Works</a>
            </div>
            {line && <p className="hm-source" data-testid="source-line">{line}</p>}
          </div>
          <div className="hm-hero-graph">
            <HeroNetwork home={home} />
          </div>
        </section>

        <section id="how" className="hm-sec" aria-labelledby="how-h">
          <div className="hm-sec-in">
            <header className="hm-sec-head">
              <h2 id="how-h">How NEXUS Z works</h2>
              <p>What the system does today, step by step, and where each step stops. Nothing planned is shown as working.</p>
            </header>
            <Workflow />
          </div>
        </section>

        <section id="architecture" className="hm-sec hm-alt" aria-labelledby="arch-h">
          <div className="hm-sec-in">
            <header className="hm-sec-head">
              <h2 id="arch-h">Architecture and target platform</h2>
              <p>How the dashboard, API, graph processing and scoring model fit together, and what is known about where they run.</p>
            </header>
            <Architecture />
          </div>
        </section>

        <section id="start" className="hm-final" aria-labelledby="start-h">
          <div className="hm-sec-in hm-final-in">
            <div>
              <h2 id="start-h">Start with the flagged rings.</h2>
              <p>Open a ring, read its payment graph, and see the signals behind its score. Scores are automated signals for review, not findings of fraud.</p>
            </div>
            <div className="hm-cta">
              <Link to="/rings" className="btn primary">Open investigation workspace <ArrowRight size={16} aria-hidden="true" /></Link>
              <a href="#architecture" className="btn tertiary">View the technical architecture</a>
            </div>
          </div>
        </section>

        <footer className="hm-foot">
          <div className="hm-sec-in hm-foot-in">
            <div className="hm-foot-brand"><Mark size={18} /> NEXUS Z</div>
            <p>
              An IBM Z Datathon 2026 project. React, FastAPI and XGBoost; IBM LinuxONE is the deployment target. Results come from evaluation data documented as synthetic,
              not from real customers' transactions. Not an IBM product, and not endorsed by IBM.
            </p>
          </div>
        </footer>
      </div>
    </Layout>
  );
}
