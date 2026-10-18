/**
 * One drawing spec for an account, shared by the ring graph (D3) and the landing illustration (React),
 * so both look the same. Flat colour, a thin white outline, and for collectors a thin ring that fills
 * in proportion to the risk score. Shape and colour tell the role apart (not colour alone).
 */
export const INK = "#0C0F1D";
export const ROSE = "#E11D5A";
export const ROSE_SOFT = "#F6CBD8";
export const LAV = "#B4B9F3";
export const LAV_DARK = "#5B63E8";
export const SLATE = "#8A90A8";

/** Path of an arc of a circle of radius r that covers `fraction` (0 to 1) of the way round, starting at the top. */
export function arcPath(r, fraction) {
  const f = Math.max(0, Math.min(0.9999, fraction));
  if (f === 0) return "";
  const a = f * 2 * Math.PI;
  const clean = (v) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2); // no "-0.00"
  const x = r * Math.sin(a);
  const y = -r * Math.cos(a);
  return `M0,${-r} A${r},${r} 0 ${f > 0.5 ? 1 : 0} 1 ${clean(x)},${clean(y)}`;
}

/** The marks that make up one account, as plain descriptions (type, size, colours). */
export function nodePrimitives(role, r, score) {
  const out = [];
  if (role === "collector") {
    if (score != null && r >= 8) {
      out.push({ type: "circle", r: r + 5, fill: "none", stroke: ROSE_SOFT, strokeWidth: 2.4 });
      const d = arcPath(r + 5, score);
      if (d) out.push({ type: "path", d, fill: "none", stroke: ROSE, strokeWidth: 2.4, linecap: "round" });
    }
    out.push({ type: "circle", r, fill: ROSE, stroke: "#fff", strokeWidth: 2 });
    out.push({ type: "circle", r: Math.max(2, r * 0.28), fill: "#fff", opacity: 0.9 });
  } else if (role === "mule") {
    out.push({ type: "circle", r, fill: "#fff", stroke: ROSE, strokeWidth: 2.6 });
    out.push({ type: "circle", r: Math.max(2, r * 0.3), fill: ROSE });
  } else if (role === "cashout") {
    out.push({ type: "rect", r, fill: INK, stroke: "#fff", strokeWidth: 2 });
    out.push({ type: "rect", r: Math.max(2.5, r * 0.34), fill: "#fff", opacity: 0.92 });
  } else if (role === "victim") {
    out.push({ type: "circle", r, fill: "#fff", stroke: INK, strokeWidth: 1.8 });
  } else {
    out.push({ type: "circle", r, fill: "#fff", stroke: SLATE, strokeWidth: 1.8, dash: "3 2" });
  }
  return out;
}

/** Width of a small id label pill, from its text length (monospace). */
export function pillWidth(text) {
  return Math.round(String(text).length * 5.9 + 12);
}
