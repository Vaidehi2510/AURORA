from __future__ import annotations

import json
import os
import time
from typing import Any

from openai_model import get_openrouter_client, openrouter_extra_headers

# ============================================================
# MODEL CONFIG
# ============================================================

PRIMARY_MODEL = "meta-llama/llama-3.3-70b-instruct:free"
DEV_FALLBACK_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"

# Modes:
# - meta_strict: only Llama 3.3
# - meta_with_retry: only Llama 3.3, with retries
# - resilient_dev: Llama 3.3 first, then Nemotron fallback
ANALYST_MODE = os.getenv("AURORA_ANALYST_MODE", "meta_with_retry")

# ============================================================
# SYSTEM PROMPT
# ============================================================

SYSTEM_PROMPT = """You are AURORA's Senior Intelligence Analyst — a seasoned cyber-physical threat analyst with 20 years of experience at NSA, CISA, and DHS.

AURORA is NOT a SIEM. It sits above cyber tools, physical security systems, and OSINT sources to determine whether correlated multi-domain activity is likely real, benign, a false positive, or still inconclusive.

Your job is to receive a correlated alert from AURORA's detection engine and produce a finished SOC-friendly operational assessment that a duty officer, SOC lead, or incident response lead could read immediately.

You are skeptical, rigorous, conservative, and precise.
You challenge weak correlations.
You do not overstate certainty.
You do not speculate beyond the evidence.

Write in plain operational English.

Your response must use this exact structure:

AURORA ASSESSMENT: one of the following
- True Positive
- False Positive
- Benign / Non-Threat
- Inconclusive

Escalation Recommendation: one of the following
- Escalate to IR
- Monitor Locally
- No Escalation

Confidence: X/100

What happened:
2-4 sentences explaining what likely happened, in chronological order if possible.

Why AURORA thinks this:
2-3 sentences explaining why the cyber, physical, and/or OSINT signals appear related or not related.

Operational gaps identified:
- 2 to 4 bullet points listing what is still missing, uncertain, or required to validate the assessment

Recommended next actions:
1. first action
2. second action
3. third action

Rules:
- Be conservative.
- Use "True Positive" only when the evidence strongly supports a real coordinated malicious event.
- Use "False Positive" when the system correlated events that do not actually support a real coordinated threat.
- Use "Benign / Non-Threat" when the activity appears routine, harmless, or operationally normal.
- Use "Inconclusive" when the evidence is insufficient to make a confident judgment.
- "Escalate to IR" should be used only when the event likely requires incident response engagement.
- "Monitor Locally" should be used when the event needs validation or watchful follow-up but not full IR escalation yet.
- "No Escalation" should be used when the event appears benign or false positive.
- Do not use JSON.
- Do not use markdown code fences.
- Do not mention model names.
- Do not mention fallback logic or prior model failures.
"""

# ============================================================
# MODEL ROUTING
# ============================================================

def get_model_sequence() -> list[str]:
    if ANALYST_MODE == "meta_strict":
        return [PRIMARY_MODEL]

    if ANALYST_MODE == "meta_with_retry":
        return [PRIMARY_MODEL]

    if ANALYST_MODE == "resilient_dev":
        return [
            PRIMARY_MODEL,
            DEV_FALLBACK_MODEL,
        ]

    return [PRIMARY_MODEL]


def call_analyst_model(messages: list[dict[str, str]], max_tokens: int = 1200) -> dict[str, Any]:
    client = get_openrouter_client()
    models = get_model_sequence()

    last_error = None

    headers = openrouter_extra_headers()
    if headers is None:
        headers = {}

    for model in models:
        # PRIMARY_MODEL gets 3 total attempts: first + 2 retries
        retry_delays = [0, 2, 5] if model == PRIMARY_MODEL else [0]

        for delay in retry_delays:
            if delay > 0:
                time.sleep(delay)

            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=0.2,
                    max_tokens=max_tokens,
                    extra_headers=headers,
                )

                if response is None:
                    raise RuntimeError(f"Model {model} returned None response")

                if not hasattr(response, "choices") or response.choices is None or len(response.choices) == 0:
                    raise RuntimeError(f"Model {model} returned no choices")

                message = response.choices[0].message
                if message is None:
                    raise RuntimeError(f"Model {model} returned empty message object")

                content = getattr(message, "content", None)
                if content is None or not str(content).strip():
                    raise RuntimeError(f"Model {model} returned empty content")

                return {
                    "model_used": model,
                    "content": str(content).strip(),
                }

            except Exception as e:
                last_error = e
                err = str(e)

                # Retry only rate limits on primary Meta model
                if model == PRIMARY_MODEL and "429" in err:
                    continue

                # Skip unavailable endpoints
                if "404" in err or "No endpoints found" in err:
                    break

                # Any other failure: move to next model
                break

    raise RuntimeError(f"AURORA analyst model failed. Last error: {last_error}")

# ============================================================
# RULE-BASED ASSESSMENT + ESCALATION GROUNDING
# ============================================================

def derive_system_assessment(alert_payload: dict[str, Any]) -> tuple[str, str, int]:
    cluster_conf = int(alert_payload.get("confidence_score", 0))
    evidence = alert_payload.get("supporting_evidence", [])
    summary = str(alert_payload.get("summary", "")).lower()
    why_connected = str(alert_payload.get("why_connected", "")).lower()

    text = f"{summary} {why_connected}"

    has_cyber = "cyber" in text
    has_physical = "physical" in text
    has_osint = "osint" in text

    strong_evidence_count = 0
    for ev in evidence:
        try:
            score = int(ev.get("match_score", 0))
        except Exception:
            score = 0

        reason = str(ev.get("reason_for_match", "")).lower()
        source = str(ev.get("source", "")).lower()

        if score >= 8:
            strong_evidence_count += 1
        elif "same infrastructure type" in reason:
            strong_evidence_count += 1
        elif "keyword overlap" in reason and source in {"cisa_ics", "aiid", "gdelt", "cisa_kev"}:
            strong_evidence_count += 1

    # Assessment logic
    if cluster_conf >= 80 and has_cyber and has_physical and strong_evidence_count >= 2:
        assessment = "True Positive"
        escalation = "Escalate to IR"
    elif cluster_conf >= 65 and (has_cyber and has_physical or has_cyber and has_osint or has_physical and has_osint) and strong_evidence_count >= 1:
        assessment = "Inconclusive"
        escalation = "Monitor Locally"
    elif cluster_conf < 45 and strong_evidence_count == 0:
        assessment = "Benign / Non-Threat"
        escalation = "No Escalation"
    elif cluster_conf < 55 and strong_evidence_count <= 1:
        assessment = "False Positive"
        escalation = "No Escalation"
    else:
        assessment = "Inconclusive"
        escalation = "Monitor Locally"

    return assessment, escalation, cluster_conf

# ============================================================
# PROMPT BUILDER
# ============================================================

def build_user_prompt(alert_payload: dict[str, Any]) -> str:
    system_assessment, system_escalation, system_confidence = derive_system_assessment(alert_payload)

    return f"""
Analyze the following correlated AURORA alert and produce a final SOC-style operational assessment.

System-grounded assessment: {system_assessment}
System-grounded escalation recommendation: {system_escalation}
System confidence score: {system_confidence}/100

Use these system-grounded values as strong anchors unless the alert payload clearly contradicts them. Be conservative and avoid overstating certainty.

ALERT INPUT:
{json.dumps(alert_payload, indent=2)}
""".strip()

# ============================================================
# MAIN ANALYST ENTRYPOINT
# ============================================================

def run_senior_analyst(alert_payload: dict[str, Any], max_tokens: int = 1200) -> dict[str, Any]:
    user_prompt = build_user_prompt(alert_payload)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    result = call_analyst_model(messages, max_tokens=max_tokens)

    return {
        "analysis_text": result["content"].strip(),
        "_meta": {
            "model_used": result["model_used"],
            "analyst_mode": ANALYST_MODE,
        },
    }

# ============================================================
# OPTIONAL TEST RUNNER
# ============================================================

if __name__ == "__main__":
    sample_alert_payload = {
        "alert_id": "ALERT-TEST-001",
        "cluster_event_ids": ["SIM1", "SIM2", "SIM3", "SIM4"],
        "facility": "substation_alpha",
        "city": "Washington",
        "country": "US",
        "timestamp_window": "2026-04-18T14:30:00 to 2026-04-18T14:39:00",
        "confidence_score": 82,
        "summary": "AURORA detected multi-domain activity involving cyber, physical, and osint signals at substation_alpha.",
        "why_connected": "Events occurred within the same operational window and share location context. The cluster includes port scanning, authentication failure, badge anomaly, and outage reporting activity.",
        "recommended_action": "Escalate to analyst review, validate cyber and physical telemetry, and assess whether critical infrastructure operations require protective action.",
        "supporting_evidence": [
            {
                "event_id": "4654",
                "source": "CISA_ICS",
                "title": "Schneider Electric SCADAPack and RemoteConnect",
                "description": "SCADAPack 57x All Versions, RemoteConnect Versions prior to R3.4.2",
                "reason_for_match": "keyword overlap",
                "match_score": 10
            },
            {
                "event_id": "ICS-8",
                "source": "CISA_ICS",
                "title": "Substation automation exploit",
                "description": "Attackers can interfere with substation control systems",
                "reason_for_match": "same infrastructure type, keyword overlap",
                "match_score": 9
            }
        ]
    }

    result = run_senior_analyst(sample_alert_payload)
    print(result["analysis_text"])