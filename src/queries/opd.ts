import { sqlFormatMonth } from '../lib/sqlCompat';
import type { DbDialect } from '../lib/sqlCompat';

export function buildOPDVisitQuery(startDate: string, endDate: string, dialect: DbDialect): string {
  void dialect;
  return `
    SELECT
      COUNT(DISTINCT vs.vn) AS total_visits,
      COUNT(DISTINCT vs.hn) AS unique_patients
    FROM vn_stat vs
    WHERE vs.vstdate BETWEEN '${startDate}' AND '${endDate}'
  `.trim();
}

export function buildOPDByDepartmentQuery(startDate: string, endDate: string, dialect: DbDialect): string {
  void dialect;
  return `
    SELECT
      vs.main_dep AS department_name,
      COUNT(DISTINCT vs.vn) AS visit_count
    FROM vn_stat vs
    WHERE vs.vstdate BETWEEN '${startDate}' AND '${endDate}'
      AND vs.main_dep IS NOT NULL
    GROUP BY vs.main_dep
    ORDER BY visit_count DESC
    LIMIT 10
  `.trim();
}

export function buildOPDMonthlyTrendQuery(startDate: string, endDate: string, dialect: DbDialect): string {
  const month = sqlFormatMonth('vs.vstdate', dialect);
  return `
    SELECT
      ${month} AS month,
      COUNT(DISTINCT vs.vn) AS visit_count,
      COUNT(DISTINCT vs.hn) AS unique_patients
    FROM vn_stat vs
    WHERE vs.vstdate BETWEEN '${startDate}' AND '${endDate}'
    GROUP BY ${month}
    ORDER BY month ASC
  `.trim();
}

export function buildOPDByFundQuery(startDate: string, endDate: string, dialect: DbDialect): string {
  void dialect;
  return `
    SELECT
      vs.pttype,
      COUNT(DISTINCT vs.vn) AS visit_count,
      COALESCE(SUM(vs.income), 0) AS total_amount
    FROM vn_stat vs
    WHERE vs.vstdate BETWEEN '${startDate}' AND '${endDate}'
    GROUP BY vs.pttype
    ORDER BY visit_count DESC
  `.trim();
}
