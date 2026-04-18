from __future__ import annotations

import json
from typing import Any

from openai import OpenAI


def _rt():
    """Late import avoids correlation_engine → engine → openai_model cycles at package init."""
    from correlation_engine.runtime import ensure_vendor_path, env

    ensure_vendor_path()
    return env


def get_openrouter_client() -> OpenAI | None:
    """OpenAI SDK client pointed at OpenRouter. None if OPENROUTER_API_KEY is missing."""
    env = _rt()
    api_key = env("OPENROUTER_API_KEY")
    if not api_key:
        return None
    return OpenAI(
        base_url=env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        api_key=api_key,
    )


def openrouter_extra_headers() -> dict[str, str]:
    env = _rt()
    return {
        "HTTP-Referer": env("OPENROUTER_SITE_URL", "https://aurora.local"),
        "X-OpenRouter-Title": env("OPENROUTER_SITE_NAME", "AURORA"),
    }


def resolve_chat_model(*, for_analyst_chat: bool = False) -> str:
    """Model slug for OpenRouter. Analyst chat may override via AURORA_ANALYST_CHAT_MODEL."""
    env = _rt()
    if for_analyst_chat:
        return env("AURORA_ANALYST_CHAT_MODEL") or env("AURORA_CHAT_MODEL", "openai/gpt-4o-mini")
    # Avoid openai/gpt-oss-*:free by default — it often routes via OpenInference ("no healthy upstream" 503s).
    return env("AURORA_CHAT_MODEL", "openai/gpt-4o-mini")


def build_analyst_chat_system_message(context: dict[str, Any] | None) -> str:
    """
    System prompt for the dashboard analyst chat (same OpenRouter stack as alert synthesis).
    Keeps persona / fusion-center framing alongside optional UI context.
    """
    sys_parts = [
        "You are an AI analyst assistant for a cyber-physical correlation dashboard (AURORA). "
        "You work alongside the same kind of structured alert synthesis used elsewhere in the product "
        "(headline, why_it_matters-style reasoning, next actions). "
        "Each user message is accompanied by a JSON snapshot of the board: dashboardStats, "
        "correlatedAlerts (ranked incidents with scores and top signals), recentLiveFeed (latest raw signals), "
        "and selectedAlertDetail (extra depth when the operator clicked one incident; may be null). "
        "Use correlatedAlerts and recentLiveFeed for situational awareness; use selectedAlertDetail when present for depth. "
        "Respond in clear prose. Be concise; use short paragraphs or bullets when helpful. "
        "If context is incomplete, say what is missing and what to verify. "
        "Do not invent classified or private data.",
    ]
    if context:
        ctx_json = json.dumps(context, indent=2, default=str)[:14_000]
        sys_parts.append("Current dashboard snapshot (refreshed on each send):\n" + ctx_json)
    return "\n\n".join(sys_parts)


class AlertSynthesisClient:
    """Small wrapper for OpenRouter chat completions used by the alert composer."""

    def __init__(self, model: str | None = None, enabled: bool = True) -> None:
        self.enabled = enabled
        self.client = get_openrouter_client() if self.enabled else None
        self.model = model or resolve_chat_model(for_analyst_chat=False)

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
                extra_headers=openrouter_extra_headers(),
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
