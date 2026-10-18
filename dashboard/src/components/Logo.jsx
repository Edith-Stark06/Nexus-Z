// The NEXUS Z mark: a Z drawn as a path through four accounts (design sheet).
export function LogoMark({ size = 32, title = "NEXUS Z", onDark = false }) {
  const bar = onDark ? "#FFFFFF" : "#0C0F1D";
  const rose = onDark ? "#FF9DBB" : "#E11D5A";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title} focusable="false">
      <path d="M12 16H48M12 48H48" stroke={bar} strokeWidth="6" strokeLinecap="round" />
      <path d="M50 16L14 48" stroke={rose} strokeWidth="6" strokeLinecap="round" />
      <circle cx="12" cy="16" r="6.5" fill={onDark ? "#0C0F1D" : "#fff"} stroke={bar} strokeWidth="4" />
      <circle cx="52" cy="16" r="7" fill={rose} />
      <circle cx="12" cy="48" r="7" fill={rose} />
      <circle cx="52" cy="48" r="7" fill={bar} />
    </svg>
  );
}

export default function Logo({ size = 30, sub, onDark = false }) {
  return (
    <span className="logo" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <LogoMark size={size} onDark={onDark} />
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: size * 0.85, letterSpacing: "0.01em", color: onDark ? "#fff" : "var(--text)" }}>NEXUS Z</span>
        {sub ? <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{sub}</span> : null}
      </span>
    </span>
  );
}
