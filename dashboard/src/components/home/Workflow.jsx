import { useState } from "react";
import "./Workflow.css";

/**
 * The five stages, as they exist in the repository. Every statement here is checked against code or docs named in `refs`;
 * `limits` says what the stage does not do. Status is "Implemented" or "Prototype" only: nothing planned is shown as built.
 */
export const STAGES = [
  {
    n: "01",
    name: "Ingest",
    line: "Payments arrive as JSON, one at a time or in batches of up to 5,000.",
    notes: ["POST /transactions"],
    status: "Implemented",
    does: [
      "The API accepts one payment or a list and queues it. The model backend takes the queued payments into its next rebuild.",
      "A replay tool streams a transaction file through the same endpoint at a chosen speed, in file order, so a demonstration is repeatable.",
    ],
    limits: ["Ingested amounts are assumed to be US dollars (there is no currency field), and the history lives in memory: it is lost when the API restarts."],
    refs: ["api/main.py", "api/async_backend.py", "infra/simulator.py"],
  },
  {
    n: "02",
    name: "Connect",
    line: "Accounts become nodes and payments become directed links. Each account gets features that describe who it pays, how often and how fast.",
    notes: ["57 account features", "PageRank · k-core"],
    status: "Implemented",
    does: [
      "Features cover transaction amounts and channels, timing (how quickly money received is sent on), graph position (counterparties, PageRank) and structure (k-core, clustering, connected component).",
      "Each payment is also described by the accounts at both ends and by what the receiver did next.",
    ],
    limits: ["Features are rebuilt from the whole history on every refresh. There is no per-payment incremental update."],
    refs: ["ml/features.py", "ml/edge_model.py"],
  },
  {
    n: "03",
    name: "Analyse",
    line: "High-risk accounts are linked by their payments into candidate rings; rings are grown through weaker linked accounts and large groups are split.",
    notes: ["ring grouping", "Louvain split"],
    status: "Implemented",
    does: [
      "Ring membership comes from the payment links between flagged accounts. Large groups are split with a community-detection step (NetworkX Louvain).",
      "A role (victim, collector, mule, cash-out) is estimated for each member from its position in the ring's payments.",
    ],
    limits: ["Roles are guesses: the data has no role labels. A ring id is a hash of its members and changes when the ring changes."],
    refs: ["ml/rings.py", "ml/service.py"],
  },
  {
    n: "04",
    name: "Score",
    line: "A payment-level XGBoost model scores every payment. An account's risk is its riskiest payment; reasons are exact TreeSHAP values.",
    notes: ["XGBoost", "TreeSHAP"],
    status: "Implemented",
    does: [
      "The API runs with a stub backend (invented sample data) or the model backend (the trained model over a transaction slice). The dashboard shows which.",
      "Explanations come from XGBoost's own TreeSHAP and say when a signal is absent.",
    ],
    limits: [
      "A risk score is a signal for investigation, not proof of anything.",
      "It runs on the CPU. No accelerator speed-up is claimed for the fraud model.",
      "Most laundering groups in the IBM AML data are still missed (docs/ML_RESULTS.md).",
    ],
    refs: ["ml/edge_model.py", "ml/explain.py", "docs/ML_RESULTS.md"],
  },
  {
    n: "05",
    name: "Investigate",
    line: "Rings, accounts and alerts are served by the API and explored in this workspace.",
    notes: ["GET /rings", "GET /rings/{id}", "GET /accounts/{id}", "GET /alerts"],
    status: "Implemented",
    does: [
      "The ring explorer shows each ring's payment graph, its reasons and its accounts; alerts link to the ring, the account and the payment pre-check.",
      "The pre-check is a prototype screen built on GET /accounts/{id}. No endpoint sends a warning and nothing is sent to anyone.",
    ],
    limits: ["Alerts cover only the highest-risk rings and list at most three likely victims each. The rule behind them has not been evaluated for accuracy."],
    refs: ["api/main.py", "ml/service.py", "dashboard/src/pages/Explorer.jsx"],
    extra: { label: "Payment pre-check", status: "Prototype" },
  },
];

export default function Workflow() {
  const [open, setOpen] = useState(0);
  const s = STAGES[open];
  const onKey = (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      setOpen((i) => Math.min(STAGES.length - 1, i + 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen((i) => Math.max(0, i - 1));
    }
  };
  return (
    <div className="wf">
      <ol className="wf-rail" role="tablist" aria-label="Investigation workflow" onKeyDown={onKey}>
        {STAGES.map((st, i) => (
          <li key={st.n} className={`wf-step${i === open ? " on" : ""}${i < open ? " past" : ""}`}>
            <button role="tab" id={`wf-tab-${i}`} aria-selected={i === open} aria-controls="wf-panel" tabIndex={i === open ? 0 : -1} onClick={() => setOpen(i)}>
              <span className="wf-n mono">{st.n}</span>
              <span className="wf-name">{st.name}</span>
            </button>
            <p className="wf-line">{st.line}</p>
            <div className="wf-notes">
              {st.notes.map((n) => <span key={n} className="mono">{n}</span>)}
            </div>
          </li>
        ))}
      </ol>

      <div className="wf-panel" id="wf-panel" role="tabpanel" aria-labelledby={`wf-tab-${open}`}>
        <header>
          <div className="eyebrow">Stage {s.n}</div>
          <h3>{s.name}</h3>
          <span className="tag ok">{s.status}</span>
          {s.extra && <span className="tag warn">{s.extra.label}: {s.extra.status}</span>}
        </header>
        <div className="wf-cols">
          <div>
            <div className="eyebrow">What the code does</div>
            <ul>{s.does.map((d) => <li key={d}>{d}</li>)}</ul>
          </div>
          <div>
            <div className="eyebrow">What it does not do</div>
            <ul className="wf-limits">{s.limits.map((d) => <li key={d}>{d}</li>)}</ul>
          </div>
        </div>
        <div className="wf-refs"><span className="eyebrow">In the repository</span> {s.refs.map((r) => <code key={r}>{r}</code>)}</div>
      </div>
    </div>
  );
}
