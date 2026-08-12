/* GET /api/health -> { ok, store, configured }
   Truthful status only — no fabricated subscriber/submission counts.
   "configured" reflects whether the two required secrets are present, not
   their values, and does not make a live call to Apps Script (a health
   check shouldn't add latency/cost to the Sheets integration just to
   answer "is this deployment wired up"). */

import { json } from './_util.js';

export async function onRequestGet({ env }) {
  const configured = Boolean(env.GOOGLE_APPS_SCRIPT_URL && env.GOOGLE_APPS_SCRIPT_SECRET);
  return json(200, { ok: true, store: 'google-sheets', configured });
}
