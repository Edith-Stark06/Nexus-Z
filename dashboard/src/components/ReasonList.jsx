import { featureLabel } from "../lib/constants";
import "./ReasonList.css";

// The model's reasons for a score, exactly as the API sends them (labels such as "(absent)" are deliberate: the model is
// flagging the lack of something). The number is a SHAP value: how far that feature pushed the score up (+) or down (-).
// It is not a probability and not a percentage.
export default function ReasonList({ reasons, limit }) {
  const list = (reasons || []).slice(0, limit || undefined);
  if (list.length === 0) return <div className="empty">No explanation available for this item.</div>;
  const max = Math.max(0.2, ...list.map((r) => Math.abs(r.contribution)));
  return (
    <ol className="reasons">
      {list.map((r, i) => {
        const up = r.contribution >= 0;
        return (
          <li key={`${r.feature}-${i}`}>
            <span className="reasons-rank num">{i + 1}</span>
            <span className="reasons-label">{r.label || featureLabel(r.feature)}</span>
            <span className={`reasons-val num ${up ? "up" : "down"}`}>
              {up ? "+" : "−"}
              {Math.abs(r.contribution).toFixed(2)}
            </span>
            <span className="reasons-bar" aria-hidden="true">
              <i className={up ? "up" : "down"} style={{ width: `${(Math.abs(r.contribution) / max) * 100}%` }} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
