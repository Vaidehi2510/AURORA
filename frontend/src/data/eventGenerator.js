import {
  EVENT_TYPES, REGIONS,
  CYBER_CATALOG, PHYSICAL_CATALOG, OSINT_CATALOG,
} from './constants.js'

const rand  = (a, b) => a + Math.random() * (b - a)
const pick  = arr => arr[Math.floor(Math.random() * arr.length)]
const uid   = () => Math.random().toString(36).slice(2, 10)

/**
 * Build a single RawEvent of the given type, optionally locked to a region index.
 * @param {'cyber'|'physical'|'osint'} type
 * @param {number|null} regionIdx  – pass null for random region
 * @param {number|null} timestampOverride – for scenario injection
 */
export function makeEvent(type, regionIdx = null, timestampOverride = null) {
  const region  = REGIONS[regionIdx ?? Math.floor(Math.random() * REGIONS.length)]
  const catalog = type === EVENT_TYPES.CYBER    ? CYBER_CATALOG
                : type === EVENT_TYPES.PHYSICAL ? PHYSICAL_CATALOG
                : OSINT_CATALOG

  const template = pick(catalog)
  const jitter   = type === EVENT_TYPES.OSINT ? 0.012 : 0.006

  return {
    id:        uid(),
    type,
    timestamp: timestampOverride ?? Date.now(),
    region:    region.name,
    lat:       region.lat + rand(-jitter, jitter),
    lng:       region.lng + rand(-jitter, jitter),
    title:     template.title,
    detail:    template.detail,
    severity:  template.severity,
  }
}

// ── Pre-built Demo Scenarios ────────────────────────────────────

/**
 * Scenario 1 — Critical Infrastructure Disturbance
 * High confidence: cyber + physical + osint all pointing at same facility
 */
export function scenarioInfrastructure() {
  const now = Date.now()
  const ri  = 0 // Arlington, VA
  return [
    { ...makeEvent('cyber',    ri, now - 1000 * 60 * 18), title: 'Unusual outbound traffic — SCADA network',    severity: 'HIGH',     detail: 'Data exfil pattern from OT subnet to external IP' },
    { ...makeEvent('cyber',    ri, now - 1000 * 60 * 15), title: 'Firewall override on grid control network',   severity: 'CRITICAL', detail: 'Unauthorized rule change disabling segment isolation' },
    { ...makeEvent('physical', ri, now - 1000 * 60 * 12), title: 'Facility sensor alarm — Substation Sector 3', severity: 'HIGH',     detail: 'Motion near substation control room after hours' },
    { ...makeEvent('physical', ri, now - 1000 * 60 * 10), title: 'Power supply fluctuation — Sector 3',        severity: 'MED',      detail: 'Voltage drop 18% below nominal on grid feed' },
    { ...makeEvent('osint',    ri, now - 1000 * 60 * 5),  title: 'Social posts: power grid disruption',         severity: 'MED',      detail: 'Multiple outage reports trending near Arlington substation' },
    { ...makeEvent('osint',    ri, now - 1000 * 60 * 3),  title: 'Local news: disruption near substation',      severity: 'MED',      detail: 'Reporter on scene at utility facility' },
  ]
}

/**
 * Scenario 2 — Facility Intrusion with Cyber Diversion
 * High confidence: failed logins + badge anomaly + emergency dispatch
 */
export function scenarioIntrusion() {
  const now = Date.now()
  const ri  = 1 // Pentagon City
  return [
    { ...makeEvent('cyber',    ri, now - 1000 * 60 * 22), title: 'Repeated failed logins (94 attempts)',       severity: 'CRITICAL', detail: 'Admin portal brute force from rotating proxies' },
    { ...makeEvent('cyber',    ri, now - 1000 * 60 * 18), title: 'Lateral movement on internal network',       severity: 'HIGH',     detail: 'Privilege escalation — token impersonation detected' },
    { ...makeEvent('physical', ri, now - 1000 * 60 * 14), title: 'Badge anomaly — Employee flagged offsite',   severity: 'HIGH',     detail: 'Cloned or stolen access card used at server room' },
    { ...makeEvent('physical', ri, now - 1000 * 60 * 10), title: 'CCTV feed interrupted — Camera 12–15',       severity: 'HIGH',     detail: 'Cameras offline covering main server corridor' },
    { ...makeEvent('physical', ri, now - 1000 * 60 * 8),  title: 'Emergency dispatch near facility',           severity: 'HIGH',     detail: 'Police response requested to perimeter breach report' },
    { ...makeEvent('osint',    ri, now - 1000 * 60 * 6),  title: 'Reddit thread: police activity near campus', severity: 'LOW',      detail: 'Users posting photos of police near office building' },
  ]
}

/**
 * Scenario 3 — False Positive / Low Confidence
 * Unrelated events near each other — model shows restraint
 */
export function scenarioFalsePositive() {
  const now = Date.now()
  const ri  = 4 // McLean, VA
  return [
    { ...makeEvent('cyber',    ri, now - 1000 * 60 * 25), title: 'Routine DNS query anomaly',           severity: 'LOW', detail: 'Slightly elevated query rate — within normal variance' },
    { ...makeEvent('osint',    ri, now - 1000 * 60 * 15), title: 'Road closure near office',            severity: 'LOW', detail: 'City-permitted construction work on Route 123' },
    { ...makeEvent('physical', ri, now - 1000 * 60 * 5),  title: 'HVAC maintenance alarm',              severity: 'LOW', detail: 'Scheduled maintenance window — facilities aware' },
  ]
}
