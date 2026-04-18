from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from correlation_engine import CorrelationConfig, CorrelationEngine


def main() -> None:
    engine = CorrelationEngine(
        CorrelationConfig(
            enable_remote_embeddings=True,
            enable_llm_synthesis=True,
            writeback=True,
        )
    )
    results = engine.run()
    alerts = results["alerts"]
    clusters = results["clusters"]
    edges = results["edges"]

    summary = {
        "generated_at": results["generated_at"],
        "alerts": len(alerts),
        "clusters": len(clusters),
        "edges": len(edges),
        "top_alerts": alerts[
            ["alert_id", "priority", "confidence", "headline", "location"]
        ].to_dict(orient="records")
        if not alerts.empty
        else [],
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
