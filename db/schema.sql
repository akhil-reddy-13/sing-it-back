-- Sing It Back: append-only event log. Run once against the Postgres database
-- (e.g. Neon via the Vercel Marketplace):  psql "$DATABASE_URL" -f db/schema.sql
CREATE TABLE IF NOT EXISTS events (
  id           BIGSERIAL PRIMARY KEY,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id   UUID        NOT NULL,
  kind         TEXT        NOT NULL,
  seq          INTEGER     NOT NULL,
  client_time  TIMESTAMPTZ,
  app_version  TEXT,
  study_mode   TEXT,
  country      TEXT,          -- coarse, from the hosting edge (no IP addresses are stored)
  payload      JSONB       NOT NULL
);
CREATE INDEX IF NOT EXISTS events_session_idx ON events (session_id);
CREATE INDEX IF NOT EXISTS events_kind_idx ON events (kind);

-- Optional raw audio, only for participants who ticked the separate audio consent box.
CREATE TABLE IF NOT EXISTS audio (
  id           BIGSERIAL PRIMARY KEY,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id   UUID        NOT NULL,
  trial_id     TEXT        NOT NULL,
  bytes        INTEGER     NOT NULL,
  wav_b64      TEXT        NOT NULL
);
CREATE INDEX IF NOT EXISTS audio_session_idx ON audio (session_id);

-- Withdrawal requests: DELETE FROM events WHERE session_id = '<id>'; DELETE FROM audio WHERE session_id = '<id>';
