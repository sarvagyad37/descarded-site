# PostHog — behavioral research (DESCARDED)

This is a **behavioral research instrument**, not marketing analytics or an
advertising pixel. It exists to answer one question:

> **Who wants to create?** What separates a visitor who just wants a
> pre-sale ticket from one who submits artist work — and where in the
> artist flow do would-be creators drop off?

D1 remains the only store of personal data (name, email, phone, links).
Google Sheets remains the operational mirror of D1. PostHog receives
**only anonymous behavioral events** — it has no relationship to either
persistence layer and cannot be joined back to a D1 row.

## Installation

Client library: PostHog's official JS snippet (`array.js`), loaded lazily
by `analytics.js` — not a build-time dependency, consistent with the rest
of this no-build-step static site.

- `functions/api/config.js` — serves `{ posthogApiKey, posthogHost }` from
  environment variables. Not authenticated: PostHog project API keys are
  designed to be client-embeddable, so this isn't a secret leak, but the
  key still isn't hardcoded — it's environment-configurable so local/
  preview/production can point at different PostHog projects (or none)
  without a code change.
- `analytics.js` — fetches `/api/config`; if no key is present, every
  tracking call becomes a no-op and the PostHog script is never even
  loaded. Included on every page except `404.html` via
  `<script src="/analytics.js" defer></script>`, right after `/app.js`.

### Environment variables

| Variable | Where | Required | Notes |
|---|---|---|---|
| `POSTHOG_API_KEY` | `.dev.vars` (local) / Cloudflare Pages env vars (prod) | No — analytics disables itself if absent | Not a secret; still env-configured, never hardcoded |
| `POSTHOG_HOST` | same | No — defaults to `https://us.i.posthog.com` | Set explicitly if using an EU-hosted or self-hosted PostHog instance |

Set both in the Cloudflare Pages dashboard (Settings → Environment
variables) for Production/Preview the same way `GOOGLE_APPS_SCRIPT_URL` is
already set — see `docs/PRODUCTION_ACTIVATION_CHECKLIST.md`.

## Privacy guarantees

Disabled, explicitly, in `analytics.js`'s `posthog.init(...)` call:

- `autocapture: false` — no automatic click/form capture
- `capture_pageview: false` — page views are sent manually, only for the
  one page (`home_viewed`) actually in the taxonomy
- `disable_session_recording: true` — no session replay, ever
- `enable_heatmaps: false`
- `capture_dead_clicks: false` — rage/dead-click detection off
- `person_profiles: 'identified_only'` — since `posthog.identify()` is
  never called anywhere in this codebase, no PostHog "person" profile is
  ever created; every event stays a fully anonymous event

**Never transmitted, by construction** (no code path in `analytics.js`
reads these): email, phone, name, IP address, or any other form field
*value*. Where a field matters for research, only the field **name**
(`field_completed`'s `field` property) or a fixed category value
(`creator_type_selected`'s `value`, which is one of eight enum options
like `"DJ / MUSIC"` — never free text) is sent.

IP address: PostHog auto-populates coarse geolocation
(`$geoip_city_name` etc.) from the request IP server-side. To ensure the
raw IP itself is never retained, enable **Project settings → "Discard
client IP data"** in the PostHog dashboard once the project is created —
this is a one-time dashboard setting, not something `analytics.js` can
control client-side.

## Event taxonomy

| Event | Fired when | Properties (beyond globals) |
|---|---|---|
| `home_viewed` | `/` loads | — |
| `artist_section_viewed` | the artist form section (`.artists-form-wrap`) scrolls into view on `artists.html` (`IntersectionObserver`, threshold 0.4) | — |
| `presale_section_viewed` | the pre-sale modal **actually becomes visible** — watched via `MutationObserver` on the modal panel's `hidden` attribute, not a click on the trigger. A click is a *request* to open; `openPresale()` in `app.js` only ever flips `hidden` on success, but the two must not be conflated | — |
| `creator_type_selected` | the artist form's Creator Type `<select>` changes to a non-empty value | `form: "artist"`, `value` (one of the 8 fixed creator-type options) |
| `form_started` | the **first `input` or `change`** event on any field in either form | `form: "presale" \| "artist"` |
| `field_completed` | a field is blurred with a non-empty value, the first time | `form`, `field` (the input's `name` attribute — never its value) |
| `form_abandoned` | `form_started` fired but the form was closed/navigated away from before `form_submitted` fired | `form` |
| `form_submitted` | the confirmed-success DOM state — watched via `MutationObserver` on the result view's `hidden` attribute, which `app.js` only ever unhides after the API call resolves successfully (D1 is the authority — see `functions/api/presale.js` / `artists.js`) | `form` |
| `portfolio_link_added` | the artist form's Work Link field is completed for the first time | `form: "artist"` |
| `social_link_added` | the artist form's Social Media field is completed for the first time | `form: "artist"` |

**Why `form_started` uses `input`/`change`, not `focus`**: `openPresale()`
in `app.js` calls `emailInput.focus()` programmatically when the pre-sale
modal opens. A focus-based trigger would fire `form_started` on every
modal open — including a visitor who opens it and immediately closes it
without typing anything — which is not a real user action and would
inflate "form started" counts with pure impressions. `input`/`change`
only fire from an actual keystroke, paste, or selection change.

**Why `form_submitted` uses the result-view DOM state, not the `submit`
event**: the `submit` event fires even when client-side validation
immediately rejects the attempt (bad email, missing creator type, etc.).
Counting that as "submitted" would both overstate conversions and
silently swallow the `form_abandoned` event that attempt should produce
if the visitor leaves without ever actually succeeding. Watching the
result view's visibility instead ties the event to the same
success condition the UI itself uses to tell the visitor they're done —
never claim more than the interface itself confirms.

### Global properties (attached to every event via `posthog.register()`)

| Property | Source |
|---|---|
| `utm_source` / `utm_medium` / `utm_campaign` | URL query params, captured once on first pageview of the browser session (sessionStorage), reused for the rest of the session |
| `referrer` | `document.referrer` at first pageview of the session |
| `device_type` | `"mobile" \| "tablet" \| "desktop"`, computed per-event from `matchMedia` breakpoints |
| `session_id` | random UUID, generated once per browser session (sessionStorage) |
| `anonymous_visitor_id` | random UUID, generated once per browser/device (localStorage), persists across sessions — this is a self-managed identifier, independent of PostHog's own internal distinct_id, and is never linked to `identify()` |

## Event ownership

| Event | Owner (who acts on this) |
|---|---|
| `home_viewed`, global acquisition properties | Growth/marketing — channel effectiveness |
| `artist_section_viewed`, `creator_type_selected`, `portfolio_link_added`, `social_link_added` | Artist program / curation — who's interested in submitting and what kind of creator they are |
| `presale_section_viewed` | Growth — pre-sale funnel top |
| `form_started`, `field_completed`, `form_abandoned`, `form_submitted` | Product — form UX, friction points, drop-off by field |

## Funnel definitions

**Artist conversion funnel** (the primary funnel for the "who wants to
create" research question):

```
home_viewed → artist_section_viewed → form_started (form=artist)
  → creator_type_selected → field_completed (field=portfolio_url)
  → form_submitted (form=artist)
```

**Pre-sale conversion funnel**:

```
home_viewed → presale_section_viewed → form_started (form=presale)
  → form_submitted (form=presale)
```

**Drop-off analysis**: filter `form_abandoned` by `form` and cross-tab
against the last `field_completed` seen in the same session (via
`session_id`) to find which field precedes abandonment most often.

## Dashboard definitions

1. **Acquisition** — `home_viewed` volume over time, broken down by
   `utm_source` / `utm_medium` / `utm_campaign` / `referrer` / `device_type`.
2. **Artist Interest** — `artist_section_viewed` → `form_started(artist)`
   conversion rate; `creator_type_selected` breakdown by `value` (which
   creator types are most represented); `portfolio_link_added` /
   `social_link_added` completion rates as a proxy for applicant
   seriousness.
3. **Pre-sale Interest** — `presale_section_viewed` → `form_started(presale)`
   → `form_submitted(presale)` conversion rate, by `device_type`.
4. **Form Friction** — `field_completed` funnel per form (which fields get
   filled, in what order, before drop-off); `form_abandoned` volume by
   `form` and `device_type`.
5. **Conversion Funnel** — the two funnels above side by side, to compare
   artist-path vs. pre-sale-path conversion rates directly.

## Audit findings (fixed before commit)

Every event was checked against the question "what real, human-driven DOM
event actually causes this to fire, and does that map to something a
stakeholder would recognize as the named business action?" Two events
failed that check on first pass and were corrected:

1. **`form_started` was firing on modal auto-focus, not user input.**
   `openPresale()` calls `emailInput.focus()` when the pre-sale modal
   opens. The original implementation used `focus` as the "did they
   start" signal, so opening the modal and closing it immediately —
   without typing anything — counted as a started form. Fixed by
   switching the trigger to `input`/`change`, which only fire from real
   keystrokes/selections. Verified live: opening and closing the modal
   with no typing now produces zero `form_started` events; typing into a
   field and then closing produces exactly one `form_started`, one
   `field_completed`, and one `form_abandoned`.
2. **`form_submitted` was firing on every submit attempt, including ones
   rejected by client-side validation.** The original implementation
   listened for the raw `submit` DOM event, which fires before
   validation runs. A rejected attempt would still be counted as
   "submitted," and — because the internal `submitted` flag was set
   `true` on that same event — a visitor who then abandoned after a
   rejected attempt would incorrectly *not* produce a `form_abandoned`
   event either. Fixed by deriving `form_submitted` from the confirmed-
   success DOM state instead (the result view becoming visible, which
   only happens after the API call resolves `ok`). Verified live,
   including against a genuine server error (502, from an unmigrated
   local D1): the failed attempt correctly produced `form_started` then
   `form_abandoned` on close — never a false `form_submitted`. A
   subsequent successful submission correctly produced `form_submitted`
   and no trailing `form_abandoned` even though the same "close" handler
   ran when the visitor dismissed the success view.
3. **`presale_section_viewed` was tied to a click on the trigger, not the
   modal actually opening.** Corrected to watch the panel's `hidden`
   attribute directly via `MutationObserver`, so the event can never fire
   for a trigger click that, for any reason, didn't actually open the
   modal.

All three fixes were verified with real DOM events (`input`/`change`,
`blur`, `requestSubmit()`, and a genuine successful `/api/presale` +
`/api/artists` round trip against local D1) driven through a live
`wrangler pages dev` instance, captured by a local mock PostHog capture
endpoint (`scripts/mock-posthog.mjs`) — not just read through review.
`artist_section_viewed` (`IntersectionObserver`-based) could not be
exercised the same way in the available browser automation tooling (its
tab reported a zero-height viewport, so no element was ever
"intersecting"); it uses the same standard `IntersectionObserver`
pattern as the rest of the codebase and was verified by code review only.

## Validation

To confirm the install after `POSTHOG_API_KEY` is set (local or prod):

1. Open the site with PostHog's project configured, open DevTools →
   Network, confirm requests to `us-assets.i.posthog.com` and
   `us.i.posthog.com` (or your configured host) appear only after page
   interaction — never a session-recording or heatmap request.
2. In the PostHog dashboard → Activity, confirm events appear with the
   exact names above and no `email`, `phone`, `first_name`, `last_name`,
   or free-text field values in their properties.
3. Confirm `person_profiles` stays empty in PostHog → Persons (no rows
   should ever appear there, since `identify()` is never called).
4. Cross-check: submit a real test presale/artist entry, confirm the row
   exists in D1 (`docs/PRODUCTION_ACTIVATION_CHECKLIST.md` has the
   `wrangler d1 execute` commands) — PostHog's `form_submitted` event
   firing does **not** by itself confirm persistence; D1 does.

### Reproducing the local verification

`scripts/mock-posthog.mjs` is a minimal stand-in for PostHog's capture
endpoint (mirrors the existing `scripts/mock-apps-script.mjs` pattern) —
it serves a stub script at `/static/array.js` implementing just
`init`/`register`/`capture`, and logs every captured event at `GET
/_debug`. To reproduce:

1. Run it (`node scripts/mock-posthog.mjs`, defaults to port 8790).
2. Temporarily point `analytics.js`'s `POSTHOG_SCRIPT_URL` at
   `http://127.0.0.1:8790/static/array.js` and set
   `POSTHOG_API_KEY`/`POSTHOG_HOST=http://127.0.0.1:8790` in `.dev.vars`
   (do not commit either change).
3. Run `wrangler pages dev .` as usual and interact with the site;
   `curl http://127.0.0.1:8790/_debug` shows every captured event and its
   properties in order.
4. Revert both temporary changes before committing.
