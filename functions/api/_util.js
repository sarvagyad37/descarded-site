const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

export function isEmail(v) {
  return EMAIL_RE.test(String(v || '').trim());
}

/* Conservative, narrow phone handling — not a general international
   normalizer. An obvious 10-digit or 11-digit-with-leading-1 number is
   assumed US and formatted as E.164 (+1XXXXXXXXXX); anything else is
   passed through sanitized (digits only, plus a leading "+" preserved if
   the visitor typed one) rather than guessed at. Canonical E.164
   normalization for non-US numbers is intentionally left to whatever
   marketing/SMS platform eventually consumes this data — pretending to
   normalize international numbers without a real phone-number library
   would just produce confidently wrong data. Returns null for empty input
   (phone is optional) or for input too short/long to plausibly be a phone
   number at all. */
export function normalizePhone(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { value: '', ok: true };

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return { value: '', ok: false };

  if (digits.length === 10) return { value: '+1' + digits, ok: true };
  if (digits.length === 11 && digits[0] === '1') return { value: '+' + digits, ok: true };

  const passthrough = (trimmed.trim()[0] === '+' ? '+' : '') + digits;
  return { value: passthrough, ok: true };
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
