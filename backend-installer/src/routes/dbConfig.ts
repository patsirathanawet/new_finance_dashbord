import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { encrypt, decrypt, maskPassword } from '../services/encryption.js';
import {
  getHospitalPool,
  invalidateHospitalPool,
  testConnection,
  probeTables,
  createPool,
  closePool,
} from '../services/hosxpPool.js';
import { getHospitalFromOpdConfig } from '../services/hosxpAuth.js';
import {
  dbConfigInputSchema,
  dbConfigTestSchema,
  probeTablesSchema,
  DEFAULT_REQUIRED_TABLES,
} from '../schemas/dbConfig.js';

/**
 * Public routes — ไม่ต้อง JWT (bootstrap & recovery)
 *  - GET /setup/status, GET /setup/db-config — public (sanitized)
 *  - POST /setup/db-config — public upsert (สร้างใหม่ หรือแก้ไขของเดิม)
 *    เปิด public เพื่อให้ admin แก้ DB config ได้แม้ login ไม่ผ่าน
 */
export async function publicSetupRoutes(app: FastifyInstance) {
  /** GET /api/setup/status — ตรวจว่าระบบ setup แล้วหรือยัง (public) */
  app.get('/setup/status', async () => {
    const count = await prisma.hospitalDbConfig.count({ where: { deletedAt: null } });
    return { configured: count > 0 };
  });

  /** POST /api/setup/db-config/test — ทดสอบ connection (public)
   *  ถ้า password ว่างและมี config เดิม → ใช้ password เดิมจาก DB
   */
  app.post('/setup/db-config/test', async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    let bodyForParse: Record<string, unknown> = { ...(body ?? {}) };

    if (!bodyForParse.password || bodyForParse.password === '') {
      const existingCfg = await prisma.hospitalDbConfig.findFirst({ where: { deletedAt: null } });
      if (!existingCfg) {
        return reply.code(400).send({ error: 'BadRequest', message: 'ต้องใส่ password' });
      }
      try {
        bodyForParse.password = decrypt(existingCfg.passwordEncrypted);
      } catch {
        return reply.code(400).send({ error: 'BadRequest', message: 'decrypt password เดิมไม่สำเร็จ' });
      }
    }

    const parsed = dbConfigTestSchema.safeParse(bodyForParse);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
    }
    return await testConnection(parsed.data);
  });

  /** GET /api/setup/db-config — ดึง connection ปัจจุบัน (public, password masked) */
  app.get('/setup/db-config', async () => {
    const cfg = await prisma.hospitalDbConfig.findFirst({ where: { deletedAt: null } });
    if (!cfg) {
      return {
        configured: false,
        defaultRequiredTables: DEFAULT_REQUIRED_TABLES,
      };
    }
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
      requiredTables: cfg.requiredTables,
      lastTestedAt: cfg.lastTestedAt,
      lastTestStatus: cfg.lastTestStatus,
      lastTestMessage: cfg.lastTestMessage,
      updatedByName: cfg.updatedByName,
      updatedAt: cfg.updatedAt,
      defaultRequiredTables: DEFAULT_REQUIRED_TABLES,
    };
  });

  /**
   * POST /api/setup/db-config
   *  - upsert: ถ้ายังไม่มี → สร้างใหม่ (bootstrap hospital จาก opdconfig)
   *           ถ้ามีอยู่แล้ว → อัปเดต + invalidate pool
   *  - ถ้า password ว่างและมี config เดิม → ใช้ password เดิม (ไม่ต้องใส่ซ้ำ)
   */
  app.post('/setup/db-config', async (request, reply) => {
    const existingCfg = await prisma.hospitalDbConfig.findFirst({ where: { deletedAt: null } });

    // ถ้ามี config เดิม + body ไม่ส่ง password → ใช้ password เดิม
    const body = request.body as Record<string, unknown> | undefined;
    let bodyForParse: Record<string, unknown> = { ...(body ?? {}) };
    if (existingCfg && (!bodyForParse.password || bodyForParse.password === '')) {
      try {
        bodyForParse.password = decrypt(existingCfg.passwordEncrypted);
      } catch {
        return reply.code(400).send({
          error: 'PasswordRequired',
          message: 'ต้องใส่ password (decrypt config เดิมไม่สำเร็จ)',
        });
      }
    }

    const parsed = dbConfigInputSchema.safeParse(bodyForParse);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
    }
    const data = parsed.data;

    // 1. Test connection
    const testResult = await testConnection({
      dbType: data.dbType,
      host: data.host,
      port: data.port,
      database: data.database,
      username: data.username,
      password: data.password,
    });
    if (!testResult.ok) {
      return reply.code(400).send({
        error: 'ConnectionFailed',
        message: `เชื่อมต่อไม่สำเร็จ: ${testResult.error}`,
      });
    }

    // 2. ดึง hospital info จาก opdconfig
    let hospitalCode = '00000';
    let hospitalName = 'โรงพยาบาล';
    {
      const pool = createPool({
        dbType: data.dbType,
        host: data.host,
        port: data.port,
        database: data.database,
        username: data.username,
        password: data.password,
      });
      try {
        const hospInfo = await getHospitalFromOpdConfig(pool);
        if (hospInfo?.code) {
          hospitalCode = hospInfo.code;
          hospitalName = hospInfo.name || hospitalName;
        }
      } catch {
        // continue with default
      } finally {
        await closePool(pool);
      }
    }

    // 3. Upsert hospital
    const hospital = await prisma.hospital.upsert({
      where: { code: hospitalCode },
      update: { name: hospitalName },
      create: { code: hospitalCode, name: hospitalName },
    });

    // 4. Upsert db_config
    const encrypted = encrypt(data.password);
    const reqTables = data.requiredTables
      ?? (existingCfg?.requiredTables as string[] | undefined)
      ?? Array.from(DEFAULT_REQUIRED_TABLES);

    const payload = {
      hospitalId: hospital.id,
      dbType: data.dbType,
      host: data.host,
      port: data.port,
      databaseName: data.database,
      username: data.username,
      passwordEncrypted: encrypted,
      requiredTables: reqTables,
      lastTestedAt: new Date(),
      lastTestStatus: 'ok',
      lastTestMessage: `latency=${testResult.latencyMs}ms`,
      updatedByName: existingCfg ? 'Setup Page' : 'Initial Setup',
    };

    const saved = existingCfg
      ? await prisma.hospitalDbConfig.update({ where: { id: existingCfg.id }, data: payload })
      : await prisma.hospitalDbConfig.create({ data: payload });

    // Invalidate pool ถ้าเป็นการ update
    if (existingCfg) {
      await invalidateHospitalPool(hospital.id);
    }

    return {
      ok: true,
      hospital: { code: hospital.code, name: hospital.name },
      configId: saved.id,
      testResult,
      mode: existingCfg ? 'updated' : 'created',
    };
  });
}

export async function dbConfigRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** GET /api/db-config — return config ของ รพ. ตัวเอง (password masked) */
  app.get('/db-config', async (request) => {
    const auth = request.auth!;
    const cfg = await prisma.hospitalDbConfig.findFirst({
      where: { hospitalId: auth.hospitalId, deletedAt: null },
    });
    if (!cfg) {
      return {
        configured: false,
        defaultRequiredTables: DEFAULT_REQUIRED_TABLES,
      };
    }
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
      requiredTables: cfg.requiredTables,
      lastTestedAt: cfg.lastTestedAt,
      lastTestStatus: cfg.lastTestStatus,
      lastTestMessage: cfg.lastTestMessage,
      updatedByName: cfg.updatedByName,
      updatedAt: cfg.updatedAt,
      defaultRequiredTables: DEFAULT_REQUIRED_TABLES,
    };
  });

  /** POST /api/db-config/test — ลอง connect (ไม่บันทึก) */
  app.post('/db-config/test', async (request, reply) => {
    const parsed = dbConfigTestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
    }
    const result = await testConnection(parsed.data);
    return result;
  });

  /** POST /api/db-config — บันทึก (admin only) */
  app.post('/db-config', async (request, reply) => {
    const auth = request.auth!;
    if (auth.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'ต้องเป็น admin เท่านั้น' });
    }
    const parsed = dbConfigInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
    }
    const data = parsed.data;

    // ทดสอบ connection ก่อนบันทึก
    const testResult = await testConnection({
      dbType: data.dbType,
      host: data.host,
      port: data.port,
      database: data.database,
      username: data.username,
      password: data.password,
    });

    const encrypted = encrypt(data.password);
    const reqTables = data.requiredTables ?? Array.from(DEFAULT_REQUIRED_TABLES);

    const existing = await prisma.hospitalDbConfig.findFirst({
      where: { hospitalId: auth.hospitalId, deletedAt: null },
    });

    const payload = {
      hospitalId: auth.hospitalId,
      dbType: data.dbType,
      host: data.host,
      port: data.port,
      databaseName: data.database,
      username: data.username,
      passwordEncrypted: encrypted,
      requiredTables: reqTables,
      lastTestedAt: new Date(),
      lastTestStatus: testResult.ok ? 'ok' : 'error',
      lastTestMessage: testResult.ok ? `latency=${testResult.latencyMs}ms` : testResult.error,
      updatedByUserId: auth.userId,
      updatedByName: auth.name,
    };

    const saved = existing
      ? await prisma.hospitalDbConfig.update({ where: { id: existing.id }, data: payload })
      : await prisma.hospitalDbConfig.create({ data: payload });

    // Invalidate pool เพื่อให้ใช้ config ใหม่
    await invalidateHospitalPool(auth.hospitalId);

    audit(request, {
      action: existing ? 'db-config.update' : 'db-config.create',
      targetType: 'hospital_db_config',
      targetId: saved.id,
      metadata: { dbType: data.dbType, host: data.host, testOk: testResult.ok },
    });

    return {
      id: saved.id,
      testResult,
    };
  });

  /** PUT /api/db-config/required-tables — อัปเดต list */
  app.put('/db-config/required-tables', async (request, reply) => {
    const auth = request.auth!;
    if (auth.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'ต้องเป็น admin เท่านั้น' });
    }
    const parsed = probeTablesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
    }
    const cfg = await prisma.hospitalDbConfig.findFirst({
      where: { hospitalId: auth.hospitalId, deletedAt: null },
    });
    if (!cfg) return reply.code(404).send({ error: 'NotFound', message: 'ยังไม่ตั้งค่า DB' });

    const updated = await prisma.hospitalDbConfig.update({
      where: { id: cfg.id },
      data: { requiredTables: parsed.data.tables },
    });
    audit(request, {
      action: 'db-config.update_tables',
      targetType: 'hospital_db_config',
      targetId: cfg.id,
    });
    return { requiredTables: updated.requiredTables };
  });

  /** POST /api/db-config/probe-tables — ตรวจตารางที่ต้องมี
   *  - ใช้ config ปัจจุบัน (ถ้ามี) — หรือรับ params ใน body เพื่อทดสอบก่อน save
   *  - body.tables (optional) override list (default = ใช้ list ใน config)
   */
  app.post('/db-config/probe-tables', async (request, reply) => {
    const auth = request.auth!;
    const body = request.body as Record<string, unknown> | undefined;

    // Option 1: ใช้ ad-hoc config (test ก่อน save)
    const adhocConfig = body && (
      body.host || body.username || body.password || body.dbType
    ) ? dbConfigTestSchema.safeParse(body) : null;

    let tablesToCheck: string[];
    if (body?.tables && Array.isArray(body.tables) && body.tables.length > 0) {
      tablesToCheck = body.tables as string[];
    } else {
      const cfg = await prisma.hospitalDbConfig.findFirst({
        where: { hospitalId: auth.hospitalId, deletedAt: null },
      });
      tablesToCheck = (cfg?.requiredTables as string[] | undefined) ?? Array.from(DEFAULT_REQUIRED_TABLES);
    }

    if (adhocConfig?.success) {
      // ad-hoc test
      let pool = null;
      try {
        pool = createPool(adhocConfig.data);
        const result = await probeTables(pool, tablesToCheck);
        return { tables: result };
      } catch (err) {
        return reply.code(500).send({ error: 'ProbeFailed', message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (pool) await closePool(pool);
      }
    }

    // ใช้ saved config
    try {
      const pool = await getHospitalPool(auth.hospitalId);
      const result = await probeTables(pool, tablesToCheck);
      return { tables: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'CONFIG_NOT_FOUND') {
        return reply.code(404).send({ error: 'NoConfig', message: 'ยังไม่ตั้งค่า DB' });
      }
      return reply.code(500).send({ error: 'ProbeFailed', message: msg });
    }
  });

  /** DELETE /api/db-config — soft delete */
  app.delete('/db-config', async (request, reply) => {
    const auth = request.auth!;
    if (auth.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'ต้องเป็น admin เท่านั้น' });
    }
    const cfg = await prisma.hospitalDbConfig.findFirst({
      where: { hospitalId: auth.hospitalId, deletedAt: null },
    });
    if (!cfg) return reply.code(404).send({ error: 'NotFound' });

    await prisma.hospitalDbConfig.update({
      where: { id: cfg.id },
      data: { deletedAt: new Date() },
    });
    await invalidateHospitalPool(auth.hospitalId);

    audit(request, {
      action: 'db-config.delete',
      targetType: 'hospital_db_config',
      targetId: cfg.id,
    });
    return reply.code(204).send();
  });
}
