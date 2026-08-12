/* POST /api/artists  { name, email, city, role, link1, link2, notes, social, company }
   -> 200 { ref }
   -> 400 { error }   (bad input, rejected before touching persistence)
   -> 502 { error }   (persistence unreachable/rejected — nothing was saved)

   "company" is the honeypot field — see presale.js for why this is
   enforced server-side, not just client-side.

   The ref (DSC-XXXXX) is generated here, but is only ever returned to the
   client after Google Sheets confirms the row was written — never before. */

import { addSubmission, StoreError } from './_store.js';
import { isEmail, readJson, json } from './_util.js';

const ROLES = ['DJ', 'PERFORMER', 'VISUAL ARTIST', 'MUSICIAN', 'PRODUCER', 'DESIGNER', 'OTHER'];

const MAX_LEN = { name: 200, city: 200, link1: 500, link2: 500, social: 200, notes: 4000 };

function tooLong(v, max) {
  return typeof v === 'string' && v.length > max;
}

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return json(400, { error: 'BAD REQUEST BODY.' });

  if (body.company) return json(400, { error: 'BAD REQUEST.' });

  if (!String(body.name || '').trim()) return json(400, { error: 'ADD A NAME OR ALIAS.' });
  if (typeof body.email !== 'string' || body.email.length > 254 || !isEmail(body.email)) {
    return json(400, { error: "THAT EMAIL DOESN'T LOOK RIGHT." });
  }
  if (!String(body.city || '').trim()) return json(400, { error: 'ADD A CITY.' });
  if (ROLES.indexOf(String(body.role || '').toUpperCase()) === -1) return json(400, { error: 'PICK A ROLE.' });
  if (!String(body.link1 || '').trim()) return json(400, { error: 'ADD A PRIMARY WORK LINK.' });

  for (const key of Object.keys(MAX_LEN)) {
    if (tooLong(body[key], MAX_LEN[key])) return json(400, { error: 'BAD REQUEST.' });
  }

  try {
    const { ref } = await addSubmission(env, {
      name: String(body.name).trim(),
      email: String(body.email).trim().toLowerCase(),
      city: String(body.city).trim(),
      role: String(body.role).toUpperCase(),
      link1: String(body.link1).trim(),
      link2: String(body.link2 || '').trim(),
      notes: String(body.notes || '').trim(),
      social: String(body.social || '').trim()
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
