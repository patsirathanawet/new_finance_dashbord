/**
 * Read-only queries บน claim DB (rep_head + rep_detail) — ใช้ใน eclaim fund pages
 *  - GET /api/claim-db/summary
 *  - GET /api/claim-db/rep-batches (paginated list)
 *  - GET /api/claim-db/rep-batches/:repNo (one batch + details)
 *  - GET /api/claim-db/monthly-trend
 *
 *  ทุก endpoint รับ optional ?fundCode= สำหรับ filter
 *    CSOP → invoice_doc LIKE '%OPCS%'/'%IPCS%'/'%PACS%'/'%INSTCS%' (ข้าราชการ — ข้อมูลเดิมของ OFC ยังแยก OP/IP ไม่ได้)
 *    CIPN → ยังไม่มีแหล่งข้อมูล (ข้าราชการผู้ป่วยใน) — return ไม่มีรายการ รอเชื่อมข้อมูลอนาคต
 *    LGO  → invoice_doc LIKE '%LGO%'
 *    SSOP → '%SSS%' (ประกันสังคม — ข้อมูลเดิมของ SSS ยังแยก OP/IP ไม่ได้)
 *    AIPN → ยังไม่มีแหล่งข้อมูล (ประกันสังคมผู้ป่วยใน) — return ไม่มีรายการ รอเชื่อมข้อมูลอนาคต
 *    BKK → '%BKK%' / PVT → '%PVT%' / SRT → '%SRT%'
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { decrypt } from '../services/encryption.js';
import { createPool, closePool, runQuery, type DbType } from '../services/hosxpPool.js';
import type { Pool as PgPool } from 'pg';
import type { Pool as MySqlPool } from 'mysql2/promise';

type CachedPool = { type: DbType; pool: PgPool | MySqlPool };

async function openClaimPool(hospitalId: string): Promise<CachedPool> {
  const cfg = await prisma.claimDbConfig.findFirst({
    where: { hospitalId, deletedAt: null },
  });
  if (!cfg) throw new Error('ยังไม่ได้ตั้งค่า claim DB — เข้าหน้า "DB เอกสารตอบกลับ" เพื่อบันทึก connection');

  let password: string;
  try {
    password = decrypt(cfg.passwordEncrypted);
  } catch {
    throw new Error(
      'decrypt password ไม่สำเร็จ — JWT_SECRET เปลี่ยน (อาจเพิ่ง install ใหม่) → ' +
      'ไปที่หน้า "DB เอกสารตอบกลับ" บันทึก password อีกครั้ง',
    );
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

/** map fund code → SQL LIKE pattern สำหรับ invoice_doc */
function fundFilter(fundCode: string | undefined): string {
  if (!fundCode) return '';
  const f = fundCode.toUpperCase();
  // CSOP = CSMBS ข้าราชการ (เดิมคือ OFC, ยังแยก OP/IP ไม่ได้จาก invoice_doc); LGO = อปท.; SSOP/BKK/PVT/SRT ตามชื่อ
  if (f === 'CSOP') return `AND (invoice_doc LIKE '%OPCS%' OR invoice_doc LIKE '%IPCS%' OR invoice_doc LIKE '%PACS%' OR invoice_doc LIKE '%INSTCS%')`;
  // CIPN/AIPN: ยังไม่มีแหล่งข้อมูลผู้ป่วยในแยกต่างหาก — กัน fallthrough ไปแสดงข้อมูลกองทุนอื่นโดยไม่ตั้งใจ
  if (f === 'CIPN') return `AND 1=0`;
  if (f === 'LGO') return `AND invoice_doc LIKE '%LGO%'`;
  if (f === 'SSOP') return `AND invoice_doc LIKE '%SSS%'`;
  if (f === 'AIPN') return `AND 1=0`;
  if (f === 'BKK') return `AND invoice_doc LIKE '%BKK%'`;
  if (f === 'PVT') return `AND invoice_doc LIKE '%PVT%'`;
  if (f === 'SRT') return `AND invoice_doc LIKE '%SRT%'`;
  return '';
}

function escapeId(s: string): string {
  // อนุญาตแค่ alphanumeric + underscore + hyphen — anything else → empty
  return s.replace(/[^A-Za-z0-9_-]/g, '');
}

/** SQL expression ที่ parse admit_date "DD/MM/YYYY [HH:MM:SS]" → DATE
 *  (admit_date เก็บเป็น VARCHAR ใน rep_detail) */
function admitDateExpr(dbType: DbType, col = 'd.admit_date'): string {
  if (dbType === 'postgresql') {
    return `(CASE WHEN ${col} ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}' ` +
      `THEN TO_DATE(SUBSTRING(${col} FROM '^([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})'), 'DD/MM/YYYY') ` +
      `ELSE NULL END)`;
  }
  return `(CASE WHEN ${col} REGEXP '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}' ` +
    `THEN STR_TO_DATE(SUBSTRING_INDEX(${col}, ' ', 1), '%d/%m/%Y') ` +
    `ELSE NULL END)`;
}

/** สร้าง WHERE clause สำหรับ filter admit_date (รับ YYYY-MM-DD) — return '' ถ้าไม่มี filter */
function dateRangeClause(dbType: DbType, startDate?: string, endDate?: string, col = 'd.admit_date'): string {
  if (!startDate && !endDate) return '';
  const expr = admitDateExpr(dbType, col);
  const sQ = startDate ? `'${startDate.replace(/'/g, '')}'` : null;
  const eQ = endDate ? `'${endDate.replace(/'/g, '')}'` : null;
  if (sQ && eQ) return `AND ${expr} BETWEEN ${sQ} AND ${eQ}`;
  if (sQ) return `AND ${expr} >= ${sQ}`;
  if (eQ) return `AND ${expr} <= ${eQ}`;
  return '';
}

/* -------------------- eclaim_error helpers / schemas -------------------- */

const eclaimErrorRowSchema = z.object({
  code: z.string().min(1).max(20),
  description: z.string().nullish(),
  resolution: z.string().nullish(),
});
const eclaimErrorSeedSchema = z.object({
  rows: z.array(eclaimErrorRowSchema).min(1).max(5000),
  replace: z.boolean().default(false),   // true = DELETE ก่อน, false = upsert
});

function sqlValueOrNull(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/* ------------------------------------------------------------------------ */

export async function claimQueryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** GET /api/claim-db/summary?fundCode=&startDate=&endDate=
   *  Filter by admit_date (วันเข้ารักษา) ถ้ามี date range — aggregate จาก rep_detail
   */
  app.get<{ Querystring: { fundCode?: string; startDate?: string; endDate?: string } }>(
    '/claim-db/summary',
    async (request, reply) => {
      const auth = request.auth!;
      const { fundCode, startDate, endDate } = request.query;
      let pool: CachedPool;
      try { pool = await openClaimPool(auth.hospitalId); }
      catch (err) { return reply.code(412).send({ error: 'ClaimDbNotConfigured', message: err instanceof Error ? err.message : String(err) }); }

      try {
        const hasDateFilter = !!(startDate || endDate);
        const fundF = fundFilter(fundCode);
        const dateF = dateRangeClause(pool.type, startDate, endDate);

        let sql: string;
        if (hasDateFilter || fundF) {
          // Aggregate จาก rep_detail (JOIN rep_head สำหรับ fund filter)
          // passed = error_code ว่าง/-, failed = ตรงข้าม
          const fundFOnH = fundF.replace(/invoice_doc/g, 'h.invoice_doc');
          sql = `
            SELECT
              COUNT(DISTINCT d.rep_no) AS batches,
              COUNT(*) AS submitted,
              SUM(CASE WHEN d.error_code IS NULL OR d.error_code IN ('', '-') THEN 1 ELSE 0 END) AS passed,
              SUM(CASE WHEN d.error_code IS NOT NULL AND d.error_code NOT IN ('', '-') THEN 1 ELSE 0 END) AS failed,
              COALESCE(SUM(CASE WHEN d.error_code IS NULL OR d.error_code IN ('', '-')
                                THEN COALESCE(d.comp_amount,0)+COALESCE(d.comp_pp,0) ELSE 0 END), 0) AS passed_amount,
              COALESCE(SUM(CASE WHEN d.error_code IS NOT NULL AND d.error_code NOT IN ('', '-')
                                THEN COALESCE(d.charge_amount,0)+COALESCE(d.charge_pp,0) ELSE 0 END), 0) AS failed_amount
            FROM rep_detail d
            JOIN rep_head h ON h.rep_no = d.rep_no
            WHERE 1=1 ${fundFOnH} ${dateF}
          `;
        } else {
          sql = `
            SELECT COUNT(*) AS batches,
                   COALESCE(SUM(total_submitted), 0) AS submitted,
                   COALESCE(SUM(total_passed), 0) AS passed,
                   COALESCE(SUM(total_failed), 0) AS failed,
                   COALESCE(SUM(passed_amount), 0) AS passed_amount,
                   COALESCE(SUM(failed_amount), 0) AS failed_amount
            FROM rep_head
          `;
        }

        const r = await runQuery(pool, sql);
        const row = r.rows[0] ?? {};
        const passedAmount = Number(row.passed_amount ?? 0);
        const failedAmount = Number(row.failed_amount ?? 0);
        return {
          batches: Number(row.batches ?? 0),
          submitted: Number(row.submitted ?? 0),
          passed: Number(row.passed ?? 0),
          failed: Number(row.failed ?? 0),
          passedAmount,
          failedAmount,
          totalAmount: passedAmount + failedAmount,
        };
      } catch (err) {
        return reply.code(500).send({ error: 'QueryFailed', message: err instanceof Error ? err.message : String(err) });
      } finally {
        await closePool(pool);
      }
    },
  );

  /** GET /api/claim-db/rep-batches?fundCode=&startDate=&endDate=&limit=&offset=
   *  ถ้ามี date filter → แสดงเฉพาะ rep_no ที่มี detail row admit_date อยู่ในช่วง
   */
  app.get<{ Querystring: { fundCode?: string; startDate?: string; endDate?: string; limit?: string; offset?: string } }>(
    '/claim-db/rep-batches',
    async (request, reply) => {
      const auth = request.auth!;
      const { fundCode, startDate, endDate } = request.query;
      const limit = Math.min(Number(request.query.limit ?? 100), 500);
      const offset = Math.max(Number(request.query.offset ?? 0), 0);

      let pool: CachedPool;
      try { pool = await openClaimPool(auth.hospitalId); }
      catch (err) { return reply.code(412).send({ error: 'ClaimDbNotConfigured', message: err instanceof Error ? err.message : String(err) }); }

      try {
        const filter = fundFilter(fundCode);
        const dateF = dateRangeClause(pool.type, startDate, endDate);
        // ถ้ามี date filter → ใช้ subquery หา rep_no ที่ qualify
        const dateSubquery = dateF
          ? `AND rep_no IN (SELECT DISTINCT d.rep_no FROM rep_detail d WHERE 1=1 ${dateF})`
          : '';

        const sql = `
          SELECT rep_no, hospital_code, invoice_doc, issued_at,
                 total_submitted, total_passed, total_failed,
                 passed_amount, failed_amount, total_amount,
                 created_at
          FROM rep_head
          WHERE 1=1 ${filter} ${dateSubquery}
          ORDER BY rep_no DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
        const countSql = `SELECT COUNT(*) AS cnt FROM rep_head WHERE 1=1 ${filter} ${dateSubquery}`;
        const [list, count] = await Promise.all([runQuery(pool, sql), runQuery(pool, countSql)]);
        return {
          items: list.rows.map((r) => ({
            repNo: String(r.rep_no ?? ''),
            hospitalCode: String(r.hospital_code ?? ''),
            invoiceDoc: String(r.invoice_doc ?? ''),
            issuedAt: String(r.issued_at ?? ''),
            totalSubmitted: Number(r.total_submitted ?? 0),
            totalPassed: Number(r.total_passed ?? 0),
            totalFailed: Number(r.total_failed ?? 0),
            passedAmount: Number(r.passed_amount ?? 0),
            failedAmount: Number(r.failed_amount ?? 0),
            totalAmount: Number(r.total_amount ?? 0),
            createdAt: r.created_at ? String(r.created_at) : null,
          })),
          total: Number(count.rows[0]?.cnt ?? 0),
          limit,
          offset,
        };
      } catch (err) {
        return reply.code(500).send({ error: 'QueryFailed', message: err instanceof Error ? err.message : String(err) });
      } finally {
        await closePool(pool);
      }
    },
  );

  /** GET /api/claim-db/rep-batches/:repNo — head + details */
  app.get<{ Params: { repNo: string } }>('/claim-db/rep-batches/:repNo', async (request, reply) => {
    const auth = request.auth!;
    const repNo = escapeId(request.params.repNo);
    if (!repNo) return reply.code(400).send({ error: 'BadRequest', message: 'invalid repNo' });

    let pool: CachedPool;
    try { pool = await openClaimPool(auth.hospitalId); }
    catch (err) { return reply.code(412).send({ error: 'ClaimDbNotConfigured', message: err instanceof Error ? err.message : String(err) }); }

    try {
      const headR = await runQuery(pool, `SELECT * FROM rep_head WHERE rep_no = '${repNo}' LIMIT 1`);
      if (headR.rows.length === 0) return reply.code(404).send({ error: 'NotFound' });

      const detailR = await runQuery(
        pool,
        `SELECT * FROM rep_detail WHERE rep_no = '${repNo}' ORDER BY seq_no ASC`,
      );
      return {
        head: headR.rows[0],
        details: detailR.rows,
      };
    } catch (err) {
      return reply.code(500).send({ error: 'QueryFailed', message: err instanceof Error ? err.message : String(err) });
    } finally {
      await closePool(pool);
    }
  });

  /** ssop_rep_head.ack_at เป็น timestamp column จริง (ไม่ใช่ VARCHAR แบบ admit_date) — filter ตรงๆ ได้ */
  function ssopDateRangeClause(startDate?: string, endDate?: string, col = 'ack_at'): string {
    if (!startDate && !endDate) return '';
    const sQ = startDate ? `'${startDate.replace(/'/g, '')}'` : null;
    const eQ = endDate ? `'${endDate.replace(/'/g, '')} 23:59:59'` : null;
    if (sQ && eQ) return `AND ${col} BETWEEN ${sQ} AND ${eQ}`;
    if (sQ) return `AND ${col} >= ${sQ}`;
    if (eQ) return `AND ${col} <= ${eQ}`;
    return '';
  }

  /** GET /api/claim-db/ssop-rep-summary?startDate=&endDate=
   *  สรุปยอด ssop_rep — ต้อง JOIN ssop_rep_detail เพราะยอดเงิน (amount/claim_amt) เก็บที่ระดับ detail
   *  ไม่ใช่ head (ต่างจาก rep_head ที่ precompute passed_amount/failed_amount ไว้แล้ว)
   */
  app.get<{ Querystring: { startDate?: string; endDate?: string } }>(
    '/claim-db/ssop-rep-summary',
    async (request, reply) => {
      const auth = request.auth!;
      const { startDate, endDate } = request.query;

      let pool: CachedPool;
      try { pool = await openClaimPool(auth.hospitalId); }
      catch (err) { return reply.code(412).send({ error: 'ClaimDbNotConfigured', message: err instanceof Error ? err.message : String(err) }); }

      try {
        const dateF = ssopDateRangeClause(startDate, endDate, 'h.ack_at');
        const sql = `
          SELECT
            COUNT(DISTINCT d.ack_no) AS batches,
            COUNT(*) AS submitted,
            SUM(CASE WHEN d.status = 'passed' THEN 1 ELSE 0 END) AS passed,
            SUM(CASE WHEN d.status = 'failed' THEN 1 ELSE 0 END) AS failed,
            COALESCE(SUM(CASE WHEN d.status = 'passed' THEN COALESCE(d.claim_amt,0) ELSE 0 END), 0) AS passed_amount,
            COALESCE(SUM(CASE WHEN d.status = 'failed' THEN COALESCE(d.amount,0) ELSE 0 END), 0) AS failed_amount
          FROM ssop_rep_detail d
          JOIN ssop_rep_head h ON h.ack_no = d.ack_no
          WHERE 1=1 ${dateF}
        `;
        const r = await runQuery(pool, sql);
        const row = r.rows[0] ?? {};
        const passedAmount = Number(row.passed_amount ?? 0);
        const failedAmount = Number(row.failed_amount ?? 0);
        return {
          batches: Number(row.batches ?? 0),
          submitted: Number(row.submitted ?? 0),
          passed: Number(row.passed ?? 0),
          failed: Number(row.failed ?? 0),
          passedAmount,
          failedAmount,
          totalAmount: passedAmount + failedAmount,
        };
      } catch (err) {
        return reply.code(500).send({ error: 'QueryFailed', message: err instanceof Error ? err.message : String(err) });
      } finally {
        await closePool(pool);
      }
    },
  );

  /** GET /api/claim-db/ssop-rep-batches?startDate=&endDate=&limit=&offset=
   *  รายการงวด ssop_rep_head (เอกสารตอบรับ สปส.) — ไม่มี fundCode filter เพราะเป็นข้อมูลประกันสังคมล้วน
   */
  app.get<{ Querystring: { startDate?: string; endDate?: string; limit?: string; offset?: string } }>(
    '/claim-db/ssop-rep-batches',
    async (request, reply) => {
      const auth = request.auth!;
      const { startDate, endDate } = request.query;
      const limit = Math.min(Number(request.query.limit ?? 100), 500);
      const offset = Math.max(Number(request.query.offset ?? 0), 0);

      let pool: CachedPool;
      try { pool = await openClaimPool(auth.hospitalId); }
      catch (err) { return reply.code(412).send({ error: 'ClaimDbNotConfigured', message: err instanceof Error ? err.message : String(err) }); }

      try {
        const dateF = ssopDateRangeClause(startDate, endDate);
        const sql = `
          SELECT ack_no, doc_type, hospital_code, main_hospital_code, main_hospital_name,
                 batch_ref, station, ack_at, total_submitted, total_passed, total_failed,
                 created_at
          FROM ssop_rep_head
          WHERE 1=1 ${dateF}
          ORDER BY ack_no DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
        const countSql = `SELECT COUNT(*) AS cnt FROM ssop_rep_head WHERE 1=1 ${dateF}`;
        const [list, count] = await Promise.all([runQuery(pool, sql), runQuery(pool, countSql)]);
        return {
          items: list.rows.map((r) => ({
            ackNo: String(r.ack_no ?? ''),
            docType: String(r.doc_type ?? ''),
            hospitalCode: String(r.hospital_code ?? ''),
            mainHospitalCode: String(r.main_hospital_code ?? ''),
            mainHospitalName: r.main_hospital_name ? String(r.main_hospital_name) : null,
            batchRef: String(r.batch_ref ?? ''),
            station: r.station ? String(r.station) : null,
            ackAt: r.ack_at ? String(r.ack_at) : null,
            totalSubmitted: Number(r.total_submitted ?? 0),
            totalPassed: Number(r.total_passed ?? 0),
            totalFailed: Number(r.total_failed ?? 0),
          })),
          total: Number(count.rows[0]?.cnt ?? 0),
          limit,
          offset,
        };
      } catch (err) {
        return reply.code(500).send({ error: 'QueryFailed', message: err instanceof Error ? err.message : String(err) });
      } finally {
        await closePool(pool);
      }
    },
  );

  /** GET /api/claim-db/ssop-rep-batches/:ackNo — head + claim lines (ssop_rep_detail) */
  app.get<{ Params: { ackNo: string } }>('/claim-db/ssop-rep-batches/:ackNo', async (request, reply) => {
    const auth = request.auth!;
    const ackNo = escapeId(request.params.ackNo);
    if (!ackNo) return reply.code(400).send({ error: 'BadRequest', message: 'invalid ackNo' });

    let pool: CachedPool;
    try { pool = await openClaimPool(auth.hospitalId); }
    catch (err) { return reply.code(412).send({ error: 'ClaimDbNotConfigured', message: err instanceof Error ? err.message : String(err) }); }

    try {
      const headR = await runQuery(pool, `SELECT * FROM ssop_rep_head WHERE ack_no = '${ackNo}' LIMIT 1`);
      if (headR.rows.length === 0) return reply.code(404).send({ error: 'NotFound' });

      const detailR = await runQuery(
        pool,
        `SELECT * FROM ssop_rep_detail WHERE ack_no = '${ackNo}' ORDER BY line_no ASC`,
      );
      return {
        head: headR.rows[0],
        details: detailR.rows,
      };
    } catch (err) {
      return reply.code(500).send({ error: 'QueryFailed', message: err instanceof Error ? err.message : String(err) });
    } finally {
      await closePool(pool);
    }
  });

  /** GET /api/claim-db/failed-export?fundCode=&startDate=&endDate=
   *   ดึงทุก rep_detail row ที่ติด C (error_code != ''/'-') พร้อม description จาก eclaim_error
   *   สำหรับ frontend นำไป export Excel
   */
  app.get<{ Querystring: { fundCode?: string; startDate?: string; endDate?: string } }>(
    '/claim-db/failed-export',
    async (request, reply) => {
      const auth = request.auth!;
      const { fundCode, startDate, endDate } = request.query;
      let pool: CachedPool;
      try { pool = await openClaimPool(auth.hospitalId); }
      catch (err) { return reply.code(412).send({ error: 'ClaimDbNotConfigured', message: err instanceof Error ? err.message : String(err) }); }

      try {
        const fundF = fundFilter(fundCode);
        const fundFOnH = fundF.replace(/invoice_doc/g, 'h.invoice_doc');
        const dateF = dateRangeClause(pool.type, startDate, endDate);
        const needJoin = !!fundF;

        const sql = needJoin
          ? `
            SELECT d.rep_no, d.seq_no, d.admit_date, d.discharge_date,
                   d.hn, d.an, d.pid, d.patient_name, d.patient_type,
                   d.fund, d.error_code,
                   d.comp_amount, d.comp_pp, d.charge_amount, d.charge_pp,
                   d.drg, d.rw
            FROM rep_detail d
            JOIN rep_head h ON h.rep_no = d.rep_no
            WHERE d.error_code IS NOT NULL
              AND d.error_code <> ''
              AND d.error_code <> '-'
              ${fundFOnH}
              ${dateF}
            ORDER BY d.rep_no DESC, d.seq_no ASC
          `
          : `
            SELECT d.rep_no, d.seq_no, d.admit_date, d.discharge_date,
                   d.hn, d.an, d.pid, d.patient_name, d.patient_type,
                   d.fund, d.error_code,
                   d.comp_amount, d.comp_pp, d.charge_amount, d.charge_pp,
                   d.drg, d.rw
            FROM rep_detail d
            WHERE d.error_code IS NOT NULL
              AND d.error_code <> ''
              AND d.error_code <> '-'
              ${dateF}
            ORDER BY d.rep_no DESC, d.seq_no ASC
          `;
        const rows = await runQuery(pool, sql);

        // โหลด eclaim_error → map (code → description) ครั้งเดียว
        const codeMap = new Map<string, string>();
        try {
          const er = await runQuery(pool, `SELECT code, description FROM eclaim_error`);
          for (const r of er.rows) {
            codeMap.set(String(r.code ?? ''), String(r.description ?? ''));
          }
        } catch { /* ตารางอาจยังไม่ seed — skip */ }

        const out = rows.rows.map((r) => {
          const errRaw = String(r.error_code ?? '').trim();
          const codes = errRaw.split(/[,;]/).map((c) => c.trim()).filter(Boolean);
          const descs = codes.map((c) => codeMap.get(c)).filter(Boolean);
          return {
            repNo: String(r.rep_no ?? ''),
            seqNo: r.seq_no != null ? Number(r.seq_no) : null,
            admitDate: String(r.admit_date ?? ''),
            dischargeDate: String(r.discharge_date ?? ''),
            hn: String(r.hn ?? ''),
            an: String(r.an ?? ''),
            pid: String(r.pid ?? ''),
            patientName: String(r.patient_name ?? ''),
            patientType: String(r.patient_type ?? ''),
            fund: String(r.fund ?? ''),
            errorCode: errRaw,
            errorDescription: descs.join(' | '),
            compAmount: Number(r.comp_amount ?? 0),
            compPp: Number(r.comp_pp ?? 0),
            chargeAmount: Number(r.charge_amount ?? 0),
            chargePp: Number(r.charge_pp ?? 0),
            drg: String(r.drg ?? ''),
            rw: r.rw != null ? Number(r.rw) : null,
          };
        });
        return { rows: out, total: out.length };
      } catch (err) {
        return reply.code(500).send({ error: 'QueryFailed', message: err instanceof Error ? err.message : String(err) });
      } finally {
        await closePool(pool);
      }
    },
  );

  /** GET /api/claim-db/error-summary?fundCode=
   *   สรุป error code จาก rep_detail — เรียงตาม count desc
   *   รวม multi-code (เช่น "305,306") โดยแยกแต่ละ code นับ +1
   */
  app.get<{ Querystring: { fundCode?: string; startDate?: string; endDate?: string } }>(
    '/claim-db/error-summary',
    async (request, reply) => {
    const auth = request.auth!;
    const { fundCode, startDate, endDate } = request.query;
    let pool: CachedPool;
    try { pool = await openClaimPool(auth.hospitalId); }
    catch (err) { return reply.code(412).send({ error: 'ClaimDbNotConfigured', message: err instanceof Error ? err.message : String(err) }); }

    try {
      const filter = fundFilter(fundCode);
      const dateF = dateRangeClause(pool.type, startDate, endDate);
      const needJoin = !!filter;
      const fundOnH = filter.replace(/invoice_doc/g, 'h.invoice_doc');

      const sql = needJoin
        ? `
          SELECT d.error_code, d.charge_amount, d.charge_pp
          FROM rep_detail d
          JOIN rep_head h ON h.rep_no = d.rep_no
          WHERE d.error_code IS NOT NULL
            AND d.error_code <> ''
            AND d.error_code <> '-'
            ${fundOnH}
            ${dateF}
        `
        : `
          SELECT d.error_code, d.charge_amount, d.charge_pp
          FROM rep_detail d
          WHERE d.error_code IS NOT NULL
            AND d.error_code <> ''
            AND d.error_code <> '-'
            ${dateF}
        `;
      const r = await runQuery(pool, sql);

      // Aggregate ใน Node — แยก multi-code (",", ";") แล้วนับแต่ละ
      const byCode = new Map<string, { code: string; count: number; totalAmount: number }>();
      let totalFailedRows = 0;
      for (const row of r.rows) {
        const raw = String(row.error_code ?? '').trim();
        if (!raw || raw === '-') continue;
        totalFailedRows++;
        const codes = raw.split(/[,;]/).map((c) => c.trim()).filter(Boolean);
        if (codes.length === 0) continue;
        const amt = Number(row.charge_amount ?? 0) + Number(row.charge_pp ?? 0);
        const amtPerCode = codes.length > 0 ? amt / codes.length : amt;

        for (const code of codes) {
          const agg = byCode.get(code) ?? { code, count: 0, totalAmount: 0 };
          agg.count++;
          agg.totalAmount += amtPerCode;
          byCode.set(code, agg);
        }
      }

      const errors = Array.from(byCode.values())
        .map((e) => ({
          ...e,
          totalAmount: Math.round(e.totalAmount * 100) / 100,   // 2 decimals
        }))
        .sort((a, b) => b.count - a.count);

      return {
        errors,
        totalFailedRows,
        uniqueCodes: errors.length,
      };
    } catch (err) {
      return reply.code(500).send({ error: 'QueryFailed', message: err instanceof Error ? err.message : String(err) });
    } finally {
      await closePool(pool);
    }
  });

  /** GET /api/claim-db/error-detail?code=305&fundCode=&startDate=&endDate=
   *   Return list of rep_detail rows ที่ error_code มี code นี้ (รองรับ multi-code "305,306")
   */
  app.get<{ Querystring: { code?: string; fundCode?: string; startDate?: string; endDate?: string } }>(
    '/claim-db/error-detail',
    async (request, reply) => {
      const auth = request.auth!;
      const { code, fundCode, startDate, endDate } = request.query;
      if (!code) return reply.code(400).send({ error: 'BadRequest', message: 'missing code param' });

      // sanitize code — รับเฉพาะ alnum + dash
      const safeCode = code.replace(/[^A-Za-z0-9_-]/g, '');
      if (!safeCode) return reply.code(400).send({ error: 'BadRequest', message: 'invalid code' });

      let pool: CachedPool;
      try { pool = await openClaimPool(auth.hospitalId); }
      catch (err) { return reply.code(412).send({ error: 'ClaimDbNotConfigured', message: err instanceof Error ? err.message : String(err) }); }

      try {
        const fundF = fundFilter(fundCode);
        const fundFOnH = fundF.replace(/invoice_doc/g, 'h.invoice_doc');
        const dateF = dateRangeClause(pool.type, startDate, endDate);

        // จับ code ทั้งกรณีเดี่ยว ("305") และอยู่ใน list ("305,306") — wrap ด้วย ','
        const concatExpr = pool.type === 'postgresql'
          ? `',' || d.error_code || ','`
          : `CONCAT(',', d.error_code, ',')`;
        const codePattern = `'%,${safeCode},%'`;

        const needJoin = !!fundF;
        const sql = needJoin
          ? `
            SELECT d.rep_no, d.seq_no, d.admit_date, d.hn, d.an, d.patient_name, d.error_code
            FROM rep_detail d
            JOIN rep_head h ON h.rep_no = d.rep_no
            WHERE d.error_code IS NOT NULL
              AND d.error_code <> ''
              AND d.error_code <> '-'
              AND ${concatExpr} LIKE ${codePattern}
              ${fundFOnH}
              ${dateF}
            ORDER BY d.rep_no DESC, d.seq_no ASC
          `
          : `
            SELECT d.rep_no, d.seq_no, d.admit_date, d.hn, d.an, d.patient_name, d.error_code
            FROM rep_detail d
            WHERE d.error_code IS NOT NULL
              AND d.error_code <> ''
              AND d.error_code <> '-'
              AND ${concatExpr} LIKE ${codePattern}
              ${dateF}
            ORDER BY d.rep_no DESC, d.seq_no ASC
          `;

        const r = await runQuery(pool, sql);
        return {
          code: safeCode,
          rows: r.rows.map((row) => ({
            repNo: String(row.rep_no ?? ''),
            seqNo: row.seq_no != null ? Number(row.seq_no) : null,
            admitDate: String(row.admit_date ?? ''),
            hn: String(row.hn ?? ''),
            an: String(row.an ?? ''),
            patientName: String(row.patient_name ?? ''),
            errorCode: String(row.error_code ?? ''),
          })),
        };
      } catch (err) {
        return reply.code(500).send({ error: 'QueryFailed', message: err instanceof Error ? err.message : String(err) });
      } finally {
        await closePool(pool);
      }
    },
  );

  /** GET /api/claim-db/monthly-trend?fundCode=
   *  สรุปรายเดือน — กลุ่มตาม issued_at (parse Thai BE format DD/MM/YYYY)
   */
  app.get<{ Querystring: { fundCode?: string } }>('/claim-db/monthly-trend', async (request, reply) => {
    const auth = request.auth!;
    const { fundCode } = request.query;
    let pool: CachedPool;
    try { pool = await openClaimPool(auth.hospitalId); }
    catch (err) { return reply.code(412).send({ error: 'ClaimDbNotConfigured', message: err instanceof Error ? err.message : String(err) }); }

    try {
      const filter = fundFilter(fundCode);
      // ดึง raw + group ใน Node (issued_at เป็น string DD/MM/YYYY พ.ศ.)
      const sql = `
        SELECT issued_at, total_submitted, total_passed, total_failed,
               passed_amount, failed_amount, total_amount
        FROM rep_head
        WHERE 1=1 ${filter}
      `;
      const r = await runQuery(pool, sql);

      const byMonth = new Map<string, {
        month: string;
        batches: number;
        submitted: number;
        passed: number;
        failed: number;
        passedAmount: number;
        failedAmount: number;
        totalAmount: number;
      }>();

      for (const row of r.rows) {
        const issued = String(row.issued_at ?? '').trim();
        const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(issued);
        let monthKey = 'unknown';
        if (m) {
          let year = Number(m[3]);
          if (year > 2400) year -= 543;   // BE → CE
          monthKey = `${year}-${String(Number(m[2])).padStart(2, '0')}`;
        }
        const agg = byMonth.get(monthKey) ?? {
          month: monthKey, batches: 0, submitted: 0, passed: 0, failed: 0,
          passedAmount: 0, failedAmount: 0, totalAmount: 0,
        };
        agg.batches++;
        agg.submitted += Number(row.total_submitted ?? 0);
        agg.passed += Number(row.total_passed ?? 0);
        agg.failed += Number(row.total_failed ?? 0);
        agg.passedAmount += Number(row.passed_amount ?? 0);
        agg.failedAmount += Number(row.failed_amount ?? 0);
        agg.totalAmount += Number(row.total_amount ?? 0);
        byMonth.set(monthKey, agg);
      }

      const months = Array.from(byMonth.values())
        .filter((m) => m.month !== 'unknown')
        .sort((a, b) => a.month.localeCompare(b.month));
      return { months };
    } catch (err) {
      return reply.code(500).send({ error: 'QueryFailed', message: err instanceof Error ? err.message : String(err) });
    } finally {
      await closePool(pool);
    }
  });

  /** GET /api/claim-db/eclaim-error-codes — list ทั้งหมด */
  app.get('/claim-db/eclaim-error-codes', async (request, reply) => {
    const auth = request.auth!;
    let pool: CachedPool;
    try { pool = await openClaimPool(auth.hospitalId); }
    catch (err) { return reply.code(412).send({ error: 'ClaimDbNotConfigured', message: err instanceof Error ? err.message : String(err) }); }

    try {
      const r = await runQuery(pool, `SELECT code, description, resolution FROM eclaim_error ORDER BY code`);
      return {
        codes: r.rows.map((row) => ({
          code: String(row.code ?? ''),
          description: row.description != null ? String(row.description) : null,
          resolution: row.resolution != null ? String(row.resolution) : null,
        })),
        total: r.rows.length,
      };
    } catch (err) {
      return reply.code(500).send({ error: 'QueryFailed', message: err instanceof Error ? err.message : String(err) });
    } finally {
      await closePool(pool);
    }
  });

  /** POST /api/claim-db/eclaim-error-codes/seed — bulk upsert
   *  body: { rows: [{code, description, resolution}], replace: bool }
   */
  app.post('/claim-db/eclaim-error-codes/seed', async (request, reply) => {
    const auth = request.auth!;
    if (auth.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'admin เท่านั้น' });
    }
    const parsed = eclaimErrorSeedSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
    }
    const { rows, replace } = parsed.data;

    let pool: CachedPool;
    try { pool = await openClaimPool(auth.hospitalId); }
    catch (err) { return reply.code(412).send({ error: 'ClaimDbNotConfigured', message: err instanceof Error ? err.message : String(err) }); }

    try {
      if (replace) {
        await runQuery(pool, 'DELETE FROM eclaim_error');
      }

      // bulk upsert in chunks
      const chunkSize = 200;
      let upserted = 0;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const values = chunk
          .map((r) => `(${sqlValueOrNull(r.code)}, ${sqlValueOrNull(r.description)}, ${sqlValueOrNull(r.resolution)})`)
          .join(', ');

        const sql = pool.type === 'postgresql'
          ? `INSERT INTO eclaim_error (code, description, resolution) VALUES ${values} ` +
            `ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, resolution = EXCLUDED.resolution, updated_at = NOW()`
          : `INSERT INTO eclaim_error (code, description, resolution) VALUES ${values} ` +
            `ON DUPLICATE KEY UPDATE description = VALUES(description), resolution = VALUES(resolution), updated_at = CURRENT_TIMESTAMP`;
        await runQuery(pool, sql);
        upserted += chunk.length;
      }
      return { ok: true, upserted, replaced: replace };
    } catch (err) {
      return reply.code(500).send({ error: 'SeedFailed', message: err instanceof Error ? err.message : String(err) });
    } finally {
      await closePool(pool);
    }
  });
}
