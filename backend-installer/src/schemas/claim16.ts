import { z } from 'zod';

/** ValidationIssue (เหมือนใน frontend types/claim16.ts) */
const validationIssueSchema = z.object({
  file: z.string(),
  row: z.number().int(),
  field: z.string(),
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string(),
  value: z.string().optional(),
});

/** Claim16Summary */
const summarySchema = z.object({
  opdVisits: z.number().int(),
  ipdAdmissions: z.number().int(),
  totalVisits: z.number().int(),
  totalAmount: z.number(),
  totalPaid: z.number(),
  importedAt: z.string().optional(),
});

/** Single 16-file payload */
const fileDataSchema = z.object({
  name: z.string(),
  rows: z.array(z.record(z.string(), z.string())),
  rowCount: z.number().int(),
});

/** สำหรับ POST /api/claim16 */
export const createClaim16Schema = z.object({
  fileName: z.string().min(1).max(500),
  hospitalCode: z.string().length(5),
  source: z.enum(['file_upload', 'hosxp_fetch']).default('file_upload'),
  totalRows: z.number().int().min(0),
  files: z.array(fileDataSchema),
  validationIssues: z.array(validationIssueSchema).default([]),
  summary: summarySchema.optional(),
  isValidated: z.boolean().default(false),
  importedAt: z.string().datetime().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

/** สำหรับ PUT /api/claim16/:id (re-validate / re-summarize) */
export const updateClaim16Schema = z.object({
  validationIssues: z.array(validationIssueSchema).optional(),
  summary: summarySchema.optional(),
  isValidated: z.boolean().optional(),
  importedAt: z.string().datetime().nullable().optional(),
});

/** Query params สำหรับ GET /api/claim16 */
export const listClaim16Schema = z.object({
  hospitalCode: z.string().length(5).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateClaim16Input = z.infer<typeof createClaim16Schema>;
export type UpdateClaim16Input = z.infer<typeof updateClaim16Schema>;
export type ListClaim16Query = z.infer<typeof listClaim16Schema>;
