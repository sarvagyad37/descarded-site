/* POST /api/presale
   body: { first_name, last_name, email, phone, sms_consent,
           source, campaign, medium, term, content, referred_by, company }
   -> 200 { code: "new" | "already" }
   -> 400 { error }   (bad input, rejected before touching persistence)
   -> 502 { error }   (persistence unreachable/rejected — nothing was saved)

   "company" is the honeypot field. It's hidden from real users by CSS; if
   it's non-empty the request is treated as automated and rejected without
   ever reaching Google Sheets. This is server-side enforcement — the
   client-side honeypot check in app.js is not sufficient on its own since
   a bot can POST here directly.

   email_consent is not accepted from the client at all — every successful
   submission through this endpoint implies it, because the modal discloses
   "WE'LL SEND DESCARDED EVENT UPDATES TO THIS EMAIL. UNSUBSCRIBE ANY TIME."
   immediately next to the submit button. sms_consent is a real, separate,
   unchecked-by-default opt-in — its presence is required if the visitor
   wants text updates, and it does NOT get inferred from providing a phone
   number.

   ip_address and user_agent are read server-side from the request itself
   (CF-Connecting-IP is set by Cloudflare's edge and can't be spoofed by
   the client; the browser never sends its own IP). Neither is obtainable
   or exposed client-side. */

import { addSubscriber, StoreError } from './_store.js';
import { isEmail, readJson, normalizePhone, json } from './_util.js';

const MAX_LEN = {
  first_name: 100, last_name: 100,
  source: 200, campaign: 200, medium: 100, term: 200, content: 200,
  referred_by: 100
};

function tooLong(v, max) {
  return typeof v === 'string' && v.length > max;
}

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return json(400, { error: 'BAD REQUEST BODY.' });

  if (body.company) return json(400, { error: 'BAD REQUEST.' });

  if (typeof body.email !== 'string' || body.email.length > 254 || !isEmail(body.email)) {
    return json(400, { error: "THAT EMAIL DOESN'T LOOK RIGHT." });
  }

  for (const key of Object.keys(MAX_LEN)) {
    if (tooLong(body[key], MAX_LEN[key])) return json(400, { error: 'BAD REQUEST.' });
  }

  const phone = normalizePhone(body.phone);
  if (!phone.ok) return json(400, { error: "THAT PHONE NUMBER DOESN'T LOOK RIGHT." });

  const smsConsent = body.sms_consent === true;
  if (smsConsent && !phone.value) {
    return json(400, { error: 'ADD A PHONE NUMBER TO GET TEXT UPDATES.' });
  }

  const ipAddress = request.headers.get('CF-Connecting-IP') || '';
  const userAgent = (request.headers.get('User-Agent') || '').slice(0, 500);

  try {
    const { code } = await addSubscriber(env, {
      email: body.email,
      firstName: typeof body.first_name === 'string' ? body.first_name.trim() : '',
      lastName: typeof body.last_name === 'string' ? body.last_name.trim() : '',
      phone: phone.value,
      smsConsent,
      referredBy: body.referred_by,
      source: body.source,
      campaign: body.campaign,
      medium: body.medium,
      term: body.term,
      content: body.content,
      ipAddress,
      userAgent
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
