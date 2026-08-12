/* Unit tests for functions/api/_store.js — specifically the Google-side
   failure paths (unreachable, auth failure, malformed response) that are
   awkward to exercise through a full wrangler+HTTP round trip. Mocks
   globalThis.fetch directly. Zero dependencies, plain Node assertions. */

import assert from 'node:assert/strict';
import { addSubscriber, addSubmission, StoreError } from '../functions/api/_store.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL - ${name}`);
    console.log(`         ${e.message}`);
  }
}

function mockFetch(impl) {
  globalThis.fetch = impl;
}

const ENV = { GOOGLE_APPS_SCRIPT_URL: 'https://example.invalid/exec', GOOGLE_APPS_SCRIPT_SECRET: 'shh' };

async function run() {
  console.log('_store.js — presale');

  await test('not configured (missing env) throws NOT_CONFIGURED', async () => {
    mockFetch(async () => { throw new Error('should not be called'); });
    await assert.rejects(
      () => addSubscriber({}, { email: 'a@b.com' }),
      (e) => e instanceof StoreError && e.code === 'NOT_CONFIGURED'
    );
  });

  await test('network failure (endpoint unreachable) throws UNREACHABLE', async () => {
    mockFetch(async () => { throw new TypeError('fetch failed'); });
    await assert.rejects(
      () => addSubscriber(ENV, { email: 'a@b.com' }),
      (e) => e instanceof StoreError && e.code === 'UNREACHABLE'
    );
  });

  await test('non-JSON response (Apps Script crashed / returned HTML) throws BAD_RESPONSE', async () => {
    mockFetch(async () => new Response('<html>Script error</html>', { status: 200 }));
    await assert.rejects(
      () => addSubscriber(ENV, { email: 'a@b.com' }),
      (e) => e instanceof StoreError && e.code === 'BAD_RESPONSE'
    );
  });

  await test('wrong shared secret (auth failure) throws UNAUTHORIZED', async () => {
    mockFetch(async () => Response.json({ ok: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' }));
    await assert.rejects(
      () => addSubscriber(ENV, { email: 'a@b.com' }),
      (e) => e instanceof StoreError && e.code === 'UNAUTHORIZED'
    );
  });

  await test('Apps Script explicit rejection throws REJECTED with its message', async () => {
    mockFetch(async () => Response.json({ ok: false, error: 'INVALID EMAIL' }));
    await assert.rejects(
      () => addSubscriber(ENV, { email: 'bad' }),
      (e) => e instanceof StoreError && e.code === 'REJECTED' && e.message === 'INVALID EMAIL'
    );
  });

  await test('new email resolves { code: "new" }', async () => {
    let sentBody;
    mockFetch(async (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return Response.json({ ok: true, code: 'new' });
    });
    const result = await addSubscriber(ENV, { email: 'NEW@Example.com', source: 'utm', campaign: 'c', referrer: 'r', landingPage: '/x' });
    assert.equal(result.code, 'new');
    assert.equal(sentBody.secret, 'shh');
    assert.equal(sentBody.op, 'presale');
    assert.equal(sentBody.data.email, 'new@example.com'); // normalized before send
    assert.equal(sentBody.data.landing_page, '/x');
  });

  await test('duplicate email resolves { code: "already" }', async () => {
    mockFetch(async () => Response.json({ ok: true, code: 'already' }));
    const result = await addSubscriber(ENV, { email: 'dup@example.com' });
    assert.equal(result.code, 'already');
  });

  console.log('_store.js — artists');

  await test('artist ref only returned after ok:true from Apps Script', async () => {
    let sentBody;
    mockFetch(async (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return Response.json({ ok: true, ref: sentBody.data.ref });
    });
    const result = await addSubmission(ENV, { name: 'Test', email: 'a@b.com', city: 'Philly', role: 'DJ', link1: 'x' });
    assert.match(result.ref, /^DSC-[A-Z0-9]{5}$/);
    assert.equal(sentBody.op, 'artist');
    assert.equal(sentBody.data.ref, result.ref);
  });

  await test('artist submission failure throws, no ref surfaced', async () => {
    mockFetch(async () => Response.json({ ok: false, error: 'SERVER BUSY, TRY AGAIN' }));
    await assert.rejects(
      () => addSubmission(ENV, { name: 'Test', email: 'a@b.com', city: 'Philly', role: 'DJ', link1: 'x' }),
      (e) => e instanceof StoreError && e.message === 'SERVER BUSY, TRY AGAIN'
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
