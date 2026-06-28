import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { validateHosxpSession } from '../services/hosxpSession.js';
import { authenticateHosxpUser, getHospitalFromOpdConfig } from '../services/hosxpAuth.js';
import { getHospitalPool } from '../services/hosxpPool.js';
import { audit } from '../middleware/audit.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthPayload } from '../types.js';

const sessionSchema = z.object({
  bmsSessionId: z.string().min(1),
});

const hosxpLoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(500),
});

const devLoginSchema = z.object({
  hospitalCode: z.string().length(5),
  userName: z.string().min(1),
  role: z.enum(['user', 'admin', 'viewer']).optional(),
});

export async function authRoutes(app: FastifyInstance) {
  /**
   * POST /api/auth/session
   * Frontend ส่ง bmsSessionId → backend validate กับ HOSxP →
   * upsert hospital + user → ออก JWT
   */
  app.post('/auth/session', async (request, reply) => {
    const parsed = sessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
    }

    let info;
    try {
      info = await validateHosxpSession(parsed.data.bmsSessionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(401).send({ error: 'SessionInvalid', message: msg });
    }

    // Upsert hospital
    const hospital = await prisma.hospital.upsert({
      where: { code: info.hospitalCode },
      update: { name: info.hospitalName },
      create: { code: info.hospitalCode, name: info.hospitalName },
    });

    // Find or create user (ใช้ findFirst เพราะ unique เป็น partial index)
    const existingUser = await prisma.user.findFirst({
      where: { hospitalId: hospital.id, bmsUserKey: info.userKey },
    });
    const user = existingUser
      ? await prisma.user.update({
          where: { id: existingUser.id },
          data: { name: info.userName, lastLoginAt: new Date() },
        })
      : await prisma.user.create({
          data: {
            hospitalId: hospital.id,
            bmsUserKey: info.userKey,
            name: info.userName,
            role: 'user',
            lastLoginAt: new Date(),
          },
        });

    const payload: AuthPayload = {
      userId: user.id,
      hospitalId: hospital.id,
      hospitalCode: hospital.code,
      role: user.role,
      name: user.name,
    };

    const token = app.jwt.sign(payload);

    audit(request, { action: 'auth.login', targetType: 'user', targetId: user.id });

    return { token, user: payload };
  });

  /**
   * POST /api/auth/dev-login (DEV ONLY)
   * สำหรับทดสอบโดยไม่ต้อง HOSxP session — ปิดใน production
   */
  if (process.env.NODE_ENV === 'development') {
    app.post('/auth/dev-login', async (request, reply) => {
      const parsed = devLoginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
      }
      const { hospitalCode, userName, role = 'admin' } = parsed.data;

      const hospital = await prisma.hospital.upsert({
        where: { code: hospitalCode },
        update: {},
        create: { code: hospitalCode, name: `รพ. ${hospitalCode}` },
      });

      const devKey = `dev_${userName}`;
      const existing = await prisma.user.findFirst({
        where: { hospitalId: hospital.id, bmsUserKey: devKey },
      });
      const user = existing
        ? await prisma.user.update({
            where: { id: existing.id },
            data: { name: userName, role, lastLoginAt: new Date() },
          })
        : await prisma.user.create({
            data: {
              hospitalId: hospital.id,
              bmsUserKey: devKey,
              name: userName,
              role,
              lastLoginAt: new Date(),
            },
          });

      const payload: AuthPayload = {
        userId: user.id,
        hospitalId: hospital.id,
        hospitalCode: hospital.code,
        role: user.role,
        name: user.name,
      };
      const token = app.jwt.sign(payload);
      return { token, user: payload, devMode: true };
    });
  }

  /**
   * POST /api/auth/hosxp-login
   * รับ username + password ของ HOSxP → verify ผ่าน opduser → JWT
   *
   *  flow:
   *    1. หา HospitalDbConfig ที่ admin ตั้งไว้ใน DB (มี 1 ตัวต่อระบบ ถ้า single-hospital)
   *    2. ใช้ connection pool query opduser พร้อมลอง password format หลายแบบ
   *    3. ถ้าผ่าน → ดึง hospitalcode/name จาก opdconfig → upsert hospital + user → JWT
   */
  app.post('/auth/hosxp-login', async (request, reply) => {
    const parsed = hosxpLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
    }
    const { username, password } = parsed.data;

    // หา DB config ที่ active (เลือกเอาตัวแรกที่เจอ — ใช้ได้กรณี single-hospital)
    const configs = await prisma.hospitalDbConfig.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    if (configs.length === 0) {
      return reply.code(412).send({
        error: 'NoConfig',
        message: 'ยังไม่ตั้งค่า DB connection — admin ต้องตั้งค่าก่อน',
      });
    }

    // ลอง login ในแต่ละ config ที่มี (1 config = 1 hospital)
    for (const cfg of configs) {
      let pool;
      try {
        pool = await getHospitalPool(cfg.hospitalId);
      } catch {
        continue;  // pool ล้มเหลว ลอง config ถัดไป
      }

      const auth = await authenticateHosxpUser(pool, username, password);
      if (!auth.ok) continue;  // ไม่ match → ลอง config ถัดไป

      // login ผ่าน — ดึง hospital info จาก opdconfig
      const hospInfo = await getHospitalFromOpdConfig(pool);
      const hospitalCode = hospInfo?.code || '00000';
      const hospitalName = hospInfo?.name || 'โรงพยาบาล';

      // upsert hospital (sync ชื่อจาก opdconfig)
      const hospital = await prisma.hospital.upsert({
        where: { code: hospitalCode },
        update: { name: hospitalName },
        create: { code: hospitalCode, name: hospitalName },
      });

      // upsert user — link bmsUserKey = `hosxp_${loginname}`
      const userKey = `hosxp_${auth.loginname}`;
      const existing = await prisma.user.findFirst({
        where: { hospitalId: hospital.id, bmsUserKey: userKey },
      });
      const user = existing
        ? await prisma.user.update({
            where: { id: existing.id },
            data: { name: auth.fullName ?? auth.loginname!, lastLoginAt: new Date() },
          })
        : await prisma.user.create({
            data: {
              hospitalId: hospital.id,
              bmsUserKey: userKey,
              name: auth.fullName ?? auth.loginname!,
              role: 'admin',  // HOSxP staff ที่ login ผ่าน = trusted admin
              lastLoginAt: new Date(),
            },
          });

      const payload: AuthPayload = {
        userId: user.id,
        hospitalId: hospital.id,
        hospitalCode: hospital.code,
        role: user.role,
        name: user.name,
      };
      const token = app.jwt.sign(payload);

      audit(request, {
        action: 'auth.hosxp-login',
        targetType: 'user',
        targetId: user.id,
        metadata: { method: auth.method, loginname: auth.loginname },
      });

      return { token, user: payload, method: auth.method };
    }

    // ไม่ผ่าน config ไหนเลย
    audit(request, {
      action: 'auth.hosxp-login.fail',
      metadata: { username },
    });
    return reply.code(401).send({
      error: 'InvalidCredentials',
      message: 'username หรือ password ไม่ถูกต้อง',
    });
  });

  /** GET /api/auth/me — คืนข้อมูล user ปัจจุบัน */
  app.get('/auth/me', { preHandler: requireAuth }, async (request) => {
    return { user: request.auth };
  });
}
