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
