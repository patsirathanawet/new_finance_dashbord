import type { FastifyReply, FastifyRequest } from 'fastify';

/** Pre-handler: บังคับให้ request ต้องมี JWT ที่ valid */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    request.auth = request.user;
  } catch {
    reply.code(401).send({ error: 'Unauthorized', message: 'Token หมดอายุหรือไม่ถูกต้อง' });
  }
}

/** Pre-handler: บังคับ role admin เท่านั้น (ใช้ต่อจาก requireAuth) */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.auth?.role !== 'admin') {
    reply.code(403).send({ error: 'Forbidden', message: 'ต้องเป็น admin เท่านั้น' });
  }
}

/** Helper: ตรวจว่า request นี้มีสิทธิ์เข้าถึง record ของโรงพยาบาลนี้ไหม */
export function canAccessHospital(request: FastifyRequest, hospitalId: string): boolean {
  if (!request.auth) return false;
  if (request.auth.role === 'admin') return true;
  return request.auth.hospitalId === hospitalId;
}
