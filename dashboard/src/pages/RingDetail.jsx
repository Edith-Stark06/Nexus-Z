import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getRing, getAccount } from "../services/api";
import { D3Graph } from "../components/D3Graph";
import { SHAPPanel } from "../components/SHAPPanel";
import PaymentTable from "../components/PaymentTable";
import ReplaySlider from "../components/ReplaySlider";
import { CaseSummary, RoleLegend } from "../components/CaseSummary";
import { ROLE_COLORS, formatUtc } from "../lib/constants";
import { useHome } from "../auth/session";
import Layout from "./Layout";
import "./RingDetail.css";
import InfoTip from "../components/InfoTip";

export default function RingDetail() {
  const { ringId } = useParams();
  const home = useHome();
  const [ring, setRing] = useState(null);
  const [gone, setGone] = useState(false); // the API said 404: the ring was rebuilt under a new id, or never existed
  const [usingMock, setUsingMock] = useState(true);
  const [cutoff, setCutoff] = useState(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let stopped = false;
    async function load() {
      const res = await getRing(ringId);
      if (!stopped) {
        setRing(res.data);
        setGone(Boolean(res.notFound));
        setUsingMock(res.usingMock);
        // Open on the whole ring. The slider replays it from the first payment when asked.
        setCutoff(null);
      }
    }
    load();
    return () => { stopped = true };
  }, [ringId]);

  if (!ring && gone) {
    // Ring ids are a hash of the members, so a ring that grew or split in the last refresh has a new id.
    return (
      <Layout usingMock={usingMock}>
        <div className="empty">
          This ring changed after the last refresh, or no longer exists. <Link to={home}>Back to the list of rings</Link> to
          find it again.
        </div>
      </Layout>
    );
  }

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
          <Link to="/monitor">Rings</Link> / <span>{ring.ring_id}</span>
        </div>

        <div className="detail-head">
          <div>
            <div className="detail-id">{ring.ring_id}</div>
            <div className="detail-meta">
              Risk {ring.risk} · {ring.accounts} members · {ring.victims} {ring.victims === 1 ? "victim" : "victims"} (estimated)
              {ring.total_amount != null ? ` · total ${ring.total_amount.toLocaleString()} (mixed currencies)` : ""}
            </div>
          </div>
          <div className="detail-times">
            <div>First seen {formatUtc(ring.first_seen)}</div>
            <div>Flagged {formatUtc(ring.flagged_at)}</div>
          </div>
        </div>

        <p className="detail-headline">{ring.headline}</p>

        <CaseSummary summary={ring.summary} />

        <div className="stat-row">
          <div className="stat"><b>{collectors.length}</b><span>collectors (estimated role)</span></div>
          <div className="stat"><b>{mules.length}</b><span>mules (estimated role)</span></div>
          <div className="stat"><b>{cashouts.length}</b><span>cash-out (estimated role)</span></div>
          <div className="stat"><b>{victims.length}</b><span>victims (estimated role)</span></div>
        </div>

        <div className="detail-grid">
          <div className="detail-col">
            <h3>Flow graph <InfoTip k="flowGraph" /></h3>
            <D3Graph ringId={ring.ring_id} ring={ring} cutoff={cutoff} />
            <ReplaySlider
              edges={ring.edges || []}
              t={cutoff}
              onT={setCutoff}
              playing={playing}
              onPlay={setPlaying}
            />
            <RoleLegend colors={ROLE_COLORS} />
          </div>
          <div className="detail-col">
            <h3>Why flagged <InfoTip k="whyFlagged" /></h3>
            <SHAPPanel ringId={ring.ring_id} ring={ring} />
          </div>
        </div>

        <div className="detail-section">
          <h3>Payments <InfoTip k="payments" /></h3>
          <PaymentTable edges={ring.edges || []} roles={Object.fromEntries((ring.members || []).map((m) => [m.id, m.role]))} />
        </div>

        <div className="detail-foot">
          <span className="badge">{victims.length} likely-victim {victims.length === 1 ? "flag" : "flags"} in this ring (estimated)</span>
          <span className="footer-note">
            Roles are estimated by the model. A victim is a recent payer into the ring.
          </span>
        </div>
      </div>
    </Layout>
  );
}