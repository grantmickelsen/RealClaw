import pg from 'pg';

const { Pool } = pg;

// Singleton connection pool — shared across the process
let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL env var is required');
    }
    _pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    _pool.on('error', (err) => {
      console.error('[DB] Pool error:', err.message);
    });
  }
  return _pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  const pool = getPool();
  try {
    return await pool.query<T>(sql, params);
  } catch (err) {
    console.error('[DB] Query error:', (err as Error).message, '\nSQL:', sql.slice(0, 200));
    throw err;
  }
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
