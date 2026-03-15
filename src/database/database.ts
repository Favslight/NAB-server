import { Pool, PoolClient, QueryResult } from 'pg';
import { config } from '../config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    if (!config.database.url) {
      throw new Error('DATABASE_URL configuration missing');
    }
    
    pool = new Pool({
      connectionString: config.database.url,
      ssl: config.env === 'production' ? { rejectUnauthorized: false } : false,
    });
  }
  
  return pool;
}

// Get a client from the pool
export async function getClient(): Promise<PoolClient> {
  return getPool().connect();
}

// Raw SQL query helper
export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const pool = getPool();
  const { rows } = await pool.query(sql, params);
  return rows;
}

// Helper for single row queries
export async function queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
  const results = await query<T>(sql, params);
  return results[0] || null;
}

// Transaction helper
export async function transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// For compatibility with existing code
export const getDb = getPool;
