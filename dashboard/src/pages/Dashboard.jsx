import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { startPolling } from "../services/api";
import { formatDateTime, relativeTime } from "../lib/constants";
import { D3Graph } from "../components/D3Graph";
import { SHAPPanel } from "../components/SHAPPanel";
import Layout from "./Layout";
import "./Dashboard.css";

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

  const filtered = rings.filter((r) =>
    r.ring_id.toLowerCase().includes(search.trim().toLowerCase())
  );

  const victimAlerts = alerts.filter((a) => a.type === "victim_warning");

  return (
    <Layout usingMock={usingMock}>
      <div className="dash">
        <section className="panel">
          <div className="panel-head">
            <h2>Flagged rings</h2>
            <input
              className="search"
              placeholder="Search ring id…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="sample-note">
            Synthetic data: IBM's AML transactions with simulated pig-butchering
            rings. Accuracy is modest; many laundering groups are still missed.
            See docs/ML_RESULTS.md.
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
                    <span>{r.victims} victims</span>
                    <span>·</span>
                    <span title="First seen">{relativeTime(r.first_seen)}</span>
                  </div>
                  <div className="ring-flag">
                    Flagged {relativeTime(r.flagged_at)}
                  </div>
                  <div className="ring-foot">
                    <span className="badge">
                      {victimAlerts.filter((a) => a.ring_id === r.ring_id).length}{" "}
                      likely victims flagged
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
            <h2>Ring detail</h2>
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
                    {selected.victims} victims
                  </div>
                </div>
                <div className="detail-times">
                  <div>First seen {formatDateTime(selected.first_seen)}</div>
                  <div>Flagged {formatDateTime(selected.flagged_at)}</div>
                </div>
              </div>
              <p className="detail-headline">{selected.headline}</p>

              <div className="detail-grid">
                <div className="detail-col">
                  <h3>Flow graph</h3>
                  <D3Graph ringId={selected.ring_id} />
                </div>
                <div className="detail-col">
                  <h3>Why flagged</h3>
                  <SHAPPanel ringId={selected.ring_id} />
                </div>
              </div>

              <div className="detail-foot">
                <span className="badge">
                  {victimAlerts.filter((a) => a.ring_id === selected.ring_id).length}{" "}
                  likely victims flagged
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