#!/bin/bash
# First-boot user data for Ubuntu Lightsail instances (install Docker + Compose plugin).
set -ex
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y docker.io docker-compose-plugin
systemctl enable docker
systemctl start docker
usermod -aG docker ubuntu || true
