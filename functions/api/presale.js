/* POST /api/presale  { email, source }
   -> 200 { code: "new" | "already" }
   -> 400 { error }                            */

import { addSubscriber } from './_store.js';
import { isEmail, readJson, json } from './_util.js';

export async function onRequestPost({ request }) {
  const body = await readJson(request);
  if (!body) return json(400, { error: 'BAD REQUEST BODY.' });
  if (!isEmail(body.email)) return json(400, { error: "THAT EMAIL DOESN'T LOOK RIGHT." });

  const { code } = addSubscriber({ email: body.email, source: body.source });
  return json(200, { code, email: String(body.email).trim().toLowerCase() });
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
