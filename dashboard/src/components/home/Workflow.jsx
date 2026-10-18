import "./Workflow.css";

/**
 * The six steps, as they exist in the repository. Every statement is checked against code or docs named in `refs`; `limits`
 * says what the step does not do. Status is "Implemented", "Prototype" or "Not built": nothing planned is shown as working.
 */
export const STAGES = [
  {
    n: "01",
    name: "Receive or simulate transaction activity",
    status: "Implemented",
    does: "Payments arrive as JSON on POST /transactions, one at a time or in batches of up to 5,000. A replay tool streams a transaction file through the same endpoint in file order, so a demonstration is repeatable.",
    limits: "The history is held in memory and is lost when the API restarts. There is no currency field.",
    refs: ["api/main.py", "api/async_backend.py", "infra/simulator.py"],
  },
  {
    n: "02",
    name: "Build the transaction relationships",
    status: "Implemented",
    does: "Accounts become nodes and payments become directed links. Each account gets features for amounts, channels, timing (how fast received money is sent on), graph position (counterparties, PageRank) and structure (k-core, clustering, connected component).",
    limits: "Features are rebuilt from the whole history on every refresh. There is no per-payment incremental update.",
    refs: ["ml/features.py", "ml/edge_model.py"],
  },
  {
    n: "03",
    name: "Analyse potentially suspicious structures",
    status: "Implemented",
    does: "High-scoring accounts are linked by their payments into candidate rings, grown through weaker linked accounts, and large groups are split with a community-detection step (NetworkX Louvain). A role is estimated for each member from its position in the ring.",
    limits: "Roles are estimates: the data has no role labels. A ring id is derived from its members and changes when they change.",
    refs: ["ml/rings.py", "ml/service.py"],
  },
  {
    n: "04",
    name: "Apply the configured fraud-scoring model",
    status: "Implemented",
    does: "A payment-level XGBoost model scores payments; an account's score comes from its riskiest payment, and reasons are TreeSHAP values. The API runs a stub backend (invented sample data) or the model backend, and the status control states which.",
    limits: "It runs on the CPU, and no accelerator speed-up is claimed. A score is a signal for review, not proof. Most laundering groups in the evaluation data are still missed (docs/ML_RESULTS.md).",
    refs: ["ml/edge_model.py", "ml/explain.py", "docs/ML_RESULTS.md"],
  },
  {
    n: "05",
    name: "Expose ring, account and alert information",
    status: "Implemented",
    does: "The API serves GET /rings, /rings/{id}, /accounts/{id}, /alerts and /health. This workspace reads exactly those.",
    limits: "Alerts cover only the 10 highest-scored rings and at most 3 likely victims each, and the rule behind them has not been evaluated for accuracy.",
    refs: ["api/main.py", "ml/service.py"],
  },
  {
    n: "06",
    name: "Support investigation and future intervention",
    status: "Implemented",
    does: "Investigations: the ring explorer, alerts, accounts and the reasons behind each score.",
    limits: "The payment pre-check screen is a prototype built on GET /accounts/{id}: no endpoint sends a warning, and nothing is sent to anyone. Intervention before a payment is not built.",
    refs: ["dashboard/src/pages/Explorer.jsx", "dashboard/src/pages/WarningScreen.jsx"],
    extra: [{ label: "Payment pre-check", status: "Prototype" }, { label: "Intervention before payment", status: "Not built" }],
  },
];

const TONE = { Implemented: "ok", Prototype: "warn", "Not built": "" };

export default function Workflow() {
  return (
    <ol className="wf" aria-label="How NEXUS Z works">
      {STAGES.map((s) => (
        <li key={s.n} className="wf-step">
          <div className="wf-n mono" aria-hidden="true">{s.n}</div>
          <div className="wf-body">
            <header>
              <h3>{s.name}</h3>
              <span className={`tag ${TONE[s.status]}`}>{s.status}</span>
              {s.extra?.map((x) => <span key={x.label} className={`tag ${TONE[x.status]}`}>{x.label}: {x.status}</span>)}
            </header>
            <p>{s.does}</p>
            <p className="wf-limit"><strong>Limits.</strong> {s.limits}</p>
            <div className="wf-refs"><span className="faint">In the repository</span> {s.refs.map((r) => <code key={r}>{r}</code>)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
