# Production D1 activation checklist

**Status: PRODUCTION D1 ACTIVATION IN PROGRESS (steps 1–5 done, 2026-08-14).**

Steps 1–5 (auth, confirm `descarded-prod` exists, obtain UUID, wire the
binding into `wrangler.toml`, apply migrations `--remote`) have been run —
`presale` and `artists` tables exist on the real `descarded-prod` database
(`fcc3ba3a-86d1-4fff-9fb4-aaba30d2c0b8`). Steps 6 onward (Pages dashboard
binding, secrets check, deploy, live smoke tests) are still pending. Do not
mark a step done until it has actually been run and its output checked.

Run all commands from this directory (`descarded/site`) unless noted.

## 1. Authenticate Wrangler

```
npx wrangler login
```

Skip if already authenticated (`npx wrangler whoami` to check).

## 2. Confirm the production D1 database

The production database already exists as `descarded-prod`. Do not run
`wrangler d1 create` — that would create a second, empty database.

## 3. Obtain the database UUID

```
npx wrangler d1 list
```

Find `descarded-prod` in the output and copy its `database_id` (a UUID).

## 4. Update the Wrangler D1 binding

Edit `wrangler.toml` in this directory — replace the placeholder:

```toml
[[d1_databases]]
binding = "DB"
database_name = "descarded-prod"
database_id = "REPLACE_WITH_REMOTE_DATABASE_ID"   # <- paste the real UUID here
migrations_dir = "migrations"
```

Do not remove `migrations_dir` — it's what makes step 5 work.

## 5. Apply migrations with `--remote`

```
npx wrangler d1 migrations apply DB --remote
```

Confirm all migrations in `migrations/` show `✅` in the output. This is the
first write ever made to the real database — review `migrations/0001_init.sql`
one more time before running this if it's been a while since it was written.

## 6. Confirm the Pages Function has binding `DB`

In the Cloudflare dashboard: Pages project → Settings → Functions → D1
database bindings → add `DB` → the `descarded-prod` database, for
both **Production** and **Preview** environments (or bind a separate preview
database if you want preview traffic isolated from production data — this
migration does not require that, but it's a reasonable option).

Verify via CLI instead/also:

```
npx wrangler pages project list
npx wrangler pages deployment list --project-name=<your-pages-project>
```

(The binding itself is only fully confirmed by a real request succeeding —
see step 9.)

## 7. Preserve existing Google Apps Script secrets

`GOOGLE_APPS_SCRIPT_URL` and `GOOGLE_APPS_SCRIPT_SECRET` are unrelated to
this migration and must **not** be touched, removed, or regenerated. If
they're already set in Cloudflare Pages → Settings → Environment variables
for Production/Preview, leave them exactly as they are. If this is a fresh
setup, follow README.md → "Google Sheets mirror (background sync)" to create
them — but note this is no longer launch-blocking (see README → "Before
launch").

## 8. Deploy

```
npx wrangler pages deploy .
```

Or via whatever CI/dashboard-connected deploy flow the project normally
uses. Confirm the deploy succeeds and the D1 binding shows up in the
deployment's function bindings (dashboard → deployment details).

## 9. Submit a real Presale form

Through the live site's UI (not curl) — fill out the pre-sale modal with a
real, disposable test email and submit.

## 10. Verify the D1 row

```
npx wrangler d1 execute DB --remote --command "SELECT * FROM presale ORDER BY created_at DESC LIMIT 1;"
```

Confirm the row matches what was submitted and `created_at` is recent.

## 11. Verify the Google Sheet mirror

Open the `DESCARDED — Form Submissions` spreadsheet → **Presale** tab,
confirm a matching row appeared (allow a few seconds — this is now a
background sync, not part of the request). Then re-check D1:

```
npx wrangler d1 execute DB --remote --command "SELECT lead_id, google_synced, google_synced_at FROM presale ORDER BY created_at DESC LIMIT 1;"
```

`google_synced` should be `1` with a `google_synced_at` timestamp.

## 12. Submit a duplicate

Submit the exact same email again through the live UI. Confirm the UI shows
the "already" state (not an error, not a second success) and:

```
npx wrangler d1 execute DB --remote --command "SELECT COUNT(*) as c FROM presale WHERE email = '<the test email, lowercased>';"
```

`c` must be `1`, not `2`.

## 13. Submit an Artist form

Through the live site's UI, fill out and submit the artist form with real
test data.

## 14. Verify the D1 row

```
npx wrangler d1 execute DB --remote --command "SELECT * FROM artists ORDER BY created_at DESC LIMIT 1;"
```

## 15. Verify the Google Sheet mirror

Open the **Artists** tab, confirm the row appeared with a matching `ref`.
Then:

```
npx wrangler d1 execute DB --remote --command "SELECT ref, google_synced, google_synced_at FROM artists ORDER BY created_at DESC LIMIT 1;"
```

## 16. Measure production response time

From the browser devtools Network tab (or `curl -w "%{time_total}\n"`
against the live `/api/presale` endpoint with real test data), confirm the
response comes back in the tens-of-milliseconds range, not seconds — this is
the whole point of the migration. Compare against the 2s–33s round trips
logged in `KNOWN_ISSUES.md` under the old architecture.

## 17. Inspect logs for Google background sync errors

```
npx wrangler pages deployment tail --project-name=<your-pages-project>
```

Look for `syncPresaleToGoogle failed` / `syncArtistToGoogle failed` log
lines (see `functions/api/_store.js`) while submitting a few more real test
entries. None expected if steps 9–15 passed cleanly; if Google Sheets was
left unconfigured on purpose for this deploy, these are expected and
harmless — submissions still succeed via D1 (see README → "Before launch").

---

Once all 17 steps are done and verified, update this file's status line at
the top to **PRODUCTION D1 ACTIVATION COMPLETE** (with the date), and remove
the `database_id` placeholder warning comment from `wrangler.toml`.
