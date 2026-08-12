# Google Apps Script — DESCARDED persistence endpoint

`Code.gs` is the full source for the Web App that Cloudflare Pages Functions
call to persist form submissions into the business-owned Google Sheet.

Full install/deploy walkthrough, required Cloudflare secrets, and how the
Cloudflare ↔ Apps Script authentication works: see **"Google Sheets
persistence"** in the main repo README, not here — this file is just the
source to copy in.

Quick reference:

1. Create/open the spreadsheet **"DESCARDED — Form Submissions"**.
2. Extensions → Apps Script, paste in `Code.gs`.
3. Project Settings → Script Properties → add `SHARED_SECRET`.
4. Deploy → New deployment → Web app → Execute as **Me**, access **Anyone**.
5. Put the resulting URL and the same secret into Cloudflare Pages
   environment secrets (`GOOGLE_APPS_SCRIPT_URL`, `GOOGLE_APPS_SCRIPT_SECRET`).

The browser never talks to this script. Only the Cloudflare Pages Functions
in `functions/api/` do, server-side.
