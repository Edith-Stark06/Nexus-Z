import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getRing, getAccount } from "../services/api";
import { D3Graph } from "../components/D3Graph";
import { SHAPPanel } from "../components/SHAPPanel";
import PaymentTable from "../components/PaymentTable";
import ReplaySlider from "../components/ReplaySlider";
import { ROLE_COLORS } from "../lib/constants";
import Layout from "./Layout";
import "./RingDetail.css";

export default function RingDetail() {
  const { ringId } = useParams();
  const [ring, setRing] = useState(null);
  const [usingMock, setUsingMock] = useState(true);
  const [cutoff, setCutoff] = useState(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let stopped = false;
    async function load() {
      const res = await getRing(ringId);
      if (!stopped) {
        setRing(res.data);
        setUsingMock(res.usingMock);
        // Start the replay at the ring's first seen moment.
        setCutoff(res.data ? res.data.first_seen : null);
      }
    }
    load();
    return () => { stopped = true };
  }, [ringId]);

  if (!ring) {
    return (
      <Layout usingMock={usingMock}>
        <div className="empty">Loading ring…</div>
      </Layout>
    );
  }

  const members = ring.members || [];
  const victims = members.filter((m) => m.role === "victim");
  const collectors = members.filter((m) => m.role === "collector");
  const mules = members.filter((m) => m.role === "mule");
  const cashouts = members.filter((m) => m.role === "cashout");

  return (
    <Layout usingMock={usingMock}>
      <div className="ring-detail">
        <div className="crumb">
          <Link to="/">Rings</Link> / <span>{ring.ring_id}</span>
        </div>

        <div className="detail-head">
          <div>
            <div className="detail-id">{ring.ring_id}</div>
            <div className="detail-meta">
              Risk {ring.risk} · {ring.accounts} members · {ring.victims} victims ·{" "}
              {ring.total_amount != null ? `${ring.total_amount.toLocaleString()}` : ""}
            </div>
          </div>
          <div className="detail-times">
            <div>First seen {ring.first_seen}</div>
            <div>Flagged {ring.flagged_at}</div>
          </div>
        </div>

        <p className="detail-headline">{ring.headline}</p>

        <div className="stat-row">
          <div className="stat"><b>{collectors.length}</b><span>collectors (estimated role)</span></div>
          <div className="stat"><b>{mules.length}</b><span>mules (estimated role)</span></div>
          <div className="stat"><b>{cashouts.length}</b><span>cash-out (estimated role)</span></div>
          <div className="stat"><b>{victims.length}</b><span>victims (estimated role)</span></div>
        </div>

        <div className="detail-grid">
          <div className="detail-col">
            <h3>Flow graph</h3>
            <D3Graph ringId={ring.ring_id} ring={ring} cutoff={cutoff} />
            <ReplaySlider
              edges={ring.edges || []}
              t={cutoff}
              onT={setCutoff}
              playing={playing}
              onPlay={setPlaying}
            />
          </div>
          <div className="detail-col">
            <h3>Why flagged</h3>
            <SHAPPanel ringId={ring.ring_id} ring={ring} />
          </div>
        </div>

        <div className="detail-section">
          <h3>Payments</h3>
          <PaymentTable edges={ring.edges || []} />
        </div>

        <div className="detail-foot">
          <span className="badge">{victims.length} likely victims flagged</span>
          <span className="footer-note">
            Roles are estimated by the model. A victim is a recent payer into the ring.
          </span>
        </div>
      </div>
    </Layout>
  );
}