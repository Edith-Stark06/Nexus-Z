import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import Layout from "./Layout";
import RoleGlyph from "../components/RoleGlyph";
import { useTopAccounts } from "../state/hooks";
import { useData } from "../state/DataContext";
import { accountScore, ACCOUNT_SCORE_NOTE, ROLE_NOTE } from "../lib/scores";
import "./Accounts.css";

// The API has no "list all accounts" route, only GET /accounts/{id}. So this page offers an exact lookup, and below it the
// highest-scored members of the top flagged rings, which come from real GET /rings/{id} answers.
export default function Accounts() {
  const navigate = useNavigate();
  const { mode } = useData();
  const [q, setQ] = useState("");
  const top = useTopAccounts(5, 20);

  const go = (e) => {
    e.preventDefault();
    const id = q.trim();
    if (id) navigate(`/account/${encodeURIComponent(id)}`);
  };

  return (
    <Layout title="Accounts" subtitle="Look up an account to see its score, estimated role, payments and the reasons behind its score.">
      <div className="acs">
        <form className="acs-lookup" onSubmit={go} role="search" aria-label="Look up an account">
          <label className="acs-field">
            <span className="eyebrow">Account id</span>
            <span className="acs-input">
              <Search size={14} aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Paste an account id" aria-label="Account id" autoComplete="off" spellCheck={false} />
            </span>
          </label>
          <button className="primary" type="submit" disabled={!q.trim()}>Look up</button>
        </form>
        <p className="acs-note">
          The API answers for one account at a time and has no list of all accounts. An account it does not know is not the same as a safe account: it only scores accounts
          active in its window.
        </p>

        <section aria-labelledby="acs-top" className="acs-sec">
          <h2 id="acs-top">Highest-scored accounts in the top flagged rings</h2>
          <p className="acs-sub">
            Built from the members of the 5 highest-scored rings the API returned. Account score is on a 0–1 scale. {ROLE_NOTE}
          </p>
          {top.phase === "loading" && <div className="acs-skel" aria-busy="true">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skel" />)}</div>}
          {top.phase === "error" && (
            <div className="empty"><strong>{mode === "unreachable" ? "The API is not reachable." : "Could not load the rings."}</strong>See the notice above to retry.</div>
          )}
          {top.phase === "empty" && <div className="empty"><strong>The API returned no rings.</strong>Accounts appear here when the model flags a ring.</div>}
          {top.phase === "ready" && (
            <div className="acs-table">
              <table className="tbl">
                <caption className="sr-only">Highest-scored accounts in the top flagged rings</caption>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Estimated role</th>
                    <th scope="col" className="r" title={ACCOUNT_SCORE_NOTE}>Account score (0–1)</th>
                    <th scope="col">Ring</th>
                  </tr>
                </thead>
                <tbody>
                  {top.accounts.map((a) => (
                    <tr key={a.id}>
                      <td className="id"><Link to={`/account/${encodeURIComponent(a.id)}`}>{a.id}</Link></td>
                      <td><RoleGlyph role={a.role} label /></td>
                      <td className="r num mono">{accountScore(a.score)}</td>
                      <td className="id"><Link to={`/ring/${a.ring_id}?account=${encodeURIComponent(a.id)}`}>{a.ring_id}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {top.failed > 0 && top.phase === "ready" && <p className="acs-sub">{top.failed} of the top rings could not be loaded and are not included.</p>}
        </section>
      </div>
    </Layout>
  );
}
