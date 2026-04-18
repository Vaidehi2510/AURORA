from __future__ import annotations

import unittest

from correlation_engine import CorrelationConfig, CorrelationEngine


class CorrelationEngineSmokeTest(unittest.TestCase):
    def test_engine_finds_simulated_cluster_without_remote_calls(self) -> None:
        engine = CorrelationEngine(
            CorrelationConfig(
                enable_remote_embeddings=False,
                enable_llm_synthesis=False,
                writeback=False,
            )
        )
        results = engine.run()

        alerts = results["alerts"]
        clusters = results["clusters"]

        self.assertGreaterEqual(len(clusters), 1)
        self.assertTrue((clusters["contains_live"]).any())
        self.assertGreaterEqual(len(alerts), 1)

        top_alert = alerts.sort_values("confidence", ascending=False).iloc[0]
        evidence_ids = {item["event_id"] for item in top_alert["evidence"]}
        self.assertTrue({"SIM1", "SIM2", "SIM3", "SIM4"}.issubset(evidence_ids))


if __name__ == "__main__":
    unittest.main()
