import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { requireAuth, canAccessHospital } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { computeContentHash } from '../services/contentHash.js';
import {
  createClaim16Schema,
  updateClaim16Schema,
  listClaim16Schema,
} from '../schemas/claim16.js';

export async function claim16Routes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** GET /api/claim16 — list (filter by hospital, paginate) */
  app.get('/claim16', async (request, reply) => {
    const parsed = listClaim16Schema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
    }
    const { hospitalCode, limit, offset } = parsed.data;
    const auth = request.auth!;

    // Non-admin → จำกัดเฉพาะของ รพ. ตัวเอง
    const code = auth.role === 'admin' ? hospitalCode : auth.hospitalCode;

    const where = {
      deletedAt: null,
      ...(code ? { hospitalCode: code } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.claim16Record.findMany({
        where,
        orderBy: { uploadedAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          hospitalCode: true,
          fileName: true,
          source: true,
          totalRows: true,
          fileCount: true,
          errorCount: true,
          warningCount: true,
          isValidated: true,
          importedAt: true,
          uploadedAt: true,
          uploadedByName: true,
          summary: true,
        },
      }),
      prisma.claim16Record.count({ where }),
    ]);

    return { items, total, limit, offset };
  });

  /** GET /api/claim16/:id — full record รวม raw_data + issues */
  app.get<{ Params: { id: string } }>('/claim16/:id', async (request, reply) => {
    const record = await prisma.claim16Record.findFirst({
      where: { id: request.params.id, deletedAt: null },
    });
    if (!record) return reply.code(404).send({ error: 'NotFound' });
    if (!canAccessHospital(request, record.hospitalId)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    return record;
  });

  /** POST /api/claim16 — create new record */
  app.post('/claim16', async (request, reply) => {
    const parsed = createClaim16Schema.safeParse(request.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const path = first.path.join('.');
      return reply.code(400).send({
        error: 'BadRequest',
        message: `ข้อมูลไม่ถูกต้อง: ${path} — ${first.message}`,
        issues: parsed.error.issues,
      });
    }
    const data = parsed.data;
    const auth = request.auth!;

    // ตรวจว่า user มีสิทธิ์ upload เข้า รพ. นี้
    if (auth.role !== 'admin' && data.hospitalCode !== auth.hospitalCode) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'ไม่อนุญาตให้บันทึกข้อมูลของโรงพยาบาลอื่น',
      });
    }

    // หา hospital จากรหัส
    const hospital = await prisma.hospital.findUnique({ where: { code: data.hospitalCode } });
    if (!hospital) {
      return reply.code(404).send({
        error: 'HospitalNotFound',
        message: `ไม่พบโรงพยาบาลรหัส ${data.hospitalCode}`,
      });
    }

    const errorCount = data.validationIssues.filter((i) => i.severity === 'error').length;
    const warningCount = data.validationIssues.filter((i) => i.severity === 'warning').length;
    const rawData = { files: data.files };
    const contentHash = computeContentHash(rawData);

    // ตรวจหา record เดิมที่ hash ตรงกัน + รพ. เดียวกัน
    const existing = await prisma.claim16Record.findFirst({
      where: {
        hospitalCode: data.hospitalCode,
        contentHash,
        deletedAt: null,
      },
    });

    if (existing) {
      // อัปเดต record เดิม (refresh validation/summary/uploadedBy/timestamp)
      const updated = await prisma.claim16Record.update({
        where: { id: existing.id },
        data: {
          uploadedByUserId: auth.userId,
          uploadedByName: auth.name,
          source: data.source,
          fileName: data.fileName,
          totalRows: data.totalRows,
          fileCount: data.files.length,
          errorCount,
          warningCount,
          isValidated: data.isValidated,
          importedAt: data.importedAt ? new Date(data.importedAt) : null,
          validationIssues: data.validationIssues,
          summary: data.summary ?? undefined,
          dateFrom: data.dateFrom ? new Date(data.dateFrom) : null,
          dateTo: data.dateTo ? new Date(data.dateTo) : null,
          uploadedAt: new Date(),
        },
      });
      audit(request, {
        action: 'claim16.update_dedup',
        targetType: 'claim16_record',
        targetId: updated.id,
        metadata: { contentHash, fileName: data.fileName, totalRows: data.totalRows },
      });
      // ตอบ 200 พร้อม flag deduped: true
      return reply.code(200).send({ ...updated, deduped: true });
    }

    const record = await prisma.claim16Record.create({
      data: {
        hospitalId: hospital.id,
        uploadedByUserId: auth.userId,
        uploadedByName: auth.name,
        source: data.source,
        fileName: data.fileName,
        hospitalCode: data.hospitalCode,
        totalRows: data.totalRows,
        fileCount: data.files.length,
        errorCount,
        warningCount,
        isValidated: data.isValidated,
        importedAt: data.importedAt ? new Date(data.importedAt) : null,
        rawData,
        contentHash,
        validationIssues: data.validationIssues,
        summary: data.summary ?? undefined,
        dateFrom: data.dateFrom ? new Date(data.dateFrom) : null,
        dateTo: data.dateTo ? new Date(data.dateTo) : null,
      },
    });

    audit(request, {
      action: 'claim16.create',
      targetType: 'claim16_record',
      targetId: record.id,
      metadata: { fileName: record.fileName, totalRows: record.totalRows, contentHash },
    });

    return reply.code(201).send({ ...record, deduped: false });
  });

  /** PUT /api/claim16/:id — update (re-validate / set summary) */
  app.put<{ Params: { id: string } }>('/claim16/:id', async (request, reply) => {
    const parsed = updateClaim16Schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', issues: parsed.error.issues });
    }

    const existing = await prisma.claim16Record.findFirst({
      where: { id: request.params.id, deletedAt: null },
    });
    if (!existing) return reply.code(404).send({ error: 'NotFound' });
    if (!canAccessHospital(request, existing.hospitalId)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const data = parsed.data;
    const update: Record<string, unknown> = {};

    if (data.validationIssues !== undefined) {
      update.validationIssues = data.validationIssues;
      update.errorCount = data.validationIssues.filter((i) => i.severity === 'error').length;
      update.warningCount = data.validationIssues.filter((i) => i.severity === 'warning').length;
    }
    if (data.summary !== undefined) update.summary = data.summary;
    if (data.isValidated !== undefined) update.isValidated = data.isValidated;
    if (data.importedAt !== undefined) {
      update.importedAt = data.importedAt ? new Date(data.importedAt) : null;
    }

    const record = await prisma.claim16Record.update({
      where: { id: request.params.id },
      data: update,
    });

    audit(request, {
      action: 'claim16.update',
      targetType: 'claim16_record',
      targetId: record.id,
    });

    return record;
  });

  /** DELETE /api/claim16/:id — soft delete */
  app.delete<{ Params: { id: string } }>('/claim16/:id', async (request, reply) => {
    const existing = await prisma.claim16Record.findFirst({
      where: { id: request.params.id, deletedAt: null },
    });
    if (!existing) return reply.code(404).send({ error: 'NotFound' });
    if (!canAccessHospital(request, existing.hospitalId)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    await prisma.claim16Record.update({
      where: { id: request.params.id },
      data: { deletedAt: new Date() },
    });

    audit(request, {
      action: 'claim16.delete',
      targetType: 'claim16_record',
      targetId: request.params.id,
    });

    return reply.code(204).send();
  });
}
