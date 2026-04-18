import React, { useEffect, useRef, useState } from 'react'
import styles from './TimelineView.module.css'

const TYPE_COLOR  = { cyber: '#4d8fff', physical: '#ffb830', osint: '#a855f7' }
const LANE_Y      = { cyber: 0.22, physical: 0.5, osint: 0.78 }
const FILTERS     = ['all', 'cyber', 'physical', 'osint', 'correlated']

function confidenceColor(score) {
  if (score >= 70) return '255,74,74'
  if (score >= 50) return '255,184,48'
  return '77,143,255'
}

export default function TimelineView({ sentinel }) {
  const { events, alerts, params } = sentinel
  const canvasRef   = useRef(null)
  const wrapRef     = useRef(null)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    draw()
  }, [events, alerts, params, filter])

  useEffect(() => {
    const ro = new ResizeObserver(draw)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  function draw() {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return

    const W = wrap.clientWidth  || 700
    const H = wrap.clientHeight || 300
    canvas.width  = W
    canvas.height = H

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#111318'
    ctx.fillRect(0, 0, W, H)

    const PAD_L = 80, PAD_R = 20, PAD_T = 20, PAD_B = 30
    const now    = Date.now()
    const span   = params.timeWindowMin * 2 * 60_000
    const startT = now - span

    const toX = t => PAD_L + ((t - startT) / span) * (W - PAD_L - PAD_R)
    const toY = type => PAD_T + LANE_Y[type] * (H - PAD_T - PAD_B)

    // Grid lines
    ctx.strokeStyle = '#ffffff06'
    ctx.lineWidth   = 1
    for (let t = startT; t <= now; t += span / 8) {
      const x = toX(t)
      ctx.beginPath(); ctx.moveTo(x, PAD_T); ctx.lineTo(x, H - PAD_B); ctx.stroke()
    }

    // Lane lines
    Object.entries(LANE_Y).forEach(([type, fy]) => {
      const y = PAD_T + fy * (H - PAD_T - PAD_B)
      ctx.strokeStyle = '#ffffff08'
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke()
      ctx.fillStyle = '#5a6070'
      ctx.font = '9px IBM Plex Mono, monospace'
      ctx.fillText(type.toUpperCase(), 4, y + 3)
    })

    // Time axis
    ctx.strokeStyle = '#ffffff10'
    ctx.beginPath(); ctx.moveTo(PAD_L, H - PAD_B); ctx.lineTo(W - PAD_R, H - PAD_B); ctx.stroke()
    ctx.fillStyle = '#3a4050'
    ctx.font = '9px IBM Plex Mono, monospace'
    for (let t = startT; t <= now; t += span / 4) {
      const x = toX(t)
      ctx.fillText(new Date(t).toLocaleTimeString(), x - 15, H - 6)
    }

    // Correlated zones
    if (filter === 'all' || filter === 'correlated') {
      alerts.forEach(inc => {
        const ts = inc.events.map(e => e.timestamp)
        const x1 = toX(Math.min(...ts))
        const x2 = Math.max(toX(Math.max(...ts)), x1 + 3)
        const rgb = confidenceColor(inc.score)
        ctx.fillStyle   = `rgba(${rgb},0.06)`
        ctx.fillRect(x1, PAD_T, x2 - x1, H - PAD_T - PAD_B)
        ctx.strokeStyle = `rgba(${rgb},0.35)`
        ctx.lineWidth   = 1
        ctx.setLineDash([3, 3])
        ctx.strokeRect(x1, PAD_T, x2 - x1, H - PAD_T - PAD_B)
        ctx.setLineDash([])
        // Label
        ctx.fillStyle = `rgba(${rgb},0.8)`
        ctx.font = '9px IBM Plex Mono, monospace'
        ctx.fillText(`${inc.score}%`, x1 + 3, PAD_T + 10)
      })
    }

    // Events
    const visibleEvents = filter === 'all' || filter === 'correlated'
      ? events
      : events.filter(e => e.type === filter)

    visibleEvents.filter(e => e.timestamp >= startT).forEach(ev => {
      const x = toX(ev.timestamp)
      const y = toY(ev.type)
      if (!y) return
      const color = TYPE_COLOR[ev.type] ?? '#888'
      const r = ev.severity === 'CRITICAL' ? 6 : ev.severity === 'HIGH' ? 5 : 4
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle   = color + 'cc'
      ctx.fill()
      if (ev.severity === 'CRITICAL' || ev.severity === 'HIGH') {
        ctx.strokeStyle = color
        ctx.lineWidth   = 1.5
        ctx.stroke()
      }
    })
  }

  return (
    <div className={styles.view}>
      <div className={styles.filters}>
        {FILTERS.map(f => (
          <button
            key={f}
            className={`${styles.filterBtn} ${filter === f ? styles.active : ''}`}
            onClick={() => setFilter(f)}
          >
            {f.toUpperCase()}
          </button>
        ))}
        <span className={styles.hint}>
          Dashed boxes = correlated clusters · Dots = individual signals
        </span>
      </div>
      <div className={styles.canvasWrap} ref={wrapRef}>
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>
    </div>
  )
}
