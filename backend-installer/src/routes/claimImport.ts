import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { decrypt } from '../services/encryption.js';
import { createPool, closePool, runQuery, type DbType } from '../services/hosxpPool.js';
import type { Pool as PgPool } from 'pg';
import type { Pool as MySqlPool } from 'mysql2/promise';

type CachedPool = { type: DbType; pool: PgPool | MySqlPool };

/* ---------- Schemas ---------- */

const repImportSchema = z.object({
  repNo: z.string().min(1),
  hospitalCode: z.string().optional().default(''),
  invoiceDoc: z.string().optional().default(''),
  issuedAt: z.string().optional().default(''),
  totalSubmitted: z.number().int().nonnegative(),
  totalPassed: z.number().int().nonnegative(),
  totalFailed: z.number().int().nonnegative(),
  passedAmount: z.number().nonnegative(),
  failedAmount: z.number().nonnegative(),
  totalAmount: z.number().nonnegative(),
  detailRows: z.array(z.record(z.string(), z.unknown())).default([]),
});

type RepImportPayload = z.infer<typeof repImportSchema>;

const ssopRepImportSchema = z.object({
  ackNo: z.string().min(1),
  docType: z.string().optional().default('OPD_BILL'),
  hospitalCode: z.string().optional().default(''),
  mainHospitalCode: z.string().optional().default(''),
  mainHospitalName: z.string().optional().default(''),
  batchRef: z.string().optional().default(''),
  station: z.string().optional().default(''),
  ackAt: z.string().optional().default(''),
  totalSubmitted: z.number().int().nonnegative(),
  totalPassed: z.number().int().nonnegative(),
  totalFailed: z.number().int().nonnegative(),
  detailRows: z.array(z.record(z.string(), z.unknown())).default([]),
});

type SsopRepImportPayload = z.infer<typeof ssopRepImportSchema>;

/* ---------- Helpers ---------- */

async function openClaimPool(hospitalId: string): Promise<CachedPool> {
  const cfg = await prisma.claimDbConfig.findFirst({
    where: { hospitalId, deletedAt: null },
  });
  if (!cfg) throw new Error('ยังไม่ได้ตั้งค่า claim DB');
  let password: string;
  try {
    password = decrypt(cfg.passwordEncrypted);
  } catch {
    throw new Error('decrypt password ไม่สำเร็จ');
  }
  return createPool({
    dbType: cfg.dbType,
    host: cfg.host,
    port: cfg.port,
    database: cfg.databaseName,
    username: cfg.username,
    password,
  });
}

/** Check rep_no มีอยู่ใน rep_head ของ target DB หรือไม่ */
async function repNoExists(pool: CachedPool, repNo: string): Promise<boolean> {
  const sql = pool.type === 'postgresql'
    ? `SELECT 1 FROM rep_head WHERE rep_no = $1 LIMIT 1`
    : `SELECT 1 FROM rep_head WHERE rep_no = ? LIMIT 1`;

  // runQuery รับ raw SQL (ไม่มี parameterized) → ใช้ inline escape ป้องกัน SQLi
  const escaped = repNo.replace(/'/g, "''");
  const safeSql = pool.type === 'postgresql'
    ? `SELECT 1 FROM rep_head WHERE rep_no = '${escaped}' LIMIT 1`
    : `SELECT 1 FROM rep_head WHERE rep_no = '${escaped}' LIMIT 1`;
  const r = await runQuery(pool, safeSql);
  void sql;   // silence warning ของ unused branch
  return r.rows.length > 0;
}

/** SQL escape helper สำหรับ values ใน INSERT (รองรับ string, number, null) */
function sqlValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    return Number.isFinite(v) ? String(v) : 'NULL';
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  // string
  const s = String(v).replace(/'/g, "''");
  return `'${s}'`;
}

const REP_DETAIL_COLUMNS = [
  'rep_no', 'seq_no', 'tran_id', 'hn', 'an', 'pid', 'patient_name', 'patient_type',
  'admit_date', 'discharge_date', 'comp_amount', 'comp_pp', 'error_code', 'fund',
  'service_type', 'referral', 'eligibility', 'right_use', 'right_primary', 'right_secondary',
  'href', 'hcode', 'prov1', 'agency_code', 'agency_name', 'proj', 'pa', 'drg', 'rw',
  'charge_amount', 'charge_pp', 'claimable', 'non_claimable', 'self_pay', 'pay_rate',
  'late_ps', 'late_ps_pct', 'ccuf', 'adj_rw', 'prb',
  'case_ipcs', 'case_ipcs_ors', 'case_opcs', 'case_pacs', 'case_instcs', 'case_otcs',
  'case_pp', 'case_drug', 'deny_ipcs', 'deny_opcs', 'deny_pacs', 'deny_instcs', 'deny_otcs',
  'ors', 'va', 'audit_results', 'seq_no_full', 'invoice_no', 'invoice_lt',
] as const;

/** Bulk insert rep_detail — แบ่งเป็น chunk เพื่อกัน SQL ยาวเกิน */
async function insertRepDetails(
  pool: CachedPool,
  rows: Record<string, unknown>[],
  chunkSize = 100,
): Promise<number> {
  if (rows.length === 0) return 0;

  const cols = REP_DETAIL_COLUMNS.join(', ');
  let inserted = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = chunk
      .map((row) => `(${REP_DETAIL_COLUMNS.map((c) => sqlValue(row[c])).join(', ')})`)
      .join(', ');
    const sql = `INSERT INTO rep_detail (${cols}) VALUES ${values}`;
    await runQuery(pool, sql);
    inserted += chunk.length;
  }
  return inserted;
}

async function insertRepHead(pool: CachedPool, p: RepImportPayload): Promise<void> {
  const cols = [
    'rep_no', 'hospital_code', 'invoice_doc', 'issued_at',
    'total_submitted', 'total_passed', 'total_failed',
    'passed_amount', 'failed_amount', 'total_amount',
  ];
  const vals = [
    sqlValue(p.repNo),
    sqlValue(p.hospitalCode || null),
    sqlValue(p.invoiceDoc || null),
    sqlValue(p.issuedAt || null),
    sqlValue(p.totalSubmitted),
    sqlValue(p.totalPassed),
    sqlValue(p.totalFailed),
    sqlValue(p.passedAmount),
    sqlValue(p.failedAmount),
    sqlValue(p.totalAmount),
  ];
  const sql = `INSERT INTO rep_head (${cols.join(', ')}) VALUES (${vals.join(', ')})`;
  await runQuery(pool, sql);
}

/** ตรวจสอบว่า ack_no มีอยู่ใน ssop_rep_head ของ target DB หรือไม่ */
async function ssopAckNoExists(pool: CachedPool, ackNo: string): Promise<boolean> {
  const escaped = ackNo.replace(/'/g, "''");
  const sql = `SELECT 1 FROM ssop_rep_head WHERE ack_no = '${escaped}' LIMIT 1`;
  const r = await runQuery(pool, sql);
  return r.rows.length > 0;
}

const SSOP_REP_DETAIL_COLUMNS = [
  'ack_no', 'line_no', 'status', 'station', 'hcode', 'hmain', 'auth_code', 'dt_tran',
  'inv_no', 'pid', 'bp', 'amount', 'claim_amt', 'check_codes', 'drug_detail',
] as const;

/** Bulk insert ssop_rep_detail — แบ่งเป็น chunk เพื่อกัน SQL ยาวเกิน */
async function insertSsopRepDetails(
  pool: CachedPool,
  rows: Record<string, unknown>[],
  chunkSize = 100,
): Promise<number> {
  if (rows.length === 0) return 0;

  const cols = SSOP_REP_DETAIL_COLUMNS.join(', ');
  let inserted = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = chunk
      .map((row) => `(${SSOP_REP_DETAIL_COLUMNS.map((c) => sqlValue(
        c === 'drug_detail' && row[c] !== null && row[c] !== undefined ? JSON.stringify(row[c]) : row[c]
      )).join(', ')})`)
      .join(', ');
    const sql = `INSERT INTO ssop_rep_detail (${cols}) VALUES ${values}`;
    await runQuery(pool, sql);
    inserted += chunk.length;
  }
  return inserted;
}

async function insertSsopRepHead(pool: CachedPool, p: SsopRepImportPayload): Promise<void> {
  const cols = [
    'ack_no', 'doc_type', 'hospital_code', 'main_hospital_code', 'main_hospital_name',
    'batch_ref', 'station', 'ack_at', 'total_submitted', 'total_passed', 'total_failed',
  ];
  const vals = [
    sqlValue(p.ackNo),
    sqlValue(p.docType || 'OPD_BILL'),
    sqlValue(p.hospitalCode || null),
    sqlValue(p.mainHospitalCode || null),
    sqlValue(p.mainHospitalName || null),
    sqlValue(p.batchRef || null),
    sqlValue(p.station || null),
    sqlValue(p.ackAt || null),
    sqlValue(p.totalSubmitted),
    sqlValue(p.totalPassed),
    sqlValue(p.totalFailed),
  ];
  const sql = `INSERT INTO ssop_rep_head (${cols.join(', ')}) VALUES (${vals.join(', ')})`;
  await runQuery(pool, sql);
}

/* ---------- Routes ---------- */

export async function claimImportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** POST /api/claim-db/rep-import
   *   1. ตรวจ rep_no ใน rep_head → ถ้ามีอยู่แล้ว return alreadyImported: true
   *   2. INSERT rep_head + bulk INSERT rep_detail
   */
  app.post('/claim-db/rep-import', async (request, reply) => {
    const auth = request.auth!;
    const parsed = repImportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
    }
    const payload = parsed.data;

    let pool: CachedPool;
    try {
      pool = await openClaimPool(auth.hospitalId);
    } catch (err) {
      return reply.code(412).send({
        error: 'ClaimDbNotConfigured',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      // Dedup check
      const exists = await repNoExists(pool, payload.repNo);
      if (exists) {
        return reply.code(200).send({
          alreadyImported: true,
          repNo: payload.repNo,
          message: `งวดที่ ${payload.repNo} มีการนำเข้าแล้ว`,
        });
      }

      // Insert head + bulk detail
      await insertRepHead(pool, payload);
      const inserted = await insertRepDetails(pool, payload.detailRows);

      audit(request, {
        action: 'claim-db.rep-import',
        targetType: 'rep_head',
        targetId: payload.repNo,
        metadata: {
          totalSubmitted: payload.totalSubmitted,
          totalPassed: payload.totalPassed,
          detailRows: inserted,
        },
      });

      return {
        alreadyImported: false,
        repNo: payload.repNo,
        headInserted: 1,
        detailInserted: inserted,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: 'ImportFailed', message: msg });
    } finally {
      await closePool(pool);
    }
  });

  /** POST /api/claim-db/ssop-rep-import
   *   1. ตรวจ ack_no ใน ssop_rep_head → ถ้ามีอยู่แล้ว return alreadyImported: true
   *   2. INSERT ssop_rep_head + bulk INSERT ssop_rep_detail
   */
  app.post('/claim-db/ssop-rep-import', async (request, reply) => {
    const auth = request.auth!;
    const parsed = ssopRepImportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
    }
    const payload = parsed.data;

    let pool: CachedPool;
    try {
      pool = await openClaimPool(auth.hospitalId);
    } catch (err) {
      return reply.code(412).send({
        error: 'ClaimDbNotConfigured',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const exists = await ssopAckNoExists(pool, payload.ackNo);
      if (exists) {
        return reply.code(200).send({
          alreadyImported: true,
          ackNo: payload.ackNo,
          message: `เลขที่ตอบรับ ${payload.ackNo} มีการนำเข้าแล้ว`,
        });
      }

      await insertSsopRepHead(pool, payload);
      const inserted = await insertSsopRepDetails(pool, payload.detailRows);

      audit(request, {
        action: 'claim-db.ssop-rep-import',
        targetType: 'ssop_rep_head',
        targetId: payload.ackNo,
        metadata: {
          totalSubmitted: payload.totalSubmitted,
          totalPassed: payload.totalPassed,
          detailRows: inserted,
        },
      });

      return {
        alreadyImported: false,
        ackNo: payload.ackNo,
        headInserted: 1,
        detailInserted: inserted,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: 'ImportFailed', message: msg });
    } finally {
      await closePool(pool);
    }
  });
}
