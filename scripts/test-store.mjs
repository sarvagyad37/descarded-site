/* Unit tests for functions/api/_store.js — the Google-side failure paths
   and generated-field shapes that are awkward to exercise through a full
   wrangler+HTTP round trip. Mocks globalThis.fetch directly. Zero
   dependencies, plain Node assertions. */

import assert from 'node:assert/strict';
import { addSubscriber, addSubmission, generateLeadId, generateReferralCode, generateArtistRef, StoreError } from '../functions/api/_store.js';

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
  console.log('_store.js — generated IDs');

  await test('lead_id matches DSC-L-XXXXXXXX (10 hex chars)', () => {
    const id = generateLeadId();
    assert.match(id, /^DSC-L-[A-F0-9]{10}$/);
  });

  await test('lead_id has no realistic collisions across many calls', () => {
    const ids = new Set();
    for (let i = 0; i < 5000; i++) ids.add(generateLeadId());
    assert.equal(ids.size, 5000);
  });

  await test('referral_code is a short alphanumeric code', () => {
    const code = generateReferralCode();
    assert.match(code, /^[A-F0-9]{6}$/);
  });

  await test('artist ref matches DSC-XXXXX (existing format preserved)', () => {
    const ref = generateArtistRef();
    assert.match(ref, /^DSC-[A-F0-9]{5}$/);
  });

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

  await test('incorrect spreadsheet schema throws REJECTED with the schema error', async () => {
    mockFetch(async () => Response.json({ ok: false, error: 'INVALID SHEET SCHEMA on "Presale": missing column(s): lead_id' }));
    await assert.rejects(
      () => addSubscriber(ENV, { email: 'a@b.com' }),
      (e) => e instanceof StoreError && e.code === 'REJECTED' && /INVALID SHEET SCHEMA/.test(e.message)
    );
  });

  await test('new email sends full field set with generated lead_id/referral_code/status', async () => {
    let sentBody;
    mockFetch(async (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return Response.json({ ok: true, code: 'new' });
    });
    const result = await addSubscriber(ENV, {
      email: 'NEW@Example.com', firstName: 'Ada', lastName: 'Lovelace', phone: '+12155551234',
      smsConsent: true, referredBy: 'ABC123', source: 'instagram', campaign: 'edition01',
      medium: 'organic-social', term: '', content: 'reel03',
      ipAddress: '203.0.113.5', userAgent: 'TestUA/1.0'
    });
    assert.equal(result.code, 'new');
    assert.equal(sentBody.op, 'presale');
    assert.equal(sentBody.data.email, 'new@example.com'); // normalized before send
    assert.match(sentBody.data.lead_id, /^DSC-L-[A-F0-9]{10}$/);
    assert.match(sentBody.data.referral_code, /^[A-F0-9]{6}$/);
    assert.equal(sentBody.data.status, 'active');
    assert.equal(sentBody.data.email_consent, true);
    assert.equal(sentBody.data.sms_consent, true);
    assert.equal(sentBody.data.first_name, 'Ada');
    assert.equal(sentBody.data.last_name, 'Lovelace');
    assert.equal(sentBody.data.phone, '+12155551234');
    assert.equal(sentBody.data.referred_by, 'ABC123');
    assert.equal(sentBody.data.source, 'instagram');
    assert.equal(sentBody.data.medium, 'organic-social');
    assert.equal(sentBody.data.content, 'reel03');
    assert.equal(sentBody.data.ip_address, '203.0.113.5');
    assert.equal(sentBody.data.user_agent, 'TestUA/1.0');
    assert.equal(sentBody.data.notes, '');
    assert.equal('created_at' in sentBody.data, false); // Code.gs stamps this itself
  });

  await test('sms_consent defaults false when not provided', async () => {
    let sentBody;
    mockFetch(async (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return Response.json({ ok: true, code: 'new' });
    });
    await addSubscriber(ENV, { email: 'nosms@example.com' });
    assert.equal(sentBody.data.sms_consent, false);
    assert.equal(sentBody.data.email_consent, true); // always true on a successful submit
  });

  await test('duplicate email resolves { code: "already" }', async () => {
    mockFetch(async () => Response.json({ ok: true, code: 'already' }));
    const result = await addSubscriber(ENV, { email: 'dup@example.com' });
    assert.equal(result.code, 'already');
  });

  console.log('_store.js — artists');

  await test('artist submission sends final schema fields with generated ref/status', async () => {
    let sentBody;
    mockFetch(async (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return Response.json({ ok: true, ref: sentBody.data.ref });
    });
    const result = await addSubmission(ENV, {
      artistName: 'Test Artist', genre: 'hyperpop', email: 'a@b.com', phone: '+12155551234',
      portfolioUrl: 'soundcloud.com/test', socialMediaUrl: 'instagram.com/test'
    });
    assert.match(result.ref, /^DSC-[A-F0-9]{5}$/);
    assert.equal(sentBody.op, 'artist');
    assert.equal(sentBody.data.ref, result.ref);
    assert.equal(sentBody.data.artist_name, 'Test Artist');
    assert.equal(sentBody.data.genre, 'hyperpop');
    assert.equal(sentBody.data.status, 'new');
    assert.equal(sentBody.data.notes, '');
    assert.equal('city' in sentBody.data, false); // dropped field, not part of final schema
    assert.equal('role' in sentBody.data, false);
  });

  await test('artist submission failure throws, no ref surfaced', async () => {
    mockFetch(async () => Response.json({ ok: false, error: 'SERVER BUSY, TRY AGAIN' }));
    await assert.rejects(
      () => addSubmission(ENV, { artistName: 'Test', email: 'a@b.com', genre: 'house', portfolioUrl: 'x.com' }),
      (e) => e instanceof StoreError && e.message === 'SERVER BUSY, TRY AGAIN'
    );
  });

  await test('artist submission uses op "artist", never "presale"', async () => {
    let sentOp;
    mockFetch(async (url, opts) => {
      sentOp = JSON.parse(opts.body).op;
      return Response.json({ ok: true, ref: 'DSC-ABCDE' });
    });
    await addSubmission(ENV, { artistName: 'Test', email: 'a@b.com', genre: 'house', portfolioUrl: 'x.com' });
    assert.equal(sentOp, 'artist');
    assert.notEqual(sentOp, 'presale');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
