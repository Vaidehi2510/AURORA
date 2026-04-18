import sqlite3
from pathlib import Path
from datetime import datetime
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_PROCESSED = BASE_DIR / "data" / "processed"
DB_DIR = BASE_DIR / "db"

OUTPUT_CSV = DATA_PROCESSED / "aurora_unified_events.csv"
OUTPUT_DB = DB_DIR / "aurora.db"

DB_DIR.mkdir(parents=True, exist_ok=True)
DATA_PROCESSED.mkdir(parents=True, exist_ok=True)

MASTER_COLUMNS = [
    "event_id",
    "source",
    "domain",
    "record_type",
    "is_live",
    "is_simulated",
    "source_priority",
    "event_type",
    "title",
    "description",
    "timestamp",
    "country",
    "city",
    "facility",
    "sector",
    "infrastructure_type",
    "severity",
    "impact_type",
    "physical_consequence",
    "critical_service_impact",
    "technique_id",
    "vulnerability",
    "risk_domain",
    "risk_subdomain",
    "intent",
    "failure_type",
    "tags",
    "ingested_at",
]

INGESTED_AT = datetime.utcnow().isoformat()


def ensure_columns(df: pd.DataFrame, defaults: dict) -> pd.DataFrame:
    df = df.copy()
    for col in MASTER_COLUMNS:
        if col not in df.columns:
            df[col] = defaults.get(col, "")
    return df[MASTER_COLUMNS]


def normalize_bool_like(value, default="false"):
    if pd.isna(value):
        return default
    s = str(value).strip().lower()
    if s in {"true", "yes", "y", "1", "possible"}:
        return "true"
    if s in {"false", "no", "n", "0"}:
        return "false"
    return default


def load_aiid(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)

    out = pd.DataFrame({
        "event_id": df.get("event_id", "").astype(str),
        "source": "AIID",
        "domain": "historical",
        "record_type": "historical_incident",
        "is_live": "false",
        "is_simulated": "false",
        "source_priority": 3,
        "event_type": "historical_incident",
        "title": df.get("title", ""),
        "description": df.get("description", ""),
        "timestamp": df.get("timestamp", ""),
        "country": df.get("country", ""),
        "city": df.get("city", ""),
        "facility": "",
        "sector": df.get("sector", ""),
        "infrastructure_type": df.get("infrastructure_type", ""),
        "severity": df.get("severity", ""),
        "impact_type": df.get("harm_domain", ""),
        "physical_consequence": df.get("critical_service_impact", "").map(normalize_bool_like),
        "critical_service_impact": df.get("critical_service_impact", "").map(normalize_bool_like),
        "technique_id": "",
        "vulnerability": "",
        "risk_domain": df.get("risk_domain", ""),
        "risk_subdomain": df.get("risk_subdomain", ""),
        "intent": df.get("intent", ""),
        "failure_type": df.get("failure_type", ""),
        "tags": (
            df.get("risk_domain", "").fillna("").astype(str) + "," +
            df.get("risk_subdomain", "").fillna("").astype(str) + "," +
            df.get("infrastructure_type", "").fillna("").astype(str)
        ).str.strip(","),
        "ingested_at": INGESTED_AT,
    })

    return ensure_columns(out, {})


def load_kev(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)

    out = pd.DataFrame({
        "event_id": df.get("event_id", "").astype(str),
        "source": df.get("source", "CISA_KEV"),
        "domain": df.get("domain", "cyber"),
        "record_type": "threat_context",
        "is_live": "false",
        "is_simulated": "false",
        "source_priority": 2,
        "event_type": df.get("event_type", "known_exploited_vulnerability"),
        "title": df.get("title", ""),
        "description": df.get("description", ""),
        "timestamp": df.get("timestamp", ""),
        "country": "",
        "city": "",
        "facility": "",
        "sector": "",
        "infrastructure_type": df.get("infrastructure_type", ""),
        "severity": df.get("severity", 4),
        "impact_type": df.get("impact_type", "cyber"),
        "physical_consequence": df.get("physical_consequence", "false").map(normalize_bool_like),
        "critical_service_impact": "",
        "technique_id": "",
        "vulnerability": df.get("vulnerability", ""),
        "risk_domain": "vulnerability",
        "risk_subdomain": "",
        "intent": "malicious",
        "failure_type": "exploitation",
        "tags": df.get("tags", ""),
        "ingested_at": INGESTED_AT,
    })

    return ensure_columns(out, {})


def load_ics(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)

    out = pd.DataFrame({
        "event_id": df.get("event_id", "").astype(str),
        "source": df.get("source", "CISA_ICS"),
        "domain": df.get("domain", "cyber"),
        "record_type": "historical_incident",
        "is_live": "false",
        "is_simulated": "false",
        "source_priority": 3,
        "event_type": df.get("event_type", "ics_advisory"),
        "title": df.get("title", ""),
        "description": df.get("description", ""),
        "timestamp": df.get("timestamp", ""),
        "country": "",
        "city": "",
        "facility": "",
        "sector": "",
        "infrastructure_type": df.get("infrastructure_type", ""),
        "severity": df.get("severity", 4),
        "impact_type": df.get("impact_type", "infrastructure"),
        "physical_consequence": df.get("physical_consequence", "possible").map(normalize_bool_like),
        "critical_service_impact": "",
        "technique_id": "",
        "vulnerability": df.get("vulnerability", ""),
        "risk_domain": "ICS/OT",
        "risk_subdomain": "",
        "intent": "malicious",
        "failure_type": "",
        "tags": df.get("tags", ""),
        "ingested_at": INGESTED_AT,
    })

    return ensure_columns(out, {})


def load_gdelt(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)

    out = pd.DataFrame({
        "event_id": df.get("event_id", "").astype(str),
        "source": df.get("source", "GDELT"),
        "domain": df.get("domain", "osint"),
        "record_type": "osint_signal",
        "is_live": "false",
        "is_simulated": "false",
        "source_priority": 2,
        "event_type": df.get("event_type", "news_event"),
        "title": df.get("title", ""),
        "description": df.get("description", ""),
        "timestamp": df.get("timestamp", ""),
        "country": df.get("country", ""),
        "city": df.get("city", ""),
        "facility": df.get("facility", ""),
        "sector": df.get("sector", ""),
        "infrastructure_type": df.get("infrastructure_type", ""),
        "severity": df.get("severity", 3),
        "impact_type": df.get("impact_type", "operational"),
        "physical_consequence": df.get("physical_consequence", "possible").map(normalize_bool_like),
        "critical_service_impact": "",
        "technique_id": "",
        "vulnerability": "",
        "risk_domain": df.get("risk_domain", ""),
        "risk_subdomain": df.get("risk_subdomain", ""),
        "intent": df.get("intent", "unknown"),
        "failure_type": "",
        "tags": df.get("tags", ""),
        "ingested_at": INGESTED_AT,
    })

    return ensure_columns(out, {})


def load_simulated(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)

    out = pd.DataFrame({
        "event_id": df.get("event_id", "").astype(str),
        "source": df.get("source", "SIM"),
        "domain": df.get("domain", ""),
        "record_type": "live_signal",
        "is_live": "true",
        "is_simulated": "true",
        "source_priority": 1,
        "event_type": df.get("event_type", ""),
        "title": df.get("title", ""),
        "description": df.get("description", ""),
        "timestamp": df.get("timestamp", ""),
        "country": df.get("country", ""),
        "city": df.get("city", ""),
        "facility": df.get("facility", ""),
        "sector": df.get("sector", ""),
        "infrastructure_type": df.get("infrastructure_type", ""),
        "severity": df.get("severity", 3),
        "impact_type": df.get("impact_type", ""),
        "physical_consequence": df.get("physical_consequence", "false").map(normalize_bool_like),
        "critical_service_impact": df.get("critical_service_impact", "").map(normalize_bool_like),
        "technique_id": df.get("technique_id", ""),
        "vulnerability": df.get("vulnerability", ""),
        "risk_domain": df.get("risk_domain", ""),
        "risk_subdomain": df.get("risk_subdomain", ""),
        "intent": df.get("intent", ""),
        "failure_type": df.get("failure_type", ""),
        "tags": df.get("tags", ""),
        "ingested_at": INGESTED_AT,
    })

    return ensure_columns(out, {})


def main():
    files = {
        "aiid": DATA_PROCESSED / "aiid_normalized_master.csv",
        "kev": DATA_PROCESSED / "kev_normalized_cleaned.csv",
        "ics": DATA_PROCESSED / "ics_normalized_cleaned.csv",
        "gdelt": DATA_PROCESSED / "gdelt_normalized_cleaned.csv",
        "sim": DATA_PROCESSED / "simulated_normalized.csv",
    }

    missing = [str(p) for p in files.values() if not p.exists()]
    if missing:
        raise FileNotFoundError("Missing required processed files:\\n" + "\\n".join(missing))

    dfs = [
        load_aiid(files["aiid"]),
        load_kev(files["kev"]),
        load_ics(files["ics"]),
        load_gdelt(files["gdelt"]),
        load_simulated(files["sim"]),
    ]

    unified = pd.concat(dfs, ignore_index=True)

    # Light cleanup
    unified["timestamp"] = unified["timestamp"].fillna("").astype(str).str.strip()
    unified["severity"] = unified["severity"].fillna("").astype(str)
    unified["tags"] = unified["tags"].fillna("").astype(str).str.strip(",")

    # Drop exact duplicate rows by key identity
    unified = unified.drop_duplicates(subset=["event_id", "source", "timestamp", "title"])

    # Save CSV
    unified.to_csv(OUTPUT_CSV, index=False)

    # Save SQLite
    conn = sqlite3.connect(OUTPUT_DB)
    unified.to_sql("unified_events", conn, if_exists="replace", index=False)

    # Helpful indexes
    cur = conn.cursor()
    cur.execute("CREATE INDEX IF NOT EXISTS idx_timestamp ON unified_events(timestamp)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_domain ON unified_events(domain)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_source ON unified_events(source)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_facility ON unified_events(facility)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_city_country ON unified_events(city, country)")
    conn.commit()
    conn.close()

    print(f"Built unified CSV: {OUTPUT_CSV}")
    print(f"Built SQLite DB:  {OUTPUT_DB}")
    print(f"Total rows: {len(unified)}")


if __name__ == "__main__":
    main()
