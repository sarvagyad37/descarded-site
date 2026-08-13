/* Dev/test-only stand-in for the real Google Apps Script Web App.
   Emulates the same doPost contract as integrations/google-apps-script/Code.gs
   (secret check, header-based schema validation, presale dedupe-by-email,
   artist append) so the Cloudflare Pages Functions can be exercised
   end-to-end via `wrangler pages dev` without needing a real Google account.

   NOT used in production. Never imported by functions/api/*.

   To simulate a broken production spreadsheet schema (a real, if rare,
   failure mode Code.gs is built to fail loudly on), send an email of
   "schema-mismatch@example.com" for presale, or an artist_name of
   "SCHEMA_MISMATCH" for artists — the mock will respond the way Code.gs
   would if a required column were missing, without touching its store.

   Usage: node scripts/mock-apps-script.mjs [port]
   Env:   MOCK_SECRET (default: test-shared-secret) */

import { createServer } from 'node:http';

const PORT = Number(process.argv[2] || process.env.MOCK_PORT || 8791);
const SECRET = process.env.MOCK_SECRET || 'test-shared-secret';
// Artificial latency, for measure-latency.mjs demonstrations only — real
// Apps Script has no such knob. Simulates the 2s-33s round trips logged in
// KNOWN_ISSUES.md to prove the D1-primary write path doesn't wait on them.
const DELAY_MS = Number(process.env.MOCK_DELAY_MS || 0);

const presaleEmails = new Map(); // normalized email -> row
const artistSubmissions = [];

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

const server = createServer(async (req, res) => {
  // Test-only introspection, not part of the real Apps Script contract —
  // lets scripts/test-api.sh verify retry-safety (no duplicate rows) from
  // outside without needing direct access to this module's in-memory state.
  if (req.method === 'GET' && req.url === '/_debug') {
    return send(res, 200, {
      presaleCount: presaleEmails.size,
      artistCount: artistSubmissions.length,
      artistRefs: artistSubmissions.map((s) => s.ref)
    });
  }

  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'METHOD NOT ALLOWED' });

  if (DELAY_MS > 0) await new Promise((r) => setTimeout(r, DELAY_MS));

  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    return send(res, 200, { ok: false, error: 'MALFORMED JSON' }); // real Apps Script always 200s
  }

  if (!body || body.secret !== SECRET) {
    return send(res, 200, { ok: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' });
  }

  const data = body.data || {};

  if (body.op === 'presale') {
    const email = String(data.email || '').trim().toLowerCase();
    if (!email || email.indexOf('@') === -1) return send(res, 200, { ok: false, error: 'INVALID EMAIL' });
    if (email === 'schema-mismatch@example.com') {
      return send(res, 200, { ok: false, error: 'INVALID SHEET SCHEMA on "Presale": missing column(s): lead_id' });
    }
    if (presaleEmails.has(email)) return send(res, 200, { ok: true, code: 'already' });
    presaleEmails.set(email, { ...data, email, created_at: new Date().toISOString() });
    return send(res, 200, { ok: true, code: 'new' });
  }

  if (body.op === 'artist') {
    if (!data.ref) return send(res, 200, { ok: false, error: 'MISSING REF' });
    if (data.artist_name === 'SCHEMA_MISMATCH') {
      return send(res, 200, { ok: false, error: 'INVALID SHEET SCHEMA on "Artists": missing column(s): genre' });
    }
    // Mirrors Code.gs's ref-based dedup: a retried background sync for the
    // same D1 row must not create a second row.
    if (artistSubmissions.some((s) => s.ref === data.ref)) {
      return send(res, 200, { ok: true, ref: data.ref });
    }
    artistSubmissions.push({ ...data, created_at: new Date().toISOString() });
    return send(res, 200, { ok: true, ref: data.ref });
  }

  return send(res, 200, { ok: false, error: 'UNKNOWN OPERATION' });
});

server.listen(PORT, () => {
  console.log(`mock apps script listening on http://127.0.0.1:${PORT}`);
  console.log(`expected secret: ${SECRET}`);
});

// Exposed for scripts/test-api.sh sanity checks / future extension.
export { presaleEmails, artistSubmissions };
