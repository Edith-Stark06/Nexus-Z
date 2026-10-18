import { featureLabel } from '../lib/constants'
import './SHAPPanel.css'

// Render SHAP-style feature contributions as a horizontal bar chart.
// Accepts either a ring object (top_reasons) or an account object (reasons).
export function SHAPPanel({ ringId, ring, accountId }) {
  const reasons = ring
    ? ring.top_reasons
    : accountId
      ? null
      : null

  if (!reasons || reasons.length === 0) {
    return <div className="empty">No explanation available.</div>
  }

  const max = Math.max(0.2, ...reasons.map((r) => Math.abs(r.contribution)))

  return (
    <div className="shap">
      {reasons.map((r, i) => {
        const positive = r.contribution >= 0
        const width = (Math.abs(r.contribution) / max) * 100
        return (
          <div key={i} className="shap-row">
            <div className="shap-label">
              <span className="shap-name">{r.label || featureLabel(r.feature)}</span>
              <span className="shap-val">{r.contribution > 0 ? '+' : ''}{r.contribution.toFixed(2)}</span>
            </div>
            <div className="shap-bar-track">
              <div
                className={`shap-bar ${positive ? 'pos' : 'neg'}`}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}