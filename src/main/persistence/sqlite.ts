import { DatabaseSync } from 'node:sqlite'

export function openSqliteDatabase(filename: string): DatabaseSync {
  const database = new DatabaseSync(filename)
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA journal_mode = WAL')
  initializeSchema(database)
  return database
}

function initializeSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS transcripts (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      title TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      language TEXT,
      target_language TEXT,
      plain_text TEXT NOT NULL,
      translated_plain_text TEXT,
      metadata_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transcript_blocks (
      id TEXT PRIMARY KEY,
      transcript_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      source TEXT NOT NULL,
      speaker_label TEXT,
      text TEXT NOT NULL,
      translated_text TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      words_json TEXT,
      FOREIGN KEY(transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_transcripts_mode_started_at
      ON transcripts(mode, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transcripts_created_at
      ON transcripts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transcript_blocks_transcript_seq
      ON transcript_blocks(transcript_id, seq);

    CREATE TABLE IF NOT EXISTS transcript_notes (
      transcript_id TEXT PRIMARY KEY,
      transcript_hash TEXT NOT NULL,
      language TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      notes_json TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_transcript_notes_updated_at
      ON transcript_notes(updated_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS transcript_search
      USING fts5(
        id UNINDEXED,
        title,
        plain_text,
        translated_plain_text,
        block_text
      );
  `)
}
