from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from senior_analyst_agent import run_senior_analyst

ROOT_DIR = Path(__file__).resolve().parent
DB_PATH = ROOT_DIR / "db" / "aurora.db"

ANALYST_COLUMNS = {
    "analyst_verdict": "TEXT",
    "analyst_confidence": "TEXT",
    "analyst_escalation": "TEXT",
    "analyst_narrative": "TEXT",
    "analyst_gaps": "TEXT",
    "analyst_actions": "TEXT",
    "analyst_ran_at": "TEXT",
}


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
        (name,),
    ).fetchone()
    return row is not None


def _load_json_list(raw: object) -> list[Any]:
    if raw is None or raw == "":
        return []
    if isinstance(raw, list):
        return raw
    try:
        value = json.loads(str(raw))
        return value if isinstance(value, list) else []
    except Exception:
        return []


def _existing_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {str(row[1]) for row in rows}


def ensure_analyst_columns(conn: sqlite3.Connection) -> None:
    existing = _existing_columns(conn, "correlation_alerts")
    for column, column_type in ANALYST_COLUMNS.items():
        if column not in existing:
            conn.execute(f"ALTER TABLE correlation_alerts ADD COLUMN {column} {column_type}")


def _flatten_lines(lines: list[str]) -> str:
    return "\n".join(line.strip() for line in lines if line.strip()).strip()


def parse_analyst_response(text: str) -> dict[str, str]:
    cleaned = str(text or "").replace("\r\n", "\n").strip()
    lines = [line.rstrip() for line in cleaned.split("\n")]

    verdict = ""
    escalation = ""
    confidence = ""

    sections: dict[str, list[str]] = {
        "what_happened": [],
        "why": [],
        "gaps": [],
        "actions": [],
    }
    current_section: str | None = None

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            if current_section:
                sections[current_section].append("")
            continue

        lower = line.lower()
        if lower.startswith("aurora assessment:"):
            verdict = line.split(":", 1)[1].strip()
            current_section = None
            continue
        if lower.startswith("escalation recommendation:"):
            escalation = line.split(":", 1)[1].strip()
            current_section = None
            continue
        if lower.startswith("confidence:"):
            confidence = line.split(":", 1)[1].strip()
            current_section = None
            continue
        if lower.startswith("what happened:"):
            current_section = "what_happened"
            continue
        if lower.startswith("why aurora thinks this:"):
            current_section = "why"
            continue
        if lower.startswith("operational gaps identified:"):
            current_section = "gaps"
            continue
        if lower.startswith("recommended next actions:"):
            current_section = "actions"
            continue

        if current_section:
            sections[current_section].append(line)

    if not confidence:
        match = re.search(r"\b(\d{1,3})\s*/\s*100\b", cleaned)
        if match:
            confidence = f"{match.group(1)}/100"

    narrative_parts = [
        _flatten_lines(sections["what_happened"]),
        _flatten_lines(sections["why"]),
    ]
    narrative = "\n\n".join(part for part in narrative_parts if part).strip()

    gaps = _flatten_lines([re.sub(r"^[-*]\s*", "", line) for line in sections["gaps"]])
    actions = _flatten_lines([re.sub(r"^\d+\.\s*", "", line) for line in sections["actions"]])

    return {
        "analyst_verdict": verdict,
        "analyst_confidence": confidence,
        "analyst_escalation": escalation,
        "analyst_narrative": narrative or cleaned,
        "analyst_gaps": gaps,
        "analyst_actions": actions,
    }


def build_alert_payload(row: sqlite3.Row) -> dict[str, Any]:
    why_it_matters = _load_json_list(row["why_it_matters"])
    next_actions = _load_json_list(row["next_actions"])
    evidence = _load_json_list(row["evidence"])
    supporting_priors = _load_json_list(row["supporting_priors"])

    try:
        confidence_value = float(row["confidence"] or 0)
    except Exception:
        confidence_value = 0.0

    confidence_score = int(round(confidence_value * 100 if confidence_value <= 1 else confidence_value))

    supporting_evidence = []
    for item in evidence:
        if not isinstance(item, dict):
            continue
        raw_score = item.get("score", 0)
        try:
            score_value = float(raw_score)
        except Exception:
            score_value = 0.0
        supporting_evidence.append(
            {
                "event_id": item.get("event_id") or item.get("id") or "",
                "source": item.get("source") or "",
                "title": item.get("title") or "",
                "description": item.get("description") or item.get("detail") or "",
                "reason_for_match": " ".join(
                    part for part in [item.get("domain"), item.get("event_type")] if part
                ).strip(),
                "match_score": int(round(score_value * 10 if score_value <= 1 else score_value)),
            }
        )

    return {
        "alert_id": row["alert_id"],
        "cluster_id": row["cluster_id"],
        "priority": row["priority"] or "",
        "confidence_score": confidence_score,
        "facility": row["location"] or "",
        "timestamp_window": f"{row['time_window_start']} to {row['time_window_end']}",
        "summary": row["headline"] or "",
        "why_connected": " ".join(str(item) for item in why_it_matters if item),
        "recommended_action": " ".join(str(item) for item in next_actions if item),
        "supporting_evidence": supporting_evidence,
        "supporting_priors": supporting_priors,
    }


def run_analyst_on_all_alerts(force: bool = False, db_path: Path | None = None) -> int:
    target_db = db_path or DB_PATH
    if not target_db.is_file():
        raise FileNotFoundError(f"AURORA DB not found: {target_db}")

    processed = 0
    with sqlite3.connect(target_db) as conn:
        conn.row_factory = sqlite3.Row
        if not _table_exists(conn, "correlation_alerts"):
            return 0

        ensure_analyst_columns(conn)

        if force:
            rows = conn.execute("SELECT * FROM correlation_alerts ORDER BY confidence DESC").fetchall()
        else:
            rows = conn.execute(
                """
                SELECT * FROM correlation_alerts
                WHERE analyst_verdict IS NULL OR TRIM(COALESCE(analyst_verdict, '')) = ''
                ORDER BY confidence DESC
                """
            ).fetchall()

        for row in rows:
            alert_payload = build_alert_payload(row)
            result = run_senior_analyst(alert_payload)
            parsed = parse_analyst_response(result.get("analysis_text", ""))
            conn.execute(
                """
                UPDATE correlation_alerts
                SET analyst_verdict = ?,
                    analyst_confidence = ?,
                    analyst_escalation = ?,
                    analyst_narrative = ?,
                    analyst_gaps = ?,
                    analyst_actions = ?,
                    analyst_ran_at = ?
                WHERE alert_id = ?
                """,
                (
                    parsed["analyst_verdict"],
                    parsed["analyst_confidence"],
                    parsed["analyst_escalation"],
                    parsed["analyst_narrative"],
                    parsed["analyst_gaps"],
                    parsed["analyst_actions"],
                    datetime.now(timezone.utc).isoformat(),
                    row["alert_id"],
                ),
            )
            processed += 1

        conn.commit()

    return processed
