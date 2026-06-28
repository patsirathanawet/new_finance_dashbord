import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({
    status: 'ok',
    time: new Date().toISOString(),
    version: '0.1.0',
  }));

  app.get('/health/db', async (_req, reply) => {
    try {
      const r = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
      return { status: 'ok', db: 'connected', test: r[0]?.ok === 1 };
    } catch (err) {
      reply.code(503);
      return { status: 'error', db: 'disconnected', error: String(err) };
    }
  });
}
