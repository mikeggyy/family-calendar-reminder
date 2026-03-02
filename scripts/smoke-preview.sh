#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${API_BASE_URL:-}" ]]; then
  echo "Usage: API_BASE_URL=https://<worker-or-custom-domain> ./scripts/smoke-preview.sh"
  exit 1
fi

SMOKE_USER_ID="${SMOKE_USER_ID:-u_smoke_preview}"

curl -fsS "$API_BASE_URL/health" | grep -q '"ok":true'

resp=$(curl -fsS -X POST "$API_BASE_URL/api/reminders" \
  -H 'content-type: application/json' \
  -d "{\"userId\":\"$SMOKE_USER_ID\",\"title\":\"preview-smoke\",\"text\":\"明天下午三點\"}")

event_id=$(echo "$resp" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).event.id))")

curl -fsS "$API_BASE_URL/api/reminders?userId=$SMOKE_USER_ID" | grep -q "$event_id"
curl -fsS -X DELETE "$API_BASE_URL/api/reminders/$event_id?userId=$SMOKE_USER_ID" >/dev/null

echo "smoke-preview OK: $event_id"
