# Known issues

## Apps Script latency / false-failure-despite-success (resolved for the visitor-facing path)

**Update, D1 migration:** This issue is what motivated moving D1 in as the
source of truth (see README.md → "Architecture"). The visitor-facing
response no longer waits on Apps Script at all — it returns as soon as D1
confirms the write, and Google Sheets is written in the background via
`context.waitUntil(...)`. A slow or failing Apps Script call can no longer
produce a false failure shown to a visitor, and can no longer race a retry
into a duplicate row (D1's unique constraints plus `Code.gs`'s new ref-based
artist dedup — see README → "D1 persistence" → "Duplicate handling").
Apps Script's underlying latency/variability itself is unchanged and out of
scope — it just no longer matters to the visitor. The original report is
kept below for record.

**Original report, before the D1 migration:**

**Observed:** 2026-08-12, during production setup and again during final
verification. Live requests to `/api/presale` and `/api/artists` — which
call through to the Google Apps Script Web App — took anywhere from 2s to
33s. Roughly half of the slower requests exceeded whatever timeout applies
to Cloudflare's outbound fetch, returning a real `502` ("COULDN'T JOIN" /
"COULDN'T SEND") to the browser — but the underlying Apps Script execution
kept running and **the row was still written** in at least two confirmed
cases (one presale, one artist submission — both showed up in the sheet
after the client had already been shown a failure).

**Practical impact:** a real visitor could see an honest failure message
and be told to retry, even though their first attempt actually saved. If
they don't retry, no harm. If they do retry: presale is deduplicated by
normalized email, so a retry there just returns `"already"` — no duplicate
row. **Artist submissions are not deduplicated**, so a retry after a false
failure could create two rows for the same person.

**Likely contributors (not confirmed):**
- Google Apps Script Web Apps have inherently variable, sometimes high,
  response latency — this isn't necessarily specific to this code.
- `Code.gs` uses a single `LockService.getScriptLock()` shared across
  *every* request regardless of operation (presale or artist), so
  concurrent requests queue behind each other and compound the delay.

**Deliberately not fixed yet** — this was flagged during setup and again
during the About/Artists refinement pass, and explicitly deferred both
times so it can get its own focused investigation rather than a rushed
change bolted onto an unrelated task. Candidate directions for that future
pass: separate locks per operation (or narrower lock scope), a longer
client-side timeout tolerance with clearer "this may still be processing"
messaging, or moving off `LockService` entirely if the dedup check can be
made race-safe another way.

**Not in scope for this file:** actually fixing it. This is a record of
what was observed, for whoever picks up that investigation next.
