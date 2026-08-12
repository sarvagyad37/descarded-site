# DESCARDED — site

Static multi-page site + Cloudflare Pages Functions. No bundler, no dependencies —
the one exception is `build.mjs`, a zero-dependency script that stitches the shared
nav into each page (see below). Output is still plain static HTML; nothing renders
client-side.

Replaces the earlier single-file Artifact export at `../site/deploy/` (kept as-is,
not part of this build).

See `KNOWN_ISSUES.md` for an open, unfixed issue (Apps Script latency /
occasional false-failure-despite-success) before touching persistence code.

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
| `_partials/presale-modal.html` | Single source of truth for the pre-sale modal (all fields, consent, honeypot) |
| `build.mjs` | Injects both partials into every page between their `START`/`END` markers |
| `integrations/google-apps-script/Code.gs` | The Google Apps Script Web App source — copy this into the business Google account |
| `scripts/mock-apps-script.mjs` | Dev/test-only stand-in for the real Apps Script, used by `wrangler pages dev` locally |
| `scripts/test-store.mjs` | Unit tests for `_store.js`'s Google-side failure handling |
| `scripts/test-api.sh` | Integration test matrix against a running dev server |

## Editing the header / nav / pre-sale modal

The header, mobile menu, and pre-sale modal are each identical across every
page that has them (the modal's only page-to-page difference — which nav
link is `aria-current="page"` — is handled by the nav partial, not the
modal). Don't hand-edit any of them per file — edit `_partials/nav.html`
and/or `_partials/presale-modal.html` once, then run:

```
node build.mjs
```

This rewrites `index.html`, `about.html`, `artists.html`, `conduct.html`,
`privacy.html`, and `contact.html` in place, replacing only the content
between each file's `NAV:START`/`NAV:END` and `PRESALE:START`/`PRESALE:END`
markers — nothing else in those files is touched. `404.html` intentionally
has its own simpler header (no nav, no menu) and no pre-sale modal at all —
edit it directly if it ever needs to change.

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
7. Get real legal/compliance review on the SMS opt-in copy and the email-consent
   mechanism before connecting anything to `sms_consent`/`email_consent` — see
   "Privacy — what still needs human review" below. Neither is fake, both are
   flagged as draft-pending-review on purpose.
8. **If Google Sheets/Apps Script is already deployed from an earlier setup**,
   this pass added a `creator_type` column to the Artists schema. Two manual
   steps needed on the live deployment before artist submissions will work
   again: add a `creator_type` header cell to row 1 of the live Artists sheet
   (insert it right after `artist_name` to match `Code.gs`), then redeploy
   `Code.gs` (Deploy → New deployment) so `ARTISTS_HEADERS` picks it up. Until
   both are done, artist submissions will fail loudly with `INVALID SHEET
   SCHEMA on "Artists": missing column(s): creator_type` rather than silently
   miswriting data — that's `Code.gs`'s header-validation working as intended,
   not a new bug.

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
Google account, with two worksheets (tabs). Row 1 of each must be exactly
these headers — **this is the authoritative production schema**; changing it
requires updating `Code.gs`'s `PRESALE_HEADERS`/`ARTISTS_HEADERS` and this
table together, not just one of them:

**Presale**

| created_at | lead_id | phone | referral_code | email_consent | sms_consent | referred_by | first_name | last_name | email | status | source | campaign | medium | term | content | ip_address | user_agent | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

**Artists**

| created_at | ref | artist_name | creator_type | genre | email | phone | portfolio_url | social_media_url | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

You don't have to create these by hand — `Code.gs` creates whichever sheet is
missing (with the correct header row) the first time it receives a real
submission for that operation. To pre-create them instead, see step 4.

`Code.gs` maps fields to columns **by header name, not position** — if you
reorder columns in Sheets later, submissions still land in the right cell.
If a sheet is missing an expected header entirely, `Code.gs` refuses to
write and returns a loud, specific error (`INVALID SHEET SCHEMA on
"Presale": missing column(s): ...`) instead of silently misaligning data.
Run `validateSchema()` from the Apps Script editor any time to check the
live spreadsheet against this schema without submitting anything.

**Who writes what:**

| Field | Where it comes from |
| --- | --- |
| `created_at` | `Code.gs`, at the moment the row is actually appended |
| `lead_id` | `_store.js`, format `DSC-L-XXXXXXXX` (10 random hex chars) |
| `referral_code` | `_store.js`, 6 random hex chars — see "Referral code" below |
| `email_consent` | `_store.js`, always `true` on a successful submission — see "Consent" below |
| `sms_consent` | The visitor's checkbox state, passed through unchanged |
| `status` | `_store.js` — `active` for a new presale lead, `new` for an artist submission |
| `phone` | The visitor's input, narrowly normalized — see "Phone handling" below |
| `first_name` / `last_name` / `email` | The visitor's input (email required, name optional) |
| `source` / `campaign` / `medium` / `term` / `content` / `referred_by` | `app.js` attribution capture — see "Attribution" below |
| `ip_address` / `user_agent` | Read server-side from the request in `presale.js`/`artists.js` — see "IP address and user agent" below |
| `notes` | Always blank on submission — it's an operational field for manual use in Sheets |
| `ref` (Artists) | `_store.js`, format `DSC-XXXXX`, same generation approach as `lead_id` |
| `artist_name` / `email` / `portfolio_url` (shown as **WORK LINK**) | The visitor's input — required |
| `creator_type` | The visitor's input, one of a fixed dropdown (see "Creator type" below) — required, for triage |
| `genre` (shown as **STYLE / GENRE**) / `phone` / `social_media_url` | The visitor's input — optional |

### Creator type

`creator_type` is a controlled-vocabulary field, not free text — a `<select>`
on both `artists.html` and in server-side validation (`functions/api/artists.js`),
kept in sync with the same list in `app.js`:

```
DJ / MUSIC · PERFORMANCE · VISUAL ART · PHOTO / VIDEO ·
DESIGN / FASHION · INSTALLATION · DIGITAL / INTERACTIVE · OTHER
```

It exists so DESCARDED can actually sort/filter submissions by discipline —
before this field existed, every artist was funneled through a single
required `genre` field with a music-only placeholder (`HYPERPOP, HOUSE, NO
WAVE…`), which meant a photographer or installation artist had no honest
answer to give. `genre` is now separate and optional: a free-text STYLE
field (house, glitch, mixed media, …) for whoever finds it meaningful, never
required. `portfolio_url` is presented to visitors as **WORK LINK** — any
legitimate link to their work (SoundCloud, YouTube, Behance, a personal
site, a relevant social profile that functions as a portfolio) qualifies;
it was previously framed as "portfolio," which excluded people who don't
maintain a dedicated portfolio site.

`creator_type` was added to the production Artists sheet as a new column
(inserted immediately after `artist_name`) rather than compressed into
`genre` — the two are different kinds of data (a controlled category vs.
free-text style) serving different purposes, and cramming them into one
column would have defeated the point of adding triage in the first place.
Existing rows are unaffected and simply have a blank `creator_type` cell —
nothing is backfilled, renamed, or reordered elsewhere.

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
  -d '{"email":"you@example.com","first_name":"Ada","source":"instagram","campaign":"edition01"}'
# -> {"code":"new","email":"you@example.com"}

curl -X POST http://localhost:8788/api/presale \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}'
# -> {"code":"already"} — same normalized email, no duplicate row

curl -X POST http://localhost:8788/api/presale \
  -H 'Content-Type: application/json' \
  -d '{"email":"you2@example.com","sms_consent":true}'
# -> 400, "ADD A PHONE NUMBER TO GET TEXT UPDATES." — sms_consent without a phone is rejected
```

### 9. Test `/api/artists`

```
curl -X POST http://localhost:8788/api/artists \
  -H 'Content-Type: application/json' \
  -d '{"artist_name":"Test Artist","email":"a@b.com","creator_type":"DJ / MUSIC","genre":"hyperpop","portfolio_url":"soundcloud.com/x"}'
# -> {"ref":"DSC-XXXXX"} — only after the row is actually written

curl -X POST http://localhost:8788/api/artists \
  -H 'Content-Type: application/json' \
  -d '{"artist_name":"Test Visual Artist","email":"b@b.com","creator_type":"VISUAL ART","portfolio_url":"behance.net/x"}'
# -> {"ref":"DSC-XXXXX"} — genre omitted entirely, still succeeds
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

`app.js` maps standard UTM parameters once per browser session (first touch
wins, stored in `sessionStorage`, so it survives navigating to another page
before opening the pre-sale modal):

| URL parameter | Sheet column |
| --- | --- |
| `utm_source` | `source` |
| `utm_campaign` | `campaign` |
| `utm_medium` | `medium` |
| `utm_term` | `term` |
| `utm_content` | `content` |
| `ref` | `referred_by` |

Example: `/?utm_source=instagram&utm_medium=organic-social&utm_campaign=edition01&utm_content=reel03&ref=ABC123`.
This is plain URL/session reading — no analytics library, no third-party
tracking script, no referral rewards or redemption logic. `referred_by` is
stored verbatim; nothing validates it against real `referral_code` values or
does anything with it beyond recording it for future use.

### Consent

**Email.** There's no separate "I agree to receive emails" checkbox. The
pre-sale modal discloses, directly above the submit button, "WE'LL SEND
DESCARDED EVENT UPDATES TO THIS EMAIL. UNSUBSCRIBE ANY TIME." — clicking
JOIN immediately under that disclosure is treated as the consent mechanism,
and `email_consent` is recorded as `true` for every successful submission.
This preserves the pattern that already existed rather than adding a second,
redundant checkbox for the same action the visitor just took. **This
reasoning, not just the resulting copy, should get a compliance sanity check
before launch** — see "Privacy" below.

**SMS.** Separate, unchecked-by-default checkbox (`sms_consent`). Never
inferred from providing a phone number — you can submit the whole form with
a phone number and leave this unchecked, and `sms_consent` will correctly be
`false`. Checking it without a phone number is rejected client- and
server-side ("ADD A PHONE NUMBER TO GET TEXT UPDATES.") since consenting to
texts with nothing to text is meaningless. **The checkbox copy in
`_partials/presale-modal.html` is explicitly marked as draft/placeholder in
an HTML comment and has not been legally reviewed** — see "Privacy" below.
No SMS is ever sent; only the consent state is stored, for whatever future
system eventually sends anything.

### Referral code

Every new presale lead gets a `referral_code` (6 random hex characters,
generated in `_store.js` the same way `lead_id` is) whether or not
`referred_by` was set. There's no uniqueness check against existing codes in
the sheet — checking that would mean a lookup on every single write, which
is the "materially complicates the integration" case the spec asked to stop
and flag for. Collision odds at 6 hex characters (~16.7M possible values)
are not a concern at the scale a single event's presale list will realistically
reach, and nothing currently reads or redeems this code — it's stored so a
future referral system has something to build on, not a working referral
system itself.

### Phone handling

Phone is optional everywhere except when `sms_consent` is checked. Validation
is deliberately narrow (`normalizePhone` in `functions/api/_util.js`):

- 10 digits → assumed US, formatted E.164 (`+1XXXXXXXXXX`).
- 11 digits starting with `1` → assumed US-with-country-code, formatted
  `+XXXXXXXXXXX`.
- Anything else with 7–15 digits → stored sanitized (digits only, plus a
  leading `+` preserved if the visitor typed one) exactly as entered,
  **not** reformatted or guessed at.
- Fewer than 7 or more than 15 digits → rejected as implausible.

This is intentionally not a real international phone-number library. Trying
to guess the correct format for non-US numbers without one would produce
confidently wrong data, which is worse than an honest un-normalized string.
**Canonical E.164 normalization for non-US numbers is the responsibility of
whatever marketing/SMS platform eventually consumes this column** — treat
`phone` as "sanitized, not canonicalized" until that exists.

### IP address and user agent

Both are read server-side in `presale.js`/`artists.js`, never client-side,
never returned in any API response:

- `ip_address` ← the `CF-Connecting-IP` request header, which Cloudflare's
  edge sets to the real client IP and which the client cannot forge (it's
  added/overwritten by Cloudflare, not read from anything the browser sent).
- `user_agent` ← the request's `User-Agent` header, truncated to 500
  characters.

Neither is used for deduplication (that's normalized email only, per
"Expected duplicate behavior" above) or for any fingerprinting beyond
storing the raw values — they exist for operational/security/consent-
evidence purposes on the presale record, per the schema, and nothing more.

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

### Privacy — what still needs human review

The Presale schema now includes `ip_address`, `user_agent`, and `phone` —
personal/technical data the site wasn't collecting before this schema.
`privacy.html` has been updated with a minimal, purely factual addition (no
legal claims — it doesn't assert GDPR/CCPA compliance, a retention period,
or enumerate legal rights, because none of that has been decided or
reviewed) describing, in plain language, what's collected and that it's
stored in a Google Sheet. **This is not a substitute for real legal review**
before this schema goes into production with real traffic. Specifically
flag for review:
- Whether the current factual disclosure is sufficient or whether formal
  privacy-policy language is required before launch.
- The email-consent mechanism described under "Consent" above (implied via
  disclosure + submission, not a separate checkbox) — confirm this is
  acceptable for your jurisdiction/audience rather than requiring an
  explicit checkbox.
- The SMS opt-in copy in `_partials/presale-modal.html` (marked in an HTML
  comment as draft) — needs real compliance-reviewed language, particularly
  around consent required by SMS marketing regulations (e.g. TCPA), before
  any SMS system is ever connected to `sms_consent: true` records.
- Data retention / deletion — nothing in this implementation deletes or
  expires rows; that's an operational decision for whoever manages the
  sheet, not something this codebase enforces.
