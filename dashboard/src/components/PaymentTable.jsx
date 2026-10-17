import { useEffect, useState } from "react";

// Time-ordered list of payments inside a ring.
//
// The amount column is labelled "amount (mixed currencies)" and carries no
// currency symbols — the model treats amounts as raw numbers, so the UI must
// not imply a single unit. This is also what the contract examples use.
export default function PaymentTable({ edges }) {
  if (!edges || edges.length === 0) {
    return <div className="pay-empty">No payments recorded.</div>;
  }

  const sorted = [...edges]
    .map((e) => ({
      ts: e.ts,
      src: e.src,
      dst: e.dst,
      amount: e.amount,
    }))
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));

  return (
    <div className="pay-table-wrap">
      <table className="pay-table">
        <thead>
          <tr>
            <th>time</th>
            <th>from</th>
            <th>to</th>
            <th>amount (mixed currencies)</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e, i) => (
            <tr key={i}>
              <td className="pay-time">{e.ts}</td>
              <td className="pay-id">{e.src}</td>
              <td className="pay-id">{e.dst}</td>
              <td className="pay-amt">{formatAmount(e.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatAmount(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}