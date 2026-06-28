/**
 * โหลด env config + validate ก่อน server start
 * Throw ถ้าค่าจำเป็นหายไป
 */
const requireEnv = (key: string): string => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env: ${key}`);
  return v;
};

const optionalEnv = (key: string, fallback: string): string => process.env[key] ?? fallback;

export const config = {
  databaseUrl: requireEnv('DATABASE_URL'),
  port: parseInt(optionalEnv('PORT', '4000'), 10),
  host: optionalEnv('HOST', '0.0.0.0'),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),
  isDev: optionalEnv('NODE_ENV', 'development') === 'development',
  jwt: {
    secret: requireEnv('JWT_SECRET'),
    expiresIn: optionalEnv('JWT_EXPIRES_IN', '12h'),
  },
  corsOrigins: optionalEnv('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  hosxpSessionUrl: optionalEnv('HOSXP_SESSION_URL', 'https://hosxp.net/phapi/PasteJSON'),
  /** ถ้า set → backend จะ serve static files จาก path นี้ (สำหรับ production single-process deploy) */
  staticDir: process.env.STATIC_DIR ?? null,
} as const;
