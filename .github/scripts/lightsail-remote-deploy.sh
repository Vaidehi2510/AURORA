#!/usr/bin/env bash
# Run on the Lightsail VM from ~/aurora after rsync (native stack, no Docker).
set -euo pipefail
APP="$HOME/aurora"
cd "$APP"

export DEBIAN_FRONTEND=noninteractive

if [ ! -d .venv ]; then
  python3.12 -m venv .venv
fi
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

(cd frontend && npm ci && npm run build)

sudo install -m0644 "$APP/.github/scripts/aurora-nginx-lightsail.conf" /etc/nginx/sites-available/aurora
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/aurora /etc/nginx/sites-enabled/aurora
sudo nginx -t
sudo systemctl reload nginx

sudo tee /etc/systemd/system/aurora-api.service >/dev/null <<'UNIT'
[Unit]
Description=AURORA FastAPI (uvicorn)
After=network.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu/aurora
EnvironmentFile=-/home/ubuntu/aurora/.env
ExecStart=/home/ubuntu/aurora/.venv/bin/uvicorn api:app --host 0.0.0.0 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable aurora-api
sudo systemctl restart aurora-api
