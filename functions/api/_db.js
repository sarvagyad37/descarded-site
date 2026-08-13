/* D1 persistence — the source of truth for Presale/Artists submissions.
   Google Sheets (see _store.js) is an operational mirror written in the
   background after a row lands here; nothing in this file talks to Google.

   Duplicate handling is concurrency-safe by construction: email (presale)
   and ref (artists) are UNIQUE-indexed columns (see migrations/0001_init.sql).
   Two simultaneous INSERTs for the same email race at the D1/SQLite layer —
   one succeeds, the other throws a UNIQUE constraint error, which this
   module turns into { code: "already" } / a regenerated ref. No
   application-level lock is involved. */

export class DbError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function isUniqueConstraintError(e, column) {
  const msg = String((e && e.message) || '');
  return msg.includes('UNIQUE constraint failed') && (!column || msg.includes(column));
}

async function run(env, query, bindings) {
  if (!env.DB) {
    throw new DbError('NOT_CONFIGURED', 'D1 binding "DB" is not present.');
  }
  try {
    return await env.DB.prepare(query).bind(...bindings).run();
  } catch (e) {
    if (isUniqueConstraintError(e)) throw e; // let callers inspect for their own column
    throw new DbError('D1_UNAVAILABLE', (e && e.message) || 'D1 write failed.');
  }
}

/* entry keys match the presale table's columns 1:1. email must already be
   normalized (trimmed, lowercased) by the caller. Returns
   { code: "new" | "already" } — "already" means no row was written, the
   existing row is left untouched. */
export async function insertPresale(env, entry) {
  const createdAt = new Date().toISOString();
  try {
    await run(
      env,
      `INSERT INTO presale (
         created_at, lead_id, phone, referral_code, email_consent, sms_consent,
         referred_by, first_name, last_name, email, status, source, campaign,
         medium, term, content, ip_address, user_agent, notes
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        createdAt, entry.lead_id, entry.phone || '', entry.referral_code,
        entry.email_consent ? 1 : 0, entry.sms_consent ? 1 : 0,
        entry.referred_by || '', entry.first_name || '', entry.last_name || '',
        entry.email, entry.status || 'active', entry.source || '', entry.campaign || '',
        entry.medium || '', entry.term || '', entry.content || '',
        entry.ip_address || '', entry.user_agent || '', entry.notes || ''
      ]
    );
    return { code: 'new', leadId: entry.lead_id, createdAt };
  } catch (e) {
    if (e instanceof DbError) throw e;
    if (isUniqueConstraintError(e, 'email')) return { code: 'already' };
    throw new DbError('D1_UNAVAILABLE', (e && e.message) || 'D1 write failed.');
  }
}

/* entry keys match the artists table's columns 1:1, except `ref`, which
   this function generates and retries on the extremely unlikely event of a
   collision (5 random hex chars — see generateArtistRef in _store.js).
   Returns { ref }. */
export async function insertArtist(env, entry, generateRef) {
  const createdAt = new Date().toISOString();
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const ref = generateRef();
    try {
      await run(
        env,
        `INSERT INTO artists (
           created_at, ref, artist_name, creator_type, genre, email, phone,
           portfolio_url, social_media_url, status, notes
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          createdAt, ref, entry.artist_name, entry.creator_type, entry.genre || '',
          entry.email, entry.phone || '', entry.portfolio_url || '',
          entry.social_media_url || '', entry.status || 'new', entry.notes || ''
        ]
      );
      return { ref, createdAt };
    } catch (e) {
      if (e instanceof DbError) throw e;
      if (isUniqueConstraintError(e, 'ref')) continue; // regenerate and retry
      throw new DbError('D1_UNAVAILABLE', (e && e.message) || 'D1 write failed.');
    }
  }
  throw new DbError('D1_UNAVAILABLE', 'Could not generate a unique artist ref.');
}

/* Called from the background Google-sync path (see _store.js) — never on
   the request fast path. Failures here are logged, not thrown, since a
   sync-status update failing must not turn a successful submission into a
   visible error. */
export async function markGoogleSynced(env, table, keyColumn, keyValue) {
  const query = `UPDATE ${table} SET google_synced = 1, google_synced_at = ?, google_sync_error = NULL WHERE ${keyColumn} = ?`;
  try {
    await env.DB.prepare(query).bind(new Date().toISOString(), keyValue).run();
  } catch (e) {
    console.error(`markGoogleSynced failed for ${table}.${keyColumn}=${keyValue}:`, e && e.message);
  }
}

export async function markGoogleSyncError(env, table, keyColumn, keyValue, errorMessage) {
  const query = `UPDATE ${table} SET google_sync_error = ? WHERE ${keyColumn} = ?`;
  try {
    await env.DB.prepare(query).bind(String(errorMessage || '').slice(0, 500), keyValue).run();
  } catch (e) {
    console.error(`markGoogleSyncError failed for ${table}.${keyColumn}=${keyValue}:`, e && e.message);
  }
}
