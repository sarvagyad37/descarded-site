/* Google Sheets persistence client.
   Calls a Google Apps Script Web App over a server-side, authenticated
   fetch. The Apps Script URL and shared secret live only in Cloudflare
   Pages environment secrets (GOOGLE_APPS_SCRIPT_URL,
   GOOGLE_APPS_SCRIPT_SECRET) — never in client-side code, never committed.

   Apps Script always responds 200 with a JSON body describing success/
   failure (it has no way to set arbitrary HTTP status codes), so success
   is read from payload.ok, not from the HTTP status. */

export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
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

export async function addSubscriber(env, { email, source, campaign, referrer, landingPage }) {
  const normalized = String(email || '').trim().toLowerCase();
  const payload = await callAppsScript(env, 'presale', {
    email: normalized,
    source: source || '',
    campaign: campaign || '',
    referrer: referrer || '',
    landing_page: landingPage || ''
  });
  return { code: payload.code === 'already' ? 'already' : 'new' };
}

export async function addSubmission(env, entry) {
  const ref = 'DSC-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  await callAppsScript(env, 'artist', Object.assign({ ref }, entry));
  return { ref };
}
