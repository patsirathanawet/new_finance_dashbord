import { sqlFormatMonth, sqlToday, sqlAvgLOS } from '../lib/sqlCompat';
import type { DbDialect } from '../lib/sqlCompat';

export function buildIPDAdmissionQuery(startDate: string, endDate: string, dialect: DbDialect): string {
  const today = sqlToday(dialect);
  const avgLos = sqlAvgLOS(`COALESCE(a.dchdate, ${today})`, 'a.regdate', dialect);
  return `
    SELECT
      COUNT(a.an) AS total_admissions,
      ${avgLos} AS avg_los_days
    FROM an_stat a
    WHERE a.regdate BETWEEN '${startDate}' AND '${endDate}'
  `.trim();
}

export function buildIPDFinanceQuery(startDate: string, endDate: string, dialect: DbDialect): string {
  void dialect;
  return `
    SELECT
      COALESCE(SUM(a.income), 0) AS total_income,
      COUNT(a.an) AS admission_count
    FROM an_stat a
    WHERE a.regdate BETWEEN '${startDate}' AND '${endDate}'
  `.trim();
}

export function buildIPDByFundQuery(startDate: string, endDate: string, dialect: DbDialect): string {
  const today = sqlToday(dialect);
  const avgLos = sqlAvgLOS(`COALESCE(a.dchdate, ${today})`, 'a.regdate', dialect);
  return `
    SELECT
      a.pttype,
      COUNT(a.an) AS admission_count,
      COALESCE(SUM(a.income), 0) AS total_amount,
      ${avgLos} AS avg_los
    FROM an_stat a
    WHERE a.regdate BETWEEN '${startDate}' AND '${endDate}'
    GROUP BY a.pttype
    ORDER BY admission_count DESC
  `.trim();
}

export function buildIPDMonthlyTrendQuery(startDate: string, endDate: string, dialect: DbDialect): string {
  const month = sqlFormatMonth('a.regdate', dialect);
  const today = sqlToday(dialect);
  const avgLos = sqlAvgLOS(`COALESCE(a.dchdate, ${today})`, 'a.regdate', dialect);
  return `
    SELECT
      ${month} AS month,
      COUNT(a.an) AS admission_count,
      COALESCE(SUM(a.income), 0) AS total_income,
      ${avgLos} AS avg_los
    FROM an_stat a
    WHERE a.regdate BETWEEN '${startDate}' AND '${endDate}'
    GROUP BY ${month}
    ORDER BY month ASC
  `.trim();
}
