import { useEffect, useRef } from "react";
import { TILE_H, makeTile, visibleTiles } from "../lib/backdrop";
import "./NetworkBackdrop.css";

// A decorative network behind a page: the same structure as the ring graph (payers, collectors, pass-through
// accounts, cash-out), straight links, and a glow that follows the cursor. Accounts near the cursor lean toward
// it and light up. On the landing page it is fixed to the window and drifts as you scroll, so the picture
// continues all the way down. It carries no data.
//
//   variant "light" (default) draws on the porcelain background; "dark" draws on the sign-in panel
//   fill     fill the parent box instead of the window, and ignore scrolling
const INK = [12, 15, 29];
const ROSE = [225, 29, 90];
const LAV = [91, 99, 232];

export default function NetworkBackdrop({ variant = "light", fill = false }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    const quiet = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dark = variant === "dark";
    const base = dark ? [255, 255, 255] : INK;
    const accent = dark ? [255, 157, 187] : ROSE;
    const line = dark ? 0.2 : 0.2;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let pointer = null;
    let glow = { x: 0, y: 0, tx: 0, ty: 0, on: 0, target: 0 };
    let scroll = 0;
    let raf = 0;
    let visible = true;
    const tiles = new Map();
    const lean = new Map(); // per node: how far it has leaned toward the cursor
    const tile = (i) => {
      const key = `${i}:${w < 700}`;
      if (!tiles.has(key)) tiles.set(key, makeTile(i, w));
      return tiles.get(key);
    };

    function size() {
      const box = fill ? canvas.parentElement.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.round(box.width));
      h = Math.max(1, Math.round(box.height));
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      tiles.clear();
    }

    const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

    function mark(node, x, y, near) {
      const a = 0.3 + 0.55 * near;
      if (node.role === "cashout") {
        ctx.fillStyle = rgba(base, a);
        ctx.fillRect(x - node.r, y - node.r, node.r * 2, node.r * 2);
      } else if (node.role === "collector") {
        ctx.fillStyle = rgba(accent, 0.45 + 0.5 * near);
        ctx.beginPath(); ctx.arc(x, y, node.r + near * 2, 0, Math.PI * 2); ctx.fill();
      } else if (node.role === "mule") {
        ctx.lineWidth = 2; ctx.strokeStyle = rgba(accent, 0.4 + 0.5 * near);
        ctx.fillStyle = dark ? "rgba(11,16,32,0.9)" : "rgba(255,255,255,0.9)";
        ctx.beginPath(); ctx.arc(x, y, node.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else {
        ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(base, a);
        ctx.fillStyle = dark ? "rgba(11,16,32,0.9)" : "rgba(255,255,255,0.9)";
        ctx.beginPath(); ctx.arc(x, y, node.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }

    function draw(now) {
      ctx.clearRect(0, 0, w, h);
      // the glow that follows the cursor (and rests where it was last seen)
      glow.x += (glow.tx - glow.x) * 0.12;
      glow.y += (glow.ty - glow.y) * 0.12;
      glow.on += (glow.target - glow.on) * 0.08;
      const g = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, dark ? 360 : 520);
      g.addColorStop(0, dark ? `rgba(120,130,255,${0.34 * glow.on})` : `rgba(36,48,217,${0.2 * glow.on})`);
      g.addColorStop(0.45, dark ? `rgba(225,29,90,${0.16 * glow.on})` : `rgba(225,29,90,${0.1 * glow.on})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      const shift = fill ? 0 : scroll * 0.45;
      const idx = visibleTiles(shift - 40, shift + h + 40);
      const t = (now || 0) / 1000;
      for (const i of idx) {
        const { nodes, links } = tile(i);
        const oy = i * TILE_H - shift;
        const pos = new Map();
        for (const n of nodes) {
          let x = n.x;
          let y = n.y + oy;
          let near = 0;
          if (pointer && !quiet) {
            const dx = pointer.x - x;
            const dy = pointer.y - y;
            const d = Math.hypot(dx, dy);
            near = d < 170 ? (1 - d / 170) ** 2 : 0;
            const target = near;
            const cur = lean.get(n.id) || { k: 0 };
            cur.k += (target - cur.k) * 0.1;
            lean.set(n.id, cur);
            if (d > 1) { x += (dx / d) * 16 * cur.k; y += (dy / d) * 16 * cur.k; }
            near = cur.k;
          } else if (lean.has(n.id)) {
            const cur = lean.get(n.id);
            cur.k *= 0.9;
            near = cur.k;
            if (pointer == null && cur.k < 0.01) lean.delete(n.id);
          }
          pos.set(n, { x, y, near });
        }
        ctx.lineCap = "round";
        for (const l of links) {
          const A = pos.get(l.a);
          const B = pos.get(l.b);
          const lit = Math.max(A.near, B.near);
          ctx.lineWidth = l.kind === "deposit" ? 1 : 1.6;
          ctx.strokeStyle = l.kind === "deposit" ? rgba(dark ? [180, 185, 243] : LAV, line + 0.35 * lit) : rgba(accent, line + 0.45 * lit);
          ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
          if (!quiet) {
            // a small dot of money travelling along the link
            const p = (t * (l.kind === "deposit" ? 0.07 : 0.1) + (l.a.y * 0.013 + l.b.x * 0.007)) % 1;
            ctx.fillStyle = rgba(l.kind === "deposit" ? (dark ? [180, 185, 243] : LAV) : accent, 0.55 + 0.4 * lit);
            ctx.beginPath(); ctx.arc(A.x + (B.x - A.x) * p, A.y + (B.y - A.y) * p, 2.1, 0, Math.PI * 2); ctx.fill();
          }
        }
        for (const n of nodes) { const p = pos.get(n); mark(n, p.x, p.y, p.near); }
      }
    }

    function frame(now) {
      draw(now);
      raf = visible && !document.hidden && !quiet ? requestAnimationFrame(frame) : 0;
    }
    const wake = () => { if (!raf && !quiet) raf = requestAnimationFrame(frame); };

    function onMove(e) {
      const box = fill ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
      pointer = { x: e.clientX - box.left, y: e.clientY - box.top };
      if (fill && (pointer.x < -40 || pointer.y < -40 || pointer.x > w + 40 || pointer.y > h + 40)) { pointer = null; glow.target = 0; return; }
      glow.tx = pointer.x; glow.ty = pointer.y;
      if (glow.target === 0) { glow.x = pointer.x; glow.y = pointer.y; }
      glow.target = 1;
      wake();
    }
    function onLeave() { pointer = null; glow.target = 0; wake(); }
    function onScroll() { scroll = window.scrollY || 0; if (quiet) draw(0); }
    function onResize() { size(); draw(performance.now()); }

    size();
    glow.tx = glow.x = w * 0.72;
    glow.ty = glow.y = h * 0.28;
    glow.target = quiet ? 0.7 : 0.55; // a resting glow before the cursor arrives
    scroll = window.scrollY || 0;
    draw(0);
    window.addEventListener("resize", onResize);
    if (!quiet) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
      document.addEventListener("visibilitychange", wake);
    }
    if (!fill) window.addEventListener("scroll", onScroll, { passive: true });
    const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) wake(); }, { threshold: 0 }) : null;
    if (io) io.observe(canvas);
    wake();
    return () => {
      cancelAnimationFrame(raf);
      if (io) io.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [variant, fill]);

  return <canvas ref={ref} className={`net-backdrop${fill ? " net-fill" : " net-fixed"}${variant === "dark" ? " net-dark" : ""}`} aria-hidden="true" />;
}
