# AURORA
### Cyber-Physical Threat Intelligence

> *Detect the signal. Before it becomes the storm.*

AURORA is an early warning system for critical infrastructure. It watches network activity, physical camera feeds, and global intelligence simultaneously — connecting signals across all three domains in real time to detect coordinated attack setup before physical assets are reached. The correlation is bidirectional: a network anomaly surfaces physical assets at risk, and a physical event traces back into the network to identify what cyber activity preceded it.

Built at the **DC Critical Ops Hackathon 2026** for Problem Statement A: Cyber-Physical Correlation Engine.


---

## The Problem

Today's security tools are siloed. Your network team sees a port scan. Your physical security team sees a badge anomaly. Your threat intelligence team sees a regional news report. Nobody connects them.

In December 2015, attackers cut power to 230,000 people in Ukraine by coordinating cyber reconnaissance, physical interference, and communications disruption simultaneously. Every security system saw a different piece. Nobody saw the whole picture. The attack caused $220M in damage and was preventable if anyone had connected the signals in time.

AURORA closes that gap.

---

## How It Works

A single network anomaly fires at 2am. AURORA does not wait for a physical event to confirm the threat.

It immediately searches 3,557 real-world incidents — government advisories, known exploits, ICS attack techniques, global news — and asks: has this pattern appeared before? What physical assets were targeted next? Do we have similar assets right now?

If the answer is yes, it warns the operator before the attacker reaches the physical asset.

If a physical anomaly fires first, AURORA runs the correlation in reverse — tracing back into the network to surface what cyber activity preceded or is accompanying the physical event.

The result is a finished intelligence brief written by an AI analyst in plain English. Verdict, confidence, what happened, what to do. Spoken out loud. Under 60 seconds from raw signal to spoken assessment.

---

## Architecture

```
Sources      Camera feeds · Network logs · Badge access · GDELT live news · CISA advisories
     |
Vision       Meta DINOv2 anomaly detection · Meta SAM 3.1 bounding box segmentation
     |
Ingest       Schema normalisation · OpenAI ada-002 embeddings · FAISS semantic index
     |
Knowledge    3,557 incidents: AIID · CISA KEV · CISA ICS · ATT&CK ICS · GDELT · META VISION
     |
Correlate    XGBoost threat scoring · NetworkX graph clustering · 6-factor edge scoring
     |
Synthesize   GPT-4o alert synthesis · Meta Llama 3.3 70B Senior Analyst Agent
     |
Operate      React dashboard · FastAPI backend · ElevenLabs voice · AWS Lightsail
```

---

## Key Features

**Bidirectional cross-domain correlation**
Cyber signals surface physical asset risk before any physical event occurs. Physical anomalies trace back into the network to identify preceding or concurrent cyber activity. No existing commercial tool does both directions.

**3,557-record knowledge base**
Six real-world sources unified into a single schema. Every record is semantically embedded using OpenAI ada-002 and indexed with FAISS for sub-50ms search across the entire dataset.

**Meta vision pipeline**
DINOv2 builds a mathematical baseline from normal facility footage and flags deviations with zero labeled training data. SAM 3.1 draws a precise bounding box around the exact anomalous object. Result: 20/20 anomaly detection, zero false positives on 80 normal frames.

**Senior Analyst Agent**
Meta Llama 3.3 70B receives the correlated alert alongside the SAM-annotated camera frame. It reasons about both. Without the image: possible threat, confidence 60, do not escalate. With the image: probable threat, confidence 80, escalate to IR immediately. Visual evidence changes the AI reasoning exactly as it would change a human analyst's.

**Fusion Assistant**
An interactive AI agent embedded in the dashboard. Operators ask questions in plain language about any live alert and receive contextual responses backed by the full knowledge base and live alert data.

**ElevenLabs voice**
Critical alerts are spoken out loud via TTS. Operator voice notes and questions are transcribed via STT and fed directly into the analyst chat.

---

## Knowledge Base

| Source | Records | Description |
|--------|---------|-------------|
| CISA KEV | 1,569 | US government confirmed exploits actively used in real attacks |
| AIID | 1,437 | Documented AI system incident records |
| CISA ICS | 129 | Government advisories specifically for industrial control systems |
| MITRE ATT&CK ICS | 95 | Every known ICS attack technique with formal technique IDs |
| GDELT | 300+ | Live global news and open source intelligence |
| META VISION + SIM | 24 | DINOv2 camera anomalies and simulated cyber events |

---

## Demo Output

```
Headline:    Potential coordinated cyber-physical activity around Substation Alpha
Priority:    CRITICAL
Confidence:  99.98%
Location:    Substation Alpha, Washington DC

Evidence:
  cyber     Modbus port scan targeting ICS protocol        score 0.91
  cyber     47 failed SCADA HMI login attempts             score 0.88
  physical  DINOv2 camera anomaly at facility gate         score 0.84
  physical  Unauthorized badge access attempt
  physical  Power outage report

Historical match:
  Ukraine 2015 power grid attack at 87% semantic similarity

Analyst verdict:    True Positive
Analyst confidence: 82/100
Escalation:         Escalate to IR immediately
```

---

## Vision Pipeline Results

DINOv2 baseline built from 20 normal frames. Detection threshold 0.07.

| Frame type | Score range | Result |
|------------|-------------|--------|
| Normal (80 frames) | 0.001 to 0.004 | 0 false positives |
| Anomaly (20 frames) | 0.082 to 0.154 | 20/20 detected |

---

## Tech Stack

**Meta models**
- DINOv2 — self-supervised camera anomaly detection, no labeled data required
- SAM 3.1 — object segmentation and bounding box generation
- Llama 3.3 70B — multimodal senior analyst agent (text and vision via OpenRouter)

**AI and intelligence**
- OpenAI ada-002 — 1,536-dimension semantic embeddings for all 3,557 records
- GPT-4o — alert card synthesis via OpenRouter
- ElevenLabs — TTS voice alerts and STT operator voice notes

**Backend**
- FastAPI — REST API serving all dashboard data
- SQLite — unified event store
- FAISS — vector similarity search
- XGBoost — threat probability scoring
- NetworkX — graph-based event clustering

**Frontend and infrastructure**
- React + Vite — live dashboard, auto-polls every 10 seconds
- AWS Lightsail — deployed production instance
- Docker + nginx — containerised deployment
- GitHub Actions — CI/CD pipeline

---

## Run the App (Local)

Use two terminals: backend from the repo root, frontend from `frontend/`.

**Terminal 1 — backend**

```bash
pip install -r requirements.txt
uvicorn api:app --host 127.0.0.1 --port 8000
```

**Terminal 2 — frontend**

```bash
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The dev server proxies `/api` to the backend on port 8000 (change `AURORA_API_PORT` in `frontend/.env.development` if you use another port).

**First time:** copy `.env.example` to `.env` in the repo root and set `OPENROUTER_API_KEY` for analyst chat and LLM features. Restart uvicorn after editing `.env`.

For voice input and output in analyst chat, also set `ELEVENLABS_API_KEY`. Optional voice settings are included in `.env.example`:

```bash
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5
ELEVENLABS_STT_MODEL=scribe_v2
```

**Voice demo flow:**
1. Start the backend and frontend
2. Open the React dashboard
3. In Controls, confirm VOICE + AI STATUS shows `READY`
4. Go to Dashboard and use `Mic` in the analyst chat panel
5. Speak a question about the selected alert, then press `Stop mic`
6. Review the cleaned transcript, press `Send`, and the reply can auto-play

**Live database in the UI:** open Controls → Use live AURORA data so the dashboard reads `db/aurora.db` via the API.

**Prerequisites:** Python 3.12+, Node 18+, and a `db/aurora.db` in the repo.

---

## Run the Full Pipeline

```bash
source venv/bin/activate
export AURORA_ANALYST_MODE=resilient_dev

# Pull live OSINT
python3 scripts/live_osint.py

# Mark SIM events live
python3 -c "
import sqlite3
conn = sqlite3.connect('db/aurora.db')
conn.execute(\"UPDATE unified_events SET is_live=1 WHERE source='SIM'\")
conn.commit()
conn.close()
"

# Run correlation engine
python3 -c "
import sys, os
sys.path.insert(0, '.')
os.makedirs('artifacts/embeddings', exist_ok=True)
from correlation_engine import CorrelationEngine, CorrelationConfig
from pathlib import Path
CorrelationEngine(CorrelationConfig(
    db_path=Path('db/aurora.db'),
    embeddings_cache_path=Path('artifacts/embeddings/cache.sqlite'),
    enable_remote_embeddings=False,
    enable_llm_synthesis=False,
    writeback=True,
)).run()
"

# Run analyst agent on all alerts
python3 run_analyst_on_alerts.py --force

# Start API
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

---

## Streamlit Dashboard (Optional)

From the repo root (third terminal):

```bash
streamlit run dashboard.py
```

Open `http://127.0.0.1:8501` for the correlation engine view over the same database.

---

## Docker

Build the image:

```bash
docker build -t aurora .
```

Or use Docker Compose:

- Streamlit on `http://127.0.0.1:8501`
- FastAPI on `http://127.0.0.1:8000`
- React + nginx on `http://127.0.0.1:8080`

```bash
docker compose up --build
```

Compose reads variables from a root `.env` file for `${OPENROUTER_API_KEY}` etc.

The `aurora-web` service builds the Vite app and serves it behind nginx. Leave `VITE_AURORA_API` unset so the browser keeps calling `/api/...` on port 8080. To bake a separate API origin into the static build, set `VITE_AURORA_API` when building.

Run the Streamlit-only container with your local `.env`, `db/`, and `artifacts/`:

```bash
docker run --rm -it \
  -p 8501:8501 \
  --env-file .env \
  -v "$(pwd)/db:/app/db" \
  -v "$(pwd)/artifacts:/app/artifacts" \
  aurora
```

Notes:
- The default container entrypoint runs the correlation engine once, then starts Streamlit
- If you update `db/aurora.db`, refresh the engine from the Streamlit sidebar or restart the container
- Without `OPENROUTER_API_KEY`, embeddings and LLM enrichment are degraded
- To skip the bootstrap engine run: set `AURORA_BOOTSTRAP_ENGINE=0`

---

## AWS Lightsail Deployment

The job `deploy-lightsail` in `.github/workflows/cicd.yml` runs after python and frontend checks succeed. It targets a Lightsail VM instance named `Nat-Sec-Hackathon-Cyber-Dashboard` in `us-east-1a`.

Repository secrets required:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `LIGHTSAIL_SSH_PRIVATE_KEY` — PEM for the key attached to the instance
- `LIGHTSAIL_KEY_PAIR_NAME` — must match the Lightsail key pair name
- `OPENROUTER_API_KEY` — recommended for the API

IAM needs Lightsail permissions: get/list/create instance, get operation, open instance public ports in us-east-1.

---

## Project Structure

```
AURORA/
├── api.py                      FastAPI backend (all endpoints)
├── senior_analyst_agent.py     Meta Llama 3.3 analyst agent
├── run_analyst_on_alerts.py    Batch analyst runner with DB writeback
├── run_demo.sh                 Full pipeline script
├── vision_pipeline.py          DINOv2 and SAM pipeline
├── dashboard.py                Streamlit dashboard
├── correlation_engine/         XGBoost and NetworkX correlation engine
├── scripts/
│   ├── live_osint.py           GDELT live news scraper
│   ├── ingest_attck.py         MITRE ATT&CK ICS ingestion
│   └── build_aurora_db.py      Master database builder
├── db/
│   └── aurora.db               SQLite unified event store
├── artifacts/
│   ├── dino_baseline.pt        Saved DINOv2 baseline embeddings
│   └── demo_events.json        Pre-processed frame detection results
├── frontend/                   React + Vite dashboard
└── docker/                     nginx config and Docker assets
```

---


