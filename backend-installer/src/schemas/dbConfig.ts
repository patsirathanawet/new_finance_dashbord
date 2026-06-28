import { z } from 'zod';

/** Default required tables — admin เพิ่ม/แก้ได้ในหน้า config */
export const DEFAULT_REQUIRED_TABLES = [
  'patient',
  'vn_stat',
  'ovst',
  'ipt',
  'an_stat',
  'opitemrece',
  'pttype',
  'pname',
  'ovst_billing',
  'reimbursement',
  'er_regist',
  'ward',
] as const;

export const dbConfigInputSchema = z.object({
  dbType: z.enum(['mysql', 'postgresql']),
  host: z.string().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().min(1).max(100),
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(500),
  requiredTables: z.array(z.string().min(1).max(100)).optional(),
});

export const dbConfigTestSchema = dbConfigInputSchema.pick({
  dbType: true,
  host: true,
  port: true,
  database: true,
  username: true,
  password: true,
});

export const probeTablesSchema = z.object({
  tables: z.array(z.string().min(1).max(100)).min(1),
});

export const querySchema = z.object({
  sql: z.string().min(1).max(20_000),
});

export type DbConfigInput = z.infer<typeof dbConfigInputSchema>;
export type DbConfigTestInput = z.infer<typeof dbConfigTestSchema>;
