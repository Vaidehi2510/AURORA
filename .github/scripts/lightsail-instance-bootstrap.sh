#!/bin/bash
# First-boot user data: install Docker Engine + Compose (reliable on Ubuntu 22.04 Lightsail).
# Avoid fragile default-repo package combos; do not use `set -e` so one apt hiccup does not abort the whole run.
set -x
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
sh /tmp/get-docker.sh
systemctl enable docker || true
systemctl start docker || true
usermod -aG docker ubuntu || true
