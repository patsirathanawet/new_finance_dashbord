import 'dotenv/config';
import { resolve, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { prisma } from './db.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { claim16Routes } from './routes/claim16.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { repRoutes } from './routes/rep.js';
import { stmRoutes } from './routes/stm.js';
import { dbConfigRoutes, publicSetupRoutes } from './routes/dbConfig.js';
import { claimDbConfigRoutes } from './routes/claimDbConfig.js';
import { claimImportRoutes } from './routes/claimImport.js';
import { claimQueryRoutes } from './routes/claimQuery.js';
import { hosxpRoutes } from './routes/hosxp.js';
import { closeAllPools } from './services/hosxpPool.js';
import './types.js';

// ── Schema migration on startup (no-op if already in sync) ──
const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '..');
const schemaFile  = join(backendRoot, 'prisma', 'schema.prisma');
const prismaBin   = join(backendRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
if (existsSync(schemaFile) && existsSync(prismaBin)) {
  try {
    execFileSync(prismaBin, ['db', 'push', '--schema', schemaFile, '--skip-generate', '--accept-data-loss'], {
      env: process.env,
      stdio: 'pipe',
      timeout: 60_000,
    });
  } catch { /* tables already exist or non-fatal */ }
}

const app = Fastify({
  logger: config.isDev
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
    : true,
  trustProxy: true,
  bodyLimit: 50 * 1024 * 1024, // 50MB — รองรับ 16 แฟ้มขนาดใหญ่
});

await app.register(cors, {
  origin: config.corsOrigins,
  credentials: true,
});

await app.register(jwt, {
  secret: config.jwt.secret,
  sign: { expiresIn: config.jwt.expiresIn },
});

// Routes — ทั้งหมดอยู่ใต้ /api
await app.register(
  async (api) => {
    await api.register(healthRoutes);
    await api.register(authRoutes);
    await api.register(publicSetupRoutes);  // public — ใช้ก่อน login ได้
    await api.register(claim16Routes);
    await api.register(dashboardRoutes);
    await api.register(repRoutes);
    await api.register(stmRoutes);
    await api.register(dbConfigRoutes);
    await api.register(claimDbConfigRoutes);
    await api.register(claimImportRoutes);
    await api.register(claimQueryRoutes);
    await api.register(hosxpRoutes);
  },
  { prefix: '/api' },
);

// Production: serve frontend dist + SPA fallback
if (config.staticDir) {
  const staticRoot = resolve(config.staticDir);
  if (!existsSync(staticRoot)) {
    app.log.warn({ staticRoot }, 'STATIC_DIR ไม่มีอยู่ — ข้าม static serving');
  } else {
    await app.register(fastifyStatic, {
      root: staticRoot,
      prefix: '/',
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'NotFound', path: request.url });
      }
      return reply.sendFile('index.html');
    });
    app.log.info({ staticRoot }, 'Serving frontend from STATIC_DIR');
  }
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down...');
  await app.close();
  await closeAllPools();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`API ready at http://${config.host}:${config.port}/api`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
