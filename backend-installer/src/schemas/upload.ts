import { z } from 'zod';

/**
 * REP / STM record schemas — เก็บ raw record ทั้งก้อนใน rawData JSONB
 * (ไม่ validate field ละเอียดเพราะมีหลาย format)
 */

/** REP — frontend ส่ง record ทั้งก้อนรวม id (= hospitalCode_batchNo) */
export const repRecordSchema = z.object({
  id: z.string().min(1).max(200),                // business_key
  hospitalCode: z.string().length(5),
  hospitalName: z.string().optional(),
  batchNo: z.string().min(1),
  refNo: z.string().optional(),
  issueDate: z.string().optional(),
  totalSubmitted: z.number().int().nonnegative().optional().default(0),
  totalPassed: z.number().int().nonnegative().optional().default(0),
  totalFailed: z.number().int().nonnegative().optional().default(0),
  totalAmount: z.number().nonnegative().optional().default(0),
  amountRoom: z.number().nonnegative().optional().default(0),
  amountTreatment: z.number().nonnegative().optional().default(0),
  cases: z.array(z.unknown()).optional().default([]),
  batchRefs: z.array(z.string()).optional().default([]),
  fileName: z.string().optional().default(''),
  uploadedAt: z.string().optional(),
  uploadedBy: z.string().optional().default(''),
  fundType: z.string().optional().default('NHSO'),
});

export type RepRecordInput = z.infer<typeof repRecordSchema>;

export const stmRecordSchema = z.object({
  id: z.string().min(1).max(200),                // business_key
  hospitalCode: z.string().length(5),
  hospitalName: z.string().optional(),
  docNo: z.string().min(1),
  period: z.string().optional(),
  stmType: z.string().optional().default('OTHER'),
  issueDate: z.string().optional(),
  totalCases: z.number().int().nonnegative().optional().default(0),
  totalAmount: z.number().nonnegative().optional().default(0),
  passedCases: z.number().int().nonnegative().optional(),
  failedCases: z.number().int().nonnegative().optional(),
  cases: z.array(z.unknown()).optional().default([]),
  fileName: z.string().optional().default(''),
  uploadedAt: z.string().optional(),
  uploadedBy: z.string().optional().default(''),
  fundType: z.string().optional().default('NHSO'),
});

export type StmRecordInput = z.infer<typeof stmRecordSchema>;

export const listUploadQuerySchema = z.object({
  hospitalCode: z.string().length(5).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});
