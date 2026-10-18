import { useEffect, useState } from "react";
import Layout from "./Layout";
import { useData } from "../state/DataContext";
import { submitTransactions, API_BASE, ApiError } from "../services/api";
import { formatUtc } from "../lib/constants";
import { StatusRows } from "../components/SystemStatus";
import { describeSystem } from "../lib/provenance";
import { AMOUNT_NOTE } from "../lib/scores";
import "./Platform.css";

const CONNECTION_WORDS = {
  live: "connected (the last health check answered)",
  stale: "not answering; showing older results",
  unreachable: "not reachable",
  demo: "demo sample (no API)",
  connecting: "connecting",
  standalone: "no provider",
};
const CHANNELS = ["ACH", "Wire", "Cash", "Cheque", "Credit Card", "Bitcoin", "Reinvestment"];

// The same rules the API enforces (api/schemas.py: tx_id, ts, src, dst, amount > 0, channel), checked before anything is sent.
export function validatePayment(f) {
  const e = {};
  if (!f.tx_id.trim()) e.tx_id = "Required.";
  if (!f.src.trim()) e.src = "Required.";
  if (!f.dst.trim()) e.dst = "Required.";
  if (f.src.trim() && f.src.trim() === f.dst.trim()) e.dst = "The sender and the receiver must differ.";
  const amount = Number(f.amount);
  if (f.amount === "" || !Number.isFinite(amount) || amount <= 0) e.amount = "Enter a number greater than 0.";
  if (!f.channel.trim()) e.channel = "Required.";
  if (!f.ts || Number.isNaN(new Date(`${f.ts}Z`).getTime())) e.ts = "Enter a valid date and time (UTC).";
  return e;
}

export function toPayload(f) {
  return { tx_id: f.tx_id.trim(), ts: `${f.ts.length === 16 ? `${f.ts}:00` : f.ts}`, src: f.src.trim(), dst: f.dst.trim(), amount: Number(f.amount), channel: f.channel.trim() };
}

function Field({ id, label, error, children, hint }) {
  return (
    <label className="field" htmlFor={id}>
      {label}
      {children}
      {hint && !error && <span className="faint pf-hint">{hint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </label>
  );
}

function PaymentForm({ health, mode }) {
  const [f, setF] = useState({ tx_id: `UI-${Date.now()}`, ts: "", src: "", dst: "", amount: "", channel: "ACH", confirm: false });
  const [tsEdited, setTsEdited] = useState(false);
  // the time starts at the newest payment the model has seen (from /health), until the analyst types their own
  useEffect(() => {
    if (!tsEdited) setF((prev) => ({ ...prev, ts: (health?.data_as_of || new Date().toISOString()).slice(0, 16) }));
  }, [health?.data_as_of, tsEdited]);
  const [errors, setErrors] = useState({});
  const [state, setState] = useState({ phase: "idle" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const live = mode === "live";

  const submit = async (ev) => {
    ev.preventDefault();
    const found = validatePayment(f);
    setErrors(found);
    if (Object.keys(found).length || !f.confirm) return;
    setState({ phase: "sending" });
    try {
      const res = await submitTransactions(toPayload(f));
      setState({ phase: "done", res, at: new Date() });
      setF({ ...f, tx_id: `UI-${Date.now()}`, confirm: false });
    } catch (err) {
      setState({ phase: "error", message: err instanceof ApiError ? (err.network ? "The API did not answer. Nothing was submitted." : `${err.message}`) : String(err.message || err) });
    }
  };

  return (
    <form className="pf" onSubmit={submit} noValidate>
      <div className="pf-grid">
        <Field id="pf-src" label="From account" error={errors.src}><input id="pf-src" value={f.src} onChange={set("src")} placeholder="ACC-…" autoComplete="off" /></Field>
        <Field id="pf-dst" label="To account" error={errors.dst}><input id="pf-dst" value={f.dst} onChange={set("dst")} placeholder="ACC-…" autoComplete="off" /></Field>
        <Field id="pf-amt" label="Amount" error={errors.amount} hint="No currency: the API treats it as a raw number.">
          <input id="pf-amt" inputMode="decimal" value={f.amount} onChange={set("amount")} placeholder="500" />
        </Field>
        <Field id="pf-ch" label="Channel" error={errors.channel}>
          <input id="pf-ch" list="pf-channels" value={f.channel} onChange={set("channel")} />
          <datalist id="pf-channels">{CHANNELS.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field id="pf-ts" label="Time (UTC)" error={errors.ts} hint="Starts at the newest time the model has seen.">
          <input id="pf-ts" type="datetime-local" value={f.ts} onChange={(e) => { setTsEdited(true); set("ts")(e); }} />
        </Field>
        <Field id="pf-id" label="Payment id" error={errors.tx_id}><input id="pf-id" className="mono" value={f.tx_id} onChange={set("tx_id")} /></Field>
      </div>
      <label className="pf-confirm">
        <input type="checkbox" checked={f.confirm} onChange={set("confirm")} />
        <span>I understand this adds the payment to the API's in-memory history. It changes results after the next refresh and is lost when the API restarts.</span>
      </label>
      {Object.keys(errors).length === 0 && !f.confirm && state.phase === "idle" && <span className="faint pf-hint">Tick the box to enable submitting.</span>}
      <div className="pf-actions">
        <button type="submit" className="primary" disabled={!live || !f.confirm || state.phase === "sending"}>
          {state.phase === "sending" ? "Submitting…" : "Submit payment"}
        </button>
        {!live && <span className="faint">Submitting needs a connected API (currently: {CONNECTION_WORDS[mode] || mode}).</span>}
      </div>
      {state.phase === "done" && (
        <div className="notice info" role="status">
          <div className="grow">
            The API accepted <b className="num">{state.res.accepted}</b> payment ({state.res.backend} backend) at {state.at.toLocaleTimeString([], { hour12: false })}.
            {state.res.backend === "stub" ? " The stub backend records it but does not score it." : health?.refresh_interval_seconds != null ? ` It shows in the results after the next refresh (minimum interval ${health.refresh_interval_seconds} s, plus the rebuild time).` : " It shows in the results after the next refresh."}
          </div>
        </div>
      )}
      {state.phase === "error" && <div className="notice danger" role="alert"><div className="grow">Not accepted: {state.message}</div></div>}
    </form>
  );
}

export default function Platform() {
  const data = useData();
  const { health, mode, lastOk, lastError } = data;
  const rows = health
    ? [
        ["Status", health.status],
        ["Backend", health.backend],
        ["Refresh mode", health.refresh_mode],
        ["Minimum refresh interval", health.refresh_interval_seconds != null ? `${health.refresh_interval_seconds} s` : null],
        ["Served state age", health.state_age_seconds != null ? `${Math.round(health.state_age_seconds)} s at the last check` : null],
        ["Last rebuild took", health.last_rebuild_seconds != null ? `${health.last_rebuild_seconds.toFixed(1)} s` : null],
        ["Data as of", health.data_as_of ? formatUtc(health.data_as_of) : null],
        ["Payments in history", health.history_transactions?.toLocaleString()],
        ["Payments waiting", health.pending_transactions?.toLocaleString()],
        ["Rebuilding now", health.refreshing == null ? null : String(health.refreshing)],
        ["Refreshes completed", health.refreshes_completed],
        ["Last refresh error", health.last_error ? `${health.last_error.type} at ${health.last_error.at}` : health.last_error === null ? "none" : null],
      ].filter(([, v]) => v != null && v !== "")
    : [];

  return (
    <Layout title="Platform" subtitle="System status, data provenance, and what the API reports about itself.">
      <div className="pl">
        <section className="pl-card pl-wide" aria-labelledby="pl-status">
          <h2 id="pl-status">Status and provenance</h2>
          <p className="pl-note">
            Four separate facts. A responding API says nothing about how old the data behind it is, so each is stated on its own.
          </p>
          <StatusRows sys={describeSystem(data)} />
        </section>

        <section className="pl-card">
          <h2>Connection</h2>
          <dl className="pl-kv">
            <div><dt>API address</dt><dd className="mono">{API_BASE}</dd></div>
            <div><dt>Connection</dt><dd>{CONNECTION_WORDS[mode] || mode}</dd></div>
            <div><dt>Last answer received (this browser)</dt><dd className="mono">{lastOk ? lastOk.toLocaleTimeString([], { hour12: false }) : "never"}</dd></div>
            {lastError && <div><dt>Last problem</dt><dd>{lastError}</dd></div>}
          </dl>
          <p className="pl-note">
            NEXUS Z is built for IBM LinuxONE (s390x). This page cannot tell where the API is running: <span className="mono">/health</span> does not report the machine, so
            nothing here claims LinuxONE.
          </p>
        </section>

        <section className="pl-card">
          <h2>Raw <span className="mono">/health</span> response</h2>
          {rows.length === 0 ? (
            <div className="empty">{mode === "demo" ? "Demo sample: there is no API to report." : "No health response yet."}</div>
          ) : (
            <dl className="pl-kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="mono">{String(v)}</dd></div>)}</dl>
          )}
          <p className="pl-note faint">
            {health?.backend === "stub"
              ? "The stub backend serves invented sample data. Start the API with NEXUSZ_BACKEND=model for model output."
              : health?.backend === "model"
              ? "Model backend: rings and scores come from the trained XGBoost model over the configured transaction slice. Scoring is a full recompute in micro-batches, not per payment."
              : ""}
          </p>
        </section>

        <section className="pl-card pl-wide">
          <h2>Submit a test payment</h2>
          <p className="pl-note faint">Sends one payment to <span className="mono">POST /transactions</span>. Use it to see a new account appear after a refresh. The API takes no currency. {AMOUNT_NOTE}</p>
          <PaymentForm health={health} mode={mode} />
        </section>
      </div>
    </Layout>
  );
}
