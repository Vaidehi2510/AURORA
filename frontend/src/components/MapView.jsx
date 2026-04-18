import React, { useEffect, useRef } from 'react'
import styles from './MapView.module.css'

// Dynamic import of leaflet to avoid SSR issues
let L = null

const TYPE_COLOR = { cyber: '#4d8fff', physical: '#ffb830', osint: '#a855f7' }

function confidenceColor(score) {
  if (score >= 70) return '#ff4a4a'
  if (score >= 50) return '#ffb830'
  return '#4d8fff'
}

export default function MapView({ sentinel }) {
  const { events, alerts, params } = sentinel
  const mapRef     = useRef(null)
  const leafletRef = useRef(null)
  const markersRef = useRef([])
  const circlesRef = useRef([])

  // Initialize map once
  useEffect(() => {
    if (leafletRef.current) return

    import('leaflet').then(mod => {
      L = mod.default

      const map = L.map(mapRef.current, {
        center: [38.90, -77.07],
        zoom: 12,
        zoomControl: true,
        attributionControl: false,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '',
        maxZoom: 18,
      }).addTo(map)

      leafletRef.current = map
    })

    return () => {
      if (leafletRef.current) {
        leafletRef.current.remove()
        leafletRef.current = null
      }
    }
  }, [])

  // Update markers when events change
  useEffect(() => {
    if (!leafletRef.current || !L) return

    const map = leafletRef.current
    const now = Date.now()
    const windowMs = params.timeWindowMin * 60_000

    // Remove old event markers
    markersRef.current.forEach(m => map.removeLayer(m))
    markersRef.current = []

    // Draw recent raw events
    const recent = events.filter(e => now - e.timestamp < windowMs)
    recent.forEach(ev => {
      const color = TYPE_COLOR[ev.type] ?? '#888'
      const marker = L.circleMarker([ev.lat, ev.lng], {
        radius: 5,
        fillColor: color,
        color: color,
        fillOpacity: 0.75,
        weight: 1,
        opacity: 0.9,
      })
      marker.bindPopup(`
        <div style="font-family:IBM Plex Mono,monospace;font-size:11px;color:#e8eaf0;min-width:200px">
          <div style="font-weight:500;margin-bottom:4px">${ev.title}</div>
          <div style="color:#9aa0b0">${ev.detail}</div>
          <div style="margin-top:6px;font-size:10px;color:#5a6070">
            ${ev.type.toUpperCase()} · ${ev.severity} · ${ev.region}
          </div>
        </div>
      `)
      marker.addTo(map)
      markersRef.current.push(marker)
    })

    // Remove old alert circles
    circlesRef.current.forEach(c => map.removeLayer(c))
    circlesRef.current = []

    // Draw correlated incident zones
    alerts.forEach(inc => {
      if (!inc.events.length) return
      const lats = inc.events.map(e => e.lat)
      const lngs = inc.events.map(e => e.lng)
      const centerLat = lats.reduce((a, b) => a + b, 0) / lats.length
      const centerLng = lngs.reduce((a, b) => a + b, 0) / lngs.length
      const color = confidenceColor(inc.score)
      const radiusM = Math.max(400, params.geoRadiusMi * 1609 * 0.6)

      const circle = L.circle([centerLat, centerLng], {
        radius: radiusM,
        color,
        fillColor: color,
        fillOpacity: 0.06,
        weight: 1.5,
        dashArray: '4 4',
        opacity: 0.7,
      })

      const headline = inc.llmData?.headline ?? `Correlated activity — ${inc.region}`
      circle.bindPopup(`
        <div style="font-family:IBM Plex Mono,monospace;font-size:11px;color:#e8eaf0;min-width:220px">
          <div style="font-weight:500;margin-bottom:6px">${headline}</div>
          <div style="color:#ffb830;margin-bottom:4px">Confidence: ${inc.score}%</div>
          <div style="color:#9aa0b0;font-size:10px">${inc.events.length} signals · ${inc.region}</div>
        </div>
      `)

      circle.addTo(map)
      circlesRef.current.push(circle)
    })
  }, [events, alerts, params])

  return (
    <div className={styles.view}>
      <div className={styles.mapWrap} ref={mapRef} />

      <div className={styles.legend}>
        <div className={styles.legendTitle}>SIGNAL TYPES</div>
        {Object.entries(TYPE_COLOR).map(([type, color]) => (
          <div key={type} className={styles.legendRow}>
            <span className={styles.legendDot} style={{ background: color }} />
            <span>{type.charAt(0).toUpperCase() + type.slice(1)}</span>
          </div>
        ))}

        <div className={styles.legendTitle} style={{ marginTop: 14 }}>CONFIDENCE ZONES</div>
        {[['≥70% High', '#ff4a4a'], ['40–70% Med', '#ffb830'], ['<40% Low', '#4d8fff']].map(([label, color]) => (
          <div key={label} className={styles.legendRow}>
            <span className={styles.legendRing} style={{ borderColor: color }} />
            <span>{label}</span>
          </div>
        ))}

        <div className={styles.legendNote}>
          Dashed circles = correlated incident zones.<br />
          Solid dots = raw signals within time window.
        </div>

        <div className={styles.statsBlock}>
          <div className={styles.statLine}>
            <span>Active alerts</span>
            <span className={styles.statVal}>{sentinel.alerts.length}</span>
          </div>
          <div className={styles.statLine}>
            <span>Signals shown</span>
            <span className={styles.statVal}>
              {sentinel.events.filter(e => Date.now() - e.timestamp < sentinel.params.timeWindowMin * 60_000).length}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
