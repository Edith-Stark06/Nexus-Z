import { useState } from "react";
import "./PaymentTable.css";

// Time-ordered payments inside a ring, grouped by day, with room to read.
//
// The amount column is labelled "amount (mixed currencies)" and carries no currency symbols: the model treats
// amounts as raw numbers, so the screen must not imply a single unit. `roles` (account id to estimated role)
// puts a small mark beside each account, matching the flow graph.
const SHOWN = 10;

export default function PaymentTable({ edges, roles = {} }) {
  const [all, setAll] = useState(false);
  if (!edges || edges.length === 0) {
    return <div className="pay-empty">No payments recorded.</div>;
  }

  const sorted = [...edges]
    .map((e) => ({ ts: e.ts, src: e.src, dst: e.dst, amount: e.amount }))
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const shown = all ? sorted : sorted.slice(0, SHOWN);

  // one header row per day, with how many payments fall on it
  const perDay = {};
  for (const e of sorted) perDay[dayOf(e.ts)] = (perDay[dayOf(e.ts)] || 0) + 1;
  const rows = [];
  let current = null;
  shown.forEach((e, i) => {
    const d = dayOf(e.ts);
    if (d !== current) {
      current = d;
      rows.push(
        <tr key={`d${d}${i}`} className="pay-day">
          <th scope="colgroup" colSpan={5}>
            {dayLabel(e.ts)} <span>{perDay[d]} payment{perDay[d] === 1 ? "" : "s"}</span>
          </th>
        </tr>
      );
    }
    rows.push(
      <tr key={i} className="pay-row">
        <td className="pay-time"><time dateTime={e.ts} title={e.ts}>{timeOf(e.ts)}</time></td>
        <td className="pay-id"><Chip id={e.src} role={roles[e.src]} /></td>
        <td className="pay-arrow" aria-hidden="true">→</td>
        <td className="pay-id"><Chip id={e.dst} role={roles[e.dst]} /></td>
        <td className="pay-amt">{formatAmount(e.amount)}</td>
      </tr>
    );
  });

  return (
    <div className="pay-table-wrap">
      <div className={`pay-scroll${all && sorted.length > 24 ? " pay-tall" : ""}`}>
        <table className="pay-table">
          <thead>
            <tr>
              <th>time (UTC)</th>
              <th>from</th>
              <th aria-hidden="true" />
              <th>to</th>
              <th className="pay-amt-h">amount (mixed currencies)</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
      {sorted.length > SHOWN ? (
        <div className="pay-foot">
          <span>{all ? `All ${sorted.length} payments` : `Showing ${SHOWN} of ${sorted.length} payments`}</span>
          <button type="button" onClick={() => setAll((a) => !a)}>{all ? "Show fewer" : `Show all ${sorted.length}`}</button>
        </div>
      ) : null}
    </div>
  );
}

function Chip({ id, role }) {
  return (
    <span className="chip">
      <i className={`chip-dot ${role || "unknown"}`} aria-hidden="true" />
      {id}
    </span>
  );
}

function asDate(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}
const dayOf = (ts) => (asDate(ts) ? asDate(ts).toISOString().slice(0, 10) : "unknown");
const timeOf = (ts) => (asDate(ts) ? asDate(ts).toISOString().slice(11, 16) : String(ts));
const dayLabel = (ts) =>
  asDate(ts) ? asDate(ts).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "Unknown date";

function formatAmount(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}
