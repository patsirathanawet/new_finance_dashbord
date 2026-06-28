/**
 * HOSxP connection pool manager — Per-hospital
 *  - Lazy init: สร้าง pool ตอนใช้ครั้งแรก
 *  - Cache by hospitalId
 *  - Invalidate เมื่อ config update
 */
import pg from 'pg';
import mysql from 'mysql2/promise';
import { prisma } from '../db.js';
import { decrypt } from './encryption.js';

const { Pool: PgPool } = pg;
type PgPoolType = InstanceType<typeof PgPool>;
type MySqlPool = mysql.Pool;

export type DbType = 'mysql' | 'postgresql';

export interface ConnectionConfig {
  dbType: DbType;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

interface CachedPool {
  type: DbType;
  pool: PgPoolType | MySqlPool;
}

const pools = new Map<string, CachedPool>();  // key = hospitalId

/** สร้าง pool ใหม่ตาม config (ไม่ cache — ใช้สำหรับ test connection) */
export function createPool(cfg: ConnectionConfig): CachedPool {
  if (cfg.dbType === 'postgresql') {
    const pool = new PgPool({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.username,
      password: cfg.password,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // ใส่ ssl: false เผื่อ HOSxP บางตัวไม่มี SSL
      ssl: false,
    });
    return { type: 'postgresql', pool };
  }
  // mysql
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.username,
    password: cfg.password,
    connectionLimit: 5,
    connectTimeout: 5_000,
  });
  return { type: 'mysql', pool };
}

/** ปิด pool + ลบ resources */
export async function closePool(cached: CachedPool): Promise<void> {
  try {
    if (cached.type === 'postgresql') {
      await (cached.pool as PgPoolType).end();
    } else {
      await (cached.pool as MySqlPool).end();
    }
  } catch {
    /* ignore */
  }
}

/** Query ผ่าน cached pool — return rows + count */
export async function runQuery(cached: CachedPool, sql: string): Promise<QueryResult> {
  if (cached.type === 'postgresql') {
    const res = await (cached.pool as PgPoolType).query(sql);
    return {
      rows: res.rows as Record<string, unknown>[],
      rowCount: res.rowCount ?? res.rows.length,
    };
  }
  // mysql
  const [rows] = await (cached.pool as MySqlPool).query(sql);
  const arr = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  return { rows: arr, rowCount: arr.length };
}

/** ทดสอบ connection — สร้าง pool ชั่วคราว → SELECT 1 → ปิด */
export async function testConnection(cfg: ConnectionConfig): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  const start = Date.now();
  let cached: CachedPool | null = null;
  try {
    cached = createPool(cfg);
    await runQuery(cached, 'SELECT 1 AS ok');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (cached) await closePool(cached);
  }
}

/** Get หรือสร้าง pool ของ hospital — โหลด config จาก DB + decrypt */
export async function getHospitalPool(hospitalId: string): Promise<CachedPool> {
  const existing = pools.get(hospitalId);
  if (existing) return existing;

  const cfg = await prisma.hospitalDbConfig.findFirst({
    where: { hospitalId, deletedAt: null },
  });
  if (!cfg) {
    throw new Error('CONFIG_NOT_FOUND');
  }

  const connCfg: ConnectionConfig = {
    dbType: cfg.dbType,
    host: cfg.host,
    port: cfg.port,
    database: cfg.databaseName,
    username: cfg.username,
    password: decrypt(cfg.passwordEncrypted),
  };

  const pool = createPool(connCfg);
  pools.set(hospitalId, pool);
  return pool;
}

/** Invalidate (ตอน config update) — ปิด pool เดิม + ลบ cache */
export async function invalidateHospitalPool(hospitalId: string): Promise<void> {
  const existing = pools.get(hospitalId);
  if (existing) {
    pools.delete(hospitalId);
    await closePool(existing);
  }
}

/** Probe tables — ตรวจว่าตารางใน list มีอยู่ใน DB หรือไม่ */
export async function probeTables(
  cached: CachedPool,
  tableNames: string[],
): Promise<Record<string, boolean>> {
  if (tableNames.length === 0) return {};
  const tableList = tableNames.map((t) => `'${t.replace(/'/g, "''")}'`).join(',');
  const sql = `SELECT table_name FROM information_schema.tables WHERE LOWER(table_name) IN (${tableList})`;
  const result = await runQuery(cached, sql);
  const existing = new Set(
    result.rows.map((r) => String(r.table_name ?? '').toLowerCase()),
  );
  const out: Record<string, boolean> = {};
  for (const t of tableNames) out[t] = existing.has(t.toLowerCase());
  return out;
}

/** Graceful shutdown — ปิดทุก pool */
export async function closeAllPools(): Promise<void> {
  for (const [id, cached] of pools) {
    pools.delete(id);
    await closePool(cached);
  }
}
