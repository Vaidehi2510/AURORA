from __future__ import annotations

import json
from typing import Any

from correlation_engine.runtime import env, ensure_vendor_path

ensure_vendor_path()

from openai import OpenAI


class AlertSynthesisClient:
    """Small wrapper for OpenRouter chat completions used by the alert composer."""

    def __init__(self, model: str | None = None, enabled: bool = True) -> None:
        self.enabled = enabled
        api_key = env("OPENROUTER_API_KEY")
        self.client = None
        if self.enabled and api_key:
            self.client = OpenAI(
                base_url=env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
                api_key=api_key,
            )
        self.model = model or env("AURORA_CHAT_MODEL", "openai/gpt-oss-120b:free")

    def synthesize_alert(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        if self.client is None:
            return None

        prompt = (
            "You are generating a concise cyber-physical alert JSON object for a SOC analyst. "
            "Respond with valid JSON only, using keys: headline, why_it_matters, next_actions, analyst_notes. "
            "Keep why_it_matters and next_actions to three short bullets each.\n\n"
            f"Alert input:\n{json.dumps(payload, indent=2)}"
        )

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "Return strict JSON and no markdown."},
                    {"role": "user", "content": prompt},
                ],
                extra_headers={
                    "HTTP-Referer": env("OPENROUTER_SITE_URL", "https://aurora.local"),
                    "X-OpenRouter-Title": env("OPENROUTER_SITE_NAME", "AURORA"),
                },
                temperature=0.2,
            )
            content = response.choices[0].message.content or ""
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                start = content.find("{")
                end = content.rfind("}")
                if start != -1 and end != -1 and end > start:
                    return json.loads(content[start : end + 1])
        except Exception:
            return None
        return None
