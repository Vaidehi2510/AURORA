from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import api


class RawDataApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "aurora-test.db"
        self.original_db_path = api.DB_PATH
        api.DB_PATH = self.db_path

        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE unified_events (
                    event_id TEXT,
                    source TEXT,
                    domain TEXT,
                    record_type TEXT,
                    is_live TEXT,
                    is_simulated TEXT,
                    source_priority INTEGER,
                    event_type TEXT,
                    title TEXT,
                    description TEXT,
                    timestamp TEXT,
                    country TEXT,
                    city TEXT,
                    facility TEXT,
                    sector TEXT,
                    infrastructure_type TEXT,
                    severity TEXT,
                    impact_type TEXT,
                    physical_consequence TEXT,
                    critical_service_impact TEXT,
                    technique_id TEXT,
                    vulnerability TEXT,
                    risk_domain TEXT,
                    risk_subdomain TEXT,
                    intent TEXT,
                    failure_type TEXT,
                    tags TEXT,
                    ingested_at TEXT
                )
                """
            )
            conn.executemany(
                """
                INSERT INTO unified_events (
                    event_id, source, domain, record_type, is_live, is_simulated, source_priority,
                    event_type, title, description, timestamp, country, city, facility, sector,
                    infrastructure_type, severity, impact_type, physical_consequence,
                    critical_service_impact, technique_id, vulnerability, risk_domain,
                    risk_subdomain, intent, failure_type, tags, ingested_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        "SIM1",
                        "SIM",
                        "cyber",
                        "live_signal",
                        "true",
                        "true",
                        1,
                        "malware",
                        "SCADA anomaly",
                        "Outbound connection spike",
                        "2026-04-18T18:00:00Z",
                        "USA",
                        "Arlington",
                        "Plant 1",
                        "",
                        "",
                        "HIGH",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "2026-04-18T18:01:00Z",
                    ),
                    (
                        "HIST1",
                        "GDELT",
                        "osint",
                        "osint_signal",
                        "false",
                        "false",
                        2,
                        "news_event",
                        "Water outage report",
                        "Service interruption reported by local media",
                        "2026-04-17T12:00:00Z",
                        "USA",
                        "Bethesda",
                        "",
                        "",
                        "",
                        "MED",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "2026-04-17T12:01:00Z",
                    ),
                    (
                        "LIVE2",
                        "SensorNet",
                        "physical",
                        "live_signal",
                        "true",
                        "false",
                        1,
                        "badge_alarm",
                        "Badge anomaly",
                        "Unexpected after-hours access",
                        "2026-04-18T17:30:00Z",
                        "USA",
                        "Arlington",
                        "HQ",
                        "",
                        "",
                        "LOW",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "2026-04-18T17:31:00Z",
                    ),
                ],
            )
            conn.commit()

        self.client = TestClient(api.app)

    def tearDown(self) -> None:
        api.DB_PATH = self.original_db_path
        self.tempdir.cleanup()

    def test_raw_data_returns_summary_and_filtered_rows(self) -> None:
        response = self.client.get(
            "/api/raw-data",
            params={"scope": "live", "domain": "cyber", "search": "scada", "limit": 50, "offset": 0},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()

        self.assertFalse(payload["dbMissing"])
        self.assertEqual(payload["matchingEvents"], 1)
        self.assertEqual(payload["limit"], 50)
        self.assertEqual(payload["offset"], 0)
        self.assertEqual(payload["summary"]["total_events"], 3)
        self.assertEqual(payload["summary"]["live_events"], 2)
        self.assertEqual(payload["summary"]["historical_events"], 1)
        self.assertEqual(payload["summary"]["simulated_events"], 1)
        self.assertEqual(payload["summary"]["unique_sources"], 3)

        self.assertEqual(len(payload["events"]), 1)
        event = payload["events"][0]
        self.assertEqual(event["id"], "SIM1")
        self.assertEqual(event["domain"], "cyber")
        self.assertEqual(event["source"], "SIM")
        self.assertEqual(event["region"], "Plant 1 · Arlington · USA")
        self.assertTrue(event["isLive"])
        self.assertTrue(event["isSimulated"])

        self.assertEqual(payload["domains"][0]["name"], "cyber")
        self.assertEqual(payload["domains"][0]["count"], 1)
        self.assertEqual(payload["sources"][0]["name"], "SIM")
        self.assertEqual(payload["sources"][0]["count"], 1)


if __name__ == "__main__":
    unittest.main()
