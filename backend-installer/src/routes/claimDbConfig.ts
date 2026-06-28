import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { encrypt, decrypt, maskPassword } from '../services/encryption.js';
import {
  testConnection,
  createPool,
  closePool,
} from '../services/hosxpPool.js';
import {
  createClaimTables, checkClaimTables,
  createSsopRepTables, checkSsopRepTables,
  createCsopTables, checkCsopTables,
  createAipnTables, checkAipnTables,
} from '../services/claimDbSetup.js';
import { dbConfigInputSchema, dbConfigTestSchema } from '../schemas/dbConfig.js';

/**
 * /api/claim-db-config — connection สำหรับฐานข้อมูล "เก็บไฟล์ตอบกลับ" (REP/STM)
 *  - คนละตัวกับ /api/db-config (HOSxP)
 *  - มี endpoint สร้างตารางในฐานปลายทาง: POST /claim-db-config/create-tables
 */
export async function claimDbConfigRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** GET /api/claim-db-config — return config (password masked) */
  app.get('/claim-db-config', async (request) => {
    const auth = request.auth!;
    const cfg = await prisma.claimDbConfig.findFirst({
      where: { hospitalId: auth.hospitalId, deletedAt: null },
    });
    if (!cfg) return { configured: false };

    let passwordLen = 0;
    try { passwordLen = decrypt(cfg.passwordEncrypted).length; } catch { /* ignore */ }
    return {
      configured: true,
      id: cfg.id,
      dbType: cfg.dbType,
      host: cfg.host,
      port: cfg.port,
      database: cfg.databaseName,
      username: cfg.username,
      password: maskPassword('x'.repeat(passwordLen)),
      lastTestedAt: cfg.lastTestedAt,
      lastTestStatus: cfg.lastTestStatus,
      lastTestMessage: cfg.lastTestMessage,
      tablesCreatedAt: cfg.tablesCreatedAt,
      tablesCreatedBy: cfg.tablesCreatedBy,
      updatedByName: cfg.updatedByName,
      updatedAt: cfg.updatedAt,
    };
  });

  /** POST /api/claim-db-config/test — test connection
   *  ถ้า password ว่างและมี config เดิม → ใช้ password เดิม
   */
  app.post('/claim-db-config/test', async (request, reply) => {
    const auth = request.auth!;
    const body = request.body as Record<string, unknown> | undefined;
    const bodyForParse: Record<string, unknown> = { ...(body ?? {}) };

    if (!bodyForParse.password || bodyForParse.password === '') {
      const existing = await prisma.claimDbConfig.findFirst({
        where: { hospitalId: auth.hospitalId, deletedAt: null },
      });
      if (existing) {
        try {
          bodyForParse.password = decrypt(existing.passwordEncrypted);
        } catch {
          return reply.code(400).send({ error: 'BadRequest', message: 'decrypt password เดิมไม่สำเร็จ' });
        }
      }
    }

    const parsed = dbConfigTestSchema.safeParse(bodyForParse);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
    }
    return await testConnection(parsed.data);
  });

  /** POST /api/claim-db-config — upsert connection (admin only)
   *  ถ้า password ว่างและมี config เดิม → ใช้ password เดิม
   */
  app.post('/claim-db-config', async (request, reply) => {
    const auth = request.auth!;
    if (auth.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'ต้องเป็น admin เท่านั้น' });
    }

    const existing = await prisma.claimDbConfig.findFirst({
      where: { hospitalId: auth.hospitalId, deletedAt: null },
    });

    const body = request.body as Record<string, unknown> | undefined;
    const bodyForParse: Record<string, unknown> = { ...(body ?? {}) };
    if (existing && (!bodyForParse.password || bodyForParse.password === '')) {
      try {
        bodyForParse.password = decrypt(existing.passwordEncrypted);
      } catch {
        return reply.code(400).send({ error: 'BadRequest', message: 'decrypt password เดิมไม่สำเร็จ' });
      }
    }

    const parsed = dbConfigInputSchema.safeParse(bodyForParse);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
    }
    const data = parsed.data;

    // Test ก่อน save
    const testResult = await testConnection({
      dbType: data.dbType,
      host: data.host,
      port: data.port,
      database: data.database,
      username: data.username,
      password: data.password,
    });

    const encrypted = encrypt(data.password);
    const payload = {
      hospitalId: auth.hospitalId,
      dbType: data.dbType,
      host: data.host,
      port: data.port,
      databaseName: data.database,
      username: data.username,
      passwordEncrypted: encrypted,
      lastTestedAt: new Date(),
      lastTestStatus: testResult.ok ? 'ok' : 'error',
      lastTestMessage: testResult.ok ? `latency=${testResult.latencyMs}ms` : (testResult.error ?? null),
      updatedByUserId: auth.userId,
      updatedByName: auth.name,
    };

    const saved = existing
      ? await prisma.claimDbConfig.update({ where: { id: existing.id }, data: payload })
      : await prisma.claimDbConfig.create({ data: payload });

    audit(request, {
      action: existing ? 'claim-db-config.update' : 'claim-db-config.create',
      targetType: 'claim_db_config',
      targetId: saved.id,
      metadata: { dbType: data.dbType, host: data.host, testOk: testResult.ok },
    });

    return { id: saved.id, testResult };
  });

  /** POST /api/claim-db-config/create-tables — สร้าง rep_records + stm_records ใน DB ปลายทาง
   *  ใช้ saved config (ห้ามรัน ad-hoc)
   */
  app.post('/claim-db-config/create-tables', async (request, reply) => {
    const auth = request.auth!;
    if (auth.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'ต้องเป็น admin เท่านั้น' });
    }

    const cfg = await prisma.claimDbConfig.findFirst({
      where: { hospitalId: auth.hospitalId, deletedAt: null },
    });
    if (!cfg) {
      return reply.code(404).send({
        error: 'NotConfigured',
        message: 'ยังไม่ตั้งค่า connection — บันทึก config ก่อน',
      });
    }

    let password: string;
    try {
      password = decrypt(cfg.passwordEncrypted);
    } catch {
      return reply.code(500).send({ error: 'DecryptFailed', message: 'decrypt password ไม่สำเร็จ' });
    }

    const pool = createPool({
      dbType: cfg.dbType,
      host: cfg.host,
      port: cfg.port,
      database: cfg.databaseName,
      username: cfg.username,
      password,
    });

    try {
      const result = await createClaimTables(pool);
      if (!result.ok) {
        return reply.code(500).send({
          error: 'CreateTablesFailed',
          message: result.error,
          created: result.created,
        });
      }

      await prisma.claimDbConfig.update({
        where: { id: cfg.id },
        data: {
          tablesCreatedAt: new Date(),
          tablesCreatedBy: auth.name,
        },
      });

      audit(request, {
        action: 'claim-db-config.create-tables',
        targetType: 'claim_db_config',
        targetId: cfg.id,
        metadata: { created: result.created },
      });

      return result;
    } finally {
      await closePool(pool);
    }
  });

  /** GET /api/claim-db-config/check-tables — ตรวจตารางมีอยู่ใน target DB หรือไม่ */
  app.get('/claim-db-config/check-tables', async (request, reply) => {
    const auth = request.auth!;
    const cfg = await prisma.claimDbConfig.findFirst({
      where: { hospitalId: auth.hospitalId, deletedAt: null },
    });
    if (!cfg) return reply.code(404).send({ error: 'NotConfigured' });

    let password: string;
    try {
      password = decrypt(cfg.passwordEncrypted);
    } catch {
      return reply.code(500).send({ error: 'DecryptFailed' });
    }

    const pool = createPool({
      dbType: cfg.dbType,
      host: cfg.host,
      port: cfg.port,
      database: cfg.databaseName,
      username: cfg.username,
      password,
    });
    try {
      return await checkClaimTables(pool);
    } finally {
      await closePool(pool);
    }
  });

  /** POST /api/claim-db-config/create-ssop-rep-tables — สร้าง ssop_rep_head + ssop_rep_detail ใน target DB */
  app.post('/claim-db-config/create-ssop-rep-tables', async (request, reply) => {
    const auth = request.auth!;
    if (auth.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'ต้องเป็น admin เท่านั้น' });
    }

    const cfg = await prisma.claimDbConfig.findFirst({
      where: { hospitalId: auth.hospitalId, deletedAt: null },
    });
    if (!cfg) {
      return reply.code(404).send({
        error: 'NotConfigured',
        message: 'ยังไม่ตั้งค่า connection — บันทึก config ก่อน',
      });
    }

    let password: string;
    try {
      password = decrypt(cfg.passwordEncrypted);
    } catch {
      return reply.code(500).send({ error: 'DecryptFailed', message: 'decrypt password ไม่สำเร็จ' });
    }

    const pool = createPool({
      dbType: cfg.dbType,
      host: cfg.host,
      port: cfg.port,
      database: cfg.databaseName,
      username: cfg.username,
      password,
    });

    try {
      const result = await createSsopRepTables(pool);
      if (!result.ok) {
        return reply.code(500).send({
          error: 'CreateTablesFailed',
          message: result.error,
          created: result.created,
        });
      }

      audit(request, {
        action: 'claim-db-config.create-ssop-rep-tables',
        targetType: 'claim_db_config',
        targetId: cfg.id,
        metadata: { created: result.created },
      });

      return result;
    } finally {
      await closePool(pool);
    }
  });

  /** GET /api/claim-db-config/check-ssop-rep-tables — ตรวจตารางมีอยู่ใน target DB หรือไม่ */
  app.get('/claim-db-config/check-ssop-rep-tables', async (request, reply) => {
    const auth = request.auth!;
    const cfg = await prisma.claimDbConfig.findFirst({
      where: { hospitalId: auth.hospitalId, deletedAt: null },
    });
    if (!cfg) return reply.code(404).send({ error: 'NotConfigured' });

    let password: string;
    try {
      password = decrypt(cfg.passwordEncrypted);
    } catch {
      return reply.code(500).send({ error: 'DecryptFailed' });
    }

    const pool = createPool({
      dbType: cfg.dbType,
      host: cfg.host,
      port: cfg.port,
      database: cfg.databaseName,
      username: cfg.username,
      password,
    });
    try {
      return await checkSsopRepTables(pool);
    } finally {
      await closePool(pool);
    }
  });

  /** POST /api/claim-db-config/create-csop-tables — สร้าง csop_rep_head + csop_rep_head_detail + csop_error ใน target DB */
  app.post('/claim-db-config/create-csop-tables', async (request, reply) => {
    const auth = request.auth!;
    if (auth.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'ต้องเป็น admin เท่านั้น' });
    }

    const cfg = await prisma.claimDbConfig.findFirst({
      where: { hospitalId: auth.hospitalId, deletedAt: null },
    });
    if (!cfg) {
      return reply.code(404).send({
        error: 'NotConfigured',
        message: 'ยังไม่ตั้งค่า connection — บันทึก config ก่อน',
      });
    }

    let password: string;
    try {
      password = decrypt(cfg.passwordEncrypted);
    } catch {
      return reply.code(500).send({ error: 'DecryptFailed', message: 'decrypt password ไม่สำเร็จ' });
    }

    const pool = createPool({
      dbType: cfg.dbType,
      host: cfg.host,
      port: cfg.port,
      database: cfg.databaseName,
      username: cfg.username,
      password,
    });

    try {
      const result = await createCsopTables(pool);
      if (!result.ok) {
        return reply.code(500).send({
          error: 'CreateTablesFailed',
          message: result.error,
          created: result.created,
        });
      }

      audit(request, {
        action: 'claim-db-config.create-csop-tables',
        targetType: 'claim_db_config',
        targetId: cfg.id,
        metadata: { created: result.created },
      });

      return result;
    } finally {
      await closePool(pool);
    }
  });

  /** GET /api/claim-db-config/check-csop-tables — ตรวจตารางมีอยู่ใน target DB หรือไม่ */
  app.get('/claim-db-config/check-csop-tables', async (request, reply) => {
    const auth = request.auth!;
    const cfg = await prisma.claimDbConfig.findFirst({
      where: { hospitalId: auth.hospitalId, deletedAt: null },
    });
    if (!cfg) return reply.code(404).send({ error: 'NotConfigured' });

    let password: string;
    try {
      password = decrypt(cfg.passwordEncrypted);
    } catch {
      return reply.code(500).send({ error: 'DecryptFailed' });
    }

    const pool = createPool({
      dbType: cfg.dbType,
      host: cfg.host,
      port: cfg.port,
      database: cfg.databaseName,
      username: cfg.username,
      password,
    });
    try {
      return await checkCsopTables(pool);
    } finally {
      await closePool(pool);
    }
  });

  /** POST /api/claim-db-config/create-aipn-tables — สร้าง aipn_rep_head + aipn_rep_head_detail ใน target DB */
  app.post('/claim-db-config/create-aipn-tables', async (request, reply) => {
    const auth = request.auth!;
    if (auth.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'ต้องเป็น admin เท่านั้น' });
    }

    const cfg = await prisma.claimDbConfig.findFirst({
      where: { hospitalId: auth.hospitalId, deletedAt: null },
    });
    if (!cfg) {
      return reply.code(404).send({
        error: 'NotConfigured',
        message: 'ยังไม่ตั้งค่า connection — บันทึก config ก่อน',
      });
    }

    let password: string;
    try {
      password = decrypt(cfg.passwordEncrypted);
    } catch {
      return reply.code(500).send({ error: 'DecryptFailed', message: 'decrypt password ไม่สำเร็จ' });
    }

    const pool = createPool({
      dbType: cfg.dbType,
      host: cfg.host,
      port: cfg.port,
      database: cfg.databaseName,
      username: cfg.username,
      password,
    });

    try {
      const result = await createAipnTables(pool);
      if (!result.ok) {
        return reply.code(500).send({
          error: 'CreateTablesFailed',
          message: result.error,
          created: result.created,
        });
      }

      audit(request, {
        action: 'claim-db-config.create-aipn-tables',
        targetType: 'claim_db_config',
        targetId: cfg.id,
        metadata: { created: result.created },
      });

      return result;
    } finally {
      await closePool(pool);
    }
  });

  /** GET /api/claim-db-config/check-aipn-tables — ตรวจตารางมีอยู่ใน target DB หรือไม่ */
  app.get('/claim-db-config/check-aipn-tables', async (request, reply) => {
    const auth = request.auth!;
    const cfg = await prisma.claimDbConfig.findFirst({
      where: { hospitalId: auth.hospitalId, deletedAt: null },
    });
    if (!cfg) return reply.code(404).send({ error: 'NotConfigured' });

    let password: string;
    try {
      password = decrypt(cfg.passwordEncrypted);
    } catch {
      return reply.code(500).send({ error: 'DecryptFailed' });
    }

    const pool = createPool({
      dbType: cfg.dbType,
      host: cfg.host,
      port: cfg.port,
      database: cfg.databaseName,
      username: cfg.username,
      password,
    });
    try {
      return await checkAipnTables(pool);
    } finally {
      await closePool(pool);
    }
  });

  /** DELETE /api/claim-db-config — soft delete */
  app.delete('/claim-db-config', async (request, reply) => {
    const auth = request.auth!;
    if (auth.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'ต้องเป็น admin เท่านั้น' });
    }
    const cfg = await prisma.claimDbConfig.findFirst({
      where: { hospitalId: auth.hospitalId, deletedAt: null },
    });
    if (!cfg) return reply.code(404).send({ error: 'NotFound' });

    await prisma.claimDbConfig.update({
      where: { id: cfg.id },
      data: { deletedAt: new Date() },
    });
    audit(request, {
      action: 'claim-db-config.delete',
      targetType: 'claim_db_config',
      targetId: cfg.id,
    });
    return reply.code(204).send();
  });
}
