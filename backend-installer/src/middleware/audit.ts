import type { FastifyRequest } from 'fastify';
import { prisma } from '../db.js';

interface AuditInput {
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/** บันทึก audit log แบบ fire-and-forget — ไม่ block response */
export function audit(request: FastifyRequest, input: AuditInput): void {
  const userId = request.auth?.userId ?? null;
  const hospitalId = request.auth?.hospitalId ?? null;
  const ip = request.ip || null;
  const ua = request.headers['user-agent'] ?? null;

  prisma.auditLog
    .create({
      data: {
        userId,
        hospitalId,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        ipAddress: ip,
        userAgent: ua,
        metadata: input.metadata ? (input.metadata as object) : undefined,
      },
    })
    .catch((err) => {
      request.log.warn({ err }, 'audit log write failed');
    });
}
