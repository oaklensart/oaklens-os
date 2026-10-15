-- Migration 0002 — the pulse table.
--
-- A pulse is a short, immediate note the owner posts to the homepage: a glyph,
-- a line, a state. It is deliberately NOT on the git publish path that frames
-- and posts travel (console → data/*.json → commit → Workers Build). That road
-- is right for archival content and wrong for something posted several times a
-- day from a phone: it would cost a full redeploy per pulse and burn a fork's
-- free build minutes doing it. A pulse is mutable, personal, short-lived state —
-- which is the D1 tier by the storage rule in CLAUDE.md.
--
-- ONE table serves both jobs. The CURRENT pulse is the newest row whose
-- expires_at is still in the future; the LOG is every row, forever. So an
-- expired pulse needs no cleanup job and no second home — it simply stops
-- matching the current query while staying in the log. Retiring a pulse early
-- (DELETE /api/pulse) moves expires_at to now rather than deleting the row, for
-- the same reason.
--
-- THERE IS NO TITLE COLUMN, and that is the one thing to know before adding one
-- back. The card names itself PULSE on every card and every fork
-- (src/shared/pulse.js PULSE_LABEL). An earlier cut stored a free-text `kicker`
-- that defaulted to the starter pack's discipline, so the same feature
-- introduced itself as PHOTOGRAPHY on one post and TECH / DEV on the next and a
-- reader could not tell what the tile was. Renamed and dropped 2026-08-13; see
-- docs/maintenance/2026-08-13-pulse-rename-and-studio.md.
--
-- Every remaining text field is FREE TEXT on purpose. An earlier design gave the
-- footer named slots for "gear / batch / take number", which is a
-- camera-metadata field wearing a different hat — it would serve photographers
-- and quietly tell writers, musicians, filmmakers and podcasters that this
-- software is not for them. The author types whatever their discipline calls
-- for, or nothing.
CREATE TABLE IF NOT EXISTS pulses (
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL DEFAULT '',   -- the line ("Eight bar loop. Send help.")
  glyphs      TEXT NOT NULL DEFAULT '',   -- the emoji, stored SEPARATELY from text
  state       TEXT NOT NULL DEFAULT '',   -- palette key (see src/shared/pulse.js)
  foot_left   TEXT NOT NULL DEFAULT '',   -- free text, empty by default
  foot_right  TEXT NOT NULL DEFAULT '',   -- free text, empty by default
  -- The author's wall clock at the moment of posting, FROZEN as a string.
  -- Never recomputed: an earlier mock rendered the clock in the visitor's
  -- browser, so a pulse posted at 20:14 read as 03:14 to someone eight time
  -- zones away. What time it was where the author stood is a fact about the
  -- moment, not something to re-derive per reader.
  local_time  TEXT NOT NULL DEFAULT '',
  posted_at   INTEGER NOT NULL,           -- epoch ms, server-stamped
  expires_at  INTEGER NOT NULL,           -- epoch ms; posted_at + ttl
  ambient     TEXT                        -- optional JSON (weather at post time)
);

-- The current-pulse read is "newest unexpired", on every homepage request that
-- misses the 30s colo cache (src/api/pulse.js). Both columns are in the index so it never scans.
CREATE INDEX IF NOT EXISTS idx_pulses_live ON pulses(expires_at DESC, posted_at DESC);
