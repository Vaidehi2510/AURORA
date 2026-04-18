#!/bin/bash
# First-boot user data (runs as root once). Ubuntu 22.04 → deadsnakes python3.12; 24.04+ → stock python3 (3.12+).
set -x
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg software-properties-common nginx

. /etc/os-release
if [ "${VERSION_ID:-}" = "22.04" ]; then
  add-apt-repository -y ppa:deadsnakes/ppa
  apt-get update -y
  apt-get install -y python3.12 python3.12-venv python3.12-dev
else
  apt-get install -y python3 python3-venv python3-pip
fi

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

systemctl enable nginx
systemctl start nginx || true
