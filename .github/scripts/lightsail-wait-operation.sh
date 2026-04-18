#!/usr/bin/env bash
# Wait for a Lightsail async operation to complete (Succeeded / Failed).
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"
OP_ID="${1:?operation id required}"
echo "Waiting for Lightsail operation: $OP_ID"
for _ in $(seq 1 120); do
  state=$(aws lightsail get-operation --region "$REGION" --operation-id "$OP_ID" \
    --query 'operation.status' --output text)
  if [[ "$state" == "Succeeded" ]]; then
    echo "Operation succeeded."
    exit 0
  fi
  if [[ "$state" == "Failed" ]]; then
    aws lightsail get-operation --region "$REGION" --operation-id "$OP_ID" --output json >&2 || true
    echo "Operation failed." >&2
    exit 1
  fi
  sleep 5
done
echo "Timeout waiting for operation $OP_ID (last state: ${state:-unknown})" >&2
exit 1
