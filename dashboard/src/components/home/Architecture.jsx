import { useState } from "react";
import "./Architecture.css";

// The stack, top to bottom, with only components that exist in the repository.
const LAYERS = [
  { key: "ui", eyebrow: "Interface", title: "Dashboard", detail: "React · Vite · D3", tag: "this page" },
  { key: "api", eyebrow: "Service", title: "NEXUS Z API", detail: "FastAPI · Uvicorn", mono: "/health  /rings  /rings/{id}  /accounts/{id}  /alerts  /transactions" },
  { key: "score", eyebrow: "Graph and scoring", title: "Rings, features, risk model", detail: "pandas · NumPy · SciPy · NetworkX (ring split) · XGBoost · TreeSHAP", tag: "CPU" },
  { key: "ctr", eyebrow: "Container", title: "Rootless Podman", detail: "read-only filesystem · capabilities dropped · loopback only", tag: "verified on the datathon VM" },
  { key: "os", eyebrow: "Operating system", title: "Red Hat Enterprise Linux 9", detail: "s390x, big-endian" },
  { key: "hw", eyebrow: "Platform", title: "IBM LinuxONE", detail: "the deployment target", dashed: true },
];
const LINKS = { ui: "JSON over HTTP", api: "model backend · background micro-batch rebuild", score: "runs in", ctr: "on", os: "on" };

const FACTS = [
  {
    layer: "os",
    title: "Runs on s390x",
    text: "A model trained on a little-endian laptop gives identical predictions on the big-endian VM: the largest difference was 9e-16 over 300 rows.",
    src: "docs/TECHNICAL_DESIGN.md, section 3",
  },
  {
    layer: "ctr",
    title: "Hardened, loopback-only container",
    text: "The API runs in a rootless Podman container: non-root, read-only filesystem and mounts, every Linux capability dropped, a memory limit, reachable only on the VM's loopback.",
    src: "docs/PLATFORM_RESULTS.md, section 3c",
  },
  {
    layer: "api",
    title: "Measured once, on an idle VM",
    text: "First state in 12.1 s from 657k payments of history; a new payment became visible in 9.6 to 9.9 s. One run and three probes: a measurement, not a guarantee.",
    src: "docs/PLATFORM_RESULTS.md, section 3c",
  },
  {
    layer: "score",
    title: "CPU only",
    text: "XGBoost, pandas and NetworkX run on the ordinary CPU. The VM's AI accelerator was measured separately: trees do not use it, so no speed-up is claimed.",
    src: "docs/ML_RESULTS.md, section 8",
  },
];

export default function Architecture() {
  const [active, setActive] = useState(null);
  return (
    <div className="ar">
      <div className="ar-facts">
        <p className="ar-lede">
          NEXUS Z is designed to run on <strong>IBM LinuxONE</strong> with <strong>Red Hat Enterprise Linux</strong> on <span className="mono">s390x</span>. The pieces below are the ones in the repository;
          each fact names where it is documented.
        </p>
        <ul className="ar-list" aria-label="Verified in the repository">
          {FACTS.map((f) => (
            <li key={f.title} onMouseEnter={() => setActive(f.layer)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(f.layer)} onBlur={() => setActive(null)} tabIndex={0}>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
              <span className="ar-src mono">{f.src}</span>
            </li>
          ))}
        </ul>
        <div className="ar-not">
          <div className="eyebrow">Not claimed</div>
          <ul>
            <li>A production banking deployment, security certifications or integrations: none exist.</li>
            <li>Accelerator speed-up for the fraud model.</li>
            <li>That this page is served from LinuxONE. The dashboard cannot tell where the API runs: <span className="mono">/health</span> does not report the machine.</li>
          </ul>
        </div>
      </div>

      <ol className="ar-stack" aria-label="Deployment stack, top to bottom">
        {LAYERS.map((l) => (
          <li key={l.key} className="ar-item">
            <div className={`ar-layer${l.dashed ? " dashed" : ""}${active === l.key ? " on" : ""}`}>
              <div className="ar-top"><span className="eyebrow">{l.eyebrow}</span>{l.tag && <span className="tag">{l.tag}</span>}</div>
              <h3>{l.title}</h3>
              <p>{l.detail}</p>
              {l.mono && <code>{l.mono}</code>}
            </div>
            {LINKS[l.key] && (
              <div className="ar-link" aria-hidden="true">
                <span className="ar-wire" />
                <span className="mono">{LINKS[l.key]}</span>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
