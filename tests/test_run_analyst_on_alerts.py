from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import run_analyst_on_alerts


class RunAnalystOnAlertsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "aurora-test.db"

        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE correlation_alerts (
                    alert_id TEXT,
                    cluster_id TEXT,
                    priority TEXT,
                    confidence REAL,
                    time_window_start TEXT,
                    time_window_end TEXT,
                    location TEXT,
                    headline TEXT,
                    why_it_matters TEXT,
                    next_actions TEXT,
                    analyst_notes TEXT,
                    evidence TEXT,
                    supporting_priors TEXT,
                    cluster_features TEXT,
                    cluster_metrics TEXT,
                    top_edges TEXT,
                    raw_json TEXT
                )
                """
            )
            conn.execute(
                """
                INSERT INTO correlation_alerts (
                    alert_id, cluster_id, priority, confidence, time_window_start, time_window_end,
                    location, headline, why_it_matters, next_actions, analyst_notes, evidence,
                    supporting_priors, cluster_features, cluster_metrics, top_edges, raw_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "ALERT-TEST-001",
                    "CLUSTER-001",
                    "critical",
                    0.87,
                    "2026-04-18T14:30:00+00:00",
                    "2026-04-18T14:50:00+00:00",
                    "Substation Alpha",
                    "Potential coordinated cyber-physical activity around Substation Alpha",
                    '["3 domains corroborate the same activity pattern.", "24 events fell inside the incident window."]',
                    '["Validate telemetry immediately.", "Review access records."]',
                    "[]",
                    '[{"event_id":"SIM1","domain":"cyber","source":"SIM","event_type":"port_scan","title":"ICS port scan","score":1.0}]',
                    "[]",
                    "{}",
                    "{}",
                    "[]",
                    "{}",
                ),
            )
            conn.commit()

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_run_analyst_adds_columns_and_updates_alerts(self) -> None:
        analysis_text = """
AURORA ASSESSMENT: True Positive
Escalation Recommendation: Escalate to IR
Confidence: 87/100

What happened:
Cyber and physical signals aligned around the same facility in a tight window.

Why AURORA thinks this:
The evidence shows consistent multi-domain corroboration.

Operational gaps identified:
- Need operator confirmation
- Need maintenance check

Recommended next actions:
1. Validate controller telemetry
2. Review access logs
3. Notify incident response
        """.strip()

        with patch.object(
            run_analyst_on_alerts,
            "run_senior_analyst",
            return_value={"analysis_text": analysis_text},
        ):
            processed = run_analyst_on_alerts.run_analyst_on_all_alerts(db_path=self.db_path)

        self.assertEqual(processed, 1)

        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            columns = {row[1] for row in conn.execute("PRAGMA table_info(correlation_alerts)").fetchall()}
            self.assertIn("analyst_verdict", columns)
            self.assertIn("analyst_actions", columns)

            row = conn.execute(
                """
                SELECT analyst_verdict, analyst_confidence, analyst_escalation,
                       analyst_narrative, analyst_gaps, analyst_actions, analyst_ran_at
                FROM correlation_alerts
                WHERE alert_id = 'ALERT-TEST-001'
                """
            ).fetchone()

        self.assertEqual(row["analyst_verdict"], "True Positive")
        self.assertEqual(row["analyst_confidence"], "87/100")
        self.assertEqual(row["analyst_escalation"], "Escalate to IR")
        self.assertIn("Cyber and physical signals aligned", row["analyst_narrative"])
        self.assertIn("Need operator confirmation", row["analyst_gaps"])
        self.assertIn("Validate controller telemetry", row["analyst_actions"])
        self.assertTrue(row["analyst_ran_at"])


if __name__ == "__main__":
    unittest.main()
