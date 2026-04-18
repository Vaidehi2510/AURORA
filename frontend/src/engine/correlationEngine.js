import { SOURCE_RELIABILITY } from '../data/constants.js'

// ── Geo distance (Haversine) ────────────────────────────────────
export function geoDistanceMiles(lat1, lng1, lat2, lng2) {
  const R    = 3958.8
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Time span (ms → minutes) ────────────────────────────────────
function spanMinutes(events) {
  const ts = events.map(e => e.timestamp)
  return (Math.max(...ts) - Math.min(...ts)) / 60_000
}

// ── Max pairwise geo distance ───────────────────────────────────
function maxDistMiles(events) {
  let max = 0
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const d = geoDistanceMiles(events[i].lat, events[i].lng, events[j].lat, events[j].lng)
      if (d > max) max = d
    }
  }
  return max
}

// ── Severity numeric weight ─────────────────────────────────────
function severityWeight(severity) {
  return { CRITICAL: 1.0, HIGH: 0.75, MED: 0.5, LOW: 0.25 }[severity] ?? 0.25
}

/**
 * Compute a 0–100 confidence score for a cluster of events.
 * Factors (weighted sum):
 *   1. Temporal proximity    — 25 pts
 *   2. Geographic proximity  — 20 pts
 *   3. Domain diversity      — 25 pts
 *   4. Severity weighting    — 20 pts
 *   5. Pattern match bonus   — 10 pts
 */
export function computeConfidence(events, params) {
  if (!events || events.length < 2) return 0

  const types      = new Set(events.map(e => e.type))
  const span       = spanMinutes(events)
  const maxDist    = maxDistMiles(events)

  // 1. Temporal — full score if within half the window
  const temporalRatio = Math.max(0, 1 - span / params.timeWindowMin)
  const temporal      = Math.round(25 * temporalRatio)

  // 2. Geographic — full score if co-located
  const geoRatio   = Math.max(0, 1 - maxDist / params.geoRadiusMi)
  const geographic = Math.round(20 * geoRatio)

  // 3. Domain diversity — 3 domains = full, 2 = partial, 1 = minimal
  const diversity  = types.size >= 3 ? 25 : types.size === 2 ? 17 : 5

  // 4. Severity — average severity weight scaled to 20 pts
  const avgSev     = events.reduce((s, e) => s + severityWeight(e.severity), 0) / events.length
  const severity   = Math.round(20 * avgSev)

  // 5. Pattern bonus — cyber + physical is the most suspicious pairing
  const hasCyber   = types.has('cyber')
  const hasPhysical= types.has('physical')
  const hasOsint   = types.has('osint')
  const pattern    = hasCyber && hasPhysical ? 10 : hasCyber && hasOsint ? 6 : hasPhysical && hasOsint ? 4 : 0

  // Source reliability weighting
  const avgReliability = events.reduce((s, e) => s + (SOURCE_RELIABILITY[e.type] ?? 0.5), 0) / events.length
  const raw     = temporal + geographic + diversity + severity + pattern
  const adjusted = Math.round(raw * avgReliability)

  return Math.min(100, Math.max(5, adjusted))
}

/**
 * Decompose confidence into named factor scores for the explainability panel.
 */
export function explainConfidence(events, params) {
  if (!events || events.length < 2) return null

  const types      = new Set(events.map(e => e.type))
  const span       = spanMinutes(events)
  const maxDist    = maxDistMiles(events)

  const temporalPct   = Math.round(100 * Math.max(0, 1 - span / params.timeWindowMin))
  const geoPct        = Math.round(100 * Math.max(0, 1 - maxDist / params.geoRadiusMi))
  const diversityPct  = types.size >= 3 ? 100 : types.size === 2 ? 67 : 20
  const avgSev        = events.reduce((s, e) => s + severityWeight(e.severity), 0) / events.length
  const severityPct   = Math.round(100 * avgSev)
  const hasCyber      = types.has('cyber')
  const hasPhysical   = types.has('physical')
  const patternPct    = hasCyber && hasPhysical ? 100 : types.size >= 2 ? 55 : 20

  return {
    temporal:     { score: temporalPct,  label: 'Temporal proximity',   desc: `${span.toFixed(1)} min span vs ${params.timeWindowMin} min window` },
    geographic:   { score: geoPct,       label: 'Geographic proximity', desc: `${maxDist.toFixed(2)} mi max spread vs ${params.geoRadiusMi} mi radius` },
    diversity:    { score: diversityPct, label: 'Domain diversity',      desc: `${types.size} of 3 domains: ${[...types].join(', ')}` },
    severity:     { score: severityPct,  label: 'Severity weighting',   desc: `Average severity weight: ${(avgSev * 100).toFixed(0)}%` },
    patternMatch: { score: patternPct,   label: 'Pattern match',        desc: hasCyber && hasPhysical ? 'Cyber + physical — high-risk pairing' : 'Partial domain pairing' },
    spanMin:      parseFloat(span.toFixed(1)),
    maxDistMi:    parseFloat(maxDist.toFixed(2)),
    types:        [...types],
  }
}

/**
 * Main correlation function.
 * Groups recent events by region, clusters multi-domain groups,
 * and returns CorrelatedIncident objects above the confidence threshold.
 *
 * @param {RawEvent[]} events
 * @param {{ timeWindowMin, geoRadiusMi, minConfidence }} params
 * @returns {CorrelatedIncident[]}
 */
export function correlateEvents(events, params) {
  const now      = Date.now()
  const windowMs = params.timeWindowMin * 60_000

  // Only look at events within the time window
  const recent = events.filter(e => now - e.timestamp < windowMs)

  // Group by region name (primary spatial key)
  const byRegion = {}
  recent.forEach(e => {
    if (!byRegion[e.region]) byRegion[e.region] = []
    byRegion[e.region].push(e)
  })

  const incidents = []

  Object.entries(byRegion).forEach(([region, evts]) => {
    const types = new Set(evts.map(e => e.type))
    if (evts.length < 2 || types.size < 2) return

    const score = computeConfidence(evts, params)
    if (score < params.minConfidence) return

    incidents.push({
      id:        `inc-${region.replace(/\W/g, '')}-${evts.length}`,
      region,
      events:    evts,
      score,
      timestamp: Math.min(...evts.map(e => e.timestamp)),
      updatedAt: Date.now(),
      llmData:   null,
      llmLoading:false,
      note:      '',
    })
  })

  return incidents.sort((a, b) => b.score - a.score)
}
