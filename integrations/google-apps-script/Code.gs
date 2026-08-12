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
 */

var PRESALE_SHEET = 'Presale';
var ARTISTS_SHEET = 'Artists';

var PRESALE_HEADERS = ['created_at', 'email', 'source', 'campaign', 'referrer', 'landing_page'];
var ARTISTS_HEADERS = ['created_at', 'ref', 'name', 'email', 'city', 'role', 'link1', 'link2', 'social', 'notes'];

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
    var sheet = getOrCreateSheet(PRESALE_SHEET, PRESALE_HEADERS);
    var existingRow = findRowByColumnValue(sheet, 2, email); // column B = email
    if (existingRow) {
      return { ok: true, code: 'already' };
    }

    sheet.appendRow([
      new Date().toISOString(),
      email,
      truncate(data.source, 200),
      truncate(data.campaign, 200),
      truncate(data.referrer, 500),
      truncate(data.landing_page, 200)
    ]);
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
    var sheet = getOrCreateSheet(ARTISTS_SHEET, ARTISTS_HEADERS);
    sheet.appendRow([
      new Date().toISOString(),
      ref,
      truncate(data.name, 200),
      email,
      truncate(data.city, 200),
      truncate(data.role, 100),
      truncate(data.link1, 500),
      truncate(data.link2, 500),
      truncate(data.social, 200),
      truncate(data.notes, 4000)
    ]);
    return { ok: true, ref: ref };
  } finally {
    lock.releaseLock();
  }
}

function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase();
}

function isPlausibleEmail(v) {
  return typeof v === 'string' && v.indexOf('@') > 0 && v.indexOf('.', v.indexOf('@')) > -1 && v.length <= 254;
}

function truncate(v, max) {
  var s = String(v == null ? '' : v);
  return s.length > max ? s.slice(0, max) : s;
}

function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  return sheet;
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
 *  pre-create both worksheets with the correct headers. Safe to re-run. */
function setupSheets() {
  getOrCreateSheet(PRESALE_SHEET, PRESALE_HEADERS);
  getOrCreateSheet(ARTISTS_SHEET, ARTISTS_HEADERS);
}
