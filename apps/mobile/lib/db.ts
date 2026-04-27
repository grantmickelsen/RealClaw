import * as SQLite from 'expo-sqlite';

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('realclaw.db', { journalMode: 'wal' });
  await runMigrations(_db);
  return _db;
}

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      correlation_id  TEXT NOT NULL,
      role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      text            TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'done',
      agent_id        TEXT,
      has_approval    INTEGER NOT NULL DEFAULT 0,
      approval_id     TEXT,
      timestamp       TEXT NOT NULL,
      synced          INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_correlation ON messages(correlation_id);

    CREATE TABLE IF NOT EXISTS offline_queue (
      id              TEXT PRIMARY KEY,
      correlation_id  TEXT NOT NULL UNIQUE,
      text            TEXT NOT NULL,
      platform        TEXT NOT NULL DEFAULT 'mobile',
      created_at      TEXT NOT NULL,
      retry_count     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_offline_queue_created ON offline_queue(created_at ASC);

    CREATE TABLE IF NOT EXISTS pending_contacts (
      id          TEXT PRIMARY KEY,
      payload     TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pending_contacts_created ON pending_contacts(created_at ASC);

    CREATE TABLE IF NOT EXISTS open_house_guests (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      phone               TEXT,
      working_with_agent  INTEGER NOT NULL DEFAULT 0,
      brain_dump_text     TEXT,
      created_at          INTEGER NOT NULL,
      synced              INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_guests_created ON open_house_guests(created_at DESC);

    CREATE TABLE IF NOT EXISTS cached_properties (
      id         TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      cached_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_tour_notes (
      id                        TEXT PRIMARY KEY,
      showing_day_property_id   TEXT NOT NULL,
      transcript                TEXT NOT NULL,
      created_at                INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pending_tour_notes_created ON pending_tour_notes(created_at ASC);
  `);
}

// ─── Message persistence helpers ───

export interface StoredMessage {
  id: string;
  correlation_id: string;
  role: 'user' | 'assistant';
  text: string;
  status: string;
  agent_id: string | null;
  has_approval: number;
  approval_id: string | null;
  timestamp: string;
  synced: number;
}

export async function saveMessage(msg: StoredMessage): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO messages
     (id, correlation_id, role, text, status, agent_id, has_approval, approval_id, timestamp, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [msg.id, msg.correlation_id, msg.role, msg.text, msg.status,
     msg.agent_id, msg.has_approval, msg.approval_id, msg.timestamp, msg.synced],
  );
}

export async function loadRecentMessages(limit = 50): Promise<StoredMessage[]> {
  const db = await getDb();
  return db.getAllAsync<StoredMessage>(
    `SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?`,
    [limit],
  );
}

export async function updateMessageText(correlationId: string, text: string, status: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE messages SET text = ?, status = ?, synced = 1 WHERE correlation_id = ?`,
    [text, status, correlationId],
  );
}

// ─── Offline queue helpers ───

export interface QueuedMessage {
  id: string;
  correlation_id: string;
  text: string;
  platform: string;
  created_at: string;
  retry_count: number;
}

export async function enqueueMessage(msg: QueuedMessage): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO offline_queue (id, correlation_id, text, platform, created_at, retry_count)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [msg.id, msg.correlation_id, msg.text, msg.platform, msg.created_at, msg.retry_count],
  );
}

export async function dequeueMessages(): Promise<QueuedMessage[]> {
  const db = await getDb();
  return db.getAllAsync<QueuedMessage>(
    `SELECT * FROM offline_queue ORDER BY created_at ASC LIMIT 20`,
  );
}

export async function removeFromQueue(correlationId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM offline_queue WHERE correlation_id = ?`, [correlationId]);
}

export async function incrementRetry(correlationId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE offline_queue SET retry_count = retry_count + 1 WHERE correlation_id = ?`,
    [correlationId],
  );
}

// ─── Pending contacts (offline queue) ───

export interface PendingContact {
  id: string;
  payload: string;   // JSON-stringified contact fields
  created_at: string;
}

export async function savePendingContact(contact: PendingContact): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO pending_contacts (id, payload, created_at) VALUES (?, ?, ?)`,
    [contact.id, contact.payload, contact.created_at],
  );
}

export async function loadPendingContacts(): Promise<PendingContact[]> {
  const db = await getDb();
  return db.getAllAsync<PendingContact>(
    `SELECT * FROM pending_contacts ORDER BY created_at ASC`,
  );
}

export async function removePendingContact(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM pending_contacts WHERE id = ?`, [id]);
}

// ─── Open house guest helpers ───

export interface StoredGuest {
  id: string;
  name: string;
  phone: string | null;
  working_with_agent: number;
  brain_dump_text: string | null;
  created_at: number;
  synced: number;
}

export async function saveGuest(guest: StoredGuest): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO open_house_guests
     (id, name, phone, working_with_agent, brain_dump_text, created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [guest.id, guest.name, guest.phone, guest.working_with_agent,
     guest.brain_dump_text, guest.created_at, guest.synced],
  );
}

export async function loadTodayGuests(): Promise<StoredGuest[]> {
  const db = await getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return db.getAllAsync<StoredGuest>(
    `SELECT * FROM open_house_guests WHERE created_at >= ? ORDER BY created_at DESC`,
    [startOfDay.getTime()],
  );
}

export async function markGuestSynced(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE open_house_guests SET synced = 1 WHERE id = ?`, [id]);
}

export async function loadUnsyncedGuests(): Promise<StoredGuest[]> {
  const db = await getDb();
  return db.getAllAsync<StoredGuest>(
    `SELECT * FROM open_house_guests WHERE synced = 0 ORDER BY created_at ASC`,
  );
}

// ─── Cached properties ───────────────────────────────────────────────────────

export async function cacheProperty(id: string, data: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO cached_properties (id, data, cached_at) VALUES (?, ?, ?)`,
    [id, data, Date.now()],
  );
}

export async function getCachedProperty(id: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ data: string; cached_at: number }>(
    `SELECT data, cached_at FROM cached_properties WHERE id = ?`,
    [id],
  );
  return row?.data ?? null;
}

// ─── Pending tour notes ──────────────────────────────────────────────────────

export interface PendingTourNote {
  id: string;
  showing_day_property_id: string;
  transcript: string;
  created_at: number;
}

export async function savePendingTourNote(note: PendingTourNote): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO pending_tour_notes
     (id, showing_day_property_id, transcript, created_at) VALUES (?, ?, ?, ?)`,
    [note.id, note.showing_day_property_id, note.transcript, note.created_at],
  );
}

export async function loadPendingTourNotes(): Promise<PendingTourNote[]> {
  const db = await getDb();
  return db.getAllAsync<PendingTourNote>(
    `SELECT * FROM pending_tour_notes ORDER BY created_at ASC`,
  );
}

export async function removePendingTourNote(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM pending_tour_notes WHERE id = ?`, [id]);
}
