#!/usr/bin/env bash
# Ensure a Lightsail *instance* (VM) exists; create it if missing. Print public IPv4 on stdout (logs on stderr).
set -euo pipefail
REGION="${1:?region}"
NAME="${2:?instance-name}"
KEY_PAIR="${3:-}"
BUNDLE="${4:-nano_2_0}"
BLUEPRINT="${5:-ubuntu_22_04}"
AZ="${6:-us-east-1a}"
BOOTSTRAP="${7:?path-to-bootstrap-script}"

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
WAIT_OP="$SCRIPT_DIR/lightsail-wait-operation.sh"

instance_exists() {
  aws lightsail get-instances --region "$REGION" --output json 2>/dev/null \
    | jq -e --arg n "$NAME" '(.instances // []) | map(select(.name == $n)) | length > 0' >/dev/null 2>&1
}

wait_instance_running() {
  local st lower
  for _ in $(seq 1 90); do
    st=$(aws lightsail get-instance --region "$REGION" --instance-name "$NAME" \
      --query 'instance.state.name' --output text 2>/dev/null || echo "unknown")
    lower=$(echo "$st" | tr '[:upper:]' '[:lower:]')
    if [[ "$lower" == "running" ]]; then
      echo "Instance state: running" >&2
      return 0
    fi
    echo "Waiting for instance running (state=$st)..." >&2
    sleep 10
  done
  echo "Timeout waiting for instance to run." >&2
  return 1
}

public_ip() {
  aws lightsail get-instance --region "$REGION" --instance-name "$NAME" \
    --query 'instance.publicIpAddress' --output text
}

wait_public_ip() {
  local ip
  for _ in $(seq 1 60); do
    ip=$(public_ip || true)
    if [[ -n "$ip" && "$ip" != "None" && "$ip" != "null" ]]; then
      echo "$ip"
      return 0
    fi
    echo "Waiting for public IP..." >&2
    sleep 5
  done
  echo "Timeout waiting for public IP." >&2
  return 1
}

open_tcp() {
  local from="$1" to="${2:-$1}"
  aws lightsail open-instance-public-ports --region "$REGION" --instance-name "$NAME" \
    --port-info "fromPort=${from},toPort=${to},protocol=tcp,cidrs=0.0.0.0/0" \
    --output json >/dev/null 2>&1 || true
}

if instance_exists; then
  echo "Lightsail instance '$NAME' already exists." >&2
else
  if [[ -z "$KEY_PAIR" ]]; then
    echo "Instance does not exist and LIGHTSAIL_KEY_PAIR_NAME is empty; cannot create." >&2
    exit 1
  fi
  echo "Creating Lightsail instance '$NAME' (bundle=$BUNDLE, blueprint=$BLUEPRINT, az=$AZ)..." >&2
  out=$(aws lightsail create-instances \
    --region "$REGION" \
    --instance-names "$NAME" \
    --availability-zone "$AZ" \
    --blueprint-id "$BLUEPRINT" \
    --bundle-id "$BUNDLE" \
    --key-pair-name "$KEY_PAIR" \
    --user-data "file://$BOOTSTRAP" \
    --output json)
  op_id=$(echo "$out" | jq -r '(.operations[0].id // .createOperations[0].id // empty)')
  if [[ -n "$op_id" && "$op_id" != "null" ]]; then
    "$WAIT_OP" "$op_id"
  fi
fi

wait_instance_running

# Firewall: SSH + HTTP (nginx serves UI and proxies /api to localhost:8000)
open_tcp 22
open_tcp 80

ip=$(wait_public_ip)
echo "Public IP: $ip" >&2
echo "$ip"
