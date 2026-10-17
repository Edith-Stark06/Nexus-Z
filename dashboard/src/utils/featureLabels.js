export function mapFeatureToLabel(feature) {
  if (!feature) return feature
  const mapping = {
    in_degree: 'Many accounts paying in',
    pass_through_min: 'Money leaves within minutes',
    pass_through_minutes: 'Money leaves within minutes',
    fan_in_ratio: 'Many payers, few receivers',
    account_age_days: 'Accounts opened recently',
    burst_timing: 'Deposits arrive in bursts',
    account_history: 'One mule has a long history',
    night_burst: 'Unusual night activity',
    crypto_exchange_contact: 'Linked to crypto exchange'
  }
  return mapping[feature] || feature
}

export function formatTimeRelative(ts) {
  if (!ts) return ''
  try {
    const now = new Date()
    const then = new Date(ts)
    const diffMs = now - then
    const diffSec = Math.floor(diffMs / 1000)
    if (diffSec < 60) return `${diffSec}s ago`
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHour = Math.floor(diffMin / 60)
    if (diffHour < 24) return `${diffHour}h ago`
    const diffDay = Math.floor(diffHour / 24)
    return `${diffDay}d ago`
  } catch (e) {
    return ''
  }
}
