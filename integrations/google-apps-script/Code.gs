/**
 * DESCARDED — Google Apps Script persistence endpoint.
 *
 * Bind this script to the "DESCARDED — Form Submissions" spreadsheet
 * (Extensions → Apps Script from within the sheet). Deploy it as a Web
 * App. Cloudflare Pages Functions call it over a server-side, authenticated
 * fetch — the browser never talks to this script directly, and the deployed
 * URL + shared secret must only ever live in Cloudflare's environment
 * config, never in this repo or in client-side code.
 *
 * Full setup walkthrough: see "Google Sheets persistence" in the main
 * repo README. Short version:
 *
 *   1. Script Properties (Project Settings → Script Properties) → add
 *      SHARED_SECRET with a long random value. Do not hardcode it here.
 *   2. Deploy → New deployment → type "Web app" → Execute as: Me,
 *      Who has access: Anyone.
 *   3. Copy the /exec URL → Cloudflare secret GOOGLE_APPS_SCRIPT_URL.
 *      Copy the same secret value → Cloudflare secret
 *      GOOGLE_APPS_SCRIPT_SECRET.
 *   4. Optional: run setupSheets() once from the editor to pre-create both
 *      worksheets with headers. Otherwise they're created lazily on first
 *      real submission.
 *
 * Schema note: row 1 of each sheet is the source of truth for where each
 * field gets written — this script maps by HEADER NAME, not column
 * position, and refuses to write (returns ok:false) if a sheet exists but
 * is missing an expected header. That way a human reordering columns in
 * Sheets doesn't silently misalign data, and a genuinely broken schema
 * fails loudly instead of writing garbage into the wrong cells.
 */

var PRESALE_SHEET = 'Presale';
var ARTISTS_SHEET = 'Artists';

// Canonical order — used only when a sheet is created fresh by this script.
// For existing sheets, actual header positions (any order) are respected;
// see mapRowFromHeaders().
var PRESALE_HEADERS = [
  'created_at', 'lead_id', 'phone', 'referral_code', 'email_consent',
  'sms_consent', 'referred_by', 'first_name', 'last_name', 'email',
  'status', 'source', 'campaign', 'medium', 'term', 'content',
  'ip_address', 'user_agent', 'notes'
];

var ARTISTS_HEADERS = [
  'created_at', 'ref', 'artist_name', 'creator_type', 'genre', 'email', 'phone',
  'portfolio_url', 'social_media_url', 'status', 'notes'
];

function doPost(e) {
  var result;
  try {
    result = handleRequest(e);
  } catch (err) {
    result = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleRequest(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return { ok: false, error: 'NO BODY' };
  }

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return { ok: false, error: 'MALFORMED JSON' };
  }

  var expectedSecret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!expectedSecret) {
    // Fail closed: an unconfigured deployment must never silently accept writes.
    return { ok: false, error: 'SERVER NOT CONFIGURED' };
  }
  if (!body || typeof body.secret !== 'string' || body.secret !== expectedSecret) {
    return { ok: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  var data = body.data || {};
  switch (body.op) {
    case 'presale':
      return handlePresale(data);
    case 'artist':
      return handleArtist(data);
    default:
      return { ok: false, error: 'UNKNOWN OPERATION' };
  }
}

function handlePresale(data) {
  var email = normalizeEmail(data.email);
  if (!isPlausibleEmail(email)) {
    return { ok: false, error: 'INVALID EMAIL' };
  }

  var lock = LockService.getScriptLock();
  var gotLock = lock.tryLock(10000);
  if (!gotLock) {
    return { ok: false, error: 'SERVER BUSY, TRY AGAIN' };
  }
  try {
    var sheetInfo = getValidatedSheet(PRESALE_SHEET, PRESALE_HEADERS);
    if (!sheetInfo.ok) return sheetInfo;

    var emailCol = sheetInfo.headerMap.email;
    var existingRow = findRowByColumnValue(sheetInfo.sheet, emailCol, email);
    if (existingRow) {
      return { ok: true, code: 'already' };
    }

    var row = mapRowFromHeaders(sheetInfo.headers, Object.assign({}, data, { email: email }));
    sheetInfo.sheet.appendRow(row);
    return { ok: true, code: 'new' };
  } finally {
    lock.releaseLock();
  }
}

function handleArtist(data) {
  var ref = String(data.ref || '').trim();
  var email = normalizeEmail(data.email);
  if (!ref) return { ok: false, error: 'MISSING REF' };
  if (!isPlausibleEmail(email)) return { ok: false, error: 'INVALID EMAIL' };

  var lock = LockService.getScriptLock();
  var gotLock = lock.tryLock(10000);
  if (!gotLock) {
    return { ok: false, error: 'SERVER BUSY, TRY AGAIN' };
  }
  try {
    var sheetInfo = getValidatedSheet(ARTISTS_SHEET, ARTISTS_HEADERS);
    if (!sheetInfo.ok) return sheetInfo;

    // ref is the stable identifier for a given D1 row's mirror write — a
    // retried background sync (D1 write succeeded, an earlier sync attempt
    // failed or timed out) must not create a second row for the same ref.
    var refCol = sheetInfo.headerMap.ref;
    var existingRow = findRowByColumnValue(sheetInfo.sheet, refCol, ref.toLowerCase());
    if (existingRow) {
      return { ok: true, ref: ref };
    }

    var row = mapRowFromHeaders(sheetInfo.headers, Object.assign({}, data, { email: email, ref: ref }));
    sheetInfo.sheet.appendRow(row);
    return { ok: true, ref: ref };
  } finally {
    lock.releaseLock();
  }
}

/** Opens (or creates) a sheet and validates its row-1 headers contain every
 *  entry in expectedHeaders (order-independent). Returns either
 *  { ok: true, sheet, headers, headerMap } or { ok: false, error }. Never
 *  writes when validation fails. */
function getValidatedSheet(name, expectedHeaders) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(expectedHeaders);
  }

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h || '').trim();
  });

  if (headers.length === 1 && headers[0] === '') {
    // Sheet exists but is completely empty — treat like a fresh sheet.
    sheet.appendRow(expectedHeaders);
    headers = expectedHeaders.slice();
  }

  var headerMap = {};
  headers.forEach(function (h, i) { if (h) headerMap[h] = i + 1; }); // 1-based column

  var missing = expectedHeaders.filter(function (h) { return !(h in headerMap); });
  if (missing.length) {
    return {
      ok: false,
      error: 'INVALID SHEET SCHEMA on "' + name + '": missing column(s): ' + missing.join(', ')
    };
  }

  return { ok: true, sheet: sheet, headers: headers, headerMap: headerMap };
}

/** Builds a row array matching the sheet's ACTUAL header order (whatever it
 *  currently is), pulling each value from data[headerName]. "created_at" is
 *  always stamped fresh here, regardless of what's in data, since it must
 *  reflect actual persistence time. Unknown/extra sheet columns (headers
 *  not in our schema) are left blank rather than guessed at. */
function mapRowFromHeaders(headers, data) {
  var now = new Date().toISOString();
  return headers.map(function (header) {
    if (header === 'created_at') return now;
    if (!(header in data)) return '';
    var v = data[header];
    return v === null || v === undefined ? '' : v;
  });
}

function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase();
}

function isPlausibleEmail(v) {
  return typeof v === 'string' && v.indexOf('@') > 0 && v.indexOf('.', v.indexOf('@')) > -1 && v.length <= 254;
}

function findRowByColumnValue(sheet, columnIndex, normalizedValue) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var values = sheet.getRange(2, columnIndex, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim().toLowerCase() === normalizedValue) {
      return i + 2;
    }
  }
  return null;
}

/** Run once manually from the Apps Script editor (Run → setupSheets) to
 *  pre-create both worksheets with the correct headers. Safe to re-run —
 *  it won't touch a sheet that already has data. */
function setupSheets() {
  getValidatedSheet(PRESALE_SHEET, PRESALE_HEADERS);
  getValidatedSheet(ARTISTS_SHEET, ARTISTS_HEADERS);
}

/** Run manually from the editor to sanity-check the live spreadsheet
 *  against the schema this script expects, without submitting any data.
 *  Logs results to the Apps Script execution log (View → Logs). */
function validateSchema() {
  var presale = getValidatedSheet(PRESALE_SHEET, PRESALE_HEADERS);
  var artists = getValidatedSheet(ARTISTS_SHEET, ARTISTS_HEADERS);
  Logger.log('Presale: ' + (presale.ok ? 'OK' : presale.error));
  Logger.log('Artists: ' + (artists.ok ? 'OK' : artists.error));
}
