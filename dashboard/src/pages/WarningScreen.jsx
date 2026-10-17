import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getAccount } from "../services/api";
import { ROLE_COLORS } from "../lib/constants";
import Layout from "./Layout";
import "./WarningScreen.css";

// Friendly, jargon-free copy for an account we have no data on.
const UNKNOWN_MESSAGE =
  "We could not find this account in our system. It is not currently linked " +
  "to a flagged ring, but we cannot confirm it is safe either. If you were " +
  "about to send money, please double-check the recipient before " +
  "proceeding.";

export default function WarningScreen() {
  const { accountId } = useParams();
  const [account, setAccount] = useState(null);
  const [usingMock, setUsingMock] = useState(true);

  useEffect(() => {
    let stopped = false;
    async function load() {
      const res = await getAccount(accountId);
      if (!stopped) {
        setAccount(res.data);
        setUsingMock(res.usingMock);
      }
    }
    load();
    return () => { stopped = true };
  }, [accountId]);

  // No account record at all — unknown ID. The mock loader returns null
  // when there is no bundled example for the requested account, and the API
  // returns a 404. Either way we show the friendly "not found" copy.
  if (!account) {
    return (
      <Layout usingMock={usingMock}>
        <div className="warning warning-unknown">
          <div className="warning-icon" style={{ color: "var(--warn)" }}>
            ?
          </div>
          <h2>Account not found</h2>
          <p className="warning-sub">
            We could not look up <b>{accountId}</b>.
          </p>
          <div className="warning-message">
            <span className="wm-label">Message shown to the customer</span>
            <p>{UNKNOWN_MESSAGE}</p>
          </div>
          <div className="warning-actions">
            <Link to="/" className="ghost">
              Cancel payment
            </Link>
            <a href="tel:0" className="ghost">
              Talk to my bank
            </a>
            <Link to="/" className="primary">
              I understand the risk, continue
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  const role = account.role || "unknown";
  const ringId = account.ring_id;
  const riskPct = Math.round((account.risk ?? 0) * 100);

  const roleCopy = {
    collector:
      "an account that collects payments from many people and forwards them quickly",
    mule: "an account that moves money on behalf of others",
    cashout: "an account that moves money out to an external destination",
    victim: "your own account — recent payments from it are under review",
    unknown: "an account under review",
  }[role] || "an account under review";

  const message =
    `Payment to this account is high risk (${riskPct}%). ` +
    `It is linked to ${ringId || "a flagged ring"}, ${roleCopy}. ` +
    `If you have not already done so, verify the recipient before sending.`;

  return (
    <Layout usingMock={usingMock}>
      <div className="warning">
        <div className="crumb">
          <Link to="/">Rings</Link>
          {ringId ? (
            <> / <Link to={`/ring/${ringId}`}>{ringId}</Link></>
          ) : null}
          {" / "}
          <Link to={`/account/${account.account_id}`}>{account.account_id}</Link>
          {" / "}
          <span>Warning</span>
        </div>

        <div className="warning-card">
          <div
            className="warning-icon"
            style={{ color: ROLE_COLORS[role] }}
          >
            ⚠
          </div>
          <h2>Check before you send</h2>
          <p className="warning-sub">
            This account is flagged as part of a fraud ring.
          </p>

          <div className="warning-meta">
            <div className="wm-row">
              <span>Account</span>
              <b>{account.account_id}</b>
            </div>
            <div className="wm-row">
              <span>Estimated role</span>
              <b style={{ color: ROLE_COLORS[role] }}>{role}</b>
            </div>
            {ringId && (
              <div className="wm-row">
                <span>Ring</span>
                <b>{ringId}</b>
              </div>
            )}
            <div className="wm-row">
              <span>Risk score</span>
              <b>{riskPct}%</b>
            </div>
          </div>

          <div className="warning-message">
            <span className="wm-label">Message shown to the customer</span>
            <p>{message}</p>
          </div>

          <div className="warning-actions">
            <Link to="/" className="ghost">
              Cancel payment
            </Link>
            <a href="tel:0" className="ghost">
              Talk to my bank
            </a>
            <Link to={`/account/${account.account_id}`} className="primary">
              I understand the risk, continue
            </Link>
          </div>
        </div>
      </div>
    </Layout>
  );
}