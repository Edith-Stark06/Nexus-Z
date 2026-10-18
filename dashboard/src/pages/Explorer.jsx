import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, MousePointerClick } from "lucide-react";
import Layout, { PageHeader } from "./Layout";
import GraphCanvas from "../components/GraphCanvas";
import ReplaySlider from "../components/ReplaySlider";
import RingList from "../components/explorer/RingList";
import { GraphToolbar, GraphLegend, GraphZoom } from "../components/explorer/GraphToolbar";
import { RingInspector, AccountInspector, PaymentInspector } from "../components/explorer/Inspector";
import { useData } from "../state/DataContext";
import { useRing, useSuccessors } from "../state/hooks";
import { filterRings, sortRings, victimFlagCounts } from "../lib/filters";
import { buildGraph } from "../lib/graph";
import { edgeTimestamps, msToIso } from "../lib/replay";
import "./Explorer.css";

const DEFAULT_FILTERS = { query: "", minRisk: 0, minAccounts: 0, onlyWithVictims: false, sort: "risk" };

// wide: three columns. mid: graph + one tabbed side panel. narrow: one panel at a time.
function useViewportMode() {
  const calc = () => (typeof window === "undefined" ? "wide" : window.innerWidth >= 1200 ? "wide" : window.innerWidth >= 900 ? "mid" : "narrow");
  const [mode, setMode] = useState(calc);
  useEffect(() => {
    const on = () => setMode(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return mode;
}

// Typing an account id into the list search asks the API about it (debounced). Only ids that look like ours ("ACC-...") are looked up.
function useAccountLookup(query) {
  const { getAccount } = useData();
  const [res, setRes] = useState(null);
  useEffect(() => {
    const q = query.trim();
    if (!/^acc-[0-9a-z]{2,}$/i.test(q)) {
      setRes(null);
      return undefined;
    }
    const id = q.toUpperCase();
    let cancelled = false;
    setRes({ id, state: "loading" });
    const t = setTimeout(async () => {
      const r = await getAccount(id);
      if (cancelled) return;
      if (r.status === "ok") setRes({ id, state: "ok", ring_id: r.data.ring_id });
      else setRes({ id, state: r.status === "notfound" ? "notfound" : "error", message: r.message });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, getAccount]);
  return res;
}

function RingMissing({ ringId, ring, successors, onOpen, onList }) {
  return (
    <div className="notice warn ex-missing" role="status">
      <AlertTriangle size={16} aria-hidden="true" />
      <div className="grow">
        <strong>
          Ring <span className="mono">{ringId}</span> is not in the current results.
        </strong>{" "}
        A ring id is derived from the ring's members, so when a data refresh regrows, splits or dissolves a ring, the old id stops working. The ring list has been refreshed.
        {ring && " The graph below is the last copy that loaded."}
        <div className="ex-succ">
          {successors.loading && <span className="faint">Looking up where its highest-scored accounts are now…</span>}
          {!successors.loading && successors.rings.length > 0 && (
            <>
              <span>Its accounts now appear in:</span>
              {successors.rings.map((s) => (
                <button key={s.ring_id} onClick={() => onOpen(s.ring_id)}>
                  <span className="mono">{s.ring_id}</span> <span className="faint">({s.members.length} of them)</span>
                </button>
              ))}
            </>
          )}
          {!successors.loading && successors.rings.length === 0 && <span className="faint">None of its highest-scored accounts is in a current ring.</span>}
          <button className="ghost" onClick={onList}>Choose another ring</button>
        </div>
      </div>
    </div>
  );
}

export default function Explorer() {
  const { ringId } = useParams();
  const [sp, setSp] = useSearchParams();
  const accountId = sp.get("account");
  const navigate = useNavigate();
  const data = useData();
  const { rings, alerts, loaded, mode } = data;
  const viewport = useViewportMode();
  const [tab, setTab] = useState("graph");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [layout, setLayout] = useState("force");
  const [emphasis, setEmphasis] = useState("role");
  const [labels, setLabels] = useState("auto");
  const [hidden, setHidden] = useState(() => new Set());
  const [cutoff, setCutoff] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [linkSel, setLinkSel] = useState(null);
  const [retryN, setRetryN] = useState(0);
  const [optsOpen, setOptsOpen] = useState(false); // narrow screens keep the graph controls folded away until asked for
  const canvas = useRef(null);

  const victimCounts = useMemo(() => victimFlagCounts(alerts), [alerts]);
  const visibleRings = useMemo(() => sortRings(filterRings(rings, { ...filters, victimCounts }), filters.sort), [rings, filters, victimCounts]);
  const { state, ring, stale, message } = useRing(ringId, retryN);
  const successors = useSuccessors(ring, state === "notfound");
  const lookup = useAccountLookup(filters.query);

  // a different ring starts with a clean view
  useEffect(() => {
    setCutoff(null);
    setPlaying(false);
    setLinkSel(null);
    setHidden(new Set());
  }, [ringId]);

  const graph = useMemo(() => buildGraph(ring, { hiddenRoles: hidden }), [ring, hidden]);
  const selectedLink = useMemo(() => (linkSel ? graph.links.find((l) => l.id === linkSel) || null : null), [graph, linkSel]);

  const selectRing = useCallback(
    (id) => {
      navigate(`/ring/${encodeURIComponent(id)}`);
      if (viewport === "narrow") setTab("graph");
    },
    [navigate, viewport]
  );
  const selectNode = useCallback(
    (id) => {
      setLinkSel(null);
      setSp({ account: id }, { replace: false });
      if (viewport !== "wide") setTab("details");
    },
    [setSp, viewport]
  );
  const selectLink = useCallback(
    (id) => {
      setLinkSel(id);
      setSp({}, { replace: true });
      if (viewport !== "wide") setTab("details");
    },
    [setSp, viewport]
  );
  const clearSelection = useCallback(() => {
    setLinkSel(null);
    if (accountId) setSp({}, { replace: false });
  }, [accountId, setSp]);

  useEffect(() => {
    const on = (e) => {
      if (e.key === "Escape" && (accountId || linkSel) && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "")) clearSelection();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [accountId, linkSel, clearSelection]);

  const toggleRole = (r) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(r) ? next.delete(r) : next.add(r);
      return next;
    });

  const openAccount = (id, rid) => (rid ? navigate(`/ring/${encodeURIComponent(rid)}?account=${encodeURIComponent(id)}`) : navigate(`/account/${encodeURIComponent(id)}`));

  // replay: play from the start when the slider is at the end
  const times = useMemo(() => edgeTimestamps(ring?.edges || []), [ring]);
  const onPlay = (on) => {
    if (on && (cutoff == null || new Date(cutoff).getTime() >= times[times.length - 1])) setCutoff(msToIso(times[0]));
    setPlaying(on);
  };

  const topRing = rings.length ? [...rings].sort((a, b) => b.risk - a.risk)[0] : null;
  const hasRing = Boolean(ring);
  const loadingRing = state === "loading";

  // ---- the three panels
  const listPanel = (
    <RingList
      rings={visibleRings}
      total={rings.length}
      selectedId={ringId}
      onSelect={selectRing}
      victimCounts={victimCounts}
      filters={filters}
      setFilters={setFilters}
      accountResult={lookup}
      onOpenAccount={openAccount}
      loading={!loaded && mode !== "unreachable"}
      unreachable={mode === "unreachable"}
    />
  );

  const graphPanel = (
    <div className="ex-graphcol">
      {state === "notfound" && <RingMissing ringId={ringId} ring={ring} successors={successors} onOpen={selectRing} onList={() => setTab("rings")} />}
      {state === "error" && (
        <div className="notice danger" role="alert">
          <div className="grow">
            <strong>Could not load ring <span className="mono">{ringId}</span>.</strong> {message || "The API did not answer."}
            <div className="notice-actions"><button onClick={() => setRetryN((n) => n + 1)}>Retry</button></div>
          </div>
        </div>
      )}
      {hasRing && (
        <>
          {viewport === "narrow" && (
            <div className="ex-opts">
              <button aria-expanded={optsOpen} aria-controls="ex-toolbar" onClick={() => setOptsOpen((o) => !o)}>Graph options</button>
            </div>
          )}
          {(viewport !== "narrow" || optsOpen) && <div id="ex-toolbar"><GraphToolbar
            layout={layout} setLayout={setLayout} emphasis={emphasis} setEmphasis={setEmphasis} labels={labels} setLabels={setLabels}
            members={ring.members || []}
            onLocate={(id) => { selectNode(id); setTimeout(() => canvas.current?.locate(id), 0); }}
          /></div>}
          <GraphLegend members={ring.members || []} hiddenRoles={hidden} toggleRole={toggleRole} emphasis={emphasis} />
          <div className="ex-canvas">
            <GraphCanvas
              ref={canvas}
              ring={ring}
              cutoff={cutoff}
              hiddenRoles={hidden}
              layout={layout}
              emphasis={emphasis}
              labels={labels}
              selectedNodeId={accountId}
              selectedLinkId={linkSel}
              onSelectNode={selectNode}
              onSelectLink={selectLink}
              onClear={clearSelection}
              ariaLabel={`Transaction graph of ring ${ring.ring_id}`}
            />
            <GraphZoom
              onZoomIn={() => canvas.current?.zoomIn()} onZoomOut={() => canvas.current?.zoomOut()} onFit={() => canvas.current?.fit()}
              onReset={() => { clearSelection(); canvas.current?.fit(); }}
              canReset={Boolean(accountId || linkSel)}
            />
            {stale && <div className="ex-stale tag warn">Last copy · ring no longer current</div>}
            {viewport !== "wide" && (accountId || selectedLink) && (
              <div className="ex-selchip" role="status">
                <span className="faint">Selected</span>
                <span className="mono">{accountId || `${selectedLink.source.slice(-6)} → ${selectedLink.target.slice(-6)}`}</span>
                <button className="primary" onClick={() => setTab("details")}>View details</button>
              </div>
            )}
          </div>
          <div className="ex-replay">
            <ReplaySlider edges={ring.edges || []} t={cutoff} onT={setCutoff} playing={playing} onPlay={onPlay} />
          </div>
        </>
      )}
      {!hasRing && loadingRing && <div className="ex-center"><div className="skel" style={{ width: 220 }} /></div>}
      {!hasRing && !loadingRing && state !== "notfound" && state !== "error" && (
        <div className="ex-center">
          <MousePointerClick size={22} aria-hidden="true" className="faint" />
          <h2>Select a ring to explore its payments</h2>
          <p className="muted">
            Pick a ring from the list, or paste an account id (<span className="mono">ACC-…</span>) into the search box to find the ring it belongs to.
          </p>
          {topRing && (
            <button className="primary" onClick={() => selectRing(topRing.ring_id)}>
              Start with the highest-scored ring: <span className="mono">{topRing.ring_id}</span>
            </button>
          )}
          {!loaded && mode === "unreachable" && <p className="faint">The API is not reachable; see the banner above.</p>}
        </div>
      )}
    </div>
  );

  const inspectorPanel = (
    <div className="ex-inspector">
      {selectedLink ? (
        <PaymentInspector link={selectedLink} onSelectNode={selectNode} onBack={clearSelection} />
      ) : accountId ? (
        <AccountInspector accountId={accountId} ring={ring} onSelectNode={selectNode} onBack={clearSelection} onFocusNeighbours={(id) => canvas.current?.focusNeighbours(id)} />
      ) : ring ? (
        <RingInspector ring={ring} stale={stale} alerts={alerts} onSelectNode={selectNode} onSelectLink={selectLink} />
      ) : (
        <div className="empty">
          <strong>Nothing selected.</strong>
          The inspector shows the ring, account or payment you select: why it was flagged and what supports that.
        </div>
      )}
    </div>
  );

  const tabs = viewport === "narrow" ? ["rings", "graph", "details"] : viewport === "mid" ? ["rings", "details"] : [];
  const TAB_LABEL = { rings: `Rings (${visibleRings.length})`, graph: "Graph", details: "Details" };
  const activeTab = viewport === "mid" && tab === "graph" ? "details" : tab;

  return (
    <Layout flush>
      <PageHeader compact title="Investigations" description="Select a flagged ring, read its payment graph, and inspect the accounts and reasons behind it." />
      <div className={`ex ex-${viewport}`}>
        {tabs.length > 0 && (
          <div className="ex-tabs seg" role="tablist" aria-label="Panels">
            {tabs.map((t) => (
              <button key={t} role="tab" aria-selected={activeTab === t} aria-pressed={activeTab === t} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>
            ))}
          </div>
        )}
        {viewport === "wide" && (
          <>
            <aside className="ex-list" aria-label="Rings">{listPanel}</aside>
            <section className="ex-graph" aria-label="Graph">{graphPanel}</section>
            <aside className="ex-side" aria-label="Inspector">{inspectorPanel}</aside>
          </>
        )}
        {viewport === "mid" && (
          <>
            <section className="ex-graph" aria-label="Graph">{graphPanel}</section>
            <aside className="ex-side" aria-label={activeTab === "rings" ? "Rings" : "Inspector"}>{activeTab === "rings" ? listPanel : inspectorPanel}</aside>
          </>
        )}
        {viewport === "narrow" && (
          <section className="ex-single">
            {activeTab === "rings" && listPanel}
            {activeTab === "graph" && graphPanel}
            {activeTab === "details" && inspectorPanel}
          </section>
        )}
      </div>
    </Layout>
  );
}

export { Link };
