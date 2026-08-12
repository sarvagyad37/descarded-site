#!/bin/sh
# Integration test matrix against a running `wrangler pages dev` (expects it
# on :8788) with the mock Apps Script (expects it on :8791, secret
# "test-shared-secret", started separately). Not run in CI automatically —
# see README "Google Sheets persistence" → Testing.

set -e
BASE="http://localhost:8788"
PASS=0
FAIL=0

check() {
  desc="$1"; expected_status="$2"; expected_grep="$3"; actual_status="$4"; actual_body="$5"
  if [ "$actual_status" = "$expected_status" ] && echo "$actual_body" | grep -q "$expected_grep"; then
    echo "  ok - $desc (status $actual_status)"
    PASS=$((PASS+1))
  else
    echo "  FAIL - $desc"
    echo "         expected status $expected_status, body containing '$expected_grep'"
    echo "         got status $actual_status, body: $actual_body"
    FAIL=$((FAIL+1))
  fi
}

req() {
  # req METHOD PATH BODY -> sets STATUS and BODY
  RESP=$(curl -s -w "\n%{http_code}" -X "$1" "$BASE$2" -H 'Content-Type: application/json' -d "$3")
  STATUS=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
}

RAND_EMAIL="test-$(date +%s)@example.com"

echo "== presale =="

req POST /api/presale "{\"email\":\"$RAND_EMAIL\"}"
check "valid new email -> new" 200 '"code":"new"' "$STATUS" "$BODY"

req POST /api/presale "{\"email\":\"$RAND_EMAIL\"}"
check "duplicate email -> already" 200 '"code":"already"' "$STATUS" "$BODY"

req POST /api/presale '{"email":"not-an-email"}'
check "invalid email -> 400" 400 "error" "$STATUS" "$BODY"

req POST /api/presale '{"email":""}'
check "empty email -> 400" 400 "error" "$STATUS" "$BODY"

req POST /api/presale "{\"email\":\"honeypot@example.com\",\"company\":\"I am a bot\"}"
check "honeypot populated -> 400, rejected before persistence" 400 "error" "$STATUS" "$BODY"

req POST /api/presale '{not valid json'
check "malformed JSON -> 400" 400 "BAD REQUEST BODY" "$STATUS" "$BODY"

echo "== artists =="

req POST /api/artists "{\"name\":\"Test Artist\",\"email\":\"artist-$(date +%s)@example.com\",\"city\":\"Philadelphia\",\"role\":\"DJ\",\"link1\":\"https://x.com\"}"
check "valid submission -> ref" 200 '"ref":"DSC-' "$STATUS" "$BODY"

req POST /api/artists '{"name":"Test","email":"bad","city":"Philly","role":"DJ","link1":"x"}'
check "invalid email -> 400" 400 "error" "$STATUS" "$BODY"

req POST /api/artists '{"name":"","email":"a@b.com","city":"Philly","role":"DJ","link1":"x"}'
check "missing name -> 400" 400 "ADD A NAME" "$STATUS" "$BODY"

req POST /api/artists '{"name":"Test","email":"a@b.com","city":"Philly","role":"WIZARD","link1":"x"}'
check "invalid role -> 400" 400 "PICK A ROLE" "$STATUS" "$BODY"

req POST /api/artists '{"name":"Test","email":"a@b.com","city":"Philly","role":"DJ","link1":"x","company":"bot"}'
check "honeypot populated -> 400, rejected before persistence" 400 "error" "$STATUS" "$BODY"

req POST /api/artists '{not valid json'
check "malformed JSON -> 400" 400 "BAD REQUEST BODY" "$STATUS" "$BODY"

echo "== health =="
req GET /api/health ""
check "health reports configured, no fake counts" 200 '"configured":true' "$STATUS" "$BODY"
if echo "$BODY" | grep -qE '"subscribers"|"submissions"'; then
  echo "  FAIL - health leaks fabricated counts: $BODY"
  FAIL=$((FAIL+1))
else
  echo "  ok - health has no fabricated subscriber/submission counts"
  PASS=$((PASS+1))
fi

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
