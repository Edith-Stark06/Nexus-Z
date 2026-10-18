import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, AlertTriangle } from "lucide-react";
import GraphCanvas from "../GraphCanvas";
import ReasonList from "../ReasonList";
import RiskMeter from "../RiskMeter";
import RoleGlyph from "../RoleGlyph";
import { useData } from "../../state/DataContext";
import { formatUtc } from "../../lib/constants";
import "./WorkspacePreview.css";

const LIST_SIZE = 6;

/**
 * A working miniature of the ring explorer. Same data source as the hero: real rings from the API when there are any, the
 * bundled illustrative rings otherwise (and it says which). Selecting a ring loads its detail; a 404 means the ring id changed
 * during a refresh, so the list is refreshed and the analyst is told, not shown invented detail.
 */
export default function WorkspacePreview({ home }) {
  const { refresh } = useData();
  const list = home.summaries.slice(0, LIST_SIZE);
  const [ringId, setRingId] = useState(null);
  const [detail, setDetail] = useState({ phase: "idle", ring: null, message: "" });
  const [account, setAccount] = useState(null);
  const getDetail = useRef(home.getDetail);
  getDetail.current = home.getDetail;
  const real = home.source === "live" || home.source === "stub";

  // start on the highest-risk ring; if the selected ring leaves the list, move to the new top ring
  useEffect(() => {
    if (!list.length) return;
    if (!ringId || !home.summaries.some((r) => r.ring_id === ringId)) setRingId(list[0].ring_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home.summaries]);

  useEffect(() => {
    if (!ringId) return undefined;
    let cancelled = false;
    setDetail((d) => ({ phase: "loading", ring: d.ring?.ring_id === ringId ? d.ring : null, message: "" }));
    setAccount(null);
    getDetail.current(ringId).then((res) => {
      if (cancelled) return;
      if (res.status === "ok") setDetail({ phase: "ready", ring: res.data, message: "" });
      else if (res.status === "notfound") {
        setDetail({ phase: "changed", ring: null, message: "" });
        refresh();
      } else setDetail({ phase: "error", ring: null, message: res.message || "The API did not answer." });
    });
    return () => {
      cancelled = true;
    };
  }, [ringId, home.source, refresh]);

  const ring = detail.ring;
  const selected = useMemo(() => ring?.members?.find((m) => m.id === account) || null, [ring, account]);
  const openTo = real && ringId ? `/ring/${encodeURIComponent(ringId)}${account ? `?account=${encodeURIComponent(account)}` : ""}` : "/rings";

  return (
    <div className="wp" role="group" aria-label="Workspace preview">
      <header className="wp-bar">
        <span className="eyebrow">Ring explorer · preview</span>
        <span className={`tag ${home.source === "live" ? "ok" : "warn"}`}>
          <span className={`dot ${home.source === "live" ? "ok" : "warn"}`} />
          {home.source === "live" ? `Live results · ${home.backend || "model"} backend` : home.source === "stub" ? "Stub backend sample · invented" : home.source === "illustrative" ? "Illustrative sample · invented" : "Connecting…"}
        </span>
      </header>

      <div className="wp-body">
        <nav className="wp-list" aria-label="Rings">
          {list.length === 0 ? (
            <div className="empty">{home.source === "connecting" ? "Loading rings…" : "No rings returned."}</div>
          ) : (
            <ol>
              {list.map((r) => (
                <li key={r.ring_id}>
                  <button className={`wp-row${r.ring_id === ringId ? " on" : ""}`} aria-current={r.ring_id === ringId ? "true" : undefined} onClick={() => setRingId(r.ring_id)}>
                    <RiskMeter value={r.risk} compact />
                    <span className="wp-id mono">{r.ring_id}</span>
                    <span className="faint wp-n num">{r.accounts}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </nav>

        <div className="wp-graph">
          {detail.phase === "changed" && (
            <div className="notice warn" role="status">
              <AlertTriangle size={15} aria-hidden="true" />
              <div className="grow"><strong className="mono">{ringId}</strong> changed during a data refresh and is no longer in the results. The list was refreshed; pick a current ring.</div>
            </div>
          )}
          {detail.phase === "error" && <div className="notice danger" role="alert"><div className="grow">Could not load the ring: {detail.message}</div></div>}
          {ring ? (
            <div className="wp-canvas">
              <GraphCanvas ring={ring} hoverHighlight softDim fitMaxZoom={2.2} labels="auto" selectedNodeId={account} onSelectNode={setAccount} onClear={() => setAccount(null)} ariaLabel={`Payment graph of ring ${ring.ring_id}`} />
            </div>
          ) : (
            <div className="wp-canvas wp-wait">{detail.phase === "loading" ? <div className="skel" style={{ width: 160 }} /> : <span className="faint">Select a ring.</span>}</div>
          )}
        </div>

        <aside className="wp-panel" aria-label="Evidence" aria-live="polite">
          {ring ? (
            selected ? (
              <>
                <div className="eyebrow">Account</div>
                <div className="mono wp-big">{selected.id}</div>
                <div className="wp-line"><RoleGlyph role={selected.role} label /> <span className="faint">estimated role</span></div>
                <div className="wp-line">Model score <span className="mono num">{selected.score.toFixed(2)}</span></div>
                <button className="ghost wp-back" onClick={() => setAccount(null)}>← Back to the ring</button>
              </>
            ) : (
              <>
                <div className="eyebrow">Ring</div>
                <div className="wp-ringhead"><span className="mono wp-big">{ring.ring_id}</span><RiskMeter value={ring.risk} /></div>
                <p className="wp-headline">{ring.headline}</p>
                <div className="wp-facts faint">
                  <span><span className="num">{ring.accounts}</span> accounts</span>
                  <span className="mono">flagged {formatUtc(ring.flagged_at)}</span>
                </div>
                <div className="eyebrow wp-sub">Top reasons</div>
                <ReasonList reasons={ring.top_reasons} limit={3} />
                <p className="faint wp-caveat">An automated risk signal, not a finding of fraud. Roles are estimated.</p>
              </>
            )
          ) : (
            <div className="empty">Evidence appears here when a ring is selected.</div>
          )}
          <Link to={openTo} className="wp-open primary-link">
            {real ? "Open this in the full investigation" : "Open the ring explorer"} <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </aside>
      </div>
    </div>
  );
}
