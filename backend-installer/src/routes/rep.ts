import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { requireAuth, canAccessHospital } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { repRecordSchema, listUploadQuerySchema } from '../schemas/upload.js';

/** map backend RepRecord row → response shape ที่ frontend คาดหวัง
 *  รวม rawData กลับเข้ากับ id = business_key */
function toResponse(r: {
  id: string;
  hospitalCode: string;
  fileName: string;
  fundType: string | null;
  businessKey: string | null;
  totalRows: number;
  rawData: unknown;
  summary: unknown;
  uploadedByName: string | null;
  uploadedAt: Date;
}): Record<string, unknown> {
  // rawData = REPRecord ทั้งก้อน — return เป็น top-level
  const raw = (r.rawData as Record<string, unknown>) ?? {};
  return {
    ...raw,
    id: r.businessKey ?? r.id,                // ใช้ business_key เป็น id ที่ frontend เห็น
    hospitalCode: r.hospitalCode,
    fileName: raw.fileName ?? r.fileName,
    fundType: raw.fundType ?? r.fundType,
    uploadedAt: raw.uploadedAt ?? r.uploadedAt.toISOString(),
    uploadedBy: raw.uploadedBy ?? r.uploadedByName ?? '',
  };
}

export async function repRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** GET /api/rep — list */
  app.get('/rep', async (request, reply) => {
    const parsed = listUploadQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
    }
    const { hospitalCode, limit, offset } = parsed.data;
    const auth = request.auth!;
    const code = auth.role === 'admin' ? hospitalCode : auth.hospitalCode;

    const where = {
      deletedAt: null,
      ...(code ? { hospitalCode: code } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.repRecord.findMany({
        where,
        orderBy: { uploadedAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          hospitalCode: true,
          fileName: true,
          fundType: true,
          businessKey: true,
          totalRows: true,
          rawData: true,
          summary: true,
          uploadedByName: true,
          uploadedAt: true,
        },
      }),
      prisma.repRecord.count({ where }),
    ]);

    return { items: items.map(toResponse), total, limit, offset };
  });

  /** GET /api/rep/:id — :id = business_key */
  app.get<{ Params: { id: string } }>('/rep/:id', async (request, reply) => {
    const record = await prisma.repRecord.findFirst({
      where: { businessKey: request.params.id, deletedAt: null },
    });
    if (!record) return reply.code(404).send({ error: 'NotFound' });
    if (!canAccessHospital(request, record.hospitalId)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    return toResponse(record);
  });

  /** POST /api/rep — create or update (dedup โดย businessKey) */
  app.post('/rep', async (request, reply) => {
    const parsed = repRecordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
    }
    const data = parsed.data;
    const auth = request.auth!;

    if (auth.role !== 'admin' && data.hospitalCode !== auth.hospitalCode) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'ไม่อนุญาตให้บันทึกข้อมูลของโรงพยาบาลอื่น',
      });
    }

    const hospital = await prisma.hospital.findUnique({ where: { code: data.hospitalCode } });
    if (!hospital) {
      return reply.code(404).send({
        error: 'HospitalNotFound',
        message: `ไม่พบโรงพยาบาลรหัส ${data.hospitalCode}`,
      });
    }

    const businessKey = data.id;

    // หา record เดิม (dedup)
    const existing = await prisma.repRecord.findFirst({
      where: { businessKey, deletedAt: null },
    });

    const payload = {
      hospitalId: hospital.id,
      uploadedByUserId: auth.userId,
      uploadedByName: auth.name,
      fileName: data.fileName,
      hospitalCode: data.hospitalCode,
      fundType: data.fundType,
      businessKey,
      totalRows: data.totalSubmitted,
      // JSON round-trip → plain JSON value (Prisma JSONB strict types)
      rawData: JSON.parse(JSON.stringify(data)),
      summary: {
        totalSubmitted: data.totalSubmitted,
        totalPassed: data.totalPassed,
        totalFailed: data.totalFailed,
        totalAmount: data.totalAmount,
      },
    };

    if (existing) {
      const updated = await prisma.repRecord.update({
        where: { id: existing.id },
        data: { ...payload, uploadedAt: new Date() },
      });
      audit(request, {
        action: 'rep.update_dedup',
        targetType: 'rep_record',
        targetId: updated.id,
        metadata: { businessKey, fileName: data.fileName },
      });
      return reply.code(200).send({ ...toResponse(updated), deduped: true });
    }

    const record = await prisma.repRecord.create({ data: payload });
    audit(request, {
      action: 'rep.create',
      targetType: 'rep_record',
      targetId: record.id,
      metadata: { businessKey, fileName: data.fileName },
    });
    return reply.code(201).send({ ...toResponse(record), deduped: false });
  });

  /** DELETE /api/rep/:id — :id = business_key */
  app.delete<{ Params: { id: string } }>('/rep/:id', async (request, reply) => {
    const existing = await prisma.repRecord.findFirst({
      where: { businessKey: request.params.id, deletedAt: null },
    });
    if (!existing) return reply.code(404).send({ error: 'NotFound' });
    if (!canAccessHospital(request, existing.hospitalId)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    await prisma.repRecord.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    audit(request, {
      action: 'rep.delete',
      targetType: 'rep_record',
      targetId: existing.id,
      metadata: { businessKey: request.params.id },
    });

    return reply.code(204).send();
  });
}
