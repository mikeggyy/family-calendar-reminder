#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:3000}"
USER_ID="${SMOKE_USER_ID:-u_smoke}"

iso_time="$(date -u -d '+1 day' '+%Y-%m-%dT%H:%M:%S')"
create_payload="$(printf '{"userId":"%s","title":"Smoke Reminder","text":"%s"}' "$USER_ID" "$iso_time")"

echo "[smoke:reminders] POST ${BASE_URL}/api/reminders"
create_response="$(curl -fsS -X POST "${BASE_URL}/api/reminders" \
  -H 'Content-Type: application/json' \
  -d "${create_payload}")"
echo "[smoke:reminders] create response: ${create_response}"

event_id="$(SMOKE_CREATE_RESPONSE="$create_response" node -e "const data = JSON.parse(process.env.SMOKE_CREATE_RESPONSE); process.stdout.write(data?.event?.id || '')")"
if [[ -z "${event_id}" ]]; then
  echo "[smoke:reminders] ERROR: unable to parse event id"
  exit 1
fi

echo "[smoke:reminders] GET ${BASE_URL}/api/reminders?userId=${USER_ID}"
list_response="$(curl -fsS "${BASE_URL}/api/reminders?userId=${USER_ID}")"
echo "[smoke:reminders] list response: ${list_response}"

echo "${list_response}" | grep -q "${event_id}"

echo "[smoke:reminders] DELETE ${BASE_URL}/api/reminders/${event_id}?userId=${USER_ID}"
curl -fsS -X DELETE "${BASE_URL}/api/reminders/${event_id}?userId=${USER_ID}" >/dev/null

echo "[smoke:reminders] OK"
