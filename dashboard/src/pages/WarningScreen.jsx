import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ShieldAlert, HelpCircle } from "lucide-react";
import Layout from "./Layout";
import ReasonList from "../components/ReasonList";
import RoleGlyph from "../components/RoleGlyph";
import { useAccountRecord } from "../state/hooks";
import { ROLE_LABELS, riskTone } from "../lib/constants";
import "./WarningScreen.css";

// Friendly, jargon-free copy for an account we have no data on.
const UNKNOWN_MESSAGE =
  "We could not find this account in our system. It is not currently linked " +
  "to a flagged ring, but we cannot confirm it is safe either. If you were " +
  "about to send money, please double-check the recipient before " +
  "proceeding.";

const ROLE_COPY = {
  collector: "an account that receives payments from several others and passes them on",
  mule: "an account that passes money along between others",
  cashout: "an account where the ring's money appears to leave",
  victim: "an account at the start of the ring's payment flow",
  unknown: "an account under review",
};

function Prototype() {
  return (
    <div className="notice info ws-proto" role="note">
      <div className="grow">
        <strong>Prototype of a customer screen.</strong> It shows what a bank's app could display before a payment, using the real <span className="mono">GET /accounts/&#123;id&#125;</span>{" "}
        lookup. It is not connected to any payment flow, and no warning is sent to anyone.
      </div>
    </div>
  );
}

function BankContact() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>Talk to my bank</button>
      {open && <p className="ws-bank" role="status">Contact your bank using the number on the back of your card.</p>}
    </>
  );
}

export default function WarningScreen() {
  const { accountId } = useParams();
  const rec = useAccountRecord(accountId);
  const account = rec.account;

  // No account record at all: the API answered 404 (or there is no sample for this id).
  if (rec.state === "notfound" || rec.state === "error") {
    return (
      <Layout title="Payment pre-check" subtitle="Customer screen prototype">
        <div className="ws">
          <Prototype />
          <div className="ws-card ws-unknown">
            <HelpCircle size={26} className="ws-icon" style={{ color: "var(--warn)" }} aria-hidden="true" />
            <h2>Account not found</h2>
            <p className="ws-sub">
              We could not look up <b className="mono">{accountId}</b>.
            </p>
            {rec.state === "error" && <p className="field-error">The lookup failed: {rec.message}</p>}
            <div className="ws-message">
              <span className="eyebrow">Message shown to the customer</span>
              <p>{UNKNOWN_MESSAGE}</p>
            </div>
            <div className="ws-actions">
              <Link to="/rings" className="btnlink">Cancel payment</Link>
              <BankContact />
              <Link to="/rings" className="btnlink">I understand the risk, continue</Link>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  if (!account) {
    return (
      <Layout title="Payment pre-check" subtitle="Customer screen prototype">
        <div className="ws"><div className="ws-loading"><div className="skel" style={{ width: 220 }} /><div className="skel" /></div></div>
      </Layout>
    );
  }

  const role = account.role || "unknown";
  const ringId = account.ring_id;
  const riskPct = Math.round((account.risk ?? 0) * 100);
  const tone = riskTone(riskPct);
  const message = ringId
    ? `This payment would go to an account that is flagged for review (risk signal ${riskPct}%). ` +
      `It is linked to ${ringId}, ${ROLE_COPY[role] || ROLE_COPY.unknown}. ` +
      `This is not proof of wrongdoing, but please verify the recipient before sending.`
    : `This account is not currently linked to a flagged ring (risk signal ${riskPct}%). That does not guarantee it is safe: verify the recipient before sending.`;

  return (
    <Layout title="Payment pre-check" subtitle="Customer screen prototype">
      <div className="ws">
        <Prototype />
        <div className="ws-cols">
          <div className="ws-card">
            <ShieldAlert size={28} className="ws-icon" style={{ color: tone === "high" ? "var(--danger)" : "var(--warn)" }} aria-hidden="true" />
            <h2>Check before you send</h2>
            <p className="ws-sub">{ringId ? "This account is flagged as part of a ring under review." : "This account is not in a flagged ring right now."}</p>

            <dl className="ws-meta">
              <div><dt>Account</dt><dd className="mono">{account.account_id}</dd></div>
              <div><dt>Estimated role</dt><dd><RoleGlyph role={role} label /></dd></div>
              {ringId && <div><dt>Ring</dt><dd className="mono">{ringId}</dd></div>}
              <div><dt>Risk signal</dt><dd className="num">{riskPct}%</dd></div>
            </dl>

            <div className="ws-message">
              <span className="eyebrow">Message shown to the customer</span>
              <p>{message}</p>
            </div>

            <div className="ws-actions">
              <Link to="/rings" className="btnlink">Cancel payment</Link>
              <BankContact />
              <Link to={`/account/${account.account_id}`} className="btnlink">I understand the risk, continue</Link>
            </div>
          </div>

          <aside className="ws-notes">
            <h3 className="eyebrow">For the analyst: what this screen is built from</h3>
            <p className="faint ws-n">Real response of <span className="mono">GET /accounts/{account.account_id}</span>. The wording is a fixed template; no model writes it.</p>
            <div className="ws-n-block"><div className="eyebrow">Why the account scores this way</div><ReasonList reasons={account.reasons} limit={3} /></div>
            <ul className="ws-points faint">
              <li>The risk signal is automated and has not been evaluated as a payment-blocking rule.</li>
              <li>The role ({ROLE_LABELS[role]}) is guessed from the ring's payments.</li>
              <li>An unknown account is shown as "cannot confirm it is safe", never as safe.</li>
            </ul>
            <div className="ws-links">
              <Link to={`/account/${account.account_id}`}>Open account page</Link>
              {ringId && <Link to={`/ring/${ringId}?account=${encodeURIComponent(account.account_id)}`}>Show in ring graph</Link>}
            </div>
          </aside>
        </div>
      </div>
    </Layout>
  );
}
