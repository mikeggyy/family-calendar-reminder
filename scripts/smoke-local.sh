#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:8787}"
SMOKE_USER_ID="${SMOKE_USER_ID:-u_smoke_cf}"

curl -fsS "$API_BASE_URL/health" >/dev/null

event_json=$(curl -fsS -X POST "$API_BASE_URL/api/reminders" \
  -H 'content-type: application/json' \
  -d "{\"userId\":\"$SMOKE_USER_ID\",\"title\":\"smoke\",\"text\":\"明天下午三點\"}")

event_id=$(echo "$event_json" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).event.id))")

curl -fsS "$API_BASE_URL/api/reminders?userId=$SMOKE_USER_ID" | grep -q "$event_id"
curl -fsS -X DELETE "$API_BASE_URL/api/reminders/$event_id?userId=$SMOKE_USER_ID" >/dev/null

echo "smoke-local OK: $event_id"
