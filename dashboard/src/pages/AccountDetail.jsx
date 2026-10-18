import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAccount } from '../services/api'
import { featureLabel, ROLE_COLORS } from '../lib/constants'
import Layout from './Layout'
import './AccountDetail.css'
import InfoTip from "../components/InfoTip";

export default function AccountDetail() {
  const { accountId } = useParams()
  const [account, setAccount] = useState(null)
  const [usingMock, setUsingMock] = useState(true)

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

  if (!account) return (
    <Layout usingMock={usingMock}>
      <div className="empty">Loading account…</div>
    </Layout>
  )

  const role = account.role || 'unknown'
  const ringId = account.ring_id

  return (
    <Layout usingMock={usingMock}>
      <div className="account-detail">
        <div className="crumb">
          <Link to="/monitor">Rings</Link>
          {ringId ? <> / <Link to={`/ring/${ringId}`}>{ringId}</Link></> : null}
          {' / '} <span>{account.account_id}</span>
        </div>

        <div className="acct-head">
          <div className="acct-id">{account.account_id}</div>
          <div
            className="acct-role"
            style={{ color: ROLE_COLORS[role] }}
          >
            {role}
          </div>
          <div className="acct-risk">
            Risk {(account.risk * 100).toFixed(0)}
            <div className="risk-bar">
              <span style={{ width: `${Math.round(account.risk * 100)}%`, background: ROLE_COLORS[role] }} />
            </div>
          </div>
        </div>

        <div className="acct-neighborhood">
          <h3>Neighborhood <InfoTip k="neighborhood" /></h3>
          <div className="nb-grid">
            <div className="nb-cell"><b>{account.neighborhood?.in_degree ?? '—'}</b><span>in</span></div>
            <div className="nb-cell"><b>{account.neighborhood?.out_degree ?? '—'}</b><span>out</span></div>
            <div className="nb-cell"><b>{account.neighborhood?.ring_size ?? '—'}</b><span>ring size</span></div>
          </div>
        </div>

        <div className="acct-reasons">
          <h3>Why flagged <InfoTip k="whyFlagged" /></h3>
          <ul className="reason-list">
            {(account.reasons || []).map((r, i) => (
              <li key={i} className="reason-item">
                <span className="reason-features">
                  <span className="reason-rank">{i + 1}</span>
                  <span>{r.label || featureLabel(r.feature)}</span>
                </span>
                <span className="reason-value">{r.contribution > 0 ? '+' : ''}{r.contribution.toFixed(2)}</span>
              </li>
            ))}
            {(!account.reasons || account.reasons.length === 0) && (
              <div className="empty">No explanation available.</div>
            )}
          </ul>
        </div>

        <div className="acct-actions">
          {ringId ? (
            <Link to={`/ring/${ringId}`}>View ring</Link>
          ) : (
            <span className="footer-note">Not currently in a flagged ring.</span>
          )}
          <Link to={`/warning/${account.account_id}`} className="primary">
            Preview warning
          </Link>
        </div>
      </div>
    </Layout>
  )
}