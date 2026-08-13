/* GET /api/health -> { ok, store, configured, google_mirror_configured }
   Truthful status only — no fabricated subscriber/submission counts. D1 is
   the source of truth; "configured" reflects whether the DB binding is
   present. "google_mirror_configured" reflects whether the two Google Apps
   Script secrets are present, not their values, and does not make a live
   call to Apps Script (a health check shouldn't add latency/cost to the
   background mirror just to answer "is this deployment wired up"). */

import { json } from './_util.js';

export async function onRequestGet({ env }) {
  const configured = Boolean(env.DB);
  const googleMirrorConfigured = Boolean(env.GOOGLE_APPS_SCRIPT_URL && env.GOOGLE_APPS_SCRIPT_SECRET);
  return json(200, { ok: true, store: 'd1', configured, google_mirror_configured: googleMirrorConfigured });
}
