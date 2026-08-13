/* Lightweight local latency check — NOT a production analytics platform,
   just evidence that Google Sheets latency no longer affects the
   visitor-facing response time.

   Requires `wrangler pages dev` running on :8788 with DEBUG_TIMING=true in
   .dev.vars (adds X-Timing-Validation-Ms / X-Timing-D1-Ms response headers,
   dev-only) and the mock Apps Script on :8791.

   Reports four numbers, separately:
     - request validation time   (from the X-Timing-Validation-Ms header)
     - D1 write time              (from the X-Timing-D1-Ms header)
     - API response time          (measured client-side, full round trip)
     - Google background sync time (google_synced_at - created_at, read
                                     back from D1 after the fact)

   Usage: node scripts/measure-latency.mjs [count]  (default 10) */

import { execSync } from 'node:child_process';

const BASE = 'http://localhost:8788';
const COUNT = Number(process.argv[2] || 10);

function d1Query(sql) {
  const out = execSync(
    `npx wrangler d1 execute DB --local --json --command ${JSON.stringify(sql)}`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const parsed = JSON.parse(out);
  return parsed[0]?.results || [];
}

function avg(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : NaN;
}

function fmt(n) {
  return Number.isFinite(n) ? n.toFixed(1) : 'n/a';
}

async function main() {
  const leadIds = [];
  const apiMs = [];
  const validationMs = [];
  const d1Ms = [];

  console.log(`Sending ${COUNT} presale submissions to ${BASE}/api/presale ...`);

  for (let i = 0; i < COUNT; i++) {
    const email = `latency-${Date.now()}-${i}@example.com`;
    const start = performance.now();
    const res = await fetch(`${BASE}/api/presale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const elapsed = performance.now() - start;
    await res.json();

    apiMs.push(elapsed);
    const v = Number(res.headers.get('X-Timing-Validation-Ms'));
    const d = Number(res.headers.get('X-Timing-D1-Ms'));
    if (Number.isFinite(v)) validationMs.push(v);
    if (Number.isFinite(d)) d1Ms.push(d);

    const rows = d1Query(`SELECT lead_id FROM presale WHERE email = '${email}';`);
    if (rows[0]) leadIds.push(rows[0].lead_id);
  }

  // Give the background waitUntil(...) syncs a moment to land, then read
  // sync duration back from the rows we just wrote.
  await new Promise((r) => setTimeout(r, 1500));

  const syncMs = [];
  for (const leadId of leadIds) {
    const rows = d1Query(`SELECT created_at, google_synced_at FROM presale WHERE lead_id = '${leadId}';`);
    const row = rows[0];
    if (row && row.google_synced_at) {
      syncMs.push(new Date(row.google_synced_at) - new Date(row.created_at));
    }
  }

  console.log('');
  console.log('Results (ms), averaged over', COUNT, 'requests:');
  console.log('  request validation :', fmt(avg(validationMs)));
  console.log('  D1 write            :', fmt(avg(d1Ms)));
  console.log('  API response (total):', fmt(avg(apiMs)));
  console.log('  Google background sync (post-response):', fmt(avg(syncMs)), `(n=${syncMs.length}/${COUNT} confirmed synced)`);
  console.log('');
  console.log('API response time excludes Google sync time entirely — the visitor');
  console.log('never waits on it. Compare "API response (total)" above against the');
  console.log('2s-33s round trips logged in KNOWN_ISSUES.md under the old architecture.');
}

main();
