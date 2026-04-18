from __future__ import annotations

import unittest

from elevenlabs_voice import (
    apply_domain_text_cleanup,
    build_keyterms,
    clean_transcript_result,
    summarize_transcript_confidence,
)


class ElevenLabsVoiceHelpersTest(unittest.TestCase):
    def test_domain_cleanup_normalizes_platform_terms(self) -> None:
        text = "show me aurora scatta alerts from open router and eleven labs"
        cleaned = apply_domain_text_cleanup(text)
        self.assertIn("AURORA", cleaned)
        self.assertIn("SCADA", cleaned)
        self.assertIn("OpenRouter", cleaned)
        self.assertIn("ElevenLabs", cleaned)

    def test_confidence_summary_flags_uncertain_words(self) -> None:
        avg, uncertain = summarize_transcript_confidence(
            [
                {"type": "word", "text": "hello", "logprob": -0.05},
                {"type": "word", "text": "scatta", "logprob": -1.2},
            ]
        )
        self.assertIsNotNone(avg)
        self.assertIn("scatta", uncertain)

    def test_clean_transcript_keeps_contextual_terms(self) -> None:
        result = clean_transcript_result(
            "brief me on the open router correlation engine",
            [],
            context={"selectedRegion": "Arlington", "alertHints": ["OpenRouter", "correlation engine"]},
        )
        self.assertIn("OpenRouter", result["text"])
        self.assertIn("correlation engine", result["text"].lower())

    def test_keyterms_include_core_domain_terms(self) -> None:
        terms = build_keyterms({"alertHints": ["Substation Alpha", "badge anomaly"]})
        self.assertIn("SCADA", terms)
        self.assertIn("badge anomaly", terms)
        self.assertIn("Substation Alpha", terms)


if __name__ == "__main__":
    unittest.main()
