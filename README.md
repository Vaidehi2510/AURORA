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

Or use Docker Compose:

- **Streamlit** on [http://127.0.0.1:8501](http://127.0.0.1:8501)
- **FastAPI** on [http://127.0.0.1:8000](http://127.0.0.1:8000) (direct access, same as local `uvicorn`)
- **React + nginx** (same-origin `/api` → API) on [http://127.0.0.1:8080](http://127.0.0.1:8080)

```bash
docker compose up --build
```

Compose reads variables from a root `.env` file for `${OPENROUTER_API_KEY}`, etc.

The **`aurora-web`** service builds the Vite app and serves it behind nginx ([`docker/nginx/aurora.conf`](docker/nginx/aurora.conf)). Leave `VITE_AURORA_API` unset for that path so the browser keeps calling `/api/...` on port **8080**. To bake a separate API origin into the static build (for example a CDN-hosted UI talking to an API host), set `VITE_AURORA_API` when building (Compose `build.args` or `docker build --build-arg`).

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

### AWS Lightsail instance (us-east-1)

The job **`deploy-lightsail`** in [`.github/workflows/cicd.yml`](.github/workflows/cicd.yml) runs after **python** and **frontend** succeed. It runs on **push to `main` or `master`** or when you **Run workflow** manually. It targets a Lightsail **VM instance** named **`Nat-Sec-Hackathon-Cyber-Dashboard`**. New instances use blueprint **`LIGHTSAIL_BLUEPRINT_ID`** (default **`ubuntu_24_04`**), bundle **`LIGHTSAIL_BUNDLE_ID`** (default **`nano_2_0`**), AZ **`us-east-1a`**, plus optional first-boot [`lightsail-instance-bootstrap.sh`](.github/scripts/lightsail-instance-bootstrap.sh). **User-data only runs on first boot**; the deploy script still runs **`apt`** on every deploy so Python **3.12+**, Node **20**, and **nginx** exist even on older VMs. Ubuntu **24.04** usually has **`python3`** at 3.12 but no **`python3.12`** binary — the scripts accept either. It opens TCP **22** and **80**, **rsync**s to **`~/aurora`**, writes **`OPENROUTER_API_KEY`** to **`~/aurora/.env`** when set, then runs [`lightsail-remote-deploy.sh`](.github/scripts/lightsail-remote-deploy.sh). Open **`http://<instance-public-ip>/`**. The deploy job **`timeout-minutes`** is **90** for long first-time **`apt`/`npm`**.

Repository secrets: **`AWS_ACCESS_KEY_ID`**, **`AWS_SECRET_ACCESS_KEY`**, **`LIGHTSAIL_SSH_PRIVATE_KEY`** (PEM for the key attached to the instance), **`LIGHTSAIL_KEY_PAIR_NAME`** (must match the Lightsail key pair name; required the first time so AWS can create the instance), and **`OPENROUTER_API_KEY`** (recommended for the API). IAM needs Lightsail permissions for **get/list/create instance**, **get operation**, **open instance public ports**, and **get instance** in **us-east-1**. If **`nano_2_0`** is not valid in your account, change **`LIGHTSAIL_BUNDLE_ID`** in the workflow or pick a bundle from **`aws lightsail get-bundles`**.

Notes:

- The default container entrypoint runs the correlation engine once, then starts Streamlit.
- If you update `db/aurora.db`, refresh the engine from the Streamlit sidebar or restart the container.
- Without `OPENROUTER_API_KEY`, embeddings and LLM enrichment are degraded; the analyst chat panel stays offline until the key is set on the **API** process.
- To skip the bootstrap engine run: set `AURORA_BOOTSTRAP_ENGINE=0` in the environment or compose file.
