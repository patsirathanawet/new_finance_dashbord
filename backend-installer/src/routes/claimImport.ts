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

const csopImportSchema = z.object({
  ackNo: z.string().min(1),
  docType: z.string().optional().default('OPD_BILL'),
  hospitalCode: z.string().optional().default(''),
  batchRef: z.string().optional().default(''),
  station: z.string().optional().default(''),
  ackAt: z.string().optional().default(''),
  totalSubmitted: z.number().int().nonnegative(),
  totalPassed: z.number().int().nonnegative(),
  totalFailed: z.number().int().nonnegative(),
  detailRows: z.array(z.record(z.string(), z.unknown())).default([]),
});

type CsopImportPayload = z.infer<typeof csopImportSchema>;

const aipnImportSchema = z.object({
  ackNo: z.string().min(1),
  docType: z.string().optional().default('IPD_BILL'),
  hospitalCode: z.string().optional().default(''),
  batchNo: z.string().optional().default(''),
  batchRef: z.string().optional().default(''),
  ackAt: z.string().optional().default(''),
  totalSubmitted: z.number().int().nonnegative(),
  totalPassed: z.number().int().nonnegative(),
  totalFailed: z.number().int().nonnegative(),
  detailRows: z.array(z.record(z.string(), z.unknown())).default([]),
});

type AipnImportPayload = z.infer<typeof aipnImportSchema>;

/** ใบแจ้งยอดเงินที่เบิกได้ (STM) ของ AIPN — จาก SIGNSTMM/SIGNSTMS.xml */
const aipnStmBillSchema = z.object({
  hmain: z.string().optional().default(''),
  billHcode: z.string().optional().default(''),
  hproc: z.string().optional().default(''),
  hn: z.string().optional().default(''),
  an: z.string().min(1),
  pid: z.string().optional().default(''),
  patientName: z.string().optional().default(''),
  dateAdm: z.string().nullable().optional(),
  dateDisch: z.string().nullable().optional(),
  ft: z.string().optional().default(''),
  bf: z.string().optional().default(''),
  drg: z.string().optional().default(''),
  rw: z.number().nullable().optional(),
  adjrw: z.number().nullable().optional(),
  due: z.string().optional().default(''),
  ptype: z.string().optional().default(''),
  rwtype: z.string().optional().default(''),
  rptype: z.string().optional().default(''),
  rid: z.string().optional().default(''),
  pstm: z.string().optional().default(''),
  careas: z.string().optional().default(''),
  sc: z.string().optional().default(''),
  ed: z.string().optional().default(''),
  reimb: z.number().optional().default(0),
  nreimb: z.number().optional().default(0),
  copay: z.number().optional().default(0),
  cp: z.string().optional().default(''),
  pp: z.string().optional().default(''),
  ods: z.string().nullable().optional(),
  spcmsg: z.string().nullable().optional(),
});

const aipnStmStatementSchema = z.object({
  stmNo: z.string().min(1),
  stmType: z.enum(['M', 'S']),
  period: z.string().optional().default(''),
  periodDesc: z.string().optional().default(''),
  dateDue: z.string().optional().default(''),
  cases: z.number().optional().default(0),
  totalAdjrw: z.number().optional().default(0),
  bills: z.array(aipnStmBillSchema).default([]),
});

const aipnStmImportSchema = z.object({
  hospitalCode: z.string().optional().default(''),
  statements: z.array(aipnStmStatementSchema).min(1),
});

type AipnStmImportPayload = z.infer<typeof aipnStmImportSchema>;

/* ---------- Helpers ---------- */

/** คอลัมน์ที่เก็บ JSON ในตาราง detail ต่างๆ — ต้อง JSON.stringify ก่อน insert */
const JSON_COLUMNS = new Set(['drug_detail', 'bill_items_detail', 'sub_detail']);

function sqlValueMaybeJson(col: string, v: unknown): string {
  return sqlValue(JSON_COLUMNS.has(col) && v !== null && v !== undefined ? JSON.stringify(v) : v);
}

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
      .map((row) => `(${SSOP_REP_DETAIL_COLUMNS.map((c) => sqlValueMaybeJson(c, row[c])).join(', ')})`)
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

/** ตรวจสอบว่า ack_no มีอยู่ใน csop_rep_head ของ target DB หรือไม่ */
async function csopAckNoExists(pool: CachedPool, ackNo: string): Promise<boolean> {
  const escaped = ackNo.replace(/'/g, "''");
  const sql = `SELECT 1 FROM csop_rep_head WHERE ack_no = '${escaped}' LIMIT 1`;
  const r = await runQuery(pool, sql);
  return r.rows.length > 0;
}

const CSOP_DETAIL_COLUMNS = [
  'ack_no', 'line_no', 'status', 'station', 'auth_code', 'dt_tran', 'inv_no', 'bill_no',
  'hn', 'member_no', 'claim_amt', 'check_codes', 'bill_items_detail', 'drug_detail',
] as const;

/** Bulk insert csop_rep_head_detail — แบ่งเป็น chunk เพื่อกัน SQL ยาวเกิน */
async function insertCsopDetails(
  pool: CachedPool,
  rows: Record<string, unknown>[],
  chunkSize = 100,
): Promise<number> {
  if (rows.length === 0) return 0;

  const cols = CSOP_DETAIL_COLUMNS.join(', ');
  let inserted = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = chunk
      .map((row) => `(${CSOP_DETAIL_COLUMNS.map((c) => sqlValueMaybeJson(c, row[c])).join(', ')})`)
      .join(', ');
    const sql = `INSERT INTO csop_rep_head_detail (${cols}) VALUES ${values}`;
    await runQuery(pool, sql);
    inserted += chunk.length;
  }
  return inserted;
}

async function insertCsopHead(pool: CachedPool, p: CsopImportPayload): Promise<void> {
  const cols = [
    'ack_no', 'doc_type', 'hospital_code', 'batch_ref', 'station', 'ack_at',
    'total_submitted', 'total_passed', 'total_failed',
  ];
  const vals = [
    sqlValue(p.ackNo),
    sqlValue(p.docType || 'OPD_BILL'),
    sqlValue(p.hospitalCode || null),
    sqlValue(p.batchRef || null),
    sqlValue(p.station || null),
    sqlValue(p.ackAt || null),
    sqlValue(p.totalSubmitted),
    sqlValue(p.totalPassed),
    sqlValue(p.totalFailed),
  ];
  const sql = `INSERT INTO csop_rep_head (${cols.join(', ')}) VALUES (${vals.join(', ')})`;
  await runQuery(pool, sql);
}

/** ตรวจสอบว่า ack_no มีอยู่ใน aipn_rep_head ของ target DB หรือไม่ */
async function aipnAckNoExists(pool: CachedPool, ackNo: string): Promise<boolean> {
  const escaped = ackNo.replace(/'/g, "''");
  const sql = `SELECT 1 FROM aipn_rep_head WHERE ack_no = '${escaped}' LIMIT 1`;
  const r = await runQuery(pool, sql);
  return r.rows.length > 0;
}

const AIPN_DETAIL_COLUMNS = [
  'ack_no', 'line_no', 'status', 'pcode', 'iptype', 'care_as', 'ss', 'hmain', 'hcare',
  'an', 'drg', 'rw', 'adjrw', 'service_type', 'service_subtype', 'pt', 'amount',
  'patient_name', 'check_codes', 'sub_detail',
] as const;

/** Bulk insert aipn_rep_head_detail — แบ่งเป็น chunk เพื่อกัน SQL ยาวเกิน */
async function insertAipnDetails(
  pool: CachedPool,
  rows: Record<string, unknown>[],
  chunkSize = 100,
): Promise<number> {
  if (rows.length === 0) return 0;

  const cols = AIPN_DETAIL_COLUMNS.join(', ');
  let inserted = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = chunk
      .map((row) => `(${AIPN_DETAIL_COLUMNS.map((c) => sqlValueMaybeJson(c, row[c])).join(', ')})`)
      .join(', ');
    const sql = `INSERT INTO aipn_rep_head_detail (${cols}) VALUES ${values}`;
    await runQuery(pool, sql);
    inserted += chunk.length;
  }
  return inserted;
}

async function insertAipnHead(pool: CachedPool, p: AipnImportPayload): Promise<void> {
  const cols = [
    'ack_no', 'doc_type', 'hospital_code', 'batch_no', 'batch_ref', 'ack_at',
    'total_submitted', 'total_passed', 'total_failed',
  ];
  const vals = [
    sqlValue(p.ackNo),
    sqlValue(p.docType || 'IPD_BILL'),
    sqlValue(p.hospitalCode || null),
    sqlValue(p.batchNo || null),
    sqlValue(p.batchRef || null),
    sqlValue(p.ackAt || null),
    sqlValue(p.totalSubmitted),
    sqlValue(p.totalPassed),
    sqlValue(p.totalFailed),
  ];
  const sql = `INSERT INTO aipn_rep_head (${cols.join(', ')}) VALUES (${vals.join(', ')})`;
  await runQuery(pool, sql);
}

const AIPN_STM_COLUMNS = [
  'stm_no', 'stm_type', 'hospital_code', 'period', 'period_desc', 'date_due',
  'hmain', 'bill_hcode', 'hproc', 'hn', 'an', 'pid', 'patient_name',
  'date_adm', 'date_disch', 'ft', 'bf', 'drg', 'rw', 'adjrw', 'due', 'ptype',
  'rwtype', 'rptype', 'rid', 'pstm', 'careas', 'sc', 'ed',
  'reimb', 'nreimb', 'copay', 'cp', 'pp', 'ods', 'spcmsg',
] as const;

interface AipnStmRow {
  stm_no: string; stm_type: string; hospital_code: string | null; period: string; period_desc: string; date_due: string;
  hmain: string; bill_hcode: string; hproc: string; hn: string; an: string; pid: string; patient_name: string;
  date_adm: string | null; date_disch: string | null; ft: string; bf: string; drg: string;
  rw: number | null; adjrw: number | null; due: string; ptype: string; rwtype: string; rptype: string;
  rid: string; pstm: string; careas: string; sc: string; ed: string;
  reimb: number; nreimb: number; copay: number; cp: string; pp: string; ods: string | null; spcmsg: string | null;
}

/** แปลง payload (statements[].bills[]) → แถวเดียวต่อ Bill — denormalize ฟิลด์หัวใบแจ้งยอดเงินลงทุกแถว */
function flattenAipnStmRows(p: AipnStmImportPayload): AipnStmRow[] {
  const rows: AipnStmRow[] = [];
  for (const stmt of p.statements) {
    for (const b of stmt.bills) {
      rows.push({
        stm_no: stmt.stmNo, stm_type: stmt.stmType, hospital_code: p.hospitalCode || null,
        period: stmt.period, period_desc: stmt.periodDesc, date_due: stmt.dateDue,
        hmain: b.hmain, bill_hcode: b.billHcode, hproc: b.hproc, hn: b.hn, an: b.an, pid: b.pid,
        patient_name: b.patientName, date_adm: b.dateAdm ?? null, date_disch: b.dateDisch ?? null,
        ft: b.ft, bf: b.bf, drg: b.drg, rw: b.rw ?? null, adjrw: b.adjrw ?? null, due: b.due,
        ptype: b.ptype, rwtype: b.rwtype, rptype: b.rptype, rid: b.rid, pstm: b.pstm, careas: b.careas,
        sc: b.sc, ed: b.ed, reimb: b.reimb, nreimb: b.nreimb, copay: b.copay, cp: b.cp, pp: b.pp,
        ods: b.ods ?? null, spcmsg: b.spcmsg ?? null,
      });
    }
  }
  return rows;
}

/** เพิ่มเฉพาะแถวที่ยังไม่มีในตาราง (เช็คคู่ stm_no+an) — รหัสที่มีอยู่แล้ว → ข้าม ไม่แก้ทับ */
async function insertAipnStmRows(pool: CachedPool, rows: AipnStmRow[]): Promise<{ inserted: number; skipped: number }> {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };

  // คัดรหัสซ้ำกันเองในชุดเดียวกัน (เก็บรายการล่าสุดของแต่ละคู่ stm_no+an)
  const byKey = new Map<string, AipnStmRow>();
  for (const r of rows) byKey.set(`${r.stm_no} ${r.an}`, r);
  const dedupedRows = [...byKey.values()];

  const existing = new Set<string>();
  const checkChunkSize = 300;
  for (let i = 0; i < dedupedRows.length; i += checkChunkSize) {
    const chunk = dedupedRows.slice(i, i + checkChunkSize);
    const conditions = chunk.map((r) => `(stm_no = ${sqlValue(r.stm_no)} AND an = ${sqlValue(r.an)})`).join(' OR ');
    const result = await runQuery(pool, `SELECT stm_no, an FROM aipn_stm WHERE ${conditions}`);
    for (const row of result.rows) existing.add(`${String(row.stm_no)} ${String(row.an)}`);
  }

  const newRows = dedupedRows.filter((r) => !existing.has(`${r.stm_no} ${r.an}`));
  const cols = AIPN_STM_COLUMNS.join(', ');
  const insertChunkSize = 100;
  for (let i = 0; i < newRows.length; i += insertChunkSize) {
    const chunk = newRows.slice(i, i + insertChunkSize);
    const values = chunk
      .map((row) => `(${AIPN_STM_COLUMNS.map((c) => sqlValue((row as unknown as Record<string, unknown>)[c])).join(', ')})`)
      .join(', ');
    await runQuery(pool, `INSERT INTO aipn_stm (${cols}) VALUES ${values}`);
  }

  return { inserted: newRows.length, skipped: dedupedRows.length - newRows.length };
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

  /** POST /api/claim-db/csop-import
   *   1. ตรวจ ack_no ใน csop_rep_head → ถ้ามีอยู่แล้ว return alreadyImported: true
   *   2. INSERT csop_rep_head + bulk INSERT csop_rep_head_detail
   */
  app.post('/claim-db/csop-import', async (request, reply) => {
    const auth = request.auth!;
    const parsed = csopImportSchema.safeParse(request.body);
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
      const exists = await csopAckNoExists(pool, payload.ackNo);
      if (exists) {
        return reply.code(200).send({
          alreadyImported: true,
          ackNo: payload.ackNo,
          message: `เลขที่ตอบรับ ${payload.ackNo} มีการนำเข้าแล้ว`,
        });
      }

      await insertCsopHead(pool, payload);
      const inserted = await insertCsopDetails(pool, payload.detailRows);

      audit(request, {
        action: 'claim-db.csop-import',
        targetType: 'csop_rep_head',
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

  /** POST /api/claim-db/aipn-import
   *   1. ตรวจ ack_no ใน aipn_rep_head → ถ้ามีอยู่แล้ว return alreadyImported: true
   *   2. INSERT aipn_rep_head + bulk INSERT aipn_rep_head_detail
   */
  app.post('/claim-db/aipn-import', async (request, reply) => {
    const auth = request.auth!;
    const parsed = aipnImportSchema.safeParse(request.body);
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
      const exists = await aipnAckNoExists(pool, payload.ackNo);
      if (exists) {
        return reply.code(200).send({
          alreadyImported: true,
          ackNo: payload.ackNo,
          message: `เลขที่ตอบรับ ${payload.ackNo} มีการนำเข้าแล้ว`,
        });
      }

      await insertAipnHead(pool, payload);
      const inserted = await insertAipnDetails(pool, payload.detailRows);

      audit(request, {
        action: 'claim-db.aipn-import',
        targetType: 'aipn_rep_head',
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

  /** POST /api/claim-db/aipn-stm-import — เพิ่มเฉพาะ (stm_no, an) ที่ยังไม่มีในตาราง aipn_stm */
  app.post('/claim-db/aipn-stm-import', async (request, reply) => {
    const auth = request.auth!;
    const parsed = aipnStmImportSchema.safeParse(request.body);
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
      const rows = flattenAipnStmRows(payload);
      const { inserted, skipped } = await insertAipnStmRows(pool, rows);

      audit(request, {
        action: 'claim-db.aipn-stm-import',
        targetType: 'aipn_stm',
        targetId: payload.statements.map((s) => s.stmNo).join(','),
        metadata: { totalBills: rows.length, inserted, skipped },
      });

      return { ok: true, inserted, skipped, totalBills: rows.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: 'ImportFailed', message: msg });
    } finally {
      await closePool(pool);
    }
  });
}
