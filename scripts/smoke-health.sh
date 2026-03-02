#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:3000}"

echo "[smoke:health] GET ${BASE_URL}/health"
response="$(curl -fsS "${BASE_URL}/health")"
echo "[smoke:health] response: ${response}"

echo "${response}" | grep -q '"ok":true'
echo "[smoke:health] OK"
