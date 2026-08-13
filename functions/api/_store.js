/* Google Sheets background sync.
   D1 (see _db.js) is the source of truth and the only thing the request
   fast path waits on. This module is called from context.waitUntil(...)
   AFTER a D1 write already succeeded — its entire job is to mirror that row
   into Google Sheets via the existing Apps Script Web App, and record the
   outcome back onto the D1 row (google_synced / google_synced_at /
   google_sync_error). A failure here is logged and recorded; it must never
   surface to the visitor, because their submission already succeeded.

   The Apps Script URL and shared secret live only in Cloudflare Pages
   environment secrets (GOOGLE_APPS_SCRIPT_URL, GOOGLE_APPS_SCRIPT_SECRET) —
   never in client-side code, never committed. Apps Script always responds
   200 with a JSON body describing success/failure (it has no way to set
   arbitrary HTTP status codes), so success is read from payload.ok, not
   from the HTTP status. */

import { markGoogleSynced, markGoogleSyncError } from './_db.js';

export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function randomCode(len) {
  return crypto.randomUUID().replace(/-/g, '').slice(0, len).toUpperCase();
}

export function generateLeadId() {
  return 'DSC-L-' + randomCode(10);
}

export function generateReferralCode() {
  return randomCode(6);
}

export function generateArtistRef() {
  return 'DSC-' + randomCode(5);
}

async function callAppsScript(env, op, data) {
  const url = env.GOOGLE_APPS_SCRIPT_URL;
  const secret = env.GOOGLE_APPS_SCRIPT_SECRET;
  if (!url || !secret) {
    throw new StoreError('NOT_CONFIGURED', 'Persistence is not configured.');
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, op, data })
    });
  } catch (e) {
    throw new StoreError('UNREACHABLE', 'Could not reach the persistence service.');
  }

  let payload;
  try {
    payload = await res.json();
  } catch (e) {
    throw new StoreError('BAD_RESPONSE', 'Persistence service returned an invalid response.');
  }

  if (!payload || payload.ok !== true) {
    const code = payload && payload.code === 'UNAUTHORIZED' ? 'UNAUTHORIZED' : 'REJECTED';
    const message = (payload && payload.error) || 'Persistence service rejected the request.';
    throw new StoreError(code, message);
  }

  return payload;
}

/* Mirrors an already-persisted presale row into Google Sheets. Call only
   from context.waitUntil(...) after insertPresale() returned { code: "new" }
   — a duplicate ("already") never reaches here, since no new row exists to
   mirror. `row` keys match the Presale sheet's header names 1:1, so Code.gs
   can write by header lookup without any name translation. created_at is
   intentionally NOT sent — Code.gs always stamps that itself, independently,
   at the moment it actually appends (see Code.gs for why: it must reflect
   Sheets write time, not D1 write time). */
export async function syncPresaleToGoogle(env, row) {
  try {
    await callAppsScript(env, 'presale', {
      lead_id: row.lead_id,
      phone: row.phone || '',
      referral_code: row.referral_code,
      email_consent: true,
      sms_consent: Boolean(row.sms_consent),
      referred_by: row.referred_by || '',
      first_name: row.first_name || '',
      last_name: row.last_name || '',
      email: row.email,
      status: row.status || 'active',
      source: row.source || '',
      campaign: row.campaign || '',
      medium: row.medium || '',
      term: row.term || '',
      content: row.content || '',
      ip_address: row.ip_address || '',
      user_agent: row.user_agent || '',
      notes: row.notes || ''
    });
    await markGoogleSynced(env, 'presale', 'lead_id', row.lead_id);
  } catch (e) {
    console.error('syncPresaleToGoogle failed for lead_id=' + row.lead_id + ':', e && e.message);
    await markGoogleSyncError(env, 'presale', 'lead_id', row.lead_id, (e && e.message) || 'unknown error');
  }
}

/* Mirrors an already-persisted artist row into Google Sheets. Call only
   from context.waitUntil(...) after insertArtist() returned a ref. `row`
   keys match the Artists sheet's header names 1:1. `ref` is the stable
   identifier Code.gs now dedupes on (see Code.gs's handleArtist), so a
   retried background sync for the same D1 row can never create a second
   sheet row. */
export async function syncArtistToGoogle(env, row) {
  try {
    await callAppsScript(env, 'artist', {
      ref: row.ref,
      artist_name: row.artist_name || '',
      creator_type: row.creator_type || '',
      genre: row.genre || '',
      email: row.email,
      phone: row.phone || '',
      portfolio_url: row.portfolio_url || '',
      social_media_url: row.social_media_url || '',
      status: row.status || 'new',
      notes: row.notes || ''
    });
    await markGoogleSynced(env, 'artists', 'ref', row.ref);
  } catch (e) {
    console.error('syncArtistToGoogle failed for ref=' + row.ref + ':', e && e.message);
    await markGoogleSyncError(env, 'artists', 'ref', row.ref, (e && e.message) || 'unknown error');
  }
}
