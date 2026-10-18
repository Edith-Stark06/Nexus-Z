import { riskTone } from "../lib/constants";

// A risk number with a thin bar. The colour is the risk tone (>= 50 high, >= 25 medium: the cut-offs ml/service.py uses for
// alert severity), so colour appears only where there is a risk to show.
export default function RiskMeter({ value, max = 100, label = "risk", compact = false }) {
  const pct = value == null ? null : (value / max) * 100;
  const tone = riskTone(pct);
  return (
    <span className={`riskmeter ${compact ? "compact" : ""}`} title={pct == null ? "No score" : `Automated ${label} signal ${Math.round(pct)} of 100`}>
      <span className="num riskmeter-n" style={{ color: tone === "high" ? "var(--danger)" : tone === "medium" ? "var(--warn)" : "var(--text)" }}>
        {pct == null ? "—" : Math.round(pct)}
      </span>
      <span className={`riskbar ${tone}`} style={{ width: compact ? 36 : 64 }}>
        <i style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} />
      </span>
    </span>
  );
}
