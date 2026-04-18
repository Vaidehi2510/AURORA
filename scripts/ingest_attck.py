"""
Download MITRE ATT&CK for ICS techniques and insert into aurora.db.
Adds ~80 real ICS attack techniques as threat_context records.
"""
import json, sqlite3, uuid, httpx
from pathlib import Path

DB_PATH = Path("db/aurora.db")

def fetch_attck_ics():
    print("Downloading ATT&CK ICS from MITRE GitHub...")
    url = "https://raw.githubusercontent.com/mitre/cti/master/ics-attack/ics-attack.json"
    try:
        data = httpx.get(url, timeout=30).json()
        techniques = [
            o for o in data["objects"]
            if o.get("type") == "attack-pattern"
            and not o.get("revoked")
        ]
        return techniques
    except Exception as e:
        print("Fetch error: " + str(e))
        return []

def insert_techniques(techniques):
    inserted = 0
    skipped = 0
    with sqlite3.connect(DB_PATH) as conn:
        for t in techniques:
            ext = next((
                r for r in t.get("external_references", [])
                if r.get("source_name") == "mitre-ics-attack"
            ), {})
            technique_id = ext.get("external_id", "")
            description = t.get("description", "")
            description = description.replace("\n", " ").strip()[:500]
            row = {
                "event_id": str(uuid.uuid4()),
                "domain": "cyber",
                "source": "ATT&CK_ICS",
                "record_type": "threat_context",
                "event_type": "ics_technique",
                "is_live": False,
                "is_simulated": False,
                "title": t.get("name", ""),
                "description": description,
                "technique_id": technique_id,
                "severity": "medium",
                "timestamp": "2024-01-01T00:00:00Z",
                "physical_consequence": True,
                "critical_service_impact": True,
                "intent": "malicious",
                "facility": "",
                "city": "",
                "country": "USA",
                "sector": "industrial_control_systems",
                "infrastructure_type": "ICS/SCADA",
                "risk_domain": "cyber",
                "risk_subdomain": "ics_attack",
                "tags": technique_id,
                "source_priority": 2,
                "vulnerability": "",
            }
            cols = ", ".join(row.keys())
            placeholders = ", ".join("?" * len(row))
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO unified_events ("
                    + cols + ") VALUES (" + placeholders + ")",
                    list(row.values())
                )
                inserted += 1
            except Exception as e:
                skipped += 1
        conn.commit()
    return inserted, skipped

if __name__ == "__main__":
    techniques = fetch_attck_ics()
    if not techniques:
        print("No techniques fetched — check internet connection")
        exit()
    print("Found " + str(len(techniques)) + " ICS techniques.")
    inserted, skipped = insert_techniques(techniques)
    print("Inserted: " + str(inserted))
    print("Skipped:  " + str(skipped))
    import sqlite3
    conn = sqlite3.connect(DB_PATH)
    total = conn.execute(
        "SELECT COUNT(*) FROM unified_events WHERE source='ATT&CK_ICS'"
    ).fetchone()[0]
    conn.close()
    print("ATT&CK_ICS rows in DB: " + str(total))
