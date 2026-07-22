import { useEffect, useState } from 'react'
import LineChart from './components/LineChart'
import { fmtPct, fmtBp, fmtSignedPct, fmtNumber, fmtGBP, fmtDate, arrow } from './lib/format'
import './App.css'

const CHART_COLORS = { gilt10y: '#4f9dde', gilt20y: '#8b7ff0' }

async function loadJson(path) {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${path}`)
  if (!res.ok) throw new Error(`Failed to load ${path}`)
  return res.json()
}

export default function App() {
  const [latest, setLatest] = useState(null)
  const [history, setHistory] = useState(null)
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)
  const [duration, setDuration] = useState(null)
  const [liabilityValue, setLiabilityValue] = useState(null)

  useEffect(() => {
    Promise.all([loadJson('latest.json'), loadJson('history.json'), loadJson('market-summary.json')])
      .then(([l, h, s]) => {
        setLatest(l)
        setHistory(h)
        setSummary(s)
        const savedDur = localStorage.getItem('liabilityDuration')
        setDuration(savedDur != null ? Number(savedDur) : l.config.liabilityDurationYears)
        const savedVal = localStorage.getItem('liabilityValue')
        setLiabilityValue(savedVal != null ? Number(savedVal) : (l.config.liabilityValueGBP ?? 0))
      })
      .catch((e) => setError(e.message))
  }, [])

  function updateDuration(v) {
    if (Number.isNaN(v)) return
    const clamped = Math.min(50, Math.max(1, v))
    setDuration(clamped)
    localStorage.setItem('liabilityDuration', String(clamped))
  }

  function updateLiabilityValue(v) {
    if (Number.isNaN(v)) return
    const clamped = Math.max(0, v)
    setLiabilityValue(clamped)
    localStorage.setItem('liabilityValue', String(clamped))
  }

  if (error) return <div className="app"><div className="banner error">Could not load data: {error}. Run <code>node scripts/fetch-data.mjs</code> first.</div></div>
  if (!latest) return <div className="app"><div className="loading">Loading dashboard…</div></div>

  const g10 = latest.gilts.gilt10y
  const g20 = latest.gilts.gilt20y

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>UK Gilt & DB Liability Dashboard</h1>
          <p className="sub">Defined-benefit pension market overview</p>
        </div>
        <div className="asof">
          <span>Yields as of</span>
          <strong>{fmtDate(g20?.date)}</strong>
          <span className="tiny">Updated {fmtDate(latest.generatedAt)}</span>
        </div>
      </header>

      {/* 1. What happened — headline yields */}
      <section className="grid-2">
        <YieldCard data={g10} color={CHART_COLORS.gilt10y} />
        <YieldCard data={g20} color={CHART_COLORS.gilt20y} />
      </section>

      {/* 2. What it means — liability impact */}
      <LiabilityPanel
        impact={latest.liabilityImpact}
        duration={duration ?? latest.config.liabilityDurationYears}
        defaultDuration={latest.config.liabilityDurationYears}
        onDurationChange={updateDuration}
        liabilityValue={liabilityValue ?? (latest.config.liabilityValueGBP ?? 0)}
        onLiabilityValueChange={updateLiabilityValue}
      />

      {/* Charts */}
      <section className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2><span className="swatch" style={{ background: CHART_COLORS.gilt10y }} />10-Year Gilt Yield</h2>
            <span className="card-latest">{fmtPct(g10?.latest)}</span>
          </div>
          <LineChart data={history?.gilt10y} color={CHART_COLORS.gilt10y} />
        </div>
        <div className="card">
          <div className="card-head">
            <h2><span className="swatch" style={{ background: CHART_COLORS.gilt20y }} />20-Year Gilt Yield</h2>
            <span className="card-latest">{fmtPct(g20?.latest)}</span>
          </div>
          <LineChart data={history?.gilt20y} color={CHART_COLORS.gilt20y} />
        </div>
      </section>

      {/* Market snapshot */}
      <MarketSnapshot snapshot={latest.snapshot} />

      {/* 3. Why it happened — market summary */}
      <MarketSummary summary={summary} />

      <footer className="footer">
        <p>
          Sources: Bank of England (gilts), US Treasury, Yahoo Finance (indices/FX). For information only — not investment advice.
        </p>
        {latest.errors?.length > 0 && <p className="warn">Data warnings: {latest.errors.join('; ')}</p>}
      </footer>
    </div>
  )
}

function YieldCard({ data, color }) {
  if (!data) return <div className="card">No data</div>
  const periods = [
    ['1D', data.changes.daily],
    ['1W', data.changes.weekly],
    ['1M', data.changes.monthly],
    ['YTD', data.changes.ytd],
  ]
  return (
    <div className="card yield-card">
      <div className="card-head">
        <h2><span className="swatch" style={{ background: color }} />{data.label}</h2>
      </div>
      <div className="yield-hero" style={{ color }}>{fmtPct(data.latest)}</div>
      <div className="period-row">
        {periods.map(([label, bp]) => (
          <div key={label} className="period">
            <span className="period-label">{label}</span>
            <span className={`period-val ${bp > 0 ? 'up' : bp < 0 ? 'down' : ''}`}>
              {arrow(bp)} {fmtBp(bp)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function LiabilityPanel({ impact, duration, defaultDuration, onDurationChange, liabilityValue, onLiabilityValueChange }) {
  // Δliability% ≈ −(duration × Δyield). changeBp is the 20y gilt move for the period.
  const calc = (bp) => (bp == null ? null : Math.round((-(duration * bp) / 100) * 100) / 100)
  // £ impact = liability value × %change.
  const gbp = (pct) => (pct == null || !liabilityValue ? null : (liabilityValue * pct) / 100)

  const dailyBp = impact?.daily?.changeBp ?? null
  const dailyPct = calc(dailyBp)
  const dailyGbp = gbp(dailyPct)
  const good = dailyBp > 0
  const bad = dailyBp < 0
  const state = good ? 'good' : bad ? 'bad' : 'flat'
  const periods = [
    ['Daily', impact?.daily?.changeBp],
    ['Weekly', impact?.weekly?.changeBp],
    ['Monthly', impact?.monthly?.changeBp],
    ['YTD', impact?.ytd?.changeBp],
  ]

  return (
    <section className={`card liability ${state}`}>
      <div className="card-head">
        <h2>Impact on DB Scheme Liabilities</h2>
      </div>

      <div className="liability-controls">
        <div className="control-field">
          <label htmlFor="dur">Liability duration</label>
          <div className="input-inline">
            <input
              id="dur"
              type="number"
              min="1"
              max="50"
              step="0.5"
              value={duration}
              onChange={(e) => onDurationChange(Number(e.target.value))}
              aria-label="Liability duration in years"
            />
            <span className="unit">years</span>
          </div>
        </div>
        <div className="control-field">
          <label htmlFor="lval">Total scheme liabilities</label>
          <div className="input-inline">
            <span className="unit prefix">£</span>
            <input
              id="lval"
              type="number"
              min="0"
              step="1000000"
              value={liabilityValue}
              onChange={(e) => onLiabilityValueChange(Number(e.target.value))}
              aria-label="Total scheme liability value in pounds"
            />
            <span className="unit echo">{fmtGBP(liabilityValue)}</span>
          </div>
        </div>
      </div>

      <div className="liability-headline">
        {dailyBp != null ? (
          <>
            <span className="liability-icon">{good ? '▲' : bad ? '▼' : '→'}</span>
            <span className="liability-text">
              {good && <>Yields rose today — liabilities estimated <strong>down ~{Math.abs(dailyPct)}%</strong>{dailyGbp != null && <> (<strong>{fmtGBP(Math.abs(dailyGbp))}</strong>)</>}</>}
              {bad && <>Yields fell today — liabilities estimated <strong>up ~{Math.abs(dailyPct)}%</strong>{dailyGbp != null && <> (<strong>{fmtGBP(Math.abs(dailyGbp))}</strong>)</>}</>}
              {!good && !bad && <>No material change in long yields today</>}
            </span>
          </>
        ) : (
          <span className="liability-text">Liability impact unavailable</span>
        )}
      </div>

      <div className="liability-grid">
        {periods.map(([label, bp]) => {
          const pct = calc(bp)
          const amount = gbp(pct)
          return (
            <div key={label} className="liability-cell">
              <span className="period-label">{label} (20y move)</span>
              <span className="liability-bp">{fmtBp(bp)}</span>
              {amount != null && (
                <span className={`liability-gbp ${pct < 0 ? 'good' : pct > 0 ? 'bad' : ''}`}>{fmtGBP(amount, { signed: true })}</span>
              )}
              <span className={`liability-pct ${pct < 0 ? 'good' : pct > 0 ? 'bad' : ''}`}>
                Liabilities {fmtSignedPct(pct)}
              </span>
            </div>
          )
        })}
      </div>

      <p className="liability-note">
        Estimate uses Δliability ≈ −(duration × Δyield){defaultDuration != null && duration !== defaultDuration ? `, default ${defaultDuration}y` : ''}. Enter your scheme's duration and liability value above — both are saved on this device.
      </p>
    </section>
  )
}

function MarketSnapshot({ snapshot }) {
  const equities = [
    ['FTSE 100', snapshot.ftse100, 'pct'],
    ['S&P 500', snapshot.sp500, 'pct'],
    ['GBP / USD', snapshot.gbpusd, 'pct'],
  ]
  const yields = [
    ['UK 10y', snapshot.gilt10y],
    ['UK 20y', snapshot.gilt20y],
    ['US 10y', snapshot.us10y],
    ['US 20y', snapshot.us20y],
  ]
  return (
    <section className="card">
      <div className="card-head"><h2>Market Snapshot</h2></div>
      <div className="snapshot-grid">
        {equities.map(([label, d]) => (
          <div key={label} className="snap-tile">
            <span className="snap-label">{label}</span>
            <span className="snap-value">{fmtNumber(d?.value)}</span>
            <span className={`snap-change ${d?.changePct > 0 ? 'up' : d?.changePct < 0 ? 'down' : ''}`}>
              {arrow(d?.changePct)} {fmtSignedPct(d?.changePct)}
            </span>
          </div>
        ))}
        {yields.map(([label, d]) => (
          <div key={label} className="snap-tile">
            <span className="snap-label">{label} yield</span>
            <span className="snap-value">{fmtPct(d?.value)}</span>
            <span className={`snap-change ${d?.dailyBp > 0 ? 'up' : d?.dailyBp < 0 ? 'down' : ''}`}>
              {arrow(d?.dailyBp)} {fmtBp(d?.dailyBp)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function MarketSummary({ summary }) {
  return (
    <section className="card summary">
      <div className="card-head">
        <h2>Market Summary — Why did it happen?</h2>
        {summary?.date && <span className="assumption">{fmtDate(summary.date)}</span>}
      </div>
      {summary?.headline && <p className="summary-headline">{summary.headline}</p>}
      <ul className="summary-list">
        {(summary?.bullets ?? []).map((b, i) => <li key={i}>{b}</li>)}
      </ul>
      {summary?.sources?.length > 0 && (
        <p className="summary-sources">Sources: {summary.sources.join(', ')}</p>
      )}
    </section>
  )
}
