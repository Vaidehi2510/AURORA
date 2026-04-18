#!/bin/bash
# First-boot user data: Python 3.12, Node 20, nginx (matches local pip/uvicorn + npm build + static serving).
# No Docker — Docker/Compose remain optional in-repo for local use only.
set -x
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg software-properties-common nginx

add-apt-repository -y ppa:deadsnakes/ppa
apt-get update -y
apt-get install -y python3.12 python3.12-venv python3.12-dev

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

systemctl enable nginx
systemctl start nginx || true
