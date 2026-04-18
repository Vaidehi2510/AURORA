# AURORA
Seeing the signals before they become incidents

## Docker

Build the image:

```bash
docker build -t aurora .
```

Or use Docker Compose:

```bash
docker compose up --build
```

Run the dashboard with your local `.env`, local `db/`, and persistent `artifacts/`:

```bash
docker run --rm -it \
  -p 8501:8501 \
  --env-file .env \
  -v "$(pwd)/db:/app/db" \
  -v "$(pwd)/artifacts:/app/artifacts" \
  aurora
```

Then open `http://localhost:8501`.

Notes:

- The container starts by running the correlation engine once, then launches the Streamlit dashboard.
- If you update `db/aurora.db`, refresh the engine from the dashboard or restart the container.
- `OPENROUTER_API_KEY` is optional but recommended. Without it, the app still runs, but semantic embeddings and alert text enrichment fall back to weaker behavior.
- If you want the dashboard without the startup engine run, add `-e AURORA_BOOTSTRAP_ENGINE=0` to `docker run`.
