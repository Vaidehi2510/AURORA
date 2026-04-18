# AURORA Unified Schema

Main database: `db/aurora.db`  
Main table: `unified_events`

## Columns

- `event_id`: unique record identifier
- `source`: dataset source (AIID, CISA_KEV, CISA_ICS, GDELT, SIM)
- `domain`: cyber, physical, osint, historical
- `record_type`: historical_incident, threat_context, osint_signal, live_signal
- `is_live`: whether this row is used as live-like signal input
- `is_simulated`: whether this row is synthetic for demo/testing
- `source_priority`: lower = more operational priority
- `event_type`: normalized event type
- `title`: short event title
- `description`: event description
- `timestamp`: event time
- `country`: country code or name
- `city`: city/location text
- `facility`: specific site/facility if available
- `sector`: deployment or impact sector
- `infrastructure_type`: energy, water, transport, maritime, etc.
- `severity`: normalized severity
- `impact_type`: cyber, operational, infrastructure, human, etc.
- `physical_consequence`: whether physical-world impact is likely/known
- `critical_service_impact`: whether critical services were affected
- `technique_id`: ATT&CK/ICS technique if available
- `vulnerability`: CVE or vulnerability identifier
- `risk_domain`: broad risk class
- `risk_subdomain`: narrower risk class
- `intent`: malicious, accidental, unknown, unintentional
- `failure_type`: technical failure pattern
- `tags`: comma-separated keywords
- `ingested_at`: pipeline ingestion timestamp
