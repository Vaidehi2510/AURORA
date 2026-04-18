#!/usr/bin/env bash
# Run on the Lightsail VM from ~/aurora after rsync (native stack, no Docker).
# Installs Python 3.12+, Node 20, nginx if missing — fixes instances where user-data never ran or OS has no python3.12 binary.
set -euo pipefail
APP="$HOME/aurora"
cd "$APP"

export DEBIAN_FRONTEND=noninteractive

resolve_python() {
  if command -v python3.12 >/dev/null 2>&1; then
    command -v python3.12
    return
  fi
  if command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' 2>/dev/null; then
    command -v python3
    return
  fi
  echo ""
}

echo "=== Ensuring OS packages (Python 3.12+, Node, nginx) ==="
sudo apt-get update -qq
sudo apt-get install -y ca-certificates curl gnupg software-properties-common nginx

. /etc/os-release
if [ "${VERSION_ID:-}" = "22.04" ]; then
  sudo add-apt-repository -y ppa:deadsnakes/ppa
  sudo apt-get update -qq
  sudo apt-get install -y python3.12 python3.12-venv python3.12-dev
else
  sudo apt-get install -y python3 python3-venv python3-pip
fi

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
  sudo apt-get install -y nodejs
fi

PYTHON="$(resolve_python)"
if [ -z "$PYTHON" ]; then
  echo "Could not find Python 3.12+ (python3.12 or python3)." >&2
  exit 1
fi
echo "Using Python: $PYTHON ($($PYTHON --version))"

if [ ! -d .venv ]; then
  "$PYTHON" -m venv .venv
fi
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

# #region agent log
echo "debug session=e3bfc2 hypothesis=C prebuilt_frontend=$([ -f frontend/dist/index.html ] && echo yes || echo no)"
# #endregion

if [ -f frontend/dist/index.html ]; then
  echo "=== Frontend: using prebuilt dist from CI (skipping npm/vite on instance) ==="
else
  echo "=== Frontend: building on instance (no dist/index.html) ==="
  (cd frontend && npm ci && npm run build)
fi

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
