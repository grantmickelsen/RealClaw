/**
 * Database migration runner.
 *
 * Run with:  npm run migrate
 *
 * Reads all *.sql files in src/db/migrations/ in lexicographic order.
 * Each migration is applied in a transaction and recorded in schema_migrations.
 * Already-applied migrations are skipped.
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL env var is required');
  }

  const client = new Client({ connectionString });
  await client.connect();

  console.log('[migrate] Connected to database');

  try {
    // Ensure the tracking table exists (idempotent bootstrap)
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_id  VARCHAR(255) PRIMARY KEY,
        applied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Read all .sql files sorted lexicographically
    const files = (await fs.readdir(MIGRATIONS_DIR))
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const migrationId = file.replace('.sql', '');

      // Check if already applied
      const { rows } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE migration_id = $1',
        [migrationId],
      );
      if (rows.length > 0) {
        console.log(`[migrate] Skip  ${migrationId} (already applied)`);
        continue;
      }

      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (migration_id) VALUES ($1)',
          [migrationId],
        );
        await client.query('COMMIT');
        console.log(`[migrate] Apply ${migrationId}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migrationId} failed: ${(err as Error).message}`);
      }
    }

    console.log('[migrate] Done');
  } finally {
    await client.end();
  }
}

run().catch(err => {
  console.error('[migrate] Fatal:', err.message);
  process.exit(1);
});
