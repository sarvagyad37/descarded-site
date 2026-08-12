/* POST /api/artists  { name, email, city, role, link1, link2, notes, social }
   -> 200 { ref }
   -> 400 { error }                                                          */

import { addSubmission } from './_store.js';
import { isEmail, readJson, json } from './_util.js';

const ROLES = ['DJ', 'PERFORMER', 'VISUAL ARTIST', 'MUSICIAN', 'PRODUCER', 'DESIGNER', 'OTHER'];

export async function onRequestPost({ request }) {
  const body = await readJson(request);
  if (!body) return json(400, { error: 'BAD REQUEST BODY.' });
  if (!String(body.name || '').trim()) return json(400, { error: 'ADD A NAME OR ALIAS.' });
  if (!isEmail(body.email)) return json(400, { error: "THAT EMAIL DOESN'T LOOK RIGHT." });
  if (!String(body.city || '').trim()) return json(400, { error: 'ADD A CITY.' });
  if (ROLES.indexOf(String(body.role || '').toUpperCase()) === -1) return json(400, { error: 'PICK A ROLE.' });
  if (!String(body.link1 || '').trim()) return json(400, { error: 'ADD A PRIMARY WORK LINK.' });

  const record = addSubmission({
    name: String(body.name).trim(),
    email: String(body.email).trim().toLowerCase(),
    city: String(body.city).trim(),
    role: String(body.role).toUpperCase(),
    link1: String(body.link1).trim(),
    link2: String(body.link2 || '').trim(),
    notes: String(body.notes || '').trim(),
    social: String(body.social || '').trim()
  });

  return json(200, { ref: record.ref });
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
