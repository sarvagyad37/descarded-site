/* POST /api/artists
   body: { artist_name, creator_type, genre, email, phone, portfolio_url,
           social_media_url, company }
   -> 200 { ref }
   -> 400 { error }   (bad input, rejected before touching persistence)
   -> 502 { error }   (D1 unavailable/rejected — nothing was saved)

   D1 is the source of truth and the only thing this handler waits on. The
   ref (DSC-XXXXX) is generated and persisted in D1 first — it is only ever
   returned to the client after D1 confirms the row was written, never
   before. Google Sheets is an operational mirror, synced in the background
   via context.waitUntil(...) — see _store.js. A Google failure never turns
   a successful D1 write into a failed response.

   "company" is the honeypot field — see presale.js for why this is
   enforced server-side, not just client-side.

   creator_type is a controlled-vocabulary field used for operational
   triage (which kind of work this is), required so DESCARDED can actually
   sort/filter submissions. genre is a separate, free-text STYLE field
   (house, glitch, mixed media, …) and is optional — creators without a
   meaningful genre (most non-music disciplines) aren't forced into one.
   portfolio_url is presented to visitors as "WORK LINK" — any legitimate
   link to their work qualifies, not specifically a portfolio site.

   Artist submissions never touch the Presale table and never imply email
   or SMS marketing consent — those only exist on the presale flow. */

import { insertArtist, DbError } from './_db.js';
import { syncArtistToGoogle, generateArtistRef } from './_store.js';
import { isEmail, readJson, normalizePhone, json } from './_util.js';

// Keep in sync with the CREATOR_TYPES list in app.js.
const CREATOR_TYPES = [
  'DJ / MUSIC', 'PERFORMANCE', 'VISUAL ART', 'PHOTO / VIDEO',
  'DESIGN / FASHION', 'INSTALLATION', 'DIGITAL / INTERACTIVE', 'OTHER'
];

const MAX_LEN = {
  artist_name: 200, genre: 100,
  portfolio_url: 500, social_media_url: 500
};

const URL_RE = /^\S+\.\S{2,}$/; // loose: no whitespace, has a dot somewhere with 2+ chars after it

function tooLong(v, max) {
  return typeof v === 'string' && v.length > max;
}

function looksLikeUrl(v) {
  return typeof v === 'string' && URL_RE.test(v.trim());
}

export async function onRequestPost({ request, env, waitUntil }) {
  const validationStart = Date.now();

  const body = await readJson(request);
  if (!body) return json(400, { error: 'BAD REQUEST BODY.' });

  if (body.company) return json(400, { error: 'BAD REQUEST.' });

  if (!String(body.artist_name || '').trim()) return json(400, { error: 'ADD A NAME OR ALIAS.' });
  if (typeof body.email !== 'string' || body.email.length > 254 || !isEmail(body.email)) {
    return json(400, { error: "THAT EMAIL DOESN'T LOOK RIGHT." });
  }
  if (CREATOR_TYPES.indexOf(String(body.creator_type || '').toUpperCase()) === -1) {
    return json(400, { error: 'PICK A CREATOR TYPE.' });
  }
  if (!looksLikeUrl(body.portfolio_url)) return json(400, { error: 'ADD A VALID WORK LINK.' });
  if (body.social_media_url && !looksLikeUrl(body.social_media_url)) {
    return json(400, { error: "THAT SOCIAL LINK DOESN'T LOOK RIGHT." });
  }

  for (const key of Object.keys(MAX_LEN)) {
    if (tooLong(body[key], MAX_LEN[key])) return json(400, { error: 'BAD REQUEST.' });
  }

  const phone = normalizePhone(body.phone);
  if (!phone.ok) return json(400, { error: "THAT PHONE NUMBER DOESN'T LOOK RIGHT." });

  const validationMs = Date.now() - validationStart;

  const row = {
    artist_name: String(body.artist_name).trim(),
    creator_type: String(body.creator_type).toUpperCase(),
    genre: String(body.genre || '').trim(),
    email: String(body.email).trim().toLowerCase(),
    phone: phone.value,
    portfolio_url: String(body.portfolio_url).trim(),
    social_media_url: String(body.social_media_url || '').trim(),
    status: 'new',
    notes: ''
  };

  const d1Start = Date.now();
  let result;
  try {
    result = await insertArtist(env, row, generateArtistRef);
  } catch (e) {
    if (e instanceof DbError) {
      return json(502, { error: "COULDN'T SEND. NOTHING WAS SUBMITTED. TRY AGAIN." });
    }
    return json(500, { error: 'SOMETHING WENT WRONG. TRY AGAIN.' });
  }
  const d1Ms = Date.now() - d1Start;

  waitUntil(syncArtistToGoogle(env, Object.assign({ ref: result.ref }, row)));

  const extraHeaders = env.DEBUG_TIMING === 'true'
    ? { 'X-Timing-Validation-Ms': String(validationMs), 'X-Timing-D1-Ms': String(d1Ms) }
    : undefined;

  return json(200, { ref: result.ref }, extraHeaders);
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
