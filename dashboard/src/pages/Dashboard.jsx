import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getRing, startPolling } from "../services/api";
import { formatUtc } from "../lib/constants";
import { D3Graph } from "../components/D3Graph";
import { SHAPPanel } from "../components/SHAPPanel";
import Layout from "./Layout";
import "./Dashboard.css";
import InfoTip from "../components/InfoTip";

function riskColor(r) {
  if (r == null) return "var(--text-faint)";
  if (r >= 80) return "var(--danger)";
  if (r >= 50) return "var(--warn)";
  return "var(--accent)";
}

export default function Dashboard() {
  const [rings, setRings] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(undefined); // undefined: loading, null: that ring no longer exists
  const [usingMock, setUsingMock] = useState(true);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const stop = startPolling(({ rings, alerts, usingMock }) => {
      setRings(rings);
      setAlerts(alerts);
      setUsingMock(usingMock);
    });
    return stop;
  }, []);

  // The list only has summaries; the graph and the reasons need the full ring.
  useEffect(() => {
    if (!selected) return undefined;
    let stopped = false;
    setDetail(undefined);
    getRing(selected.ring_id).then((res) => {
      if (!stopped) setDetail(res.data);
    });
    return () => {
      stopped = true;
    };
  }, [selected?.ring_id]);

  const filtered = rings.filter((r) =>
    r.ring_id.toLowerCase().includes(search.trim().toLowerCase())
  );

  const victimAlerts = alerts.filter((a) => a.type === "victim_warning");

  return (
    <Layout usingMock={usingMock}>
      <div className="dash-kpis">
        <div className="kpi-row" aria-label="Summary">
          <div className="kpi"><div className="kpi-n">{rings.length}</div><div className="kpi-l">Rings flagged <InfoTip k="kpiRings" /></div></div>
          <div className="kpi"><div className="kpi-n rose">{rings.length ? `${Math.min(...rings.map((r) => r.risk))}-${Math.max(...rings.map((r) => r.risk))}` : "n/a"}</div><div className="kpi-l">Ring risk range (lowest to highest) <InfoTip k="kpiRisk" /></div></div>
          <div className="kpi"><div className="kpi-n">{victimAlerts.length}</div><div className="kpi-l">Recent payers flagged for review <InfoTip k="kpiVictims" /></div></div>
        </div>
      </div>
      <div className="dash">
        <section className="panel">
          <div className="panel-head">
            <h2>Rings <InfoTip k="rings" /></h2>
            <input
              className="search"
              placeholder="Search ring id…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="sample-note">
            Synthetic data: IBM AML transactions with simulated pig-butchering
            rings made by our own team (data/rings.py). Results on those rings are
            optimistic, and most laundering groups in IBM's own data are still missed.
          </div>
          {filtered.length === 0 ? (
            <div className="empty">No rings match that search.</div>
          ) : (
            <div className="ring-grid">
              {filtered.map((r) => (
                <div
                  key={r.ring_id}
                  className={`ring-card${selected?.ring_id === r.ring_id ? " selected" : ""}`}
                  onClick={() => setSelected(r)}
                >
                  <div className="ring-card-top">
                    <span className="ring-id">{r.ring_id}</span>
                    <span
                      className="risk-pill"
                      style={{ color: riskColor(r.risk) }}
                    >
                      {r.risk}
                    </span>
                  </div>
                  <div className="risk-bar">
                    <span
                      style={{
                        width: `${Math.max(0, Math.min(100, r.risk))}%`,
                        background: riskColor(r.risk),
                      }}
                    />
                  </div>
                  <p className="ring-headline">{r.headline}</p>
                  <div className="ring-meta">
                    <span>{r.accounts} accounts</span>
                    <span>·</span>
                    <span>{r.victims} {r.victims === 1 ? "victim" : "victims"} (estimated)</span>
                  </div>
                  <div className="ring-flag">
                    First seen {formatUtc(r.first_seen)} · flagged {formatUtc(r.flagged_at)}
                  </div>
                  <div className="ring-foot">
                    <span className="badge">
                      {victimAlerts.filter((a) => a.ring_id === r.ring_id).length}{" "}
                      likely-victim flags
                    </span>
                    <Link
                      to={`/ring/${r.ring_id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Inspect →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Ring detail <InfoTip k="ringDetail" /></h2>
            {selected && (
              <button onClick={() => navigate(`/ring/${selected.ring_id}`)}>
                Open full ring
              </button>
            )}
          </div>
          {!selected ? (
            <div className="empty">Select a ring to inspect.</div>
          ) : (
            <div className="detail">
              <div className="detail-head">
                <div>
                  <div className="detail-id">{selected.ring_id}</div>
                  <div className="detail-meta">
                    Risk {selected.risk} · {selected.accounts} members ·{" "}
                    {selected.victims} {selected.victims === 1 ? "victim" : "victims"} (estimated)
                  </div>
                </div>
                <div className="detail-times">
                  <div>First seen {formatUtc(selected.first_seen)}</div>
                  <div>Flagged {formatUtc(selected.flagged_at)}</div>
                </div>
              </div>
              <p className="detail-headline">{selected.headline}</p>

              <div className="detail-grid">
                <div className="detail-col">
                  <h3>Flow graph <InfoTip k="flowGraph" /></h3>
                  {detail === null ? (
                    <div className="empty">This ring changed after the last refresh. Pick it again from the list.</div>
                  ) : (
                    <D3Graph ringId={selected.ring_id} ring={detail} />
                  )}
                </div>
                <div className="detail-col">
                  <h3>Why flagged <InfoTip k="whyFlagged" /></h3>
                  {detail === undefined ? (
                    <div className="empty">Loading…</div>
                  ) : (
                    <SHAPPanel ringId={selected.ring_id} ring={detail || undefined} />
                  )}
                </div>
              </div>

              <div className="detail-foot">
                <span className="badge">
                  {victimAlerts.filter((a) => a.ring_id === selected.ring_id).length}{" "}
                  likely-victim flags
                </span>
                <span className="footer-note">
                  Roles are estimated by the model. SHAP contributions are
                  per-feature pushes on the ring risk score.
                </span>
              </div>
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}