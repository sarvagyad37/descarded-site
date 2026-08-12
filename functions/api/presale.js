/* POST /api/presale  { email, source, campaign, referrer, landing_page, company }
   -> 200 { code: "new" | "already" }
   -> 400 { error }   (bad input, rejected before touching persistence)
   -> 502 { error }   (persistence unreachable/rejected — nothing was saved)

   "company" is the honeypot field. It's hidden from real users by CSS; if
   it's non-empty the request is treated as automated and rejected without
   ever reaching Google Sheets. This is server-side enforcement — the
   client-side honeypot check in app.js is not sufficient on its own since
   a bot can POST here directly. */

import { addSubscriber, StoreError } from './_store.js';
import { isEmail, readJson, json } from './_util.js';

const MAX_LEN = { source: 200, campaign: 200, referrer: 500, landing_page: 200 };

function tooLong(v, max) {
  return typeof v === 'string' && v.length > max;
}

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return json(400, { error: 'BAD REQUEST BODY.' });

  if (body.company) return json(400, { error: 'BAD REQUEST.' });

  if (typeof body.email !== 'string' || body.email.length > 254) {
    return json(400, { error: "THAT EMAIL DOESN'T LOOK RIGHT." });
  }
  if (!isEmail(body.email)) return json(400, { error: "THAT EMAIL DOESN'T LOOK RIGHT." });

  for (const key of Object.keys(MAX_LEN)) {
    if (tooLong(body[key], MAX_LEN[key])) return json(400, { error: 'BAD REQUEST.' });
  }

  try {
    const { code } = await addSubscriber(env, {
      email: body.email,
      source: body.source,
      campaign: body.campaign,
      referrer: body.referrer,
      landingPage: body.landing_page
    });
    return json(200, { code, email: String(body.email).trim().toLowerCase() });
  } catch (e) {
    if (e instanceof StoreError) {
      return json(502, { error: "COULDN'T JOIN. NOTHING WAS SUBMITTED. CHECK THE EMAIL AND TRY AGAIN." });
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
