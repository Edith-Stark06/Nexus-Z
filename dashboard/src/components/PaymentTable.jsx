import { Link } from "react-router-dom";
import { formatUtc } from "../lib/constants";
import { AMOUNT_NOTE } from "../lib/scores";
import "./PaymentTable.css";

// Time-ordered list of payments. Amounts are shown as recorded: the API carries no currency, so no symbol is drawn and no
// total is computed (AMOUNT_NOTE). Pass `accountId` to add an In/Out column from that account's point of view and to make the
// other side of each payment a link.
export default function PaymentTable({ edges, accountId = null }) {
  if (!edges || edges.length === 0) {
    return <div className="pay-empty">No payments recorded.</div>;
  }

  const sorted = [...edges].map((e) => ({ ts: e.ts, src: e.src, dst: e.dst, amount: e.amount })).sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const other = (e) => (e.src === accountId ? e.dst : e.src);

  return (
    <div className="pay-table-wrap">
      <table className="pay-table">
        <thead>
          <tr>
            <th scope="col">Time (UTC)</th>
            {accountId && <th scope="col">Direction</th>}
            {accountId ? <th scope="col">Other account</th> : <><th scope="col">From</th><th scope="col">To</th></>}
            <th scope="col" className="pay-amt" title={AMOUNT_NOTE}>Amount*</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e, i) => (
            <tr key={i}>
              <td className="pay-time">{formatUtc(e.ts)}</td>
              {accountId && <td className="pay-dir">{e.src === accountId ? "Out" : "In"}</td>}
              {accountId ? (
                <td className="pay-id"><Link to={`/account/${encodeURIComponent(other(e))}`}>{other(e)}</Link></td>
              ) : (
                <>
                  <td className="pay-id">{e.src}</td>
                  <td className="pay-id">{e.dst}</td>
                </>
              )}
              <td className="pay-amt">{formatAmount(e.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pay-foot">* {AMOUNT_NOTE}</div>
    </div>
  );
}

function formatAmount(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}
