/* POST /api/artists
   body: { artist_name, creator_type, genre, email, phone, portfolio_url,
           social_media_url, company }
   -> 200 { ref }
   -> 400 { error }   (bad input, rejected before touching persistence)
   -> 502 { error }   (persistence unreachable/rejected — nothing was saved)

   "company" is the honeypot field — see presale.js for why this is
   enforced server-side, not just client-side.

   The ref (DSC-XXXXX) is generated in _store.js, but is only ever returned
   to the client after Google Sheets confirms the row was written — never
   before.

   creator_type is a controlled-vocabulary field used for operational
   triage (which kind of work this is), required so DESCARDED can actually
   sort/filter submissions. genre is a separate, free-text STYLE field
   (house, glitch, mixed media, …) and is optional — creators without a
   meaningful genre (most non-music disciplines) aren't forced into one.
   portfolio_url is presented to visitors as "WORK LINK" — any legitimate
   link to their work qualifies, not specifically a portfolio site.

   Artist submissions never touch the Presale sheet and never imply email
   or SMS marketing consent — those only exist on the presale flow. */

import { addSubmission, StoreError } from './_store.js';
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

export async function onRequestPost({ request, env }) {
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

  try {
    const { ref } = await addSubmission(env, {
      artistName: String(body.artist_name).trim(),
      creatorType: String(body.creator_type).toUpperCase(),
      genre: String(body.genre || '').trim(),
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
