import { useEffect, useMemo, useRef, useState } from "react";
import { CLUSTER, LAYOUTS, TRANSACTIONS, lerp } from "./illustrative";
import { hullGeometry } from "../../lib/graph";
import { useReducedMotion } from "./useHomeData";
import "./InsightCompare.css";

const R = 9;

// a tall composition on phones, so the labels stay readable
function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return narrow;
}

// 0 = every transfer on its own, 1 = one network. Eases between the two so the change is something you can watch.
function useTween(target, reduced, ms = 750) {
  const [t, setT] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (reduced || typeof requestAnimationFrame === "undefined") {
      cur.current = target;
      setT(target);
      return undefined;
    }
    const from = cur.current;
    const start = performance.now();
    let raf;
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      cur.current = lerp(from, target, eased);
      setT(cur.current);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced, ms]);
  return t;
}

const STATES = {
  tiles: {
    key: "tiles",
    label: "Individual transactions",
    caption: "Ten transfers, each between two accounts. Looked at one at a time, every one is a plausible payment. Nothing here says they are related.",
    changed: ["Each transfer is judged on its own.", "The same account id appears in several of them, but you only ever see two accounts at a time."],
  },
  network: {
    key: "network",
    label: "Connected network",
    caption: "The same ten transfers, joined wherever they share an account. Eight of them now form one structure: several accounts pay one account, which passes the money on to a single exit.",
    changed: ["Shared accounts are merged, so the relationships between transfers become visible.", "The two unrelated transfers stay apart: ordinary activity stays ordinary."],
  },
};

export default function InsightCompare() {
  const [mode, setMode] = useState("tiles");
  const reduced = useReducedMotion();
  const t = useTween(mode === "network" ? 1 : 0, reduced);
  const state = STATES[mode];
  const narrow = useNarrow();
  const L = narrow ? LAYOUTS.tall : LAYOUTS.wide;
  const VIEW = L.view;

  const markers = useMemo(() => {
    const out = [];
    TRANSACTIONS.forEach((tx, i) => {
      const tile = L.tile(i);
      out.push({ key: `${tx.id}:s`, acct: tx.src, from: tile.src, to: L.accounts[tx.src] });
      out.push({ key: `${tx.id}:d`, acct: tx.dst, from: tile.dst, to: L.accounts[tx.dst] });
    });
    return out;
  }, [L]);
  const at = (m) => ({ x: lerp(m.from.x, m.to.x, t), y: lerp(m.from.y, m.to.y, t) });
  const pos = Object.fromEntries(markers.map((m) => [m.key, at(m)]));

  const hull = hullGeometry(CLUSTER.map((id) => ({ ...L.accounts[id], r: R })), narrow ? 20 : 28);
  const onKey = (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") setMode("network");
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") setMode("tiles");
  };

  return (
    <div className="ic">
      <div className="ic-bar">
        <div className="seg ic-seg" role="group" aria-label="View" onKeyDown={onKey}>
          {Object.values(STATES).map((s) => (
            <button key={s.key} aria-pressed={mode === s.key} onClick={() => setMode(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
        <span className="tag warn">Illustrative: invented accounts and transfers</span>
      </div>

      <div className="ic-frame">
        <svg viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} role="img" aria-label={`Illustrative comparison. ${state.caption}`} className="ic-svg">
          <defs>
            <marker id="ic-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0,1 L9,5 L0,9 z" fill="#6f8aa0" />
            </marker>
            <marker id="ic-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0,1 L9,5 L0,9 z" fill="#e87970" />
            </marker>
          </defs>

          {/* the suspicious structure appears only once the transfers are connected */}
          {hull && <path d={hull.d} className="ic-hull" style={{ opacity: Math.max(0, (t - 0.55) / 0.45) }} />}
          {hull && (
            <text x={hull.label.x} y={hull.label.y} textAnchor="middle" className="ic-hull-label" style={{ opacity: Math.max(0, (t - 0.7) / 0.3) }}>
              illustrative cluster
            </text>
          )}

          {TRANSACTIONS.map((tx, i) => {
            const a = pos[`${tx.id}:s`], b = pos[`${tx.id}:d`];
            const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
            const ux = dx / d, uy = dy / d;
            const hot = t > 0.6 && CLUSTER.includes(tx.src) && CLUSTER.includes(tx.dst);
            const tile = L.tile(i);
            return (
              <g key={tx.id}>
                <line x1={a.x + ux * (R + 2)} y1={a.y + uy * (R + 2)} x2={b.x - ux * (R + 5)} y2={b.y - uy * (R + 5)} className={`ic-edge${hot ? " hot" : ""}`} markerEnd={hot ? "url(#ic-arrow-hot)" : "url(#ic-arrow)"} />
                <text x={tile.cx} y={tile.cy - 38} textAnchor="middle" className="ic-txid" style={{ opacity: 1 - t }}>
                  {tx.id}
                </text>
              </g>
            );
          })}

          {markers.map((m) => {
            const p = pos[m.key];
            const inCluster = CLUSTER.includes(m.acct);
            return (
              <g key={m.key} transform={`translate(${p.x},${p.y})`}>
                <circle r={R} className={`ic-node${inCluster && t > 0.6 ? " hot" : ""}`} />
                <text y={R + 13} textAnchor="middle" className="ic-label">{m.acct}</text>
              </g>
            );
          })}

          <text x="14" y={VIEW.height - 12} className="ic-axis" style={{ opacity: 1 - t }}>{narrow ? "10 separate transfers, T01 to T10" : "10 separate transfers, in time order T01 to T10"}</text>
          <text x="14" y={VIEW.height - 12} className="ic-axis" style={{ opacity: t }}>the same transfers, one account each</text>
        </svg>
      </div>

      <div className="ic-text" aria-live="polite">
        <p className="ic-caption">{state.caption}</p>
        <ul className="ic-changed">
          {state.changed.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
    </div>
  );
}
