#!/bin/sh
# Integration test matrix against a running `wrangler pages dev` (expects it
# on :8788, D1 binding DB migrated locally) with the mock Apps Script
# (expects it on :8791, secret "test-shared-secret", started separately).
# Not run in CI automatically — see README "D1 persistence" → Testing.
#
# D1-unavailable/failure is intentionally NOT covered here (there's no
# black-box HTTP way to break the local D1 binding mid-run) — see
# scripts/test-db.mjs for that case, covered at the unit level with a
# mocked D1 binding instead.

set -e
BASE="http://localhost:8788"
PASS=0
FAIL=0

# Reads one column for a WHERE key = value lookup from the local D1 db via
# `wrangler d1 execute --json`, without needing jq.
d1_field() {
  # d1_field TABLE COLUMN WHERE_COLUMN WHERE_VALUE
  npx wrangler d1 execute DB --local --json \
    --command "SELECT $2 as v FROM $1 WHERE $3 = '$4' LIMIT 1;" 2>/dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);const row=r[0]&&r[0].results&&r[0].results[0];process.stdout.write(row?String(row.v):'');}catch(e){}})"
}

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

# Fixed-literal fixture rows (schema-mismatch@example.com / SCHEMA_MISMATCH)
# now persist in D1 across runs (unlike the old architecture, where a Google
# failure meant nothing was ever saved) — clear them first so the suite is
# repeatable.
npx wrangler d1 execute DB --local --command "DELETE FROM presale WHERE email = 'schema-mismatch@example.com'; DELETE FROM artists WHERE artist_name = 'SCHEMA_MISMATCH';" > /dev/null 2>&1 || true

echo "== presale =="

req POST /api/presale "{\"email\":\"$RAND_EMAIL\"}"
check "valid email-only submission -> new" 200 '"code":"new"' "$STATUS" "$BODY"

req POST /api/presale "{\"email\":\"name-$(date +%s)@example.com\",\"first_name\":\"Ada\",\"last_name\":\"Lovelace\"}"
check "valid email + name -> new" 200 '"code":"new"' "$STATUS" "$BODY"

req POST /api/presale "{\"email\":\"phone-$(date +%s)@example.com\",\"phone\":\"2155551234\"}"
check "valid email + phone -> new" 200 '"code":"new"' "$STATUS" "$BODY"

req POST /api/presale "{\"email\":\"smsfalse-$(date +%s)@example.com\",\"sms_consent\":false}"
check "sms_consent false, no phone -> new (not required)" 200 '"code":"new"' "$STATUS" "$BODY"

req POST /api/presale "{\"email\":\"smstrue-$(date +%s)@example.com\",\"phone\":\"2155551234\",\"sms_consent\":true}"
check "sms_consent true with phone -> new" 200 '"code":"new"' "$STATUS" "$BODY"

req POST /api/presale "{\"email\":\"smsnophone-$(date +%s)@example.com\",\"sms_consent\":true}"
check "sms_consent true without phone -> 400" 400 "PHONE NUMBER" "$STATUS" "$BODY"

req POST /api/presale "{\"email\":\"$RAND_EMAIL\"}"
check "duplicate normalized email -> already" 200 '"code":"already"' "$STATUS" "$BODY"

echo "== presale: concurrent duplicate =="

CONC_EMAIL="conc-$(date +%s)@example.com"
curl -s -X POST "$BASE/api/presale" -H 'Content-Type: application/json' -d "{\"email\":\"$CONC_EMAIL\"}" > /tmp/conc_a.json &
curl -s -X POST "$BASE/api/presale" -H 'Content-Type: application/json' -d "{\"email\":\"$CONC_EMAIL\"}" > /tmp/conc_b.json &
wait
CONC_CODES=$(cat /tmp/conc_a.json /tmp/conc_b.json | grep -o '"code":"[a-z]*"' | sort | tr '\n' ',')
if [ "$CONC_CODES" = '"code":"already","code":"new",' ]; then
  echo "  ok - two simultaneous submissions for the same email -> exactly one 'new', one 'already'"
  PASS=$((PASS+1))
else
  echo "  FAIL - concurrent duplicate handling: got codes [$CONC_CODES]"
  FAIL=$((FAIL+1))
fi
rm -f /tmp/conc_a.json /tmp/conc_b.json

req POST /api/presale "{\"email\":\"attr-$(date +%s)@example.com\",\"source\":\"instagram\",\"campaign\":\"edition01\",\"medium\":\"organic-social\",\"term\":\"descarded\",\"content\":\"reel03\"}"
check "attribution fields accepted -> new" 200 '"code":"new"' "$STATUS" "$BODY"

req POST /api/presale "{\"email\":\"ref-$(date +%s)@example.com\",\"referred_by\":\"ABC123\"}"
check "ref -> referred_by accepted -> new" 200 '"code":"new"' "$STATUS" "$BODY"

req POST /api/presale '{"email":"not-an-email"}'
check "malformed email -> 400" 400 "error" "$STATUS" "$BODY"

req POST /api/presale '{"email":""}'
check "empty email -> 400" 400 "error" "$STATUS" "$BODY"

req POST /api/presale "{\"email\":\"badphone-$(date +%s)@example.com\",\"phone\":\"abc\"}"
check "malformed phone -> 400" 400 "PHONE NUMBER" "$STATUS" "$BODY"

req POST /api/presale "{\"email\":\"honeypot@example.com\",\"company\":\"I am a bot\"}"
check "honeypot populated -> 400, rejected before persistence" 400 "error" "$STATUS" "$BODY"

BIGVAL=$(printf 'a%.0s' $(seq 1 300))
req POST /api/presale "{\"email\":\"oversized-$(date +%s)@example.com\",\"first_name\":\"$BIGVAL\"}"
check "oversized payload field -> 400" 400 "error" "$STATUS" "$BODY"

req POST /api/presale '{not valid json'
check "malformed JSON -> 400" 400 "BAD REQUEST BODY" "$STATUS" "$BODY"

echo "== presale: D1 primary, Google background sync =="

OK_EMAIL="sync-ok-$(date +%s)@example.com"
req POST /api/presale "{\"email\":\"$OK_EMAIL\"}"
check "valid submission -> new (response returned before Google sync)" 200 '"code":"new"' "$STATUS" "$BODY"
sleep 1
SYNCED=$(d1_field presale google_synced email "$OK_EMAIL")
if [ "$SYNCED" = "1" ]; then
  echo "  ok - D1 row marked google_synced=1 after background sync completes"
  PASS=$((PASS+1))
else
  echo "  FAIL - expected google_synced=1, got: $SYNCED"
  FAIL=$((FAIL+1))
fi

FAIL_EMAIL="schema-mismatch@example.com"
req POST /api/presale "{\"email\":\"$FAIL_EMAIL\"}"
check "Google sync failure (bad sheet schema) does NOT fail the user-facing request" 200 '"code":"new"' "$STATUS" "$BODY"
sleep 1
SYNCERR=$(d1_field presale google_sync_error email "$FAIL_EMAIL")
if echo "$SYNCERR" | grep -q "INVALID SHEET SCHEMA"; then
  echo "  ok - D1 row records google_sync_error, lead is NOT lost (row still exists in D1)"
  PASS=$((PASS+1))
else
  echo "  FAIL - expected google_sync_error to record the schema mismatch, got: $SYNCERR"
  FAIL=$((FAIL+1))
fi

echo "== artists =="

req POST /api/artists "{\"artist_name\":\"Test Musician\",\"email\":\"artist-$(date +%s)@example.com\",\"creator_type\":\"DJ / MUSIC\",\"genre\":\"hyperpop\",\"phone\":\"2155551234\",\"portfolio_url\":\"soundcloud.com/test\",\"social_media_url\":\"instagram.com/test\"}"
check "musician submission (creator_type + genre) -> ref" 200 '"ref":"DSC-' "$STATUS" "$BODY"

req POST /api/artists "{\"artist_name\":\"Test Visual Artist\",\"email\":\"visual-$(date +%s)@example.com\",\"creator_type\":\"VISUAL ART\",\"portfolio_url\":\"behance.net/test\"}"
check "visual artist submission, no genre -> ref (genre never forced)" 200 '"ref":"DSC-' "$STATUS" "$BODY"

req POST /api/artists "{\"artist_name\":\"Test Performer\",\"email\":\"performer-$(date +%s)@example.com\",\"creator_type\":\"PERFORMANCE\",\"portfolio_url\":\"youtube.com/test\"}"
check "performer submission -> ref" 200 '"ref":"DSC-' "$STATUS" "$BODY"

CROSS_EMAIL="cross-check-$(date +%s)@example.com"
req POST /api/artists "{\"artist_name\":\"Cross Check\",\"email\":\"$CROSS_EMAIL\",\"creator_type\":\"OTHER\",\"portfolio_url\":\"x.com\"}"
check "artist submission with a fresh email -> ref" 200 '"ref":"DSC-' "$STATUS" "$BODY"
req POST /api/presale "{\"email\":\"$CROSS_EMAIL\"}"
check "same email via presale afterwards -> new, NOT already (artist never entered Presale)" 200 '"code":"new"' "$STATUS" "$BODY"

req POST /api/artists "{\"artist_name\":\"\",\"email\":\"a@b.com\",\"creator_type\":\"OTHER\",\"portfolio_url\":\"x.com\"}"
check "required field (name) missing -> 400" 400 "ADD A NAME" "$STATUS" "$BODY"

req POST /api/artists '{"artist_name":"Test","email":"bad","creator_type":"OTHER","portfolio_url":"x.com"}'
check "invalid email -> 400" 400 "error" "$STATUS" "$BODY"

req POST /api/artists "{\"artist_name\":\"Test\",\"email\":\"artist-noct-$(date +%s)@example.com\",\"portfolio_url\":\"x.com\"}"
check "missing creator_type -> 400 (non-musicians no longer forced into a music genre model)" 400 "CREATOR TYPE" "$STATUS" "$BODY"

req POST /api/artists "{\"artist_name\":\"Test\",\"email\":\"artist-badct-$(date +%s)@example.com\",\"creator_type\":\"WIZARD\",\"portfolio_url\":\"x.com\"}"
check "creator_type not in controlled vocabulary -> 400" 400 "CREATOR TYPE" "$STATUS" "$BODY"

req POST /api/artists "{\"artist_name\":\"Test\",\"email\":\"artist2-$(date +%s)@example.com\",\"creator_type\":\"OTHER\",\"phone\":\"not a phone at all!!\",\"portfolio_url\":\"x.com\"}"
check "invalid phone -> 400 (phone stays optional but is validated when present)" 400 "PHONE NUMBER" "$STATUS" "$BODY"

req POST /api/artists "{\"artist_name\":\"Test\",\"email\":\"artist3-$(date +%s)@example.com\",\"creator_type\":\"OTHER\",\"portfolio_url\":\"not a url\"}"
check "invalid work link -> 400" 400 "WORK LINK" "$STATUS" "$BODY"

req POST /api/artists "{\"artist_name\":\"Test\",\"email\":\"artist4-$(date +%s)@example.com\",\"creator_type\":\"OTHER\",\"portfolio_url\":\"x.com\",\"social_media_url\":\"not a url\"}"
check "invalid social URL -> 400" 400 "SOCIAL" "$STATUS" "$BODY"

req POST /api/artists "{\"artist_name\":\"Test\",\"email\":\"artist5-$(date +%s)@example.com\",\"creator_type\":\"OTHER\",\"portfolio_url\":\"x.com\",\"company\":\"bot\"}"
check "honeypot populated -> 400, rejected before persistence" 400 "error" "$STATUS" "$BODY"

req POST /api/artists '{not valid json'
check "malformed JSON -> 400" 400 "BAD REQUEST BODY" "$STATUS" "$BODY"

echo "== artists: D1 primary, Google background sync + retry safety =="

ARTIST_OK_NAME="Sync OK Test"
req POST /api/artists "{\"artist_name\":\"$ARTIST_OK_NAME\",\"email\":\"artist-sync-$(date +%s)@example.com\",\"creator_type\":\"OTHER\",\"portfolio_url\":\"x.com\"}"
check "valid submission -> ref (response returned before Google sync)" 200 '"ref":"DSC-' "$STATUS" "$BODY"
ARTIST_REF=$(echo "$BODY" | grep -o '"ref":"[^"]*"' | cut -d'"' -f4)
sleep 1
ARTIST_SYNCED=$(d1_field artists google_synced ref "$ARTIST_REF")
if [ "$ARTIST_SYNCED" = "1" ]; then
  echo "  ok - D1 row marked google_synced=1 after background sync completes"
  PASS=$((PASS+1))
else
  echo "  FAIL - expected google_synced=1 for ref $ARTIST_REF, got: $ARTIST_SYNCED"
  FAIL=$((FAIL+1))
fi

req POST /api/artists '{"artist_name":"SCHEMA_MISMATCH","email":"schema2@example.com","creator_type":"OTHER","portfolio_url":"x.com"}'
check "Google sync failure (bad sheet schema) does NOT fail the user-facing request" 200 '"ref":"DSC-' "$STATUS" "$BODY"
SCHEMA_REF=$(echo "$BODY" | grep -o '"ref":"[^"]*"' | cut -d'"' -f4)
sleep 1
ARTIST_SYNCERR=$(d1_field artists google_sync_error ref "$SCHEMA_REF")
if echo "$ARTIST_SYNCERR" | grep -q "INVALID SHEET SCHEMA"; then
  echo "  ok - D1 row records google_sync_error, submission is NOT lost (row still exists in D1)"
  PASS=$((PASS+1))
else
  echo "  FAIL - expected google_sync_error to record the schema mismatch, got: $ARTIST_SYNCERR"
  FAIL=$((FAIL+1))
fi

# Retry-safety: directly re-post the SAME ref straight to the mock (as a
# retried background sync would) and confirm Code.gs-equivalent dedup means
# no second row is created — see mock-apps-script.mjs's ref check.
BEFORE_COUNT=$(curl -s http://127.0.0.1:8791/_debug | grep -o '"artistCount":[0-9]*' | cut -d: -f2)
curl -s -X POST http://127.0.0.1:8791 -H 'Content-Type: application/json' \
  -d "{\"secret\":\"test-shared-secret\",\"op\":\"artist\",\"data\":{\"ref\":\"$ARTIST_REF\",\"artist_name\":\"$ARTIST_OK_NAME\",\"creator_type\":\"OTHER\",\"email\":\"retry@example.com\",\"portfolio_url\":\"x.com\"}}" > /dev/null
AFTER_COUNT=$(curl -s http://127.0.0.1:8791/_debug | grep -o '"artistCount":[0-9]*' | cut -d: -f2)
if [ "$BEFORE_COUNT" = "$AFTER_COUNT" ]; then
  echo "  ok - retrying a background sync with the same ref does not create a duplicate mirror row"
  PASS=$((PASS+1))
else
  echo "  FAIL - artist mirror row count grew on retry ($BEFORE_COUNT -> $AFTER_COUNT), ref should have deduped"
  FAIL=$((FAIL+1))
fi

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
