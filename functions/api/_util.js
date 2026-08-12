const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

export function isEmail(v) {
  return EMAIL_RE.test(String(v || '').trim());
}

export function json(status, payload, extraHeaders) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: Object.assign(
      { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      extraHeaders || {}
    )
  });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}
