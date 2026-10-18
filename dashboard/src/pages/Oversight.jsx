import { useEffect, useState } from "react";
import { health, startPolling } from "../services/api";
import { formatDateTime } from "../lib/constants";
import Layout from "./Layout";
import "./RolePages.css";
import InfoTip from "../components/InfoTip";

const RISK_BANDS = [
  { key: "high", label: "Risk 80 or more", test: (r) => r >= 80, cls: "rose" },
  { key: "mid", label: "Risk 50 to 79", test: (r) => r >= 50 && r < 80, cls: "amber" },
  { key: "low", label: "Risk below 50", test: (r) => r < 50, cls: "" },
];
const SIZE_BANDS = [
  { label: "2 to 4 accounts", test: (n) => n <= 4 },
  { label: "5 to 9 accounts", test: (n) => n >= 5 && n <= 9 },
  { label: "10 to 19 accounts", test: (n) => n >= 10 && n <= 19 },
  { label: "20 or more", test: (n) => n >= 20 },
];

function Bars({ rows, total }) {
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span>{r.label}</span>
          <div className="bar-track" role="presentation"><div className={`bar-fill ${r.cls || ""}`} style={{ width: `${total ? (100 * r.n) / total : 0}%` }} /></div>
          <span className="bar-n">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

/** Regulator home: counts only. No account ids, no drill-down into individuals. */
export default function Oversight() {
  const [rings, setRings] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [usingMock, setUsingMock] = useState(true);
  const [asOf, setAsOf] = useState(null);

  useEffect(() => {
    const stop = startPolling(({ rings, alerts, usingMock }) => {
      setRings(rings);
      setAlerts(alerts);
      setUsingMock(usingMock);
    });
    return stop;
  }, []);

  useEffect(() => {
    let stop = false;
    health().then((h) => { if (!stop) setAsOf(h.data_as_of || null); }).catch(() => { if (!stop) setAsOf(null); });
    return () => { stop = true; };
  }, [rings.length]);

  const riskRows = RISK_BANDS.map((b) => ({ label: b.label, cls: b.cls, n: rings.filter((r) => b.test(r.risk)).length }));
  const sizeRows = SIZE_BANDS.map((b) => ({ label: b.label, n: rings.filter((r) => b.test(r.accounts)).length }));
  const risks = rings.map((r) => r.risk);
  const minRisk = risks.length ? Math.min(...risks) : null;
  const maxRisk = risks.length ? Math.max(...risks) : null;
  const compressed = rings.length >= 10 && minRisk >= 80;
  const flags = alerts.filter((a) => a.type === "victim_warning").length;
  const accountsInRings = rings.reduce((s, r) => s + (r.accounts || 0), 0);

  return (
    <Layout title="Oversight" usingMock={usingMock}>
      <div className="rp">
        <p className="rp-lead">
          The overall picture, without individual accounts. Counts describe what the system currently flags in its data window; they are
          not a measure of how much fraud exists.
        </p>

        {usingMock ? (
          <p className="notice" role="status"><b>Sample data.</b> The live API is not reachable, so these counts come from bundled examples.</p>
        ) : null}

        {compressed ? (
          <p className="notice" role="status">
            <b>Every ring currently scores {minRisk} or more.</b> The ring score ranks rings against each other, but here it does not separate high-risk from low-risk rings, so the risk bands below are not informative.
          </p>
        ) : null}

        <div className="kpi-row" aria-label="Summary">
          <div className="kpi"><div className="kpi-n">{rings.length}</div><div className="kpi-l">Rings flagged <InfoTip k="kpiRings" /></div></div>
          <div className="kpi"><div className="kpi-n rose">{minRisk == null ? "n/a" : `${minRisk}-${maxRisk}`}</div><div className="kpi-l">Ring risk range (lowest to highest) <InfoTip k="kpiRisk" /></div></div>
          <div className="kpi"><div className="kpi-n">{accountsInRings}</div><div className="kpi-l">Accounts inside flagged rings <InfoTip k="osAccounts" /></div></div>
          <div className="kpi"><div className="kpi-n">{flags}</div><div className="kpi-l">Recent payers flagged for review <InfoTip k="kpiVictims" /></div></div>
        </div>

        <div className="rp-grid">
          <section className="rp-card">
            <h2>Rings by risk <InfoTip k="osBands" /></h2>
            <Bars rows={riskRows} total={rings.length} />
          </section>
          <section className="rp-card">
            <h2>Rings by size <InfoTip k="osSizes" /></h2>
            <Bars rows={sizeRows} total={rings.length} />
          </section>
        </div>

        <div className="rp-grid">
          <section className="rp-card">
            <h2>How current <InfoTip k="osCurrent" /></h2>
            <dl className="kv">
              <dt>Data as of</dt><dd>{asOf ? formatDateTime(asOf) : "n/a"}</dd>
              <dt>Source</dt><dd>{usingMock ? "Bundled sample data" : "Live API"}</dd>
            </dl>
          </section>
          <section className="rp-card">
            <h2>Limits of the evidence <InfoTip k="osLimits" /></h2>
            <ul className="limit-list">
              <li>Synthetic data. The rings are simulated by the team that built the model, so results on them are optimistic.</li>
              <li>On IBM's own labels most laundering groups are still missed.</li>
              <li>A flag is a reason to look closer, not a finding of fraud. Nothing is sent to anyone.</li>
              <li>All identifiers are pseudonymised. This role has no account-level view.</li>
            </ul>
          </section>
        </div>
      </div>
    </Layout>
  );
}
