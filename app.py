"""
JSON API for the React dashboard. Reads the same SQLite database as `dashboard.py`.
Run: uvicorn api:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

_APP_ROOT = Path(__file__).resolve().parent
DB_PATH = _APP_ROOT / "db" / "aurora.db"

# Load repo-root .env before any handler reads OPENROUTER_API_KEY (uvicorn may not import correlation_engine first).
load_dotenv(_APP_ROOT / ".env")

app = FastAPI(title="AURORA API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Rough DC-metro centroids for map pins when lat/lng are not in the DB
_LOCATION_HINTS: tuple[tuple[str, tuple[float, float]], ...] = (
    ("arlington", (38.8816, -77.0910)),
    ("pentagon", (38.8719, -77.0563)),
    ("crystal city", (38.8576, -77.0511)),
    ("reagan", (38.8512, -77.0402)),
    ("national airport", (38.8512, -77.0402)),
    ("mclean", (38.9369, -77.1803)),
    ("rosslyn", (38.8960, -77.0707)),
    ("bethesda", (38.9848, -77.0947)),
    ("silver spring", (38.9964, -77.0261)),
    ("baltimore", (39.2904, -76.6122)),
    ("virginia", (38.8048, -77.0469)),
    ("maryland", (39.0458, -76.6413)),
    ("washington", (38.9072, -77.0369)),
    ("district of columbia", (38.9072, -77.0369)),
    ("dc", (38.9072, -77.0369)),
)


def _coords_for_place(text: str) -> tuple[float, float]:
    lower = (text or "").lower()
    for hint, coords in _LOCATION_HINTS:
        if hint in lower:
            return coords
    return 38.9072, -77.0369


def _jitter(lat: float, lng: float, seed: str, scale: float = 0.035) -> tuple[float, float]:
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    dx = (digest[0] / 255.0 - 0.5) * scale
    dy = (digest[1] / 255.0 - 0.5) * scale
    return lat + dx, lng + dy


def _parse_ts(value: object) -> float:
    if value is None:
        return datetime.utcnow().timestamp() * 1000
    if isinstance(value, (int, float)):
        # assume seconds if small else ms
        v = float(value)
        return v * 1000 if v < 1e12 else v
    text = str(value).strip()
    if not text:
        return datetime.utcnow().timestamp() * 1000
    try:
        if text.isdigit():
            v = float(text)
            return v * 1000 if v < 1e12 else v
        iso = text.replace("Z", "+00:00")
        dt = datetime.fromisoformat(iso)
        return dt.timestamp() * 1000
    except Exception:
        return datetime.utcnow().timestamp() * 1000


def _domain_to_type(domain: str) -> str:
    d = (domain or "").lower().strip()
    if d == "cyber":
        return "cyber"
    if d == "physical":
        return "physical"
    return "osint"


def _severity_label(raw: object) -> str:
    text = str(raw or "").upper().strip()
    if "CRIT" in text:
        return "CRITICAL"
    if "HIGH" in text:
        return "HIGH"
    if "MED" in text or "MID" in text:
        return "MED"
    if "LOW" in text:
        return "LOW"
    return "MED"


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", (name,)
    ).fetchone()
    return row is not None


def _load_json_list(raw: object) -> list:
    if raw is None or raw == "":
        return []
    if isinstance(raw, list):
        return raw
    try:
        out = json.loads(str(raw))
        return out if isinstance(out, list) else []
    except Exception:
        return []


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "db": str(DB_PATH.resolve())}


@app.get("/api/snapshot")
def snapshot() -> dict[str, object]:
    """Latest live events and correlation alerts in shapes the React app expects."""
    if not DB_PATH.is_file():
        return {"liveEvents": [], "alerts": [], "dbMissing": True}

    now_ms = datetime.utcnow().timestamp() * 1000
    live_events: list[dict[str, object]] = []
    alerts_out: list[dict[str, object]] = []

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row

        if _table_exists(conn, "unified_events"):
            rows = conn.execute(
                """
                SELECT event_id, source, domain, event_type, title, description,
                       timestamp, city, country, facility, severity
                FROM unified_events
                WHERE is_live = 'true'
                ORDER BY timestamp DESC
                LIMIT 400
                """
            ).fetchall()
            for row in rows:
                place = " · ".join(
                    p for p in (row["facility"], row["city"], row["country"]) if p
                ) or "Unknown"
                lat0, lng0 = _coords_for_place(place)
                lat, lng = _jitter(lat0, lng0, str(row["event_id"]))
                live_events.append(
                    {
                        "id": row["event_id"],
                        "type": _domain_to_type(row["domain"] or ""),
                        "timestamp": _parse_ts(row["timestamp"]),
                        "region": place,
                        "lat": lat,
                        "lng": lng,
                        "title": row["title"] or "(no title)",
                        "detail": (row["description"] or "")
                        + (f" — {row['source']}" if row["source"] else ""),
                        "severity": _severity_label(row["severity"]),
                    }
                )

        if _table_exists(conn, "correlation_alerts"):
            arows = conn.execute(
                "SELECT * FROM correlation_alerts ORDER BY confidence DESC"
            ).fetchall()
            for row in arows:
                evidence = _load_json_list(row["evidence"])
                why = _load_json_list(row["why_it_matters"])
                nxt = _load_json_list(row["next_actions"])
                notes_raw = row["analyst_notes"] if "analyst_notes" in row.keys() else None
                notes = _load_json_list(notes_raw)
                region = row["location"] or "Unspecified"
                base_lat, base_lng = _coords_for_place(region)
                mapped_events: list[dict[str, object]] = []
                for ev in evidence:
                    eid = str(ev.get("event_id") or "")
                    lat, lng = _jitter(base_lat, base_lng, eid or region)
                    mapped_events.append(
                        {
                            "id": eid,
                            "type": _domain_to_type(str(ev.get("domain") or "")),
                            "timestamp": _parse_ts(ev.get("timestamp")),
                            "region": region,
                            "lat": lat,
                            "lng": lng,
                            "title": ev.get("title") or "",
                            "detail": f"{ev.get('source', '')} · {ev.get('event_type', '')}".strip(
                                " ·"
                            ),
                            "severity": "HIGH"
                            if float(ev.get("score") or 0) > 0.72
                            else "MED",
                        }
                    )
                conf = float(row["confidence"] or 0)
                score = int(round(max(0.0, min(1.0, conf)) * 100))
                summary_bits = [str(x) for x in why[:2] if x]
                summary = " ".join(summary_bits) if summary_bits else (row["headline"] or "")
                rec = str(nxt[0]) if nxt else ""
                alerts_out.append(
                    {
                        "id": row["alert_id"],
                        "region": region,
                        "events": mapped_events,
                        "score": score,
                        "timestamp": _parse_ts(row["time_window_start"]),
                        "updatedAt": now_ms,
                        "llmData": {
                            "headline": row["headline"] or "",
                            "summary": summary,
                            "recommendation": rec,
                            "uncertainty": notes[1] if len(notes) > 1 else (notes[0] if notes else ""),
                        },
                        "llmLoading": False,
                        "note": "",
                    }
                )

    return {
        "liveEvents": live_events,
        "alerts": alerts_out,
        "dbMissing": False,
    }


class AnalystChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(..., max_length=16_000)


class AnalystChatRequest(BaseModel):
    messages: list[AnalystChatMessage] = Field(..., max_length=40)
    context: dict[str, Any] | None = None


@app.get("/api/analyst-chat/status")
def analyst_chat_status() -> dict[str, Any]:
    from correlation_engine.runtime import env

    from openai_model import resolve_chat_model

    key_ok = bool(env("OPENROUTER_API_KEY"))
    return {
        "configured": key_ok,
        "model": resolve_chat_model(for_analyst_chat=True),
    }


@app.post("/api/analyst-chat")
def analyst_chat(body: AnalystChatRequest) -> dict[str, str]:
    """
    Analyst window: OpenRouter chat via shared helpers in openai_model.py
    (same client, headers, and model resolution as alert synthesis).
    """
    if not body.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")

    from openai_model import (
        build_analyst_chat_system_message,
        get_openrouter_client,
        openrouter_extra_headers,
        resolve_chat_model,
    )

    client = get_openrouter_client()
    model = resolve_chat_model(for_analyst_chat=True)
    if client is None or not model:
        raise HTTPException(
            status_code=503,
            detail="OpenRouter is not configured. Set OPENROUTER_API_KEY in the environment.",
        )

    system_content = build_analyst_chat_system_message(body.context)
    messages: list[dict[str, str]] = [{"role": "system", "content": system_content}]
    for m in body.messages[-32:]:
        messages.append({"role": m.role, "content": m.content})

    try:
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            extra_headers=openrouter_extra_headers(),
            temperature=0.35,
            max_tokens=1024,
        )
        reply = (response.choices[0].message.content or "").strip()
    except Exception as exc:
        msg = str(exc)[:700]
        hint = ""
        low = msg.lower()
        if "503" in msg or "no healthy upstream" in low or "provider returned error" in low:
            hint = (
                " OpenRouter’s upstream for this model is unavailable. Set AURORA_ANALYST_CHAT_MODEL "
                "(or AURORA_CHAT_MODEL) in .env to another slug, e.g. openai/gpt-4o-mini or "
                "google/gemini-2.0-flash-001 — then restart uvicorn."
            )
        raise HTTPException(status_code=502, detail=f"OpenRouter request failed: {msg}{hint}") from exc

    if not reply:
        raise HTTPException(status_code=502, detail="Empty model response")
    return {"reply": reply}


@app.post("/api/run-engine")
def run_engine() -> dict[str, str]:
    """Run the Python correlation engine (same as the Streamlit sidebar button)."""
    from correlation_engine import CorrelationConfig, CorrelationEngine

    engine = CorrelationEngine(
        CorrelationConfig(
            enable_remote_embeddings=True,
            enable_llm_synthesis=True,
            writeback=True,
        )
    )
    engine.run()
    return {"status": "ok"}
