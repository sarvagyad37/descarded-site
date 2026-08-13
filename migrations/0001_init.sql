-- Presale and Artists tables. D1 is the source of truth; Google Sheets is
-- an operational mirror synced in the background (see functions/api/_store.js
-- and the google_synced* columns below).
--
-- Field lists mirror the production Sheets headers 1:1 (see README.md ->
-- "Google Sheets persistence") so the D1 row and its mirrored Sheet row stay
-- easy to compare by eye. created_at is stamped by application code at the
-- moment of insert, same as Code.gs previously stamped it at append time.

CREATE TABLE presale (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at          TEXT NOT NULL,
  lead_id             TEXT NOT NULL,
  phone               TEXT NOT NULL DEFAULT '',
  referral_code       TEXT NOT NULL,
  email_consent       INTEGER NOT NULL DEFAULT 1,
  sms_consent         INTEGER NOT NULL DEFAULT 0,
  referred_by         TEXT NOT NULL DEFAULT '',
  first_name          TEXT NOT NULL DEFAULT '',
  last_name           TEXT NOT NULL DEFAULT '',
  email               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',
  source              TEXT NOT NULL DEFAULT '',
  campaign            TEXT NOT NULL DEFAULT '',
  medium              TEXT NOT NULL DEFAULT '',
  term                TEXT NOT NULL DEFAULT '',
  content             TEXT NOT NULL DEFAULT '',
  ip_address          TEXT NOT NULL DEFAULT '',
  user_agent          TEXT NOT NULL DEFAULT '',
  notes               TEXT NOT NULL DEFAULT '',
  -- Operational sync fields (D1 -> Google Sheets mirror)
  google_synced       INTEGER NOT NULL DEFAULT 0,
  google_synced_at    TEXT,
  google_sync_error   TEXT
);

-- email is stored pre-normalized (trimmed, lowercased) by the write path,
-- so this unique index is what makes concurrent duplicate submissions for
-- the same address safe without any application-level lock: two
-- simultaneous INSERTs race at the SQLite/D1 layer, one wins, the other
-- throws a UNIQUE constraint error that the write path turns into
-- { code: "already" }.
CREATE UNIQUE INDEX idx_presale_email ON presale (email);
CREATE UNIQUE INDEX idx_presale_lead_id ON presale (lead_id);
-- referral_code is NOT unique-constrained: generation is 6 random hex
-- chars with no collision check today (see _store.js), so a uniqueness
-- constraint here would just turn a pre-existing (very unlikely) collision
-- into a hard insert failure instead of preserving current behavior.
CREATE INDEX idx_presale_referral_code ON presale (referral_code);
CREATE INDEX idx_presale_created_at ON presale (created_at);
CREATE INDEX idx_presale_status ON presale (status);
CREATE INDEX idx_presale_source_campaign ON presale (source, campaign);
CREATE INDEX idx_presale_google_synced ON presale (google_synced);

CREATE TABLE artists (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at          TEXT NOT NULL,
  ref                 TEXT NOT NULL,
  artist_name         TEXT NOT NULL,
  creator_type        TEXT NOT NULL,
  genre               TEXT NOT NULL DEFAULT '',
  email               TEXT NOT NULL,
  phone               TEXT NOT NULL DEFAULT '',
  portfolio_url       TEXT NOT NULL DEFAULT '',
  social_media_url    TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'new',
  notes               TEXT NOT NULL DEFAULT '',
  -- Operational sync fields (D1 -> Google Sheets mirror)
  google_synced       INTEGER NOT NULL DEFAULT 0,
  google_synced_at    TEXT,
  google_sync_error   TEXT
);

-- ref is the stable identifier for both D1 and the Google Sheet mirror
-- (Code.gs now dedupes artist rows by ref too, so a retried background
-- sync for the same D1 row can't create a second sheet row).
CREATE UNIQUE INDEX idx_artists_ref ON artists (ref);
CREATE INDEX idx_artists_email ON artists (email);
CREATE INDEX idx_artists_created_at ON artists (created_at);
CREATE INDEX idx_artists_status ON artists (status);
CREATE INDEX idx_artists_creator_type ON artists (creator_type);
CREATE INDEX idx_artists_google_synced ON artists (google_synced);
