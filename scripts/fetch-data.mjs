#!/usr/bin/env node
// Daily data fetcher for the Gigi Stocks / gilt dashboard.
// Pulls gilt yields (Bank of England), US Treasury yields, and an index/FX
// snapshot (Yahoo), computes period changes + DB-liability impact, and writes
// public/data/latest.json and public/data/history.json.
//
// All sources are free and require no API key. Run: `node scripts/fetch-data.mjs`

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'public', 'data')

const config = JSON.parse(await readFile(join(ROOT, 'dashboard.config.json'), 'utf8'))

const UA = 'Mozilla/5.0 (compatible; gigi-stocks-dashboard/1.0)'

// ---------- helpers ----------

function fmtBoeDate(d) {
  // Bank of England wants dd/Mon/yyyy, e.g. 01/Jan/2025
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${day}/${months[d.getUTCMonth()]}/${d.getUTCFullYear()}`
}

function parseBoeDate(s) {
  // "01 Jul 2026" -> Date (UTC)
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
  const [day, mon, year] = s.trim().split(/\s+/)
  return new Date(Date.UTC(Number(year), months[mon], Number(day)))
}

// Given an ascending [{date: Date, value: number}] series, return the value on
// or immediately before the target date (nearest earlier trading day).
function valueOnOrBefore(series, target) {
  let found = null
  for (const point of series) {
    if (point.date.getTime() <= target.getTime()) found = point
    else break
  }
  return found
}

function daysAgo(fromDate, n) {
  const d = new Date(fromDate.getTime())
  d.setUTCDate(d.getUTCDate() - n)
  return d
}

function round(n, dp = 4) {
  if (n == null || Number.isNaN(n)) return null
  const f = 10 ** dp
  return Math.round(n * f) / f
}

// Compute daily/weekly/monthly/YTD change in basis points for a yield series.
function computeChanges(series) {
  if (!series.length) return null
  const latest = series[series.length - 1]
  const prev = series[series.length - 2] ?? null
  const weekAgo = valueOnOrBefore(series, daysAgo(latest.date, 7))
  const monthAgo = valueOnOrBefore(series, daysAgo(latest.date, 30))
  const yearStart = valueOnOrBefore(series, new Date(Date.UTC(latest.date.getUTCFullYear(), 0, 1)))
  const bp = (a, b) => (a != null && b != null ? round((a - b) * 100, 1) : null) // % -> bp
  return {
    date: latest.date.toISOString().slice(0, 10),
    latest: round(latest.value, 4),
    changes: {
      daily: bp(latest.value, prev?.value),
      weekly: bp(latest.value, weekAgo?.value),
      monthly: bp(latest.value, monthAgo?.value),
      ytd: bp(latest.value, yearStart?.value),
    },
  }
}

// ---------- Bank of England gilt yields ----------

async function fetchBoeGilts() {
  const from = fmtBoeDate(new Date(config.historyStartDate + 'T00:00:00Z'))
  const to = fmtBoeDate(new Date())
  const codes = [config.series.gilt10y.boeCode, config.series.gilt20y.boeCode]
  const url =
    `https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes` +
    `&Datefrom=${encodeURIComponent(from)}&Dateto=${encodeURIComponent(to)}` +
    `&SeriesCodes=${codes.join(',')}&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`

  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`BoE HTTP ${res.status}`)
  const text = await res.text()

  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  const header = lines[0].split(',') // DATE,<code1>,<code2>
  const col10 = header.indexOf(config.series.gilt10y.boeCode)
  const col20 = header.indexOf(config.series.gilt20y.boeCode)
  if (col10 < 0 || col20 < 0) throw new Error('BoE: expected series columns not found: ' + lines[0])

  const s10 = []
  const s20 = []
  for (const line of lines.slice(1)) {
    const cols = line.split(',')
    const date = parseBoeDate(cols[0])
    const v10 = Number(cols[col10])
    const v20 = Number(cols[col20])
    if (!Number.isNaN(v10)) s10.push({ date, value: v10 })
    if (!Number.isNaN(v20)) s20.push({ date, value: v20 })
  }
  return { gilt10y: s10, gilt20y: s20 }
}

// ---------- US Treasury par yields ----------

async function fetchUsTreasury() {
  const now = new Date()
  const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const url =
    `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml` +
    `?data=daily_treasury_yield_curve&field_tdr_date_value_month=${yyyymm}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Treasury HTTP ${res.status}`)
  const xml = await res.text()

  // Each <entry> has <d:NEW_DATE> and <d:BC_10YEAR> / <d:BC_20YEAR>.
  const entries = xml.split('<entry>').slice(1)
  const rows = []
  for (const e of entries) {
    const date = (e.match(/<d:NEW_DATE[^>]*>([^<]+)</) || [])[1]
    const y10 = Number((e.match(/<d:BC_10YEAR[^>]*>([^<]+)</) || [])[1])
    const y20 = Number((e.match(/<d:BC_20YEAR[^>]*>([^<]+)</) || [])[1])
    if (date && !Number.isNaN(y10)) rows.push({ date: date.slice(0, 10), y10, y20 })
  }
  if (rows.length < 1) throw new Error('Treasury: no rows parsed')
  const last = rows[rows.length - 1]
  const prev = rows[rows.length - 2] ?? null
  return {
    us10y: { value: round(last.y10, 2), dailyBp: prev ? round((last.y10 - prev.y10) * 100, 1) : null },
    us20y: { value: round(last.y20, 2), dailyBp: prev ? round((last.y20 - prev.y20) * 100, 1) : null },
  }
}

// ---------- Yahoo snapshot (indices + FX) ----------

async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Yahoo ${symbol} HTTP ${res.status}`)
  const json = await res.json()
  const meta = json?.chart?.result?.[0]?.meta
  if (!meta) throw new Error(`Yahoo ${symbol}: no meta`)
  const price = meta.regularMarketPrice
  const prevClose = meta.chartPreviousClose ?? meta.previousClose
  const changePct = prevClose ? round(((price - prevClose) / prevClose) * 100, 2) : null
  return { value: round(price, 2), changePct }
}

async function fetchSnapshot() {
  const symbols = { ftse100: '^FTSE', sp500: '^GSPC', gbpusd: 'GBPUSD=X' }
  const out = {}
  for (const [key, sym] of Object.entries(symbols)) {
    try {
      out[key] = await fetchYahooQuote(sym)
    } catch (err) {
      out[key] = { value: null, changePct: null, error: String(err.message || err) }
    }
  }
  return out
}

// ---------- liability impact ----------

function liabilityImpact(changeBp) {
  // Δliability% ≈ -(duration × Δyield). +bp in yields => liabilities fall (good, green).
  if (changeBp == null) return null
  const duration = config.liabilityDurationYears
  const pct = round(-(duration * (changeBp / 100)) / 100 * 100, 2) // = -duration * changeBp/100 (in %)
  return {
    changeBp,
    liabilityChangePct: pct, // negative when yields rise
    direction: changeBp > 0 ? 'liabilities-down' : changeBp < 0 ? 'liabilities-up' : 'flat',
  }
}

// ---------- main ----------

async function main() {
  const errors = []
  const safe = async (label, fn) => {
    try {
      return await fn()
    } catch (err) {
      errors.push(`${label}: ${err.message || err}`)
      return null
    }
  }

  const gilts = await safe('BoE gilts', fetchBoeGilts)
  const us = await safe('US Treasury', fetchUsTreasury)
  const snapshot = (await safe('Yahoo snapshot', fetchSnapshot)) || {}

  const gilt10 = gilts ? computeChanges(gilts.gilt10y) : null
  const gilt20 = gilts ? computeChanges(gilts.gilt20y) : null

  const latest = {
    generatedAt: new Date().toISOString(),
    config: {
      liabilityDurationYears: config.liabilityDurationYears,
      liabilityValueGBP: config.liabilityValueGBP ?? null,
    },
    gilts: {
      gilt10y: gilt10 && { ...gilt10, label: config.series.gilt10y.label },
      gilt20y: gilt20 && { ...gilt20, label: config.series.gilt20y.label },
    },
    liabilityImpact: {
      // headline impact driven by the long (20y) daily move, per the spec
      daily: liabilityImpact(gilt20?.changes.daily ?? null),
      weekly: liabilityImpact(gilt20?.changes.weekly ?? null),
      monthly: liabilityImpact(gilt20?.changes.monthly ?? null),
      ytd: liabilityImpact(gilt20?.changes.ytd ?? null),
    },
    snapshot: {
      ftse100: snapshot.ftse100 ?? null,
      sp500: snapshot.sp500 ?? null,
      gbpusd: snapshot.gbpusd ?? null,
      us10y: us?.us10y ?? null,
      us20y: us?.us20y ?? null,
      gilt10y: gilt10 ? { value: gilt10.latest, dailyBp: gilt10.changes.daily } : null,
      gilt20y: gilt20 ? { value: gilt20.latest, dailyBp: gilt20.changes.daily } : null,
    },
    errors,
  }

  const history = {
    generatedAt: latest.generatedAt,
    gilt10y: gilts ? gilts.gilt10y.map((p) => ({ d: p.date.toISOString().slice(0, 10), v: round(p.value, 4) })) : [],
    gilt20y: gilts ? gilts.gilt20y.map((p) => ({ d: p.date.toISOString().slice(0, 10), v: round(p.value, 4) })) : [],
  }

  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(join(DATA_DIR, 'latest.json'), JSON.stringify(latest, null, 2))
  await writeFile(join(DATA_DIR, 'history.json'), JSON.stringify(history))

  console.log('Wrote public/data/latest.json and history.json')
  if (gilt10) console.log(`  10y gilt: ${gilt10.latest}%  (daily ${gilt10.changes.daily}bp, YTD ${gilt10.changes.ytd}bp)`)
  if (gilt20) console.log(`  20y gilt: ${gilt20.latest}%  (daily ${gilt20.changes.daily}bp, YTD ${gilt20.changes.ytd}bp)`)
  console.log(`  history points: ${history.gilt10y.length}`)
  if (errors.length) console.warn('  errors:', errors)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
