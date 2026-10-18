import { useEffect, useRef, useState } from "react";
import { linePath, ROLE_LABEL, ROLE_TEXT } from "../lib/graphLayout";
import { INK, LAV, LAV_DARK, ROSE, nodePrimitives } from "../lib/nodeStyle";
import { along, makeNodes, settled, stepNodes } from "../lib/heroPhysics";

// firm, not springy: nodes lean toward the cursor and settle without swinging
const FIRM = { spring: 0.14, damping: 0.7, pull: 0.45, maxShift: 20 };

// An illustration of the shape NEXUS Z looks for, that reacts to the cursor. It is not data.
// It uses the same account marks as the ring graph (lib/nodeStyle.js).
const W = 440;
const H = 340;

const POINTS = [
  ...[[40, 40], [34, 92], [46, 146], [30, 200], [42, 252], [36, 300]].map(([x, y], i) => ({ id: `v${i}`, role: "victim", x, y, r: 7 })),
  ...[[176, 96], [168, 200], [182, 286]].map(([x, y], i) => ({ id: `c${i}`, role: "collector", x, y, r: i === 1 ? 14 : 11, score: [0.92, 0.97, 0.88][i] })),
  ...[[290, 70], [300, 160], [286, 250]].map(([x, y], i) => ({ id: `m${i}`, role: "mule", x, y, r: 9 })),
  { id: "x0", role: "cashout", x: 392, y: 160, r: 12 },
];
const LINKS = [
  ...[0, 1, 2, 3, 4, 5].map((i) => [`v${i}`, `c${Math.floor(i / 2)}`, "deposit"]),
  ["c0", "m0", "flow"], ["c1", "m1", "flow"], ["c2", "m2", "flow"], ["c1", "m0", "flow"],
  ["m0", "x0", "flow"], ["m1", "x0", "flow"], ["m2", "x0", "flow"],
];
const DEFAULT_CAPTION = "Move your cursor over the picture. Illustration of the shape we look for. Not real data.";

function Shape({ role, r, score }) {
  return (
    <>
      {nodePrimitives(role, r, score).map((p, i) => {
        if (p.type === "path") return <path key={i} d={p.d} fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} strokeLinecap={p.linecap || "butt"} />;
        if (p.type === "rect") {
          return <rect key={i} x={-p.r} y={-p.r} width={2 * p.r} height={2 * p.r} rx={Math.min(3.5, p.r * 0.3)} fill={p.fill}
            stroke={p.stroke || "none"} strokeWidth={p.strokeWidth || 0} opacity={p.opacity ?? 1} />;
        }
        return <circle key={i} r={p.r} fill={p.fill} stroke={p.stroke || "none"} strokeWidth={p.strokeWidth || 0}
          strokeDasharray={p.dash || undefined} opacity={p.opacity ?? 1} />;
      })}
    </>
  );
}

export default function HeroGraph() {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const hoverRef = useRef(null);
  const [caption, setCaption] = useState(DEFAULT_CAPTION);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const quiet = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nodes = makeNodes(POINTS);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const nodeEls = new Map([...svg.querySelectorAll("[data-node]")].map((el) => [el.dataset.node, el]));
    const linkEls = [...svg.querySelectorAll("[data-link]")];
    const dotEls = [...svg.querySelectorAll("[data-dot]")];
    const neighbours = new Map(nodes.map((n) => [n.id, new Set()]));
    for (const [a, b] of LINKS) { neighbours.get(a).add(b); neighbours.get(b).add(a); }

    let pointer = null; // in the picture's own coordinates
    let visible = true;
    let raf = 0;
    let last = performance.now();
    const phase = dotEls.map((_, i) => (i * 0.37) % 1);

    function paint(dt) {
      const hov = hoverRef.current;
      for (const n of nodes) {
        const el = nodeEls.get(n.id);
        el.setAttribute("transform", `translate(${n.x.toFixed(2)},${n.y.toFixed(2)})`);
        const on = hov == null || n.id === hov || neighbours.get(hov).has(n.id);
        el.style.opacity = on ? 1 : 0.2;
      }
      linkEls.forEach((el, i) => {
        const [a, b, kind] = LINKS[i];
        const A = byId.get(a);
        const B = byId.get(b);
        el.setAttribute("d", linePath(A, B, A.r, B.r));
        el.style.opacity = hov == null ? (kind === "deposit" ? 0.75 : 0.6) : a === hov || b === hov ? 1 : 0.08;
      });
      dotEls.forEach((el, i) => {
        const [a, b, kind] = LINKS[Math.floor(i / 2)];
        if (!quiet) phase[i] = (phase[i] + dt * (kind === "deposit" ? 0.00022 : 0.00034)) % 1;
        const A = byId.get(a);
        const B = byId.get(b);
        const p = along(A, B, phase[i]);
        el.setAttribute("cx", p.x.toFixed(2));
        el.setAttribute("cy", p.y.toFixed(2));
        el.style.opacity = hov == null || a === hov || b === hov ? 0.95 : 0.1;
      });
    }

    function frame(now) {
      const dt = Math.min(now - last, 50);
      last = now;
      if (!quiet) stepNodes(nodes, pointer, FIRM);
      paint(dt);
      raf = visible && !document.hidden && (!quiet || !settled(nodes)) ? requestAnimationFrame(frame) : 0;
    }
    const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };

    function onMove(e) {
      const box = svg.getBoundingClientRect();
      if (!box.width) return;
      pointer = { x: ((e.clientX - box.left) / box.width) * W, y: ((e.clientY - box.top) / box.height) * H };
      wake();
    }
    function onLeave() { pointer = null; wake(); }

    const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) wake(); }, { threshold: 0.05 }) : null;
    if (io) io.observe(svg);
    if (!quiet) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
      document.addEventListener("visibilitychange", wake);
    }
    const repaint = () => paint(0);
    svg.addEventListener("hero-repaint", repaint);
    paint(0);
    if (!quiet) wake();
    return () => {
      svg.removeEventListener("hero-repaint", repaint);
      cancelAnimationFrame(raf);
      if (io) io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  const focus = (id) => {
    hoverRef.current = id;
    const n = POINTS.find((p) => p.id === id);
    setCaption(n ? `${ROLE_LABEL[n.role]}: ${ROLE_TEXT[n.role]}` : DEFAULT_CAPTION);
    // the animation loop repaints; when it is idle (reduced motion) repaint here
    if (svgRef.current) svgRef.current.dispatchEvent(new Event("hero-repaint"));
  };

  return (
    <div className="hero-card" ref={wrapRef}>
      <svg ref={svgRef} className="ring-art" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label="Example of a ring: many payers pay a few collector accounts, money passes through mule accounts to one cash-out. Illustration only."
        onPointerLeave={() => focus(null)}>
        <defs>
          <filter id="hero-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1.2" stdDeviation="1.8" floodColor={INK} floodOpacity="0.2" />
          </filter>
          <marker id="hero-arrow-rose" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M0,1.2 L9,5 L0,8.8 z" fill={ROSE} />
          </marker>
          <marker id="hero-arrow-lav" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M0,1.2 L9,5 L0,8.8 z" fill={LAV_DARK} />
          </marker>
        </defs>
        <ellipse cx="262" cy="170" rx="168" ry="146" fill="rgba(225,29,90,0.045)" stroke="rgba(225,29,90,0.3)" strokeDasharray="2 6" strokeLinecap="round" />
        <g fill="none" strokeLinecap="round">
          {LINKS.map(([a, b, kind]) => (
            <path key={`${a}${b}`} data-link={`${a}${b}`} stroke={kind === "deposit" ? LAV : ROSE} strokeWidth={kind === "deposit" ? 1.3 : 2}
              markerEnd={`url(#${kind === "deposit" ? "hero-arrow-lav" : "hero-arrow-rose"})`} />
          ))}
        </g>
        {LINKS.flatMap(([a, b, kind]) => [0, 1].map((k) => (
          <circle key={`${a}${b}${k}`} data-dot={`${a}${b}${k}`} r="2.6" fill={kind === "deposit" ? LAV_DARK : ROSE} />
        )))}
        {POINTS.map((p) => (
          <g key={p.id} data-node={p.id} className="hero-node" filter="url(#hero-shadow)" tabIndex={0} aria-label={`${ROLE_LABEL[p.role]} (illustration)`}
            onPointerEnter={() => focus(p.id)} onFocus={() => focus(p.id)} onBlur={() => focus(null)}>
            <circle r={p.r + 10} fill="transparent" />
            <Shape role={p.role} r={p.r} score={p.score} />
          </g>
        ))}
        <g fontFamily="Hanken Grotesk, sans-serif" fontSize="10.5" fontWeight="700" letterSpacing="0.09em" fill="#7A8095" pointerEvents="none">
          <text x="14" y="18">PAYERS</text>
          <text x="148" y="58">COLLECTORS</text>
          <text x="258" y="30">MULE CHAIN</text>
          <text x="346" y="196">CASH-OUT</text>
        </g>
      </svg>
      <span className="l-caption" aria-live="polite">{caption}</span>
    </div>
  );
}

