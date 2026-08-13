/* Unit tests for functions/api/_db.js — D1 write paths, duplicate handling
   via UNIQUE constraint errors, and sync-status bookkeeping. Mocks a
   minimal D1 binding (env.DB.prepare().bind().run()) directly; no real D1
   instance needed. Zero dependencies, plain Node assertions. */

import assert from 'node:assert/strict';
import { insertPresale, insertArtist, markGoogleSynced, markGoogleSyncError, DbError } from '../functions/api/_db.js';

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

/* A fake D1 binding. `impl(query, bindings)` decides what happens per call;
   throw a real Error with a D1-shaped message to simulate a constraint
   violation, e.g. new Error('D1_ERROR: UNIQUE constraint failed: presale.email'). */
function fakeDb(impl) {
  return {
    prepare(query) {
      return {
        bind(...bindings) {
          return {
            async run() {
              return impl(query, bindings);
            }
          };
        }
      };
    }
  };
}

const PRESALE_ENTRY = {
  lead_id: 'DSC-L-0000000000', phone: '', referral_code: 'ABCDEF',
  email_consent: true, sms_consent: false, referred_by: '', first_name: 'Ada',
  last_name: '', email: 'ada@example.com', status: 'active', source: '', campaign: '',
  medium: '', term: '', content: '', ip_address: '', user_agent: '', notes: ''
};

const ARTIST_ENTRY = {
  artist_name: 'Test', creator_type: 'OTHER', genre: '', email: 'a@b.com',
  phone: '', portfolio_url: 'x.com', social_media_url: '', status: 'new', notes: ''
};

async function run() {
  console.log('_db.js — presale');

  await test('missing DB binding throws NOT_CONFIGURED', async () => {
    await assert.rejects(
      () => insertPresale({}, PRESALE_ENTRY),
      (e) => e instanceof DbError && e.code === 'NOT_CONFIGURED'
    );
  });

  await test('successful insert returns { code: "new" }', async () => {
    let ranQuery;
    const env = { DB: fakeDb((q) => { ranQuery = q; return { success: true }; }) };
    const result = await insertPresale(env, PRESALE_ENTRY);
    assert.equal(result.code, 'new');
    assert.match(ranQuery, /INSERT INTO presale/);
  });

  await test('UNIQUE constraint on email resolves { code: "already" }, no throw', async () => {
    const env = { DB: fakeDb(() => { throw new Error('D1_ERROR: UNIQUE constraint failed: presale.email'); }) };
    const result = await insertPresale(env, PRESALE_ENTRY);
    assert.equal(result.code, 'already');
  });

  await test('other D1 failure throws DbError with code D1_UNAVAILABLE', async () => {
    const env = { DB: fakeDb(() => { throw new Error('D1_ERROR: table presale has no column named foo'); }) };
    await assert.rejects(
      () => insertPresale(env, PRESALE_ENTRY),
      (e) => e instanceof DbError && e.code === 'D1_UNAVAILABLE'
    );
  });

  console.log('_db.js — artists');

  await test('successful insert returns generated ref', async () => {
    const env = { DB: fakeDb(() => ({ success: true })) };
    const result = await insertArtist(env, ARTIST_ENTRY, () => 'DSC-AAAAA');
    assert.equal(result.ref, 'DSC-AAAAA');
  });

  await test('UNIQUE constraint on ref regenerates and retries, then succeeds', async () => {
    let calls = 0;
    const env = {
      DB: fakeDb(() => {
        calls++;
        if (calls === 1) throw new Error('D1_ERROR: UNIQUE constraint failed: artists.ref');
        return { success: true };
      })
    };
    const refs = ['DSC-AAAAA', 'DSC-BBBBB'];
    const result = await insertArtist(env, ARTIST_ENTRY, () => refs.shift());
    assert.equal(result.ref, 'DSC-BBBBB');
    assert.equal(calls, 2);
  });

  await test('exhausting retries on repeated ref collision throws D1_UNAVAILABLE', async () => {
    const env = { DB: fakeDb(() => { throw new Error('D1_ERROR: UNIQUE constraint failed: artists.ref'); }) };
    await assert.rejects(
      () => insertArtist(env, ARTIST_ENTRY, () => 'DSC-AAAAA'),
      (e) => e instanceof DbError && e.code === 'D1_UNAVAILABLE'
    );
  });

  await test('non-constraint D1 failure throws D1_UNAVAILABLE immediately (no retry)', async () => {
    let calls = 0;
    const env = { DB: fakeDb(() => { calls++; throw new Error('D1_ERROR: disk I/O error'); }) };
    await assert.rejects(
      () => insertArtist(env, ARTIST_ENTRY, () => 'DSC-AAAAA'),
      (e) => e instanceof DbError && e.code === 'D1_UNAVAILABLE'
    );
    assert.equal(calls, 1);
  });

  console.log('_db.js — sync bookkeeping');

  await test('markGoogleSynced sends an UPDATE with the sync timestamp', async () => {
    let ranQuery, ranBindings;
    const env = { DB: fakeDb((q, b) => { ranQuery = q; ranBindings = b; return { success: true }; }) };
    await markGoogleSynced(env, 'presale', 'lead_id', 'DSC-L-0000000000');
    assert.match(ranQuery, /UPDATE presale SET google_synced = 1/);
    assert.equal(ranBindings[1], 'DSC-L-0000000000');
  });

  await test('markGoogleSyncError sends an UPDATE with the error message, does not throw', async () => {
    let ranQuery, ranBindings;
    const env = { DB: fakeDb((q, b) => { ranQuery = q; ranBindings = b; return { success: true }; }) };
    await markGoogleSyncError(env, 'artists', 'ref', 'DSC-AAAAA', 'UNREACHABLE');
    assert.match(ranQuery, /UPDATE artists SET google_sync_error/);
    assert.equal(ranBindings[0], 'UNREACHABLE');
    assert.equal(ranBindings[1], 'DSC-AAAAA');
  });

  await test('markGoogleSynced/markGoogleSyncError swallow D1 errors (never throw)', async () => {
    const env = { DB: fakeDb(() => { throw new Error('boom'); }) };
    await markGoogleSynced(env, 'presale', 'lead_id', 'x'); // should not throw
    await markGoogleSyncError(env, 'presale', 'lead_id', 'x', 'boom'); // should not throw
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
