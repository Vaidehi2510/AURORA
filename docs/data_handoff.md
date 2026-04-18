# AURORA Data Handoff

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
