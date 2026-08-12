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
| `functions/api/health.js` | `GET /api/health` → counts |
| `functions/api/_store.js` | **Stub persistence — in-memory, resets when the Worker isolate recycles** |
| `_headers` | Cloudflare Pages cache-control rules |
| `assets/hero-still-life.jpg` | Hero photo, also used as the OG/Twitter share image |
| `_partials/nav.html` | Single source of truth for the header + mobile menu |
| `build.mjs` | Injects `_partials/nav.html` into every page between `<!-- NAV:START -->` / `<!-- NAV:END -->` markers |

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

1. `functions/api/_store.js` is the only stub. Replace `addSubscriber` / `addSubmission`
   with real persistence (KV / D1) and an ESP. No provider has been chosen — this is
   deliberately out of scope for the current pass.
2. `contact.html` has no monitored email wired up. Do not invent one — add it once a
   real inbox exists, in one place (search for `TODO` in `contact.html`).
3. `conduct.html` and `privacy.html` are honest placeholders, not fake legal copy.
   Replace with real approved copy when it exists.
4. Set `<link rel="canonical">` and `og:url` on every page once the production domain
   is live — they're commented out on purpose rather than pointing at a guessed URL.
5. No rate limiting or spam trap beyond a client-side honeypot field on both forms.
   Add real rate limiting before launch.

## Routes

`/` home · `/about.html` · `/artists.html` · `/conduct.html` · `/privacy.html` ·
`/contact.html`. No hash-routing, no client-side router — every page is a real static
file crawlers and no-JS clients can read.

## Behaviour notes

- No fake queue/confirmation-email language: pre-sale sign-up is a single step
  (email → "you're in"), not a double opt-in. There is no confirmation-email system,
  so none is implied in the copy.
- The pre-sale and artist forms both degrade to a local echo when the API is
  unreachable (static-only hosting, offline), so the flows still demo — but nothing
  is stored in that case.
- No social links in the footer. There are no official DESCARDED social accounts yet;
  the UI is left out entirely rather than pointing at invented handles.
