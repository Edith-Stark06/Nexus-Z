import { useEffect, useState } from "react";
import { API_BASE, health } from "../services/api";
import { formatUtc } from "../lib/constants";
import Layout from "./Layout";
import "./RolePages.css";
import InfoTip from "../components/InfoTip";

const POLL_MS = 5000;

function seconds(v) {
  return v == null ? "n/a" : `${Number(v).toFixed(1)} s`;
}

/** Administrator home: what the API says about itself. Everything here comes from GET /health. */
export default function Admin() {
  const [h, setH] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let stop = false;
    async function tick() {
      try {
        const data = await health();
        if (!stop) { setH(data); setError(null); }
      } catch (e) {
        if (!stop) { setH(null); setError(String(e.message || e)); }
      }
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { stop = true; clearInterval(id); };
  }, []);

  const model = h && h.backend === "model";
  const degraded = h && h.status !== "ok";

  return (
    <Layout title="System" usingMock={!h}>
      <div className="rp">
        <p className="rp-lead">What the service reports about itself, refreshed every few seconds. It rebuilds its state in micro-batches, so a new payment appears after the next rebuild, not instantly.</p>

        {error ? (
          <p className="notice bad" role="alert">
            <b>The API is not reachable.</b> The dashboard is showing sample data elsewhere. Tried {API_BASE}/health: {error}
          </p>
        ) : null}
        {h && !model ? (
          <p className="notice" role="status">
            <b>Sample-data mode.</b> The API is serving invented rings from its stub, not the model. Do not present these as results.
          </p>
        ) : null}
        {degraded ? (
          <p className="notice bad" role="alert"><b>Degraded.</b> The latest refresh failed; the previous results are still being served. {h.last_error || ""}</p>
        ) : null}

        <div className="kpi-row" aria-label="Service status">
          <div className="kpi">
            <div className="kpi-n text">{h ? (model ? "Model" : "Sample data") : "n/a"}</div>
            <div className="kpi-l">Backend <InfoTip k="adminBackend" /></div>
          </div>
          <div className="kpi">
            <div className="kpi-n">{h && h.state_age_seconds != null ? Math.round(h.state_age_seconds) : "n/a"}{h && h.state_age_seconds != null ? <small>s</small> : null}</div>
            <div className="kpi-l">Time since the last rebuild <InfoTip k="adminSince" /></div>
          </div>
          <div className="kpi">
            <div className="kpi-n">{h && h.last_rebuild_seconds != null ? Number(h.last_rebuild_seconds).toFixed(1) : "n/a"}{h && h.last_rebuild_seconds != null ? <small>s</small> : null}</div>
            <div className="kpi-l">Last rebuild took <InfoTip k="adminRebuild" /></div>
          </div>
          <div className="kpi">
            <div className="kpi-n">{h && h.history_transactions != null ? h.history_transactions.toLocaleString("en-US") : "n/a"}</div>
            <div className="kpi-l">Payments of history loaded <InfoTip k="adminHistory" /></div>
          </div>
        </div>

        <div className="rp-grid">
          <section className="rp-card">
            <h2>Details <InfoTip k="adminDetails" /></h2>
            <dl className="kv">
              <dt>Status</dt><dd>{h ? h.status : "n/a"}</dd>
              <dt>Data as of</dt><dd>{h && h.data_as_of ? formatUtc(h.data_as_of) : "n/a"}</dd>
              <dt>Refresh mode</dt><dd>{h && h.refresh_mode ? h.refresh_mode : "n/a"}</dd>
              <dt>Minimum refresh gap</dt><dd>{h ? seconds(h.refresh_interval_seconds) : "n/a"}</dd>
              <dt>Refreshes completed</dt><dd>{h && h.refreshes_completed != null ? h.refreshes_completed : "n/a"}</dd>
              <dt>Payments waiting</dt><dd>{h && h.pending_transactions != null ? h.pending_transactions.toLocaleString("en-US") : "n/a"}</dd>
              <dt>Refreshing now</dt><dd>{h && h.refreshing != null ? (h.refreshing ? "yes" : "no") : "n/a"}</dd>
              <dt>API address</dt><dd>{API_BASE}</dd>
            </dl>
          </section>

          <section className="rp-card">
            <h2>What this deployment is <InfoTip k="adminDeployment" /></h2>
            <ul className="limit-list">
              <li>The background data is IBM's synthetic anti-money-laundering data; the rings are simulated by our own team.</li>
              <li>Scoring runs on CPU (XGBoost). No on-chip accelerator is used for detection.</li>
              <li>The API has no user accounts or passwords: it listens on the machine's loopback and is reached through a tunnel. The sign-in on this site is a demo that only selects a view.</li>
              <li>Freshness: about ten seconds on an idle machine in our measurements, longer while payments stream in.</li>
            </ul>
          </section>
        </div>
      </div>
    </Layout>
  );
}
