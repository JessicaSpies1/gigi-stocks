// Formatting helpers for the dashboard.

export function fmtPct(v, dp = 2) {
  if (v == null || Number.isNaN(v)) return '—'
  return `${v.toFixed(dp)}%`
}

export function fmtBp(v) {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}bp`
}

export function fmtSignedPct(v, dp = 2) {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(dp)}%`
}

// Abbreviated pounds: £1.23bn / £45.60m / £780k / £512. `signed` adds a + for positives.
export function fmtGBP(v, { signed = false } = {}) {
  if (v == null || Number.isNaN(v)) return '—'
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : signed && v > 0 ? '+' : ''
  let body
  if (abs >= 1e9) body = `£${(abs / 1e9).toFixed(2)}bn`
  else if (abs >= 1e6) body = `£${(abs / 1e6).toFixed(2)}m`
  else if (abs >= 1e3) body = `£${(abs / 1e3).toFixed(0)}k`
  else body = `£${abs.toFixed(0)}`
  return `${sign}${body}`
}

export function fmtNumber(v, dp = 2) {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

export function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Direction arrow for a numeric change.
export function arrow(v) {
  if (v == null || v === 0) return '→'
  return v > 0 ? '▲' : '▼'
}
