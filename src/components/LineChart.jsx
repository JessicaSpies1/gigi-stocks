import { useMemo, useRef, useState } from 'react'
import { fmtDate } from '../lib/format'

// Lightweight dependency-free SVG line chart with a hover crosshair + tooltip.
// data: [{ d: 'YYYY-MM-DD', v: number }] ascending by date. Single series.
export default function LineChart({ data, color = '#4f9dde', unit = '%', height = 220 }) {
  const wrapRef = useRef(null)
  const [hover, setHover] = useState(null) // index into data
  const width = 640 // viewBox width; scales responsively via CSS
  const pad = { top: 16, right: 16, bottom: 26, left: 44 }

  const geom = useMemo(() => {
    if (!data || data.length === 0) return null
    const values = data.map((p) => p.v)
    let min = Math.min(...values)
    let max = Math.max(...values)
    const span = max - min || 1
    min -= span * 0.08
    max += span * 0.08
    const innerW = width - pad.left - pad.right
    const innerH = height - pad.top - pad.bottom
    const x = (i) => pad.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW)
    const y = (v) => pad.top + innerH - ((v - min) / (max - min)) * innerH
    const points = data.map((p, i) => [x(i), y(p.v)])
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
    const areaPath = `${path} L${points[points.length - 1][0].toFixed(1)},${(pad.top + innerH).toFixed(1)} L${points[0][0].toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`
    // ~4 gridline ticks
    const ticks = []
    for (let t = 0; t <= 4; t++) {
      const val = min + ((max - min) * t) / 4
      ticks.push({ val, y: y(val) })
    }
    return { x, y, points, path, areaPath, min, max, innerH, ticks }
  }, [data, height])

  if (!geom) {
    return <div className="chart-empty">No data available</div>
  }

  function handleMove(e) {
    const rect = wrapRef.current.getBoundingClientRect()
    const relX = ((e.clientX - rect.left) / rect.width) * width
    const innerW = width - pad.left - pad.right
    let i = Math.round(((relX - pad.left) / innerW) * (data.length - 1))
    i = Math.max(0, Math.min(data.length - 1, i))
    setHover(i)
  }

  const hp = hover != null ? data[hover] : null
  const hx = hover != null ? geom.points[hover][0] : null
  const hy = hover != null ? geom.points[hover][1] : null

  return (
    <div className="chart" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`fill-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {geom.ticks.map((t, i) => (
          <g key={i}>
            <line className="grid" x1={pad.left} y1={t.y} x2={width - pad.right} y2={t.y} />
            <text className="axis-label" x={pad.left - 8} y={t.y + 3} textAnchor="end">
              {t.val.toFixed(2)}
            </text>
          </g>
        ))}

        <path d={geom.areaPath} fill={`url(#fill-${color.replace('#', '')})`} />
        <path d={geom.path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />

        {hover != null && (
          <g>
            <line className="crosshair" x1={hx} y1={pad.top} x2={hx} y2={height - pad.bottom} />
            <circle cx={hx} cy={hy} r="4.5" fill={color} stroke="var(--surface)" strokeWidth="2" />
          </g>
        )}
      </svg>

      {hp && (
        <div
          className="chart-tooltip"
          style={{ left: `${(hx / width) * 100}%`, transform: hx > width / 2 ? 'translateX(-105%)' : 'translateX(5%)' }}
        >
          <div className="tt-date">{fmtDate(hp.d)}</div>
          <div className="tt-val">
            {hp.v.toFixed(3)}
            {unit}
          </div>
        </div>
      )}
    </div>
  )
}
