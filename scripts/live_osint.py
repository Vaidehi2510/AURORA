"""
Pull live OSINT from GDELT real-time API and inject into aurora.db.
Run this once before demo to populate fresh signals.
"""
import httpx, sqlite3, uuid, json
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path("db/aurora.db")

KEYWORDS = [
    "power grid attack",
    "substation outage", 
    "ICS cyberattack",
    "SCADA hack",
    "critical infrastructure threat",
    "energy sector cyber",
]

def fetch_gdelt_live(keyword: str) -> list:
    url = "https://api.gdeltproject.org/api/v2/doc/doc"
    params = {
        "query": keyword,
        "mode": "artlist",
        "maxrecords": 5,
        "format": "json",
        "timespan": "24h",
    }
    try:
        r = httpx.get(url, params=params, timeout=15)
        data = r.json()
        return data.get("articles", [])
    except Exception as e:
        print("GDELT fetch error for '" + keyword + "': " + str(e))
        return []

def insert_osint_events(articles: list, keyword: str):
    rows = []
    for a in articles:
        rows.append({
            "event_id": str(uuid.uuid4()),
            "domain": "osint",
            "source": "GDELT_LIVE",
            "record_type": "live_signal",
            "event_type": "news_report",
            "is_live": True,
            "is_simulated": False,
            "title": a.get("title", "")[:200],
            "description": a.get("title", "")[:300],
            "facility": "",
            "city": "",
            "country": a.get("sourcecountry", ""),
            "sector": "critical_infrastructure",
            "infrastructure_type": "energy",
            "risk_domain": "osint",
            "risk_subdomain": "news_signal",
            "severity": "medium",
            "physical_consequence": False,
            "critical_service_impact": False,
            "intent": "unknown",
            "vulnerability": "",
            "technique_id": "",
            "tags": "osint,gdelt,live," + keyword.replace(" ", "_"),
            "source_priority": 3,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    with sqlite3.connect(DB_PATH) as conn:
        inserted = 0
        for row in rows:
            cols = ", ".join(row.keys())
            placeholders = ", ".join("?" * len(row))
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO unified_events (" + cols + ") VALUES (" + placeholders + ")",
                    list(row.values())
                )
                inserted += 1
            except Exception as e:
                print("Insert error: " + str(e))
        conn.commit()
    return inserted

if __name__ == "__main__":
    print("Fetching live OSINT from GDELT...")
    total = 0
    for keyword in KEYWORDS:
        articles = fetch_gdelt_live(keyword)
        if articles:
            count = insert_osint_events(articles, keyword)
            total += count
            print("  '" + keyword + "' -> " + str(count) + " articles inserted")
        else:
            print("  '" + keyword + "' -> no results")
    
    print()
    print("Total live OSINT events inserted: " + str(total))
    
    # Verify
    with sqlite3.connect(DB_PATH) as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM unified_events WHERE source='GDELT_LIVE'"
        ).fetchone()[0]
    print("GDELT_LIVE rows in DB: " + str(count))
