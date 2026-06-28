import { PrismaClient } from '@prisma/client';
import { config } from './config.js';

/** Singleton PrismaClient — สำคัญเพื่อไม่เปิด pool ซ้ำตอน hot-reload */
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: config.isDev ? ['warn', 'error'] : ['error'],
  });

if (config.isDev) global.__prisma = prisma;
