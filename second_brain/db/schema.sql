PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- One row per saved item, from any source. Source-specific details live in raw_metadata.
CREATE TABLE IF NOT EXISTS items (
    id                INTEGER PRIMARY KEY,
    source            TEXT NOT NULL,
    source_id         TEXT NOT NULL,
    url               TEXT NOT NULL,
    author            TEXT,
    caption           TEXT,
    saved_at          TEXT,
    media_type        TEXT NOT NULL DEFAULT 'unknown',
    duration_seconds  REAL,
    video_path        TEXT,
    video_deleted     INTEGER NOT NULL DEFAULT 0,
    raw_metadata      TEXT,
    discovered_at     TEXT NOT NULL,

    download_status   TEXT NOT NULL DEFAULT 'pending',
    download_error    TEXT,
    download_at       TEXT,
    transcribe_status TEXT NOT NULL DEFAULT 'pending',
    transcribe_error  TEXT,
    transcribe_at     TEXT,
    frames_status     TEXT NOT NULL DEFAULT 'pending',
    frames_error      TEXT,
    frames_at         TEXT,
    analyze_status    TEXT NOT NULL DEFAULT 'pending',
    analyze_error     TEXT,
    analyze_at        TEXT,
    embed_status      TEXT NOT NULL DEFAULT 'pending',
    embed_error       TEXT,
    embed_at          TEXT,

    UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS items_download_idx ON items (download_status);
CREATE INDEX IF NOT EXISTS items_analyze_idx ON items (analyze_status);

CREATE TABLE IF NOT EXISTS transcripts (
    item_id              INTEGER PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
    text                 TEXT NOT NULL,
    language             TEXT,
    language_probability REAL,
    model                TEXT,
    segments             TEXT,
    created_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS frames (
    id                INTEGER PRIMARY KEY,
    item_id           INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    position          INTEGER NOT NULL,
    path              TEXT NOT NULL,
    timestamp_seconds REAL,
    UNIQUE (item_id, position)
);

CREATE TABLE IF NOT EXISTS analyses (
    item_id          INTEGER PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    summary          TEXT NOT NULL,
    key_points       TEXT NOT NULL,
    category         TEXT NOT NULL,
    tags             TEXT NOT NULL,
    language         TEXT,
    actionable       INTEGER NOT NULL DEFAULT 0,
    model            TEXT,
    taxonomy_version TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_usage (
    id            INTEGER PRIMARY KEY,
    stage         TEXT NOT NULL,
    item_id       INTEGER,
    model         TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5 (
    content,
    item_id UNINDEXED
);
