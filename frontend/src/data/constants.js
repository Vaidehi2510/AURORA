// ── Event Types ────────────────────────────────────────────────
// RawEvent base fields shared by all event types
// CyberEvent, PhysicalEvent, OpenSourceEvent extend RawEvent

export const EVENT_TYPES = {
  CYBER: 'cyber',
  PHYSICAL: 'physical',
  OSINT: 'osint',
}

export const SEVERITY = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MED: 'MED',
  LOW: 'LOW',
}

// ── Geographic Regions (DC Metro Area) ────────────────────────
export const REGIONS = [
  { name: 'Arlington, VA',     lat: 38.880, lng: -77.100 },
  { name: 'Pentagon City',     lat: 38.862, lng: -77.060 },
  { name: 'Crystal City',      lat: 38.855, lng: -77.050 },
  { name: 'Reagan Airport',    lat: 38.852, lng: -77.037 },
  { name: 'McLean, VA',        lat: 38.940, lng: -77.180 },
  { name: 'Rosslyn, VA',       lat: 38.894, lng: -77.072 },
  { name: 'Bethesda, MD',      lat: 38.980, lng: -77.100 },
  { name: 'Silver Spring, MD', lat: 38.991, lng: -77.028 },
]

// ── Simulated Event Catalogs ───────────────────────────────────
export const CYBER_CATALOG = [
  { title: 'Suspicious outbound traffic burst',      severity: SEVERITY.HIGH,     detail: 'Unusual data exfil to external IP 185.220.x.x' },
  { title: 'Failed login burst (47 attempts)',       severity: SEVERITY.HIGH,     detail: 'Brute force pattern on VPN endpoint detected' },
  { title: 'Malware detection — IDS alert',          severity: SEVERITY.CRITICAL, detail: 'Trojan dropper signature matched in memory scan' },
  { title: 'Firewall rule override detected',        severity: SEVERITY.MED,      detail: 'Admin bypass on segmented OT subnet' },
  { title: 'DDoS traffic spike',                     severity: SEVERITY.HIGH,     detail: 'SYN flood from 3 external sources — 40Gbps' },
  { title: 'Credential stuffing attempt',            severity: SEVERITY.MED,      detail: 'Known breach credential list in use' },
  { title: 'Lateral movement detected',              severity: SEVERITY.HIGH,     detail: 'Anomalous SMB traversal across internal subnets' },
  { title: 'Unusual DNS query pattern',              severity: SEVERITY.MED,      detail: 'C2 beacon DNS tunneling pattern identified' },
  { title: 'SCADA protocol anomaly',                 severity: SEVERITY.CRITICAL, detail: 'Unauthorized Modbus write command to PLC' },
  { title: 'Privilege escalation on endpoint',       severity: SEVERITY.HIGH,     detail: 'Token impersonation on domain controller' },
]

export const PHYSICAL_CATALOG = [
  { title: 'Access badge anomaly — door 4B',         severity: SEVERITY.HIGH,     detail: 'Badge used by employee flagged as offsite' },
  { title: 'Facility sensor alarm — Sector 3',       severity: SEVERITY.MED,      detail: 'Motion detected in restricted area after hours' },
  { title: 'Emergency dispatch near facility',       severity: SEVERITY.HIGH,     detail: 'Police response requested to perimeter breach' },
  { title: 'Power supply fluctuation',               severity: SEVERITY.MED,      detail: 'Substation voltage drop — 12% below nominal' },
  { title: 'CCTV feed interruption',                 severity: SEVERITY.HIGH,     detail: 'Camera cluster 12–15 offline unexpectedly' },
  { title: 'Door forced entry alarm',                severity: SEVERITY.CRITICAL, detail: 'Perimeter breach at secondary access point' },
  { title: 'HVAC system anomaly — server room',      severity: SEVERITY.LOW,      detail: 'Unusual temperature changes in data center bay' },
  { title: 'Vehicle checkpoint flag',                severity: SEVERITY.MED,      detail: 'Unregistered plate at main gate — 3rd occurrence' },
  { title: 'Guard station unresponsive',             severity: SEVERITY.HIGH,     detail: 'No check-in from post for 22 minutes' },
  { title: 'Unauthorized drone detected',            severity: SEVERITY.HIGH,     detail: 'UAV in restricted airspace above campus' },
]

export const OSINT_CATALOG = [
  { title: 'Social post: power issues downtown',     severity: SEVERITY.LOW,      detail: 'Multiple reports of outage trending on X/Twitter' },
  { title: 'Local news: disruption near substation', severity: SEVERITY.MED,      detail: 'Reporter on scene at utility facility' },
  { title: 'Traffic anomaly — unusual congestion',   severity: SEVERITY.LOW,      detail: 'Waze alert showing road closures near facility' },
  { title: 'Outage report filed with utility co.',   severity: SEVERITY.MED,      detail: 'Online outage map showing cluster near target' },
  { title: 'Emergency alert broadcast',              severity: SEVERITY.HIGH,     detail: 'County-level Wireless Emergency Alert pushed' },
  { title: 'Reddit thread: weird activity',          severity: SEVERITY.LOW,      detail: 'Users reporting unusual vehicle/personnel movements' },
  { title: 'Pastebin: partial config dump',          severity: SEVERITY.HIGH,     detail: 'Credentials matching target org found posted' },
  { title: 'Flight radar anomaly near site',        severity: SEVERITY.MED,       detail: 'Unregistered aircraft circling perimeter' },
]

// ── Default Correlation Parameters ────────────────────────────
export const DEFAULT_PARAMS = {
  timeWindowMin: 20,   // minutes
  geoRadiusMi:   2.0,  // miles
  minConfidence: 40,   // 0–100
}

// ── Source Reliability Weights ─────────────────────────────────
export const SOURCE_RELIABILITY = {
  [EVENT_TYPES.CYBER]:    0.9,
  [EVENT_TYPES.PHYSICAL]: 0.85,
  [EVENT_TYPES.OSINT]:    0.6,
}
