# AURORA Data Handoff

## Source of truth
- `db/aurora.db`

## Main table
- `unified_events`

## Datasets included
1. AIID
   - historical consequence and harm intelligence
2. CISA KEV
   - active cyber threat context
3. CISA ICS
   - OT / critical infrastructure advisories
4. GDELT
   - OSINT / public event context
5. SIM
   - simulated live cyber, physical, and OSINT events

## Record usage
- `record_type = historical_incident`
  - used for precedent retrieval
- `record_type = threat_context`
  - used for vulnerability context
- `record_type = osint_signal`
  - used for public signal context
- `record_type = live_signal`
  - used by correlation engine

## Important fields for correlation
- `timestamp`
- `domain`
- `facility`
- `city`
- `country`
- `is_live`

## Important fields for evidence retrieval
- `title`
- `description`
- `source`
- `risk_domain`
- `risk_subdomain`
- `infrastructure_type`
- `vulnerability`
- `tags`

## Rebuild command
```bash
python scripts/build_aurora_db.py# AURORA Data Handoff

## Source of truth
- `db/aurora.db`

## Main table
- `unified_events`

## Record types
- `historical_incident`
- `threat_context`
- `osint_signal`
- `live_signal`

## Important fields for correlation
- `timestamp`
- `domain`
- `facility`
- `city`
- `country`
- `is_live`
- `is_simulated`

## Important fields for evidence retrieval
- `source`
- `title`
- `description`
- `risk_domain`
- `risk_subdomain`
- `tags`
- `vulnerability`
- `infrastructure_type`

## Rebuild command
```bash
python scripts/build_aurora_db.py
