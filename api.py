from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from elevenlabs_voice import (
    synthesize_speech_bytes,
    transcribe_audio_bytes,
    voice_status,
)

_APP_ROOT = Path(__file__).resolve().parent
DB_PATH = _APP_ROOT / "db" / "aurora.db"

load_dotenv(_APP_ROOT / ".env")

app = FastAPI(title="AURORA API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

def _boolish(value: object) -> bool:
    return str(value or "").strip().lower() in {"true", "1", "yes", "y"}


def _row_region(row: sqlite3.Row) -> str:
    return " · ".join(p for p in (row["facility"], row["city"], row["country"]) if p) or "Unknown"


def _raw_data_where(
    *,
    scope: str,
    domain: str,
    search: str,
    include_domain: bool,
) -> tuple[str, list[object]]:
    clauses: list[str] = []
    params: list[object] = []

    scope_norm = (scope or "all").strip().lower()
    if scope_norm == "live":
        clauses.append("LOWER(COALESCE(is_live, '')) = 'true'")
    elif scope_norm == "historical":
        clauses.append("LOWER(COALESCE(is_live, 'false')) != 'true'")
    elif scope_norm == "simulated":
        clauses.append("LOWER(COALESCE(is_simulated, '')) = 'true'")

    domain_norm = (domain or "all").strip().lower()
    if include_domain and domain_norm and domain_norm != "all":
        clauses.append("LOWER(COALESCE(domain, '')) = ?")
        params.append(domain_norm)

    search_norm = (search or "").strip().lower()
    if search_norm:
        like = f"%{search_norm}%"
        clauses.append(
            """
            (
                LOWER(COALESCE(event_id, '')) LIKE ?
                OR LOWER(COALESCE(source, '')) LIKE ?
                OR LOWER(COALESCE(domain, '')) LIKE ?
                OR LOWER(COALESCE(event_type, '')) LIKE ?
                OR LOWER(COALESCE(title, '')) LIKE ?
                OR LOWER(COALESCE(description, '')) LIKE ?
                OR LOWER(COALESCE(facility, '')) LIKE ?
                OR LOWER(COALESCE(city, '')) LIKE ?
                OR LOWER(COALESCE(country, '')) LIKE ?
            )
            """
        )
        params.extend([like] * 9)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    return where, params



def _parse_llm_json_object(text: str) -> dict[str, Any] | None:
    clean = text.replace("```json", "").replace("```", "").strip()
    try:
        obj = json.loads(clean)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        pass
    start = clean.find("{")
    end = clean.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            obj = json.loads(clean[start:end + 1])
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            return None
    return None


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "db": str(DB_PATH.resolve())}


@app.get("/api/snapshot")
def snapshot() -> dict[str, object]:
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
                live_events.append({
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
                })

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
                    mapped_events.append({
                        "id": eid,
                        "type": _domain_to_type(str(ev.get("domain") or "")),
                        "timestamp": _parse_ts(ev.get("timestamp")),
                        "region": region,
                        "lat": lat,
                        "lng": lng,
                        "title": ev.get("title") or "",
                        "detail": f"{ev.get('source', '')} · {ev.get('event_type', '')}".strip(" ·"),
                        "severity": "HIGH" if float(ev.get("score") or 0) > 0.72 else "MED",
                    })
                conf = float(row["confidence"] or 0)
                score = int(round(max(0.0, min(1.0, conf)) * 100))
                summary_bits = [str(x) for x in why[:2] if x]
                summary = " ".join(summary_bits) if summary_bits else (row["headline"] or "")
                rec = str(nxt[0]) if nxt else ""
                keys = row.keys()
                alerts_out.append({
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
                    "analystVerdict": row["analyst_verdict"] if "analyst_verdict" in keys else None,
                    "analystConfidence": row["analyst_confidence"] if "analyst_confidence" in keys else None,
                    "analystEscalation": row["analyst_escalation"] if "analyst_escalation" in keys else None,
                    "analystNarrative": row["analyst_narrative"] if "analyst_narrative" in keys else None,
                    "analystGaps": row["analyst_gaps"] if "analyst_gaps" in keys else None,
                    "analystActions": row["analyst_actions"] if "analyst_actions" in keys else None,
                })

    return {"liveEvents": live_events, "alerts": alerts_out, "dbMissing": False}


@app.get("/api/raw-data")
def raw_data(
    scope: str = Query("all"),
    domain: str = Query("all"),
    search: str = Query(""),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, object]:
    """Summaries plus a paginated sample from `unified_events` for the Data tab."""
    if not DB_PATH.is_file():
        return {
            "summary": {},
            "domains": [],
            "sources": [],
            "events": [],
            "matchingEvents": 0,
            "limit": limit,
            "offset": offset,
            "dbMissing": True,
        }

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        if not _table_exists(conn, "unified_events"):
            return {
                "summary": {},
                "domains": [],
                "sources": [],
                "events": [],
                "matchingEvents": 0,
                "limit": limit,
                "offset": offset,
                "dbMissing": True,
            }

        summary_row = conn.execute(
            """
            SELECT
                COUNT(*) AS total_events,
                SUM(CASE WHEN LOWER(COALESCE(is_live, '')) = 'true' THEN 1 ELSE 0 END) AS live_events,
                SUM(CASE WHEN LOWER(COALESCE(is_live, 'false')) != 'true' THEN 1 ELSE 0 END) AS historical_events,
                SUM(CASE WHEN LOWER(COALESCE(is_simulated, '')) = 'true' THEN 1 ELSE 0 END) AS simulated_events,
                COUNT(DISTINCT NULLIF(TRIM(source), '')) AS unique_sources,
                MAX(timestamp) AS latest_timestamp
            FROM unified_events
            """
        ).fetchone()

        where_all, params_all = _raw_data_where(
            scope=scope,
            domain=domain,
            search=search,
            include_domain=True,
        )
        where_no_domain, params_no_domain = _raw_data_where(
            scope=scope,
            domain=domain,
            search=search,
            include_domain=False,
        )

        matching_events = int(
            conn.execute(
                f"SELECT COUNT(*) FROM unified_events {where_all}",
                params_all,
            ).fetchone()[0]
            or 0
        )

        domain_rows = conn.execute(
            f"""
            SELECT
                COALESCE(NULLIF(LOWER(TRIM(domain)), ''), 'unknown') AS name,
                COUNT(*) AS count
            FROM unified_events
            {where_no_domain}
            GROUP BY 1
            ORDER BY count DESC, name ASC
            """,
            params_no_domain,
        ).fetchall()

        source_rows = conn.execute(
            f"""
            SELECT
                COALESCE(NULLIF(TRIM(source), ''), 'Unknown') AS name,
                COUNT(*) AS count
            FROM unified_events
            {where_all}
            GROUP BY 1
            ORDER BY count DESC, name ASC
            LIMIT 12
            """,
            params_all,
        ).fetchall()

        event_rows = conn.execute(
            f"""
            SELECT
                event_id,
                source,
                domain,
                event_type,
                title,
                description,
                timestamp,
                city,
                country,
                facility,
                severity,
                is_live,
                is_simulated
            FROM unified_events
            {where_all}
            ORDER BY timestamp DESC, event_id DESC
            LIMIT ? OFFSET ?
            """,
            [*params_all, limit, offset],
        ).fetchall()

    summary = {
        "total_events": int(summary_row["total_events"] or 0),
        "live_events": int(summary_row["live_events"] or 0),
        "historical_events": int(summary_row["historical_events"] or 0),
        "simulated_events": int(summary_row["simulated_events"] or 0),
        "unique_sources": int(summary_row["unique_sources"] or 0),
        "latest_timestamp": (
            _parse_ts(summary_row["latest_timestamp"])
            if summary_row["latest_timestamp"]
            else None
        ),
    }

    events = [
        {
            "id": row["event_id"] or "",
            "timestamp": _parse_ts(row["timestamp"]),
            "timestampRaw": row["timestamp"],
            "domain": (row["domain"] or "unknown").lower(),
            "source": row["source"] or "Unknown",
            "title": row["title"] or "(no title)",
            "description": row["description"] or "",
            "eventType": row["event_type"] or "",
            "region": _row_region(row),
            "severity": _severity_label(row["severity"]),
            "isLive": _boolish(row["is_live"]),
            "isSimulated": _boolish(row["is_simulated"]),
        }
        for row in event_rows
    ]

    return {
        "summary": summary,
        "domains": [{"name": row["name"], "count": int(row["count"] or 0)} for row in domain_rows],
        "sources": [{"name": row["name"], "count": int(row["count"] or 0)} for row in source_rows],
        "events": events,
        "matchingEvents": matching_events,
        "limit": limit,
        "offset": offset,
        "dbMissing": False,
    }


class AnalystChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(..., max_length=16_000)


class AnalystChatRequest(BaseModel):
    messages: list[AnalystChatMessage] = Field(..., max_length=40)
    context: dict[str, Any] | None = None


class VoiceSpeakRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=12_000)


class SynthesizeAlertRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=24_000)


@app.get("/api/analyst-chat/status")
def analyst_chat_status() -> dict[str, Any]:
    from correlation_engine.runtime import env
    from openai_model import resolve_chat_model
    key_ok = bool(env("OPENROUTER_API_KEY"))
    return {"configured": key_ok, "model": resolve_chat_model(for_analyst_chat=True)}


@app.post("/api/analyst-chat")
def analyst_chat(body: AnalystChatRequest) -> dict[str, str]:
    if not body.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")
    from openai_model import (
        build_analyst_chat_system_message, get_openrouter_client,
        openrouter_extra_headers, resolve_chat_model,
    )
    client = get_openrouter_client()
    model = resolve_chat_model(for_analyst_chat=True)
    if client is None or not model:
        raise HTTPException(status_code=503, detail="OpenRouter not configured.")
    system_content = build_analyst_chat_system_message(body.context)
    messages: list[dict[str, str]] = [{"role": "system", "content": system_content}]
    for m in body.messages[-32:]:
        messages.append({"role": m.role, "content": m.content})
    try:
        response = client.chat.completions.create(
            model=model, messages=messages,
            extra_headers=openrouter_extra_headers(),
            temperature=0.35, max_tokens=1024,
        )
        reply = (response.choices[0].message.content or "").strip()
    except Exception as exc:
        msg = str(exc)[:700]
        raise HTTPException(status_code=502, detail=f"OpenRouter failed: {msg}") from exc
    if not reply:
        raise HTTPException(status_code=502, detail="Empty model response")
    return {"reply": reply}


@app.post("/api/synthesize-alert")
def synthesize_alert_card(body: SynthesizeAlertRequest) -> dict[str, str]:
    from openai_model import get_openrouter_client, openrouter_extra_headers, resolve_chat_model
    client = get_openrouter_client()
    model = resolve_chat_model(for_analyst_chat=False)
    if client is None or not model:
        raise HTTPException(status_code=503, detail="OpenRouter not configured.")
    system_msg = (
        "Return a single JSON object only with keys: headline, summary, recommendation, uncertainty. "
        "All values must be strings. No markdown fences or preamble."
    )
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": body.prompt},
            ],
            extra_headers=openrouter_extra_headers(),
            temperature=0.25, max_tokens=600,
        )
        reply = (response.choices[0].message.content or "").strip()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenRouter failed: {str(exc)[:700]}") from exc
    if not reply:
        raise HTTPException(status_code=502, detail="Empty model response")
    parsed = _parse_llm_json_object(reply)
    if not parsed:
        raise HTTPException(status_code=502, detail="Model did not return valid JSON")
    out = {
        "headline": str(parsed.get("headline", "")).strip(),
        "summary": str(parsed.get("summary", "")).strip(),
        "recommendation": str(parsed.get("recommendation", "")).strip(),
        "uncertainty": str(parsed.get("uncertainty", "")).strip(),
    }
    if not out["headline"]:
        raise HTTPException(status_code=502, detail="JSON missing headline")
    return out


@app.get("/api/analyst-verdicts")
def analyst_verdicts() -> dict[str, Any]:
    if not DB_PATH.is_file():
        return {"verdicts": []}
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        if not _table_exists(conn, "correlation_alerts"):
            return {"verdicts": []}
        try:
            rows = conn.execute("""
                SELECT alert_id, headline, priority, confidence, location,
                       analyst_verdict, analyst_confidence, analyst_escalation,
                       analyst_narrative, analyst_gaps, analyst_actions, analyst_ran_at
                FROM correlation_alerts
                WHERE analyst_verdict IS NOT NULL
                ORDER BY confidence DESC
            """).fetchall()
        except Exception:
            return {"verdicts": []}
    return {"verdicts": [dict(r) for r in rows]}


@app.post("/api/run-analyst")
def run_analyst() -> dict[str, Any]:
    try:
        from run_analyst_on_alerts import run_analyst_on_all_alerts
        count = run_analyst_on_all_alerts(force=False)
        return {"status": "ok", "processed": count}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Analyst run failed: {str(exc)[:500]}") from exc


@app.get("/api/voice/status")
def api_voice_status() -> dict[str, Any]:
    return voice_status()


@app.post("/api/voice/transcribe")
async def api_voice_transcribe(
    file: UploadFile = File(...),
    context_json: str | None = Form(default=None),
) -> dict[str, Any]:
    if not voice_status()["stt"]:
        raise HTTPException(status_code=503, detail="ElevenLabs STT not configured.")
    context: Any = None
    if context_json:
        try:
            context = json.loads(context_json)
        except Exception:
            context = None
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Empty audio file.")
    try:
        return transcribe_audio_bytes(
            payload,
            filename=file.filename or "voice-input.webm",
            content_type=file.content_type or "audio/webm",
            context=context,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {str(exc)[:700]}") from exc


@app.post("/api/voice/speak")
def api_voice_speak(body: VoiceSpeakRequest) -> Response:
    if not voice_status()["tts"]:
        raise HTTPException(status_code=503, detail="ElevenLabs TTS not configured.")
    try:
        audio = synthesize_speech_bytes(body.text)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Voice synthesis failed: {str(exc)[:700]}") from exc
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store",
                 "Content-Disposition": 'inline; filename="aurora-voice.mp3"'},
    )


@app.post("/api/run-engine")
def run_engine() -> dict[str, str]:
    from correlation_engine import CorrelationConfig, CorrelationEngine
    engine = CorrelationEngine(CorrelationConfig(
        enable_remote_embeddings=True,
        enable_llm_synthesis=True,
        writeback=True,
    ))
    engine.run()
    return {"status": "ok"}
