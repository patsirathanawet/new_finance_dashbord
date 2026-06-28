import { sqlFormatMonth } from '../lib/sqlCompat';
import type { DbDialect } from '../lib/sqlCompat';

export type PttypeFilter = string;

function buildPttypeCondition(alias: string, pttype: PttypeFilter): string {
  return pttype.includes(',')
    ? `${alias}.pttype IN (${pttype.split(',').map(p => `'${p.trim()}'`).join(',')})`
    : `${alias}.pttype = '${pttype}'`;
}

// vn_stat มีทุกคอลัมน์ที่ต้องการ: vn, hn, vstdate, pttype, income
// ไม่จำเป็นต้อง JOIN visit table

export function buildVisitQuery(pttype: PttypeFilter, startDate: string, endDate: string, dialect: DbDialect): string {
  void dialect;
  return `
    SELECT
      COUNT(DISTINCT vs.vn) AS total_count,
      COALESCE(SUM(vs.income), 0) AS total_amount
    FROM vn_stat vs
    WHERE ${buildPttypeCondition('vs', pttype)}
      AND vs.vstdate BETWEEN '${startDate}' AND '${endDate}'
  `.trim();
}

export function buildClaimsQuery(pttype: PttypeFilter, startDate: string, endDate: string, dialect: DbDialect): string {
  void dialect;
  return `
    SELECT
      COUNT(o.vn) AS claim_count,
      COALESCE(SUM(vs.income), 0) AS claim_amount
    FROM ovst_billing o
    JOIN vn_stat vs ON vs.vn = o.vn
    WHERE ${buildPttypeCondition('vs', pttype)}
      AND vs.vstdate BETWEEN '${startDate}' AND '${endDate}'
  `.trim();
}

export function buildApprovedQuery(pttype: PttypeFilter, startDate: string, endDate: string, dialect: DbDialect): string {
  void dialect;
  return `
    SELECT
      COUNT(DISTINCT re.vn) AS approve_count,
      COALESCE(SUM(re.reimb_1_1), 0) AS approve_amount
    FROM reimbursement re
    WHERE ${buildPttypeCondition('re', pttype)}
      AND re.vstdate BETWEEN '${startDate}' AND '${endDate}'
      AND re.reimb_status = 'A'
  `.trim();
}

export function buildDeniedQuery(pttype: PttypeFilter, startDate: string, endDate: string, dialect: DbDialect): string {
  void dialect;
  return `
    SELECT
      COUNT(DISTINCT re.vn) AS deny_count,
      COALESCE(SUM(re.reimb_1_1), 0) AS deny_amount
    FROM reimbursement re
    WHERE ${buildPttypeCondition('re', pttype)}
      AND re.vstdate BETWEEN '${startDate}' AND '${endDate}'
      AND re.reimb_status = 'D'
  `.trim();
}

export function buildMonthlyTrendQuery(pttype: PttypeFilter, startDate: string, endDate: string, dialect: DbDialect): string {
  const month = sqlFormatMonth('vs.vstdate', dialect);
  // filter ผ่าน pttype.hipdata_code (กลุ่มสิทธิมาตรฐาน) แทน vs.pttype (รหัสภายในของแต่ละ รพ.)
  const codes = pttype.split(',').map((p) => `'${p.trim()}'`).join(',');
  return `
    SELECT
      ${month} AS month,
      COUNT(DISTINCT vs.vn) AS visit_count,
      COALESCE(SUM(vs.income), 0) AS total_amount
    FROM vn_stat vs
    LEFT JOIN pttype pt ON pt.pttype = vs.pttype
    WHERE pt.hipdata_code IN (${codes})
      -- WHERE ${buildPttypeCondition('vs', pttype)}  -- เงื่อนไขเดิม (เก็บไว้อ้างอิง)
      AND vs.vstdate BETWEEN '${startDate}' AND '${endDate}'
    GROUP BY ${month}
    ORDER BY month ASC
  `.trim();
}

export function buildOverviewQuery(startDate: string, endDate: string, dialect: DbDialect): string {
  void dialect; // ไม่ใช้ dialect แต่รับไว้เพื่อ API สม่ำเสมอ
  return `
    SELECT
      vs.pttype,
      pt.name AS pttype_name,
      COUNT(DISTINCT vs.vn) AS visit_count,
      COALESCE(SUM(vs.income), 0) AS total_amount
    FROM vn_stat vs
    LEFT JOIN pttype pt ON pt.pttype = vs.pttype
    WHERE vs.vstdate BETWEEN '${startDate}' AND '${endDate}'
    GROUP BY vs.pttype, pt.name
    ORDER BY total_amount DESC
  `.trim();
}

// PTTYPE constants
export const PTTYPE = {
  NHSO: "UC,UCS,WEL",
  GOVERNMENT: "OFC",
  SOCIAL: "SSI",
  INSURANCE: "LI",
  SELF_PAY: "A",
} as const;
