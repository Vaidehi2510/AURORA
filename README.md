# AURORA

Seeing the signals before they become incidents.

## Run the app (local)

Use **two terminals**: backend from the repo root, frontend from `frontend/`.

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

Then open [http://127.0.0.1:5173](http://127.0.0.1:5173). The dev server proxies `/api` to the backend on port **8000** (change `AURORA_API_PORT` in `frontend/.env.development` if you use another port).

**First time:** copy `.env.example` to `.env` in the repo root and set `OPENROUTER_API_KEY` for analyst chat and LLM features. Restart uvicorn after editing `.env`.

**Live database in the UI:** open **Controls** → **Use live AURORA data** so the dashboard reads `db/aurora.db` via the API.

### Optional: Streamlit dashboard

From the repo root (third terminal):

```bash
streamlit run dashboard.py
```

Open [http://127.0.0.1:8501](http://127.0.0.1:8501) for the correlation-engine view over the same database.

### Prerequisites

Python **3.12+**, Node **18+**, and a `db/aurora.db` in the repo (or your usual DB build flow).

---

## Docker

Build the image:

```bash
docker build -t aurora .
```

Or use Docker Compose (Streamlit on **8501**, FastAPI on **8000**):

```bash
docker compose up --build
```

Compose reads variables from a root `.env` file for `${OPENROUTER_API_KEY}`, etc.

Run the Streamlit-only container with your local `.env`, `db/`, and `artifacts/`:

```bash
docker run --rm -it \
  -p 8501:8501 \
  --env-file .env \
  -v "$(pwd)/db:/app/db" \
  -v "$(pwd)/artifacts:/app/artifacts" \
  aurora
```

Then open [http://localhost:8501](http://localhost:8501).

Notes:

- The default container entrypoint runs the correlation engine once, then starts Streamlit.
- If you update `db/aurora.db`, refresh the engine from the Streamlit sidebar or restart the container.
- Without `OPENROUTER_API_KEY`, embeddings and LLM enrichment are degraded; the analyst chat panel stays offline until the key is set on the **API** process.
- To skip the bootstrap engine run: set `AURORA_BOOTSTRAP_ENGINE=0` in the environment or compose file.
