from __future__ import annotations

import json
import math
import re
from typing import Any

import httpx

from correlation_engine.runtime import env


ELEVENLABS_BASE_URL = env("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io") or "https://api.elevenlabs.io"
DEFAULT_TTS_MODEL = env("ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5") or "eleven_flash_v2_5"
DEFAULT_TTS_VOICE_ID = env("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb") or "JBFqnCBsd6RMkjVDRZzb"
DEFAULT_TTS_OUTPUT_FORMAT = env("ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128") or "mp3_44100_128"
DEFAULT_STT_MODEL = env("ELEVENLABS_STT_MODEL", "scribe_v2") or "scribe_v2"

DOMAIN_GLOSSARY = [
    "AURORA",
    "ElevenLabs",
    "OpenRouter",
    "SCADA",
    "ICS",
    "OT",
    "CISA",
    "KEV",
    "GDELT",
    "AIID",
    "cyber-physical",
    "critical infrastructure",
    "correlation engine",
    "correlated alert",
    "badge anomaly",
    "port scan",
    "auth failure",
    "analyst chat",
    "incident envelope",
    "substation",
    "control-system telemetry",
    "physical security",
    "control system",
    "live signal",
    "OSINT",
]

_COMMON_STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "at",
    "be",
    "for",
    "from",
    "how",
    "i",
    "in",
    "is",
    "it",
    "me",
    "near",
    "of",
    "on",
    "or",
    "show",
    "that",
    "the",
    "this",
    "to",
    "us",
    "what",
    "with",
}

_TERM_REPLACEMENTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\beleven\s+labs\b", re.IGNORECASE), "ElevenLabs"),
    (re.compile(r"\bopen\s+router\b", re.IGNORECASE), "OpenRouter"),
    (re.compile(r"\baurora\b", re.IGNORECASE), "AURORA"),
    (re.compile(r"\bskyda\b|\bsca\s*da\b|\bscatta\b", re.IGNORECASE), "SCADA"),
    (re.compile(r"\bi\s*c\s*s\b", re.IGNORECASE), "ICS"),
    (re.compile(r"\bo\s*t\b", re.IGNORECASE), "OT"),
    (re.compile(r"\bg\s*d\s*e\s*l\s*t\b|\bg[\s-]*delta\b", re.IGNORECASE), "GDELT"),
    (re.compile(r"\bcisa\b", re.IGNORECASE), "CISA"),
    (re.compile(r"\bkev\b", re.IGNORECASE), "KEV"),
    (re.compile(r"\bosint\b", re.IGNORECASE), "OSINT"),
    (re.compile(r"\bcyber\s+physical\b", re.IGNORECASE), "cyber-physical"),
    (re.compile(r"\bportscan\b", re.IGNORECASE), "port scan"),
    (re.compile(r"\bauth(?:entication)?\s+failure\b", re.IGNORECASE), "auth failure"),
    (re.compile(r"\bbadge\s+anomal(?:y|ies)\b", re.IGNORECASE), "badge anomaly"),
)


def elevenlabs_configured() -> bool:
    return bool(env("ELEVENLABS_API_KEY"))


def voice_status() -> dict[str, Any]:
    key_ok = elevenlabs_configured()
    return {
        "tts": key_ok,
        "stt": key_ok,
        "ttsModel": DEFAULT_TTS_MODEL,
        "sttModel": DEFAULT_STT_MODEL,
        "voiceId": DEFAULT_TTS_VOICE_ID,
    }


def _headers() -> dict[str, str]:
    api_key = env("ELEVENLABS_API_KEY")
    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not configured.")
    return {"xi-api-key": api_key}


def _normalize_spacing(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.?!:;])", r"\1", text)
    return text


def _collect_context_terms(context: Any) -> list[str]:
    terms: list[str] = []
    seen: set[str] = set()

    def add_term(value: str) -> None:
        clean = _normalize_spacing(value)
        if not clean:
            return
        lowered = clean.lower()
        if lowered in seen:
            return
        if len(clean) > 48 or len(clean.split()) > 5:
            return
        seen.add(lowered)
        terms.append(clean)

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for item in value.values():
                walk(item)
            return
        if isinstance(value, list):
            for item in value:
                walk(item)
            return
        if not isinstance(value, str):
            return

        text = value.strip()
        if not text:
            return
        add_term(text)
        for token in re.findall(r"[A-Za-z0-9][A-Za-z0-9+./-]{1,30}", text):
            low = token.lower()
            if low not in _COMMON_STOP_WORDS:
                add_term(token)

    walk(context)
    return terms[:60]


def build_keyterms(context: Any = None) -> list[str]:
    terms: list[str] = []
    seen: set[str] = set()
    for term in [*DOMAIN_GLOSSARY, *_collect_context_terms(context)]:
        normalized = term.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        terms.append(normalized)
    return terms[:100]


def _word_confidence(word: dict[str, Any]) -> float | None:
    logprob = word.get("logprob")
    if logprob is None:
        return None
    try:
        score = math.exp(float(logprob))
    except Exception:
        return None
    return max(0.0, min(1.0, score))


def summarize_transcript_confidence(words: list[dict[str, Any]]) -> tuple[float | None, list[str]]:
    confidences: list[float] = []
    uncertain_terms: list[str] = []
    for word in words:
        if word.get("type") != "word":
            continue
        confidence = _word_confidence(word)
        if confidence is None:
            continue
        confidences.append(confidence)
        if confidence < 0.55 and len(uncertain_terms) < 8:
            token = str(word.get("text") or "").strip()
            if token:
                uncertain_terms.append(token)
    if not confidences:
        return None, uncertain_terms
    return round(sum(confidences) / len(confidences), 4), uncertain_terms


def apply_domain_text_cleanup(text: str) -> str:
    cleaned = _normalize_spacing(text)
    for pattern, replacement in _TERM_REPLACEMENTS:
        cleaned = pattern.sub(replacement, cleaned)
    cleaned = re.sub(r"\bics/scada\b", "ICS/SCADA", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bot\/ics\b", "OT/ICS", cleaned, flags=re.IGNORECASE)
    return _normalize_spacing(cleaned)


def _llm_should_repair(
    raw_text: str,
    cleaned_text: str,
    average_confidence: float | None,
    uncertain_terms: list[str],
) -> bool:
    if not raw_text.strip():
        return False
    if raw_text != cleaned_text:
        return True
    if average_confidence is not None and average_confidence < 0.82:
        return True
    if uncertain_terms:
        return True
    return False


def _repair_with_openrouter(
    cleaned_text: str,
    *,
    context: Any = None,
    glossary: list[str] | None = None,
) -> str | None:
    try:
        from openai_model import (
            get_openrouter_client,
            openrouter_extra_headers,
            resolve_chat_model,
        )
    except Exception:
        return None

    client = get_openrouter_client()
    if client is None:
        return None

    prompt_payload = {
        "transcript": cleaned_text,
        "glossary": glossary or DOMAIN_GLOSSARY,
        "context": context or {},
        "instructions": [
            "Fix likely speech-to-text mistakes and technical term confusion.",
            "Keep the original user intent.",
            "Do not add new requests, facts, or detail.",
            "Prefer glossary and context terms when they clearly match the audio intent.",
            "Return strict JSON with keys text and changed.",
        ],
    }

    try:
        response = client.chat.completions.create(
            model=resolve_chat_model(for_analyst_chat=True),
            messages=[
                {"role": "system", "content": "Return strict JSON only."},
                {"role": "user", "content": json.dumps(prompt_payload, ensure_ascii=True)},
            ],
            extra_headers=openrouter_extra_headers(),
            temperature=0.0,
            max_tokens=220,
        )
        content = (response.choices[0].message.content or "").strip()
        start = content.find("{")
        end = content.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        payload = json.loads(content[start : end + 1])
        repaired = str(payload.get("text") or "").strip()
        if not repaired:
            return None
        return apply_domain_text_cleanup(repaired)
    except Exception:
        return None


def clean_transcript_result(raw_text: str, words: list[dict[str, Any]], context: Any = None) -> dict[str, Any]:
    average_confidence, uncertain_terms = summarize_transcript_confidence(words)
    cleaned_text = apply_domain_text_cleanup(raw_text)

    used_llm_repair = False
    if _llm_should_repair(raw_text, cleaned_text, average_confidence, uncertain_terms):
        repaired = _repair_with_openrouter(
            cleaned_text,
            context=context,
            glossary=build_keyterms(context),
        )
        if repaired:
            cleaned_text = repaired
            used_llm_repair = True

    return {
        "rawText": raw_text.strip(),
        "text": cleaned_text.strip(),
        "averageConfidence": average_confidence,
        "uncertainTerms": uncertain_terms,
        "usedLlmRepair": used_llm_repair,
        "cleanupApplied": cleaned_text.strip() != raw_text.strip(),
    }


def transcribe_audio_bytes(
    audio_bytes: bytes,
    *,
    filename: str = "voice-input.webm",
    content_type: str = "audio/webm",
    context: Any = None,
) -> dict[str, Any]:
    if not audio_bytes:
        raise RuntimeError("Audio payload was empty.")

    url = f"{ELEVENLABS_BASE_URL.rstrip('/')}/v1/speech-to-text"
    multipart_files: list[tuple[str, tuple[str | None, bytes | str, str | None]]] = [
        ("model_id", (None, DEFAULT_STT_MODEL, None))
    ]
    for term in build_keyterms(context):
        multipart_files.append(("keyterms", (None, term, None)))
    multipart_files.append(
        ("file", (filename, audio_bytes, content_type or "application/octet-stream"))
    )

    response = httpx.post(
        url,
        headers=_headers(),
        files=multipart_files,
        timeout=httpx.Timeout(90.0),
    )
    response.raise_for_status()

    payload = response.json()
    words = payload.get("words") or []
    return clean_transcript_result(str(payload.get("text") or ""), words, context=context)


def synthesize_speech_bytes(
    text: str,
    *,
    voice_id: str | None = None,
    model_id: str | None = None,
    output_format: str | None = None,
) -> bytes:
    clean_text = _normalize_spacing(text)
    if not clean_text:
        raise RuntimeError("Text payload was empty.")

    target_voice = voice_id or DEFAULT_TTS_VOICE_ID
    target_model = model_id or DEFAULT_TTS_MODEL
    target_format = output_format or DEFAULT_TTS_OUTPUT_FORMAT
    url = f"{ELEVENLABS_BASE_URL.rstrip('/')}/v1/text-to-speech/{target_voice}"

    payload = {
        "text": clean_text[:2500],
        "model_id": target_model,
        "voice_settings": {
            "stability": 0.45,
            "similarity_boost": 0.82,
            "style": 0.2,
            "use_speaker_boost": True,
        },
    }

    response = httpx.post(
        url,
        headers={**_headers(), "Content-Type": "application/json"},
        params={"output_format": target_format},
        json=payload,
        timeout=httpx.Timeout(90.0),
    )
    response.raise_for_status()
    return response.content
