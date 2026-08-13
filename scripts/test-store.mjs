/* Unit tests for functions/api/_store.js — the Google-side background sync
   paths (syncPresaleToGoogle / syncArtistToGoogle). These run AFTER a D1
   write already succeeded, so they must never throw — failures are caught
   internally and recorded onto the D1 row via _db.js's mark* functions
   (mocked here with a fake D1 binding). Mocks globalThis.fetch directly.
   Zero dependencies, plain Node assertions. */

import assert from 'node:assert/strict';
import {
  syncPresaleToGoogle, syncArtistToGoogle,
  generateLeadId, generateReferralCode, generateArtistRef
} from '../functions/api/_store.js';

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
    console.log(`         ${e.stack || e.message}`);
  }
}

function mockFetch(impl) {
  globalThis.fetch = impl;
}

/* Fake D1 binding that just records every UPDATE it receives, keyed by the
   bound key value (bindings[1] for both mark* helpers — see _db.js). */
function fakeDb() {
  const updates = [];
  return {
    updates,
    DB: {
      prepare(query) {
        return {
          bind(...bindings) {
            return {
              async run() {
                updates.push({ query, bindings });
                return { success: true };
              }
            };
          }
        };
      }
    }
  };
}

const BASE_ENV = { GOOGLE_APPS_SCRIPT_URL: 'https://example.invalid/exec', GOOGLE_APPS_SCRIPT_SECRET: 'shh' };

async function run() {
  console.log('_store.js — generated IDs');

  await test('lead_id matches DSC-L-XXXXXXXX (10 hex chars)', () => {
    assert.match(generateLeadId(), /^DSC-L-[A-F0-9]{10}$/);
  });

  await test('referral_code is a short alphanumeric code', () => {
    assert.match(generateReferralCode(), /^[A-F0-9]{6}$/);
  });

  await test('artist ref matches DSC-XXXXX (existing format preserved)', () => {
    assert.match(generateArtistRef(), /^DSC-[A-F0-9]{5}$/);
  });

  console.log('_store.js — syncPresaleToGoogle');

  const PRESALE_ROW = {
    lead_id: 'DSC-L-0000000001', phone: '+12155551234', referral_code: 'ABCDEF',
    sms_consent: true, referred_by: 'ABC123', first_name: 'Ada', last_name: 'Lovelace',
    email: 'ada@example.com', status: 'active', source: 'instagram', campaign: 'edition01',
    medium: 'organic-social', term: '', content: 'reel03', ip_address: '203.0.113.5',
    user_agent: 'TestUA/1.0', notes: ''
  };

  await test('success sends full field set and marks google_synced (never throws)', async () => {
    let sentBody;
    mockFetch(async (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return Response.json({ ok: true, code: 'new' });
    });
    const { DB, updates } = fakeDb();
    await syncPresaleToGoogle({ ...BASE_ENV, DB }, PRESALE_ROW);

    assert.equal(sentBody.op, 'presale');
    assert.equal(sentBody.data.lead_id, PRESALE_ROW.lead_id);
    assert.equal(sentBody.data.email, 'ada@example.com');
    assert.equal(sentBody.data.email_consent, true);
    assert.equal(sentBody.data.sms_consent, true);
    assert.equal('created_at' in sentBody.data, false); // Code.gs stamps this itself

    assert.equal(updates.length, 1);
    assert.match(updates[0].query, /UPDATE presale SET google_synced = 1/);
    assert.equal(updates[0].bindings[1], PRESALE_ROW.lead_id);
  });

  await test('not configured (missing secrets) records google_sync_error, does not throw', async () => {
    mockFetch(async () => { throw new Error('should not be called'); });
    const { DB, updates } = fakeDb();
    await syncPresaleToGoogle({ DB }, PRESALE_ROW);
    assert.equal(updates.length, 1);
    assert.match(updates[0].query, /UPDATE presale SET google_sync_error/);
  });

  await test('network failure (Google unreachable) records google_sync_error, does not throw', async () => {
    mockFetch(async () => { throw new TypeError('fetch failed'); });
    const { DB, updates } = fakeDb();
    await syncPresaleToGoogle({ ...BASE_ENV, DB }, PRESALE_ROW);
    assert.equal(updates.length, 1);
    assert.match(updates[0].query, /google_sync_error/);
  });

  await test('Apps Script rejection (e.g. schema mismatch) records the error text', async () => {
    mockFetch(async () => Response.json({ ok: false, error: 'INVALID SHEET SCHEMA on "Presale": missing column(s): lead_id' }));
    const { DB, updates } = fakeDb();
    await syncPresaleToGoogle({ ...BASE_ENV, DB }, PRESALE_ROW);
    assert.match(updates[0].bindings[0], /INVALID SHEET SCHEMA/);
  });

  console.log('_store.js — syncArtistToGoogle');

  const ARTIST_ROW = {
    ref: 'DSC-AAAAA', artist_name: 'Test Artist', creator_type: 'DJ / MUSIC', genre: 'hyperpop',
    email: 'a@b.com', phone: '+12155551234', portfolio_url: 'soundcloud.com/test',
    social_media_url: 'instagram.com/test', status: 'new', notes: ''
  };

  await test('success sends final schema fields and marks google_synced', async () => {
    let sentBody;
    mockFetch(async (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return Response.json({ ok: true, ref: sentBody.data.ref });
    });
    const { DB, updates } = fakeDb();
    await syncArtistToGoogle({ ...BASE_ENV, DB }, ARTIST_ROW);

    assert.equal(sentBody.op, 'artist');
    assert.equal(sentBody.data.ref, 'DSC-AAAAA');
    assert.equal(sentBody.data.creator_type, 'DJ / MUSIC');
    assert.equal('email_consent' in sentBody.data, false); // presale-only concept
    assert.equal(updates[0].bindings[1], 'DSC-AAAAA');
  });

  await test('failure after D1 success records google_sync_error, response still would be a success upstream', async () => {
    mockFetch(async () => Response.json({ ok: false, error: 'SERVER BUSY, TRY AGAIN' }));
    const { DB, updates } = fakeDb();
    await syncArtistToGoogle({ ...BASE_ENV, DB }, ARTIST_ROW); // must not throw
    assert.match(updates[0].query, /google_sync_error/);
    assert.match(updates[0].bindings[0], /SERVER BUSY/);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
