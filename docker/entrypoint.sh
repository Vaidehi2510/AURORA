#!/usr/bin/env sh
set -eu

cd /app

mkdir -p artifacts/embeddings db

if [ "${AURORA_BOOTSTRAP_ENGINE:-1}" = "1" ]; then
  echo "Bootstrapping correlation engine from db/aurora.db..."
  if ! python3 scripts/run_correlation_engine.py; then
    echo "Bootstrap run failed; starting dashboard with existing DB contents."
  fi
fi

exec python3 -m streamlit run dashboard.py \
  --server.address "${STREAMLIT_SERVER_ADDRESS}" \
  --server.port "${STREAMLIT_SERVER_PORT}" \
  --server.headless true
