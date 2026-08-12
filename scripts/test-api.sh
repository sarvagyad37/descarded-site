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

req POST /api/presale '{"email":"schema-mismatch@example.com"}'
check "incorrect spreadsheet schema -> 502, honest failure" 502 "error" "$STATUS" "$BODY"

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

req POST /api/artists '{"artist_name":"SCHEMA_MISMATCH","email":"schema2@example.com","creator_type":"OTHER","portfolio_url":"x.com"}'
check "incorrect spreadsheet schema -> 502, honest failure" 502 "error" "$STATUS" "$BODY"

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
