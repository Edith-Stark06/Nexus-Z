import { ROLE_COLORS, ROLE_LABELS } from "../lib/constants";

// The same shape the graph uses for an estimated role, so a list row and a graph node read as one thing.
// victim: hollow circle, collector: filled circle, mule: diamond, cash-out: square, unknown: dashed circle.
export default function RoleGlyph({ role = "unknown", size = 14, color, label = false, dim = false }) {
  const c = color || ROLE_COLORS[role] || ROLE_COLORS.unknown;
  const p = { stroke: c, strokeWidth: 1.6, opacity: dim ? 0.35 : 1 };
  let shape;
  if (role === "victim") shape = <circle r="5.5" fill="none" {...p} />;
  else if (role === "collector") shape = <circle r="5.5" fill={c} {...p} />;
  else if (role === "mule") shape = <rect x="-4.5" y="-4.5" width="9" height="9" transform="rotate(45)" fill={c} {...p} />;
  else if (role === "cashout") shape = <rect x="-5" y="-5" width="10" height="10" rx="1.5" fill={c} {...p} />;
  else shape = <circle r="5.5" fill="none" strokeDasharray="2 1.6" {...p} />;
  return (
    <span className="roleglyph" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <svg width={size} height={size} viewBox="-8 -8 16 16" aria-hidden="true">{shape}</svg>
      {label && <span>{ROLE_LABELS[role] || role}</span>}
    </span>
  );
}
