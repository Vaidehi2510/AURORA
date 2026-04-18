
## Put this in `docs/alert_schema.md`

```md
# AURORA Alert Schema

Each alert should contain:

- `alert_id`
- `cluster_event_ids`
- `facility`
- `city`
- `country`
- `timestamp_window`
- `confidence_score`
- `summary`
- `why_connected`
- `recommended_action`
- `supporting_evidence`

## Supporting evidence item
- `event_id`
- `source`
- `title`
- `description`
- `reason_for_match`
