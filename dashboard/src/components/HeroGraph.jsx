import { useEffect, useRef, useState } from "react";
import { curvePath, curvePoint, ROLE_LABEL, ROLE_TEXT } from "../lib/graphLayout";
import { makeNodes, settled, stepNodes } from "../lib/heroPhysics";

// An illustration of the shape NEXUS Z looks for, that reacts to the cursor. It is not data.
const INK = "#0C0F1D";
const ROSE = "#E11D5A";
const LAV = "#9AA0EE";
const W = 440;
const H = 340;

const POINTS = [
  ...[[40, 40], [34, 92], [46, 146], [30, 200], [42, 252], [36, 300]].map(([x, y], i) => ({ id: `v${i}`, role: "victim", x, y, r: 7 })),
  ...[[176, 96], [168, 200], [182, 286]].map(([x, y], i) => ({ id: `c${i}`, role: "collector", x, y, r: i === 1 ? 14 : 11 })),
  ...[[290, 70], [300, 160], [286, 250]].map(([x, y], i) => ({ id: `m${i}`, role: "mule", x, y, r: 9 })),
  { id: "x0", role: "cashout", x: 392, y: 160, r: 12 },
];
const LINKS = [
  ...[0, 1, 2, 3, 4, 5].map((i) => [`v${i}`, `c${Math.floor(i / 2)}`, "deposit"]),
  ["c0", "m0", "flow"], ["c1", "m1", "flow"], ["c2", "m2", "flow"], ["c1", "m0", "flow"],
  ["m0", "x0", "flow"], ["m1", "x0", "flow"], ["m2", "x0", "flow"],
];
const DEFAULT_CAPTION = "Move your cursor over the picture. Illustration of the shape we look for. Not real data.";

function Shape({ role, r }) {
  if (role === "cashout") return <rect x={-r} y={-r} width={2 * r} height={2 * r} rx="3" fill={INK} />;
  if (role === "collector") return (<><circle r={r + 7} fill="none" stroke={ROSE} strokeOpacity="0.22" strokeWidth="2" /><circle r={r} fill={ROSE} /></>);
  if (role === "mule") return <circle r={r} fill="#fff" stroke={ROSE} strokeWidth="3" />;
  return <circle r={r} fill="#fff" stroke={INK} strokeWidth="2" />;
}

export default function HeroGraph() {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const hoverRef = useRef(null);
  const [caption, setCaption] = useState(DEFAULT_CAPTION);

  useEffect(() => {
    const svg = svgRef.current;
    const wrap = wrapRef.current;
    if (!svg || !wrap) return undefined;
    const hero = svg.closest(".l-hero");
    const quiet = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nodes = makeNodes(POINTS);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const nodeEls = new Map([...svg.querySelectorAll("[data-node]")].map((el) => [el.dataset.node, el]));
    const linkEls = [...svg.querySelectorAll("[data-link]")];
    const dotEls = [...svg.querySelectorAll("[data-dot]")];
    const neighbours = new Map(nodes.map((n) => [n.id, new Set()]));
    for (const [a, b] of LINKS) { neighbours.get(a).add(b); neighbours.get(b).add(a); }

    let pointer = null; // in the picture's own coordinates
    let tilt = { x: 0, y: 0, tx: 0, ty: 0 };
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
        const [a, b] = LINKS[i];
        const A = byId.get(a);
        const B = byId.get(b);
        el.setAttribute("d", curvePath(A, B, 0.12));
        el.style.opacity = hov == null ? 0.9 : a === hov || b === hov ? 1 : 0.1;
      });
      dotEls.forEach((el, i) => {
        const [a, b, kind] = LINKS[Math.floor(i / 2)];
        if (!quiet) phase[i] = (phase[i] + dt * (kind === "deposit" ? 0.00022 : 0.00034)) % 1;
        const p = curvePoint(byId.get(a), byId.get(b), phase[i], 0.12);
        el.setAttribute("cx", p.x.toFixed(2));
        el.setAttribute("cy", p.y.toFixed(2));
        el.style.opacity = hov == null || a === hov || b === hov ? 0.95 : 0.1;
      });
      if (!quiet) {
        tilt.x += (tilt.tx - tilt.x) * 0.08;
        tilt.y += (tilt.ty - tilt.y) * 0.08;
        wrap.style.transform = `perspective(1000px) rotateY(${(tilt.x * 5).toFixed(2)}deg) rotateX(${(-tilt.y * 4).toFixed(2)}deg)`;
      }
    }

    function frame(now) {
      const dt = Math.min(now - last, 50);
      last = now;
      if (!quiet) stepNodes(nodes, pointer);
      paint(dt);
      raf = visible && !document.hidden && (!quiet || !settled(nodes)) ? requestAnimationFrame(frame) : 0;
    }
    const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };

    function onMove(e) {
      const box = svg.getBoundingClientRect();
      if (!box.width) return;
      pointer = { x: ((e.clientX - box.left) / box.width) * W, y: ((e.clientY - box.top) / box.height) * H };
      tilt.tx = clamp((e.clientX / window.innerWidth - 0.5) * 2, -1, 1);
      tilt.ty = clamp((e.clientY / window.innerHeight - 0.5) * 2, -1, 1);
      if (hero) {
        const hb = hero.getBoundingClientRect();
        hero.style.setProperty("--mx", `${e.clientX - hb.left}px`);
        hero.style.setProperty("--my", `${e.clientY - hb.top}px`);
      }
      wake();
    }
    function onLeave() { pointer = null; tilt.tx = 0; tilt.ty = 0; wake(); }

    const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) wake(); }, { threshold: 0.05 }) : null;
    io && io.observe(svg);
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
      io && io.disconnect();
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
    svgRef.current && svgRef.current.dispatchEvent(new Event("hero-repaint"));
  };

  return (
    <div className="hero-card" ref={wrapRef}>
      <svg ref={svgRef} className="ring-art" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label="Example of a ring: many payers pay a few collector accounts, money passes through mule accounts to one cash-out. Illustration only."
        onPointerLeave={() => focus(null)}>
        <ellipse cx="270" cy="170" rx="170" ry="140" fill="rgba(225,29,90,0.06)" stroke="rgba(225,29,90,0.45)" strokeDasharray="5 5" />
        <g fill="none" strokeLinecap="round">
          {LINKS.map(([a, b, kind]) => (
            <path key={`${a}${b}`} data-link={`${a}${b}`} stroke={kind === "deposit" ? LAV : ROSE} strokeWidth={kind === "deposit" ? 1.5 : 2.6} />
          ))}
        </g>
        {LINKS.flatMap(([a, b, kind]) => [0, 1].map((k) => (
          <circle key={`${a}${b}${k}`} data-dot={`${a}${b}${k}`} r="2.8" fill={kind === "deposit" ? "#5B63E8" : ROSE} />
        )))}
        {POINTS.map((p) => (
          <g key={p.id} data-node={p.id} className="hero-node" tabIndex={0} aria-label={`${ROLE_LABEL[p.role]} (illustration)`}
            onPointerEnter={() => focus(p.id)} onFocus={() => focus(p.id)} onBlur={() => focus(null)}>
            <circle r={p.r + 10} fill="transparent" />
            <Shape role={p.role} r={p.r} />
          </g>
        ))}
        <g fontFamily="Hanken Grotesk, sans-serif" fontSize="12" fill="#4F566B" pointerEvents="none">
          <text x="14" y="18">Payers</text>
          <text x="150" y="60">Collectors</text>
          <text x="262" y="30">Mule chain</text>
          <text x="352" y="196">Cash-out</text>
        </g>
      </svg>
      <span className="l-caption" aria-live="polite">{caption}</span>
    </div>
  );
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
