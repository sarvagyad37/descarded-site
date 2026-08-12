/* POST /api/artists
   body: { artist_name, genre, email, phone, portfolio_url, social_media_url, company }
   -> 200 { ref }
   -> 400 { error }   (bad input, rejected before touching persistence)
   -> 502 { error }   (persistence unreachable/rejected — nothing was saved)

   "company" is the honeypot field — see presale.js for why this is
   enforced server-side, not just client-side.

   The ref (DSC-XXXXX) is generated in _store.js, but is only ever returned
   to the client after Google Sheets confirms the row was written — never
   before.

   Artist submissions never touch the Presale sheet and never imply email
   or SMS marketing consent — those only exist on the presale flow. */

import { addSubmission, StoreError } from './_store.js';
import { isEmail, readJson, normalizePhone, json } from './_util.js';

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

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return json(400, { error: 'BAD REQUEST BODY.' });

  if (body.company) return json(400, { error: 'BAD REQUEST.' });

  if (!String(body.artist_name || '').trim()) return json(400, { error: 'ADD A NAME OR ALIAS.' });
  if (typeof body.email !== 'string' || body.email.length > 254 || !isEmail(body.email)) {
    return json(400, { error: "THAT EMAIL DOESN'T LOOK RIGHT." });
  }
  if (!String(body.genre || '').trim()) return json(400, { error: 'ADD A GENRE.' });
  if (!looksLikeUrl(body.portfolio_url)) return json(400, { error: 'ADD A VALID PORTFOLIO LINK.' });
  if (body.social_media_url && !looksLikeUrl(body.social_media_url)) {
    return json(400, { error: 'THAT SOCIAL LINK DOESN\'T LOOK RIGHT.' });
  }

  for (const key of Object.keys(MAX_LEN)) {
    if (tooLong(body[key], MAX_LEN[key])) return json(400, { error: 'BAD REQUEST.' });
  }

  const phone = normalizePhone(body.phone);
  if (!phone.ok) return json(400, { error: "THAT PHONE NUMBER DOESN'T LOOK RIGHT." });

  try {
    const { ref } = await addSubmission(env, {
      artistName: String(body.artist_name).trim(),
      genre: String(body.genre).trim(),
      email: String(body.email).trim().toLowerCase(),
      phone: phone.value,
      portfolioUrl: String(body.portfolio_url).trim(),
      socialMediaUrl: String(body.social_media_url || '').trim()
    });
    return json(200, { ref });
  } catch (e) {
    if (e instanceof StoreError) {
      return json(502, { error: "COULDN'T SEND. NOTHING WAS SUBMITTED. TRY AGAIN." });
    }
    return json(500, { error: 'SOMETHING WENT WRONG. TRY AGAIN.' });
  }
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
