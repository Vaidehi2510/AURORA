from __future__ import annotations

import json
import re
from typing import Any
from openai_model import get_openrouter_client, openrouter_extra_headers

ANALYST_MODEL = "meta-llama/llama-4-scout"

SYSTEM_PROMPT = """You are AURORA's Senior Intelligence Analyst — a seasoned cyber-physical threat analyst with 20 years of experience at NSA, CISA, and DHS.

Your job is to receive a correlated alert from AURORA's detection engine and produce a FINISHED INTELLIGENCE PRODUCT — the kind a duty officer would read before deciding whether to escalate to an incident response team.

You are skeptical, rigorous, and precise. You challenge weak correlations. You cite specific evidence. You never speculate beyond what the data supports.

Your output must follow this exact JSON structure:
{
  "analyst_verdict": "CONFIRMED THREAT | PROBABLE THREAT | POSSIBLE THREAT | LIKELY BENIGN | INSUFFICIENT DATA",
  "confidence_assessment": {
    "score": 0-100,
    "rationale": "2-3 sentences explaining exactly why this score"
  },
  "threat_narrative": "3-4 sentence plain-English story of what likely happened in chronological order",
  "evidence_evaluation": [
    {
      "event": "event description",
      "credibility": "HIGH | MEDIUM | LOW",
      "reasoning": "one sentence"
    }
  ],
  "historical_precedent": {
    "best_match": "name of closest historical incident",
    "similarity": "what matches and what differs",
    "outcome": "what happened in that historical case"
  },
  "critical_gaps": ["what is missing that would confirm or deny this threat"],
  "recommended_actions": [
    {
      "priority": "IMMEDIATE | WITHIN_1HR | WITHIN_24HR",
      "action": "specific actionable step",
      "owner": "who should do this"
    }
  ],
  "escalate": true or false,
  "escalation_rationale": "one sentence why escalate or why not"
}

Return strict JSON only. No markdown. No backticks. No preamble."""


def _clean_json(raw: str) -> str:
    cleaned = raw.strip()
    cleaned = re.sub(r"^```json\s*", "", cleaned)
    cleaned = re.sub(r"^```\s*", "", cleaned)
    cleaned = re.sub(r"```\s*$", "", cleaned).strip()
    return cleaned


def _parse_response(raw: str) -> dict | None:
    cleaned = _clean_json(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(cleaned[start:end + 1])
            except json.JSONDecodeError:
                pass
    return None


class SeniorAnalystAgent:
    def __init__(self) -> None:
        self.client = get_openrouter_client()
        self.model = ANALYST_MODEL

    def analyze(self, alert: dict[str, Any]) -> dict[str, Any] | None:
        if self.client is None:
            print("No OpenRouter client — check OPENROUTER_API_KEY in .env")
            return None

        alert_summary = {
            "headline": alert.get("headline", ""),
            "priority": alert.get("priority", ""),
            "confidence": alert.get("confidence", 0),
            "location": alert.get("location", ""),
            "time_window_start": alert.get("time_window_start", ""),
            "time_window_end": alert.get("time_window_end", ""),
            "why_it_matters": alert.get("why_it_matters", []),
            "evidence": alert.get("evidence", [])[:8],
            "supporting_priors": alert.get("supporting_priors", [])[:4],
            "top_edges": alert.get("top_edges", [])[:5],
            "cluster_metrics": alert.get("cluster_metrics", {}),
        }

        prompt = (
            "The AURORA cyber-physical correlation engine has fired the following alert. "
            "Perform your senior analyst review and return your finished intelligence assessment.\n\n"
            "AURORA ALERT:\n"
            + json.dumps(alert_summary, indent=2, default=str)
        )

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                extra_headers=openrouter_extra_headers(),
                temperature=0.1,
            )
            raw = response.choices[0].message.content or ""
            result = _parse_response(raw)
            if result is None:
                print("JSON parse failed. Raw output:\n" + raw[:500])
            return result
        except Exception as e:
            print("Analyst agent error: " + str(e))
            return None

    def analyze_with_vision(
        self,
        alert: dict[str, Any],
        frame_path: str | None = None,
    ) -> dict[str, Any] | None:
        if self.client is None:
            print("No OpenRouter client — check OPENROUTER_API_KEY in .env")
            return None

        alert_summary = {
            "headline": alert.get("headline", ""),
            "priority": alert.get("priority", ""),
            "confidence": alert.get("confidence", 0),
            "location": alert.get("location", ""),
            "evidence": alert.get("evidence", [])[:8],
            "supporting_priors": alert.get("supporting_priors", [])[:4],
        }

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT}
        ]

        if frame_path:
            import base64
            try:
                with open(frame_path, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode()
                messages.append({
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": "data:image/jpeg;base64," + b64
                            }
                        },
                        {
                            "type": "text",
                            "text": (
                                "This is the camera frame that triggered AURORA's physical anomaly detection. "
                                "DINOv2 flagged this frame as anomalous and SAM segmented the object of interest. "
                                "Analyze what you see in the image, then review the full AURORA alert below "
                                "and produce your senior analyst assessment.\n\n"
                                "AURORA ALERT:\n"
                                + json.dumps(alert_summary, indent=2, default=str)
                            )
                        }
                    ]
                })
            except Exception as e:
                print("Could not load frame: " + str(e))
                messages.append({
                    "role": "user",
                    "content": (
                        "AURORA ALERT:\n"
                        + json.dumps(alert_summary, indent=2, default=str)
                    )
                })
        else:
            messages.append({
                "role": "user",
                "content": (
                    "AURORA ALERT:\n"
                    + json.dumps(alert_summary, indent=2, default=str)
                )
            })

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                extra_headers=openrouter_extra_headers(),
                temperature=0.1,
            )
            raw = response.choices[0].message.content or ""
            result = _parse_response(raw)
            if result is None:
                print("Vision JSON parse failed. Raw output:\n" + raw[:500])
            return result
        except Exception as e:
            print("Vision analyst error: " + str(e))
            return None

    def analyze_with_vision_and_bbox(
        self,
        alert: dict[str, Any],
        frame_path: str,
        bbox: list[int],
    ) -> dict[str, Any] | None:
        from PIL import Image, ImageDraw
        import base64, io

        try:
            img = Image.open(frame_path).convert("RGB")
            draw = ImageDraw.Draw(img)
            x1, y1, x2, y2 = bbox
            draw.rectangle([x1, y1, x2, y2], outline=(255, 0, 0), width=3)
            buf = io.BytesIO()
            img.save(buf, format="JPEG")
            b64 = base64.b64encode(buf.getvalue()).decode()
        except Exception as e:
            print("Could not annotate frame: " + str(e))
            return self.analyze(alert)

        alert_summary = {
            "headline": alert.get("headline", ""),
            "priority": alert.get("priority", ""),
            "confidence": alert.get("confidence", 0),
            "location": alert.get("location", ""),
            "evidence": alert.get("evidence", [])[:8],
            "supporting_priors": alert.get("supporting_priors", [])[:4],
        }

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": "data:image/jpeg;base64," + b64}
                    },
                    {
                        "type": "text",
                        "text": (
                            "This camera frame was captured at " + alert.get("location", "the facility") + ". "
                            "The RED BOUNDING BOX was drawn by Meta SAM after DINOv2 detected an anomaly. "
                            "This is the object that triggered AURORA's physical domain alert. "
                            "Analyze what you see inside the red box, assess the threat, "
                            "then review the full correlated alert and produce your intelligence assessment.\n\n"
                            "AURORA ALERT:\n"
                            + json.dumps(alert_summary, indent=2, default=str)
                        )
                    }
                ]
            }
        ]

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                extra_headers=openrouter_extra_headers(),
                temperature=0.1,
            )
            raw = response.choices[0].message.content or ""
            result = _parse_response(raw)
            if result is None:
                print("BBox vision parse failed. Raw:\n" + raw[:500])
            return result
        except Exception as e:
            print("BBox vision analyst error: " + str(e))
            return None
