/* Google Sheets persistence client.
   Calls a Google Apps Script Web App over a server-side, authenticated
   fetch. The Apps Script URL and shared secret live only in Cloudflare
   Pages environment secrets (GOOGLE_APPS_SCRIPT_URL,
   GOOGLE_APPS_SCRIPT_SECRET) — never in client-side code, never committed.

   Apps Script always responds 200 with a JSON body describing success/
   failure (it has no way to set arbitrary HTTP status codes), so success
   is read from payload.ok, not from the HTTP status.

   This module owns generating the server-side fields the visitor never
   enters directly: lead_id, referral_code, status, and (for artists) ref.
   created_at is generated in Code.gs instead, at the moment of actual
   persistence — see that file for why. */

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

/* entry keys match the Presale sheet's header names 1:1, so Code.gs can
   write by header lookup without any name translation. created_at is
   intentionally NOT included — Code.gs always stamps that itself. */
export async function addSubscriber(env, entry) {
  const email = String(entry.email || '').trim().toLowerCase();
  const payload = await callAppsScript(env, 'presale', {
    lead_id: generateLeadId(),
    phone: entry.phone || '',
    referral_code: generateReferralCode(),
    email_consent: true,
    sms_consent: Boolean(entry.smsConsent),
    referred_by: entry.referredBy || '',
    first_name: entry.firstName || '',
    last_name: entry.lastName || '',
    email,
    status: 'active',
    source: entry.source || '',
    campaign: entry.campaign || '',
    medium: entry.medium || '',
    term: entry.term || '',
    content: entry.content || '',
    ip_address: entry.ipAddress || '',
    user_agent: entry.userAgent || '',
    notes: ''
  });
  return { code: payload.code === 'already' ? 'already' : 'new' };
}

/* entry keys match the Artists sheet's header names 1:1, same reasoning. */
export async function addSubmission(env, entry) {
  const ref = generateArtistRef();
  await callAppsScript(env, 'artist', {
    ref,
    artist_name: entry.artistName || '',
    genre: entry.genre || '',
    email: String(entry.email || '').trim().toLowerCase(),
    phone: entry.phone || '',
    portfolio_url: entry.portfolioUrl || '',
    social_media_url: entry.socialMediaUrl || '',
    status: 'new',
    notes: ''
  });
  return { ref };
}
