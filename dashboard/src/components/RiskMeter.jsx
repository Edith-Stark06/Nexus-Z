import { riskTone } from "../lib/constants";
import { RING_SCORE, ACCOUNT_SCORE, ringScore, accountScore, ringPct, accountPct } from "../lib/scores";

// A score with a thin bar, always on the scale it came with: a ring score is 0 to 100, an account score is 0 to 1.
// Only a ring score is coloured by severity (>= 50 high, >= 25 medium: the cut-offs ml/service.py uses for alert severity);
// an account score has no such cut-offs, so its bar stays neutral. The tooltip names the score and its scale.
export default function RiskMeter({ value, kind = "ring", compact = false }) {
  const ring = kind === "ring";
  const pct = ring ? ringPct(value) : accountPct(value);
  const tone = ring && !compact ? riskTone(pct) : "none"; // list rows stay neutral: dozens of red bars say nothing
  const meta = ring ? RING_SCORE : ACCOUNT_SCORE;
  const text = ring ? ringScore(value) : accountScore(value);
  return (
    <span className={`riskmeter ${compact ? "compact" : ""}`} title={pct == null ? `No ${meta.name.toLowerCase()}` : `${meta.name} ${text} on a ${meta.scale} scale (automated signal)`}>
      <span className="num riskmeter-n" style={{ color: tone === "high" ? "var(--danger-text)" : tone === "medium" ? "var(--warn-text)" : "var(--text)" }}>
        {text}
      </span>
      <span className={`riskbar ${tone}`} style={{ width: compact ? 36 : 64 }} aria-hidden="true">
        <i style={{ width: `${pct ?? 0}%` }} />
      </span>
      {!compact && <span className="faint riskmeter-scale">{ring ? "/ 100" : "/ 1"}</span>}
    </span>
  );
}
