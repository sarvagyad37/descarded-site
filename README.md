# DESCARDED — site

Static multi-page site + Cloudflare Pages Functions. No bundler, no dependencies —
the one exception is `build.mjs`, a zero-dependency script that stitches the shared
nav into each page (see below). Output is still plain static HTML; nothing renders
client-side.

Replaces the earlier single-file Artifact export at `../site/deploy/` (kept as-is,
not part of this build).

## Run locally

Any static file server works, e.g.:

```
npx wrangler pages dev site
```

or for a plain static preview without the API routes:

```
npx serve site
```

## Files

| Path | What it is |
| --- | --- |
| `index.html` / `about.html` / `artists.html` | The three real pages |
| `conduct.html` / `privacy.html` / `contact.html` | Trust pages — honest TODO placeholders where real copy/contact info doesn't exist yet |
| `styles.css` | Shared styles |
| `app.js` | Shared behavior — mobile menu, pre-sale modal, artist form |
| `functions/api/presale.js` | `POST /api/presale` → `{ code: "new" \| "already" }` |
| `functions/api/artists.js` | `POST /api/artists` → `{ ref }` |
| `functions/api/health.js` | `GET /api/health` → truthful config status, no fabricated counts |
| `functions/api/_store.js` | Google Sheets persistence client (server-side only — see "Google Sheets persistence" below) |
| `_headers` | Cloudflare Pages cache-control rules |
| `.assetsignore` | Excludes `functions/`, `integrations/`, `scripts/` etc. from the deployed static asset bundle |
| `assets/hero-still-life.jpg` | Hero photo, also used as the OG/Twitter share image |
| `_partials/nav.html` | Single source of truth for the header + mobile menu |
| `build.mjs` | Injects `_partials/nav.html` into every page between `<!-- NAV:START -->` / `<!-- NAV:END -->` markers |
| `integrations/google-apps-script/Code.gs` | The Google Apps Script Web App source — copy this into the business Google account |
| `scripts/mock-apps-script.mjs` | Dev/test-only stand-in for the real Apps Script, used by `wrangler pages dev` locally |
| `scripts/test-store.mjs` | Unit tests for `_store.js`'s Google-side failure handling |
| `scripts/test-api.sh` | Integration test matrix against a running dev server |

## Editing the header / nav

The header and mobile menu are identical across every page except which link is
marked `aria-current="page"`. Don't hand-edit them per file — edit
`_partials/nav.html` once, then run:

```
node build.mjs
```

This rewrites `index.html`, `about.html`, `artists.html`, `conduct.html`,
`privacy.html`, and `contact.html` in place, replacing only the content between
their `NAV:START`/`NAV:END` markers — nothing else in those files is touched.
`404.html` intentionally has its own simpler header (no nav, no menu) and isn't
part of this — edit it directly if it ever needs to change.

## Deploy

**Cloudflare Pages** — point the project at this `site/` directory. `functions/api/*.js`
become Pages Functions automatically at `/api/presale`, `/api/artists`, `/api/health`;
no route config needed. Same-origin, so no CORS is required (unlike the old Vercel
build, which needed `Access-Control-Allow-Origin: *` because forms could hit the API
from a different origin during static-only hosting).

## Before launch

1. Complete the Google Sheets setup below — until `GOOGLE_APPS_SCRIPT_URL` and
   `GOOGLE_APPS_SCRIPT_SECRET` are set in Cloudflare, both forms will honestly fail
   (502, "couldn't join" / "couldn't send") rather than pretend to succeed.
2. `contact.html` has no monitored email wired up. Do not invent one — add it once a
   real inbox exists, in one place (search for `TODO` in `contact.html`).
3. `conduct.html` and `privacy.html` are honest placeholders, not fake legal copy.
   Replace with real approved copy when it exists.
4. Set `<link rel="canonical">` and `og:url` on every page once the production domain
   is live — they're commented out on purpose rather than pointing at a guessed URL.
5. Configure Cloudflare-level rate limiting on `/api/*` — see "Abuse controls" below.
   This can't live in the repo; it's dashboard/API configuration on the zone.
6. Verify `functions/`, `integrations/`, and `scripts/` are actually excluded from the
   live static bundle after your first deploy (see "A known local-only gap" below) —
   `.assetsignore` is in place but wasn't confirmed against a real deployment.

## Routes

`/` home · `/about.html` · `/artists.html` · `/conduct.html` · `/privacy.html` ·
`/contact.html`. No hash-routing, no client-side router — every page is a real static
file crawlers and no-JS clients can read.

## Behaviour notes

- No fake queue/confirmation-email language: pre-sale sign-up is a single step
  (email → "you're in"), not a double opt-in. There is no confirmation-email system,
  so none is implied in the copy.
- There is no local/demo fallback. If `/api/presale` or `/api/artists` can't reach
  Google Sheets, or Google rejects the write, the form shows a real error and keeps
  what the user typed so they can retry — it never claims a submission succeeded
  unless persistence actually confirmed it.
- No social links in the footer. There are no official DESCARDED social accounts yet;
  the UI is left out entirely rather than pointing at invented handles.

## Google Sheets persistence

Form submissions are persisted server-side to a Google Sheet, via a Google Apps
Script Web App that only Cloudflare Pages Functions talk to. The browser never
sees the Apps Script URL or its shared secret — those exist only as Cloudflare
Pages environment secrets.

```
DESCARDED HTML → app.js → Cloudflare Pages Functions (/api/presale, /api/artists)
              → authenticated server-side fetch → Google Apps Script Web App
              → "DESCARDED — Form Submissions" spreadsheet
```

### 1–3. Spreadsheet, worksheets, columns

Create one spreadsheet named **`DESCARDED — Form Submissions`** in the business
Google account, with two worksheets (tabs):

**Presale**

| created_at | email | source | campaign | referrer | landing_page |
| --- | --- | --- | --- | --- | --- |

**Artists**

| created_at | ref | name | email | city | role | link1 | link2 | social | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

You don't have to create these by hand — `Code.gs` creates whichever sheet is
missing (with the correct header row) the first time it receives a real
submission for that operation. To pre-create them instead, see step 4.

### 4. Install the Apps Script

1. Open (or create) the spreadsheet above.
2. Extensions → Apps Script.
3. Delete the default boilerplate, paste in the full contents of
   `integrations/google-apps-script/Code.gs`.
4. Project Settings (gear icon) → Script Properties → add a property named
   `SHARED_SECRET` with a long random value (e.g. `openssl rand -hex 32`). This
   is the one place the real secret should exist outside of Cloudflare — never
   put it in the script's source code, never commit it.
5. Optional: run `setupSheets` once from the editor's function picker + Run
   button to pre-create both worksheets with headers immediately, instead of
   waiting for the first real submission.

### 5. Deploy it as a Web App

1. Deploy → New deployment.
2. Type: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone**. (This does not mean "anyone can write to your
   sheet" — every request is still rejected unless it carries the correct
   `SHARED_SECRET`. "Anyone" here means Google doesn't also require the caller
   to be logged into a Google account, which Cloudflare's server-side fetch
   isn't.)
5. Copy the resulting URL — it ends in `/exec`.

Re-deploying (as a new version, not editing the existing deployment) gives you
a new URL. If you do that, update the Cloudflare secret to match.

### 6. Cloudflare secrets

Set these as **Cloudflare Pages → Settings → Environment variables → Secrets**
(encrypted, not plaintext build vars — the whole point is the browser and the
repo never see them):

| Name | Value |
| --- | --- |
| `GOOGLE_APPS_SCRIPT_URL` | The `/exec` URL from step 5 |
| `GOOGLE_APPS_SCRIPT_SECRET` | The same value you put in Script Properties as `SHARED_SECRET` |

Set both for both the Production and Preview environments if you want previews
to be able to submit too (they'll write to the same spreadsheet — there's no
separate staging sheet, by design, to keep this simple).

For local development, copy `.dev.vars.example` to `.dev.vars` (gitignored)
and fill in the same two values, then run `npx wrangler pages dev .`. Cloudflare
Pages itself does not read a `.env` file in production — `.dev.vars` is purely
a `wrangler`-local convention.

### 7. How the authentication works

Every write from Cloudflare to Apps Script is a POST with a JSON body shaped
`{ secret, op, data }`. `Code.gs` reads `SHARED_SECRET` from Script
Properties (never from its own source) and rejects the request with
`{ ok: false, code: "UNAUTHORIZED" }` if `secret` doesn't match exactly.
Apps Script Web Apps can't return arbitrary HTTP status codes from `doPost` —
every response is HTTP 200 — so success/failure is always read from the JSON
body's `ok` field, on both ends. `_store.js` treats an auth rejection, a
network failure, and a malformed (non-JSON) response as three distinct error
codes (`UNAUTHORIZED`, `UNREACHABLE`, `BAD_RESPONSE`) for anyone debugging a
failure later, even though the user just sees one honest generic error.

### 8. Test `/api/presale`

With `wrangler pages dev` running and `.dev.vars` pointing at either the real
Apps Script or the local mock (`node scripts/mock-apps-script.mjs`):

```
curl -X POST http://localhost:8788/api/presale \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","source":"utm-test"}'
# -> {"code":"new","email":"you@example.com"}

curl -X POST http://localhost:8788/api/presale \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}'
# -> {"code":"already"} — same normalized email, no duplicate row
```

### 9. Test `/api/artists`

```
curl -X POST http://localhost:8788/api/artists \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Artist","email":"a@b.com","city":"Philadelphia","role":"DJ","link1":"https://x.com"}'
# -> {"ref":"DSC-XXXXX"} — only after the row is actually written
```

Or run the full scripted matrix (starts against an already-running
`wrangler pages dev` + mock — see `scripts/test-api.sh` header comment for
exact setup):

```
node scripts/test-store.mjs   # unit tests: Google-side failure handling
sh scripts/test-api.sh        # integration tests: full request/validation matrix
```

### 10. Expected duplicate behavior

Presale duplicate detection is by normalized email (trimmed, lowercased),
checked against the **Presale** sheet's email column under a script lock, so
two concurrent submissions of the same email can't both pass the check and
create two rows. A duplicate does not update or move the existing row — the
original `created_at`/attribution is left alone, and the response is simply
`{ "code": "already" }`. Artist submissions are never deduplicated or cross-
written into the Presale sheet — submitting the artist form does not add
someone to the pre-sale list.

### 11. Expected failure behavior

If Google is unreachable, rejects the request (bad/missing secret), or
returns something that isn't valid JSON, the Cloudflare function returns
`502` with a short honest error string and writes nothing. The frontend shows
that error inline and keeps whatever the user typed. There is no scenario in
which the UI says "you're in" or shows a `DSC-XXXXX` ref without a prior
`ok: true` from Apps Script.

### Attribution

`app.js` captures `utm_source` → `source`, `utm_campaign` → `campaign`,
`document.referrer` → `referrer`, and the landing path → `landing_page` once
per browser session (first touch wins, stored in `sessionStorage`), so a link
like `/?utm_source=artist_dm&utm_campaign=edition01` keeps attributing
correctly even if the person browses to another page before opening the
pre-sale modal. This is plain URL/session reading — no analytics library, no
third-party tracking script.

### Abuse controls

Implemented in the repo:

- Every field is validated and length-capped server-side before anything is
  sent to Google (not just in `app.js` — a bot posting straight to `/api/*`
  hits the same checks).
- The `company` honeypot field is checked server-side, not just client-side;
  a filled honeypot is rejected with a plain 400 before persistence is ever
  attempted.
- Malformed JSON, oversized fields, and missing required fields are all
  rejected with 400 before the Apps Script call.

Not implemented in the repo, because it isn't repo configuration — set this
up in the Cloudflare dashboard once the site is live:

- A **Cloudflare Rate Limiting Rule** on `/api/presale` and `/api/artists`
  (Security → WAF → Rate limiting rules), a reasonable starting point being
  something like 10 requests / 1 minute per IP, 429 on the rest. Cloudflare
  Pages Functions are stateless across requests without adding KV/Durable
  Objects, which would be new infrastructure for a problem Cloudflare already
  solves at the edge — so this is deliberately a dashboard step, not code.
- Optionally, Cloudflare's Bot Fight Mode (free) or Turnstile, if spam turns
  out to be a real problem after launch. Not turned on preemptively — that's
  more than "lightweight" for what this is.

### A known local-only gap

`wrangler pages dev` (the local dev server used to test all of the above)
serves `functions/`, `integrations/`, and `scripts/` as plain static files
alongside the real pages — e.g. `http://localhost:8788/functions/api/_store.js`
returns the source. `.assetsignore` is in place to exclude them from the
deployed bundle, and Cloudflare Pages documents `functions/` as excluded from
the static build automatically regardless — but this was **not verified
against a real Cloudflare Pages deployment**, only against the local dev
server, which doesn't fully replicate deploy-time asset packaging. No secret
*value* is exposed either way (the source only references `env.*` bindings,
never a literal secret), but after your first deploy, confirm directly:

```
curl -I https://<your-pages-domain>/functions/api/_store.js
# expect 404
```

If that returns 200, treat it as a real bug and follow up — it would mean
server-side implementation details (validation rules, the honeypot field
name, the exact auth handshake) are publicly downloadable, which is worth
fixing even though it wouldn't leak the secret itself.
