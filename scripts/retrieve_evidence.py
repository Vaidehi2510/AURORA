import os
import sqlite3
import pandas as pd
from typing import List, Dict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "db", "aurora.db")


def load_db():
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT * FROM unified_events", conn)
    conn.close()
    return df


def score_row(
    row: pd.Series,
    keywords: List[str],
    facility: str = "",
    city: str = "",
    infrastructure_type: str = ""
) -> int:
    score = 0

    text = " ".join([
        str(row.get("title", "")),
        str(row.get("description", "")),
        str(row.get("risk_domain", "")),
        str(row.get("risk_subdomain", "")),
        str(row.get("tags", "")),
        str(row.get("infrastructure_type", "")),
        str(row.get("vulnerability", "")),
        str(row.get("event_type", "")),
    ]).lower()

    for kw in keywords:
        if kw and kw.lower() in text:
            score += 3

    if facility and facility == str(row.get("facility", "")):
        score += 5

    if city and city == str(row.get("city", "")):
        score += 2

    if infrastructure_type and infrastructure_type == str(row.get("infrastructure_type", "")):
        score += 3

    if str(row.get("record_type", "")) == "historical_incident":
        score += 2

    if str(row.get("source", "")) == "CISA_ICS":
        score += 2

    return score


def retrieve_evidence(
    keywords: List[str],
    facility: str = "",
    city: str = "",
    infrastructure_type: str = "",
    top_k: int = 5
) -> List[Dict]:
    df = load_db()

    evidence_df = df[
        df["record_type"].isin(["historical_incident", "threat_context", "osint_signal"])
    ].copy()

    evidence_df["match_score"] = evidence_df.apply(
        lambda row: score_row(row, keywords, facility, city, infrastructure_type),
        axis=1
    )

    evidence_df = evidence_df[evidence_df["match_score"] > 0].copy()
    evidence_df = evidence_df.sort_values(
        by=["match_score", "source_priority"],
        ascending=[False, True]
    )

    results = []
    for _, row in evidence_df.head(top_k).iterrows():
        reason_parts = []

        if infrastructure_type and infrastructure_type == str(row.get("infrastructure_type", "")):
            reason_parts.append("same infrastructure type")

        if city and city == str(row.get("city", "")):
            reason_parts.append("same city")

        reason_parts.append("keyword overlap")

        results.append({
            "event_id": row["event_id"],
            "source": row["source"],
            "title": row["title"],
            "description": row["description"],
            "reason_for_match": ", ".join(reason_parts),
            "match_score": int(row["match_score"]),
        })

    return results


if __name__ == "__main__":
    sample = retrieve_evidence(
        keywords=["ics", "scada", "substation", "outage", "access"],
        facility="substation_alpha",
        city="Washington",
        infrastructure_type="energy",
        top_k=5
    )

    print("\n=== TOP EVIDENCE ===\n")
    for item in sample:
        print(item)
