import os
from datetime import datetime, timezone
from typing import List, Dict


def calculate_confidence(cluster_events: List[Dict], evidence: List[Dict]) -> int:
    domains = len(set(str(event.get("domain", "")) for event in cluster_events))
    base = 40
    base += min(domains * 15, 30)
    base += min(len(cluster_events) * 5, 15)
    base += min(len(evidence) * 3, 15)
    return min(base, 95)


def generate_alert(cluster_events: List[Dict], evidence: List[Dict]) -> Dict:
    facility = next((e.get("facility", "") for e in cluster_events if e.get("facility")), "")
    city = next((e.get("city", "") for e in cluster_events if e.get("city")), "")
    country = next((e.get("country", "") for e in cluster_events if e.get("country")), "")

    event_ids = [e["event_id"] for e in cluster_events]
    event_types = sorted(set(str(e.get("event_type", "")) for e in cluster_events))
    domains = sorted(set(str(e.get("domain", "")) for e in cluster_events))
    timestamps = sorted([str(e.get("timestamp", "")) for e in cluster_events if e.get("timestamp", "")])

    confidence = calculate_confidence(cluster_events, evidence)

    summary = (
        f"AURORA detected multi-domain activity involving {', '.join(domains)} signals "
        f"at {facility or city or 'a monitored location'}."
    )

    why_connected = (
        f"Events occurred within the same operational window and share location context. "
        f"The cluster includes {', '.join(event_types)} activity, and supporting evidence "
        f"indicates relevance to infrastructure risk."
    )

    recommended_action = (
        "Escalate to analyst review, validate cyber and physical telemetry, and assess whether "
        "critical infrastructure operations require protective action."
    )

    return {
        "alert_id": f"ALERT-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
        "cluster_event_ids": event_ids,
        "facility": facility,
        "city": city,
        "country": country,
        "timestamp_window": f"{timestamps[0]} to {timestamps[-1]}" if timestamps else "",
        "confidence_score": confidence,
        "summary": summary,
        "why_connected": why_connected,
        "recommended_action": recommended_action,
        "supporting_evidence": evidence,
    }


if __name__ == "__main__":
    sample_cluster = [
        {
            "event_id": "SIM1",
            "domain": "cyber",
            "event_type": "port_scan",
            "timestamp": "2026-04-18 14:30:00",
            "facility": "substation_alpha",
            "city": "Washington",
            "country": "US",
        },
        {
            "event_id": "SIM3",
            "domain": "physical",
            "event_type": "badge_anomaly",
            "timestamp": "2026-04-18 14:36:00",
            "facility": "substation_alpha",
            "city": "Washington",
            "country": "US",
        },
        {
            "event_id": "SIM4",
            "domain": "osint",
            "event_type": "news_report",
            "timestamp": "2026-04-18 14:39:00",
            "facility": "substation_alpha",
            "city": "Washington",
            "country": "US",
        },
    ]

    sample_evidence = [
        {
            "event_id": "ICS-8",
            "source": "CISA_ICS",
            "title": "Substation automation exploit",
            "description": "Attackers can interfere with substation control systems",
            "reason_for_match": "same infrastructure type, keyword overlap",
            "match_score": 9,
        }
    ]

    alert = generate_alert(sample_cluster, sample_evidence)

    print("\n=== GENERATED ALERT ===\n")
    for key, value in alert.items():
        print(f"{key}: {value}")
