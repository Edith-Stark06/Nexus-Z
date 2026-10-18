import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAccount } from "../services/api";
import Layout from "./Layout";
import "./RolePages.css";

const KEY = "nexusz.checks";

function loadChecks() {
  try { return JSON.parse(window.sessionStorage.getItem(KEY) || "[]"); } catch { return []; }
}
function saveChecks(list) {
  try { window.sessionStorage.setItem(KEY, JSON.stringify(list.slice(0, 20))); } catch { /* storage may be unavailable */ }
}

/** Customer home: look an account up before paying it. Uses the same account lookup as the analyst screens. */
export default function Protect() {
  const navigate = useNavigate();
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [checks, setChecks] = useState(loadChecks);

  const record = (account, label, flagged) => {
    const next = [{ id: account, label, flagged, at: Date.now() }, ...checks.filter((c) => c.id !== account)];
    setChecks(next);
    saveChecks(next);
  };

  const submit = async (e) => {
    e.preventDefault(); // never a native form post
    const account = id.trim();
    if (!account) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await getAccount(account);
      const data = res.data;
      if (data && data.ring_id) {
        record(account, "Flagged", true);
        navigate(`/warning/${encodeURIComponent(account)}`);
        return;
      }
      if (data) {
        record(account, "No flag found", false);
        setResult({ kind: "clear", account, sample: res.usingMock });
      } else {
        record(account, "Not in our data", false);
        setResult({ kind: "unknown", account });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout title="Payment protection">
      <div className="rp">
        <p className="rp-lead">
          Before you send money to an account you do not know well, check it here. We tell you if the account is linked to a ring we have
          flagged, and why.
        </p>

        <section className="rp-card" aria-labelledby="check-title">
          <h2 id="check-title">Check an account</h2>
          <p>Enter the account you are about to pay.</p>
          <form className="check-form" onSubmit={submit}>
            <label className="sr-only" htmlFor="acct">Recipient account</label>
            <input id="acct" name="account" type="text" placeholder="For example ACC-7F3A" autoComplete="off" value={id} onChange={(e) => setId(e.target.value)} />
            <button type="submit" className="btn-primary" disabled={busy || !id.trim()}>{busy ? "Checking…" : "Check account"}</button>
          </form>

          {result && result.kind === "clear" ? (
            <p className="notice ok" role="status" style={{ marginTop: 16 }}>
              <b>No flag found for {result.account}.</b> It is not linked to a ring we have flagged. That does not prove it is safe: we
              only see the payments in this data.{result.sample ? " This answer comes from bundled sample data, not the live system." : ""}
            </p>
          ) : null}
          {result && result.kind === "unknown" ? (
            <p className="notice" role="status" style={{ marginTop: 16 }}>
              <b>We could not find {result.account}.</b> It is not in the data this system has seen, so we cannot say anything about it. If
              you are unsure, check with the person you are paying through another channel.
            </p>
          ) : null}
        </section>

        <section className="rp-card" aria-labelledby="recent-title">
          <h2 id="recent-title">Your checks in this session</h2>
          {checks.length === 0 ? (
            <p className="empty-note">Nothing checked yet. Checks are kept in this browser tab only.</p>
          ) : (
            <ul className="recent">
              {checks.map((c) => (
                <li key={c.id}>
                  <span className="id">{c.id}</span>
                  <span className={c.flagged ? "flagged" : "clear"}>{c.label}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rp-card">
          <h3>Stop and think</h3>
          <p>
            Did someone you met online promise returns on an investment? Stop and talk to someone you trust before you pay. Scam networks
            collect payments from many people into a few accounts, then pass the money on within hours.
          </p>
          <p className="footer-note">Demo: only accounts in our synthetic data can be checked. No payment is made or held by this screen.</p>
        </section>
      </div>
    </Layout>
  );
}
