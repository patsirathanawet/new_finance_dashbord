/**
 * HOSxP query proxy — รับ SQL จาก frontend แล้วรันผ่าน connection pool ของ รพ. user
 * (แทน HOSxP /api/sql เดิม)
 *
 * Security:
 *  - SELECT-only (block DML/DDL ทั้งหมด)
 *  - Auth ต้องมี JWT + hospital ตั้ง config แล้ว
 *  - SQL size limit 20KB
 */
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { getHospitalPool, runQuery } from '../services/hosxpPool.js';
import { querySchema } from '../schemas/dbConfig.js';

/** ตรวจ SQL — รับเฉพาะ SELECT */
function isReadOnlySql(sql: string): boolean {
  const trimmed = sql.trim().replace(/\s+/g, ' ');
  // Remove leading comments
  const stripped = trimmed.replace(/^(--.*$|\/\*[\s\S]*?\*\/)\s*/gm, '').trim();
  // Must start with SELECT, SHOW, DESCRIBE, EXPLAIN, WITH
  return /^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|WITH)\b/i.test(stripped);
}

export async function hosxpRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** POST /api/hosxp/query — รัน SELECT ผ่าน connection ของ รพ. */
  app.post('/hosxp/query', async (request, reply) => {
    const parsed = querySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'SQL ไม่ถูกต้อง',
        issues: parsed.error.issues,
      });
    }
    const { sql } = parsed.data;
    const auth = request.auth!;

    if (!isReadOnlySql(sql)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'รับเฉพาะ SELECT/SHOW/DESCRIBE/EXPLAIN/WITH เท่านั้น',
      });
    }

    let pool;
    try {
      pool = await getHospitalPool(auth.hospitalId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'CONFIG_NOT_FOUND') {
        return reply.code(412).send({
          error: 'NoConfig',
          message: 'ยังไม่ตั้งค่า DB connection ของโรงพยาบาล — กรุณาตั้งที่หน้า "ตั้งค่าฐานข้อมูล"',
        });
      }
      return reply.code(500).send({ error: 'PoolError', message: msg });
    }

    try {
      const result = await runQuery(pool, sql);
      return {
        // ตอบ shape ใกล้กับ BMS API เดิม เพื่อ frontend ใช้ของเดิมได้
        MessageCode: 200,
        Message: 'OK',
        data: result.rows,
        rowCount: result.rowCount,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      request.log.warn({ err: msg, sql: sql.slice(0, 200) }, 'hosxp query failed');
      return reply.code(500).send({
        error: 'QueryError',
        message: msg,
      });
    }
  });
}
