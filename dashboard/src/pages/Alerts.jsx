import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { startPolling } from '../services/api'
import { formatDateTime, relativeTime, SEVERITY_COLORS } from '../lib/constants'
import Layout from './Layout'
import './Alerts.css'

export default function Alerts() {
  const [alerts, setAlerts] = useState([])
  const [usingMock, setUsingMock] = useState(true)

  useEffect(() => {
    const stop = startPolling(({ alerts, usingMock }) => {
      setAlerts(alerts)
      setUsingMock(usingMock)
    })
    return stop
  }, [])

  const rings = alerts.filter((a) => a.type === 'ring')
  const victims = alerts.filter((a) => a.type === 'victim_warning')

  return (
    <Layout usingMock={usingMock}>
      <div className="alerts">
        <section className="panel">
          <div className="panel-head">
            <h2>Ring alerts</h2>
            <span className="badge">{rings.length} active</span>
          </div>
          {rings.length === 0 ? (
            <div className="empty">No ring alerts yet.</div>
          ) : (
            <table className="alert-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Ring</th>
                  <th>Severity</th>
                  <th>Summary</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rings.map((a) => (
                  <tr key={a.alert_id}>
                    <td className="time">{relativeTime(a.ts)}</td>
                    <td>
                      <Link to={`/ring/${a.ring_id}`}>{a.ring_id}</Link>
                    </td>
                    <td>
                      <span
                        className="severity-dot"
                        style={{ background: SEVERITY_COLORS[a.severity] }}
                      />
                      {a.severity}
                    </td>
                    <td>{a.message}</td>
                    <td>
                      <Link to={`/ring/${a.ring_id}`}>Inspect</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Victim warnings</h2>
            <span className="badge">{victims.length} sent</span>
          </div>
          {victims.length === 0 ? (
            <div className="empty">No victim warnings sent yet.</div>
          ) : (
            <table className="alert-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Account</th>
                  <th>Ring</th>
                  <th>Severity</th>
                  <th>Message</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {victims.map((a) => (
                  <tr key={a.alert_id}>
                    <td className="time">{relativeTime(a.ts)}</td>
                    <td>
                      <Link to={`/account/${a.account_id}`}>{a.account_id}</Link>
                    </td>
                    <td>
                      <Link to={`/ring/${a.ring_id}`}>{a.ring_id}</Link>
                    </td>
                    <td>
                      <span
                        className="severity-dot"
                        style={{ background: SEVERITY_COLORS[a.severity] }}
                      />
                      {a.severity}
                    </td>
                    <td>{a.message}</td>
                    <td>
                      <Link to={`/warning/${a.account_id}`}>Preview</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </Layout>
  )
}