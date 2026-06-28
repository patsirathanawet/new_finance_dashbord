import { sqlFormatMonth, sqlToday, sqlAvgLOS } from '../lib/sqlCompat';
import type { DbDialect } from '../lib/sqlCompat';

export function buildTotalBedsQuery(): string {
  return `SELECT COALESCE(SUM(bedcount), 0) AS total_beds FROM ward WHERE ward_active = 'Y'`;
}

export function buildOccupiedBedsQuery(): string {
  return `SELECT COUNT(a.an) AS occupied_beds FROM an_stat a WHERE a.dchdate IS NULL`;
}

export function buildAdmissionsByWardQuery(startDate: string, endDate: string, dialect: DbDialect): string {
  const today = sqlToday(dialect);
  const avgLos = sqlAvgLOS(`COALESCE(a.dchdate, ${today})`, 'a.regdate', dialect);
  return `
    SELECT
      w.name AS ward_name,
      COUNT(a.an) AS admission_count,
      ${avgLos} AS avg_los_days
    FROM an_stat a
    JOIN ward w ON w.ward = a.ward
    WHERE a.regdate BETWEEN '${startDate}' AND '${endDate}'
    GROUP BY w.ward, w.name
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
      ${avgLos} AS avg_los
    FROM an_stat a
    WHERE a.regdate BETWEEN '${startDate}' AND '${endDate}'
    GROUP BY ${month}
    ORDER BY month ASC
  `.trim();
}

export function buildCurrentIPDQuery(): string {
  return `
    SELECT
      w.name AS ward_name,
      COUNT(a.an) AS current_patients,
      w.bedcount AS total_beds
    FROM an_stat a
    JOIN ward w ON w.ward = a.ward
    WHERE a.dchdate IS NULL
    GROUP BY w.ward, w.name, w.bedcount
    ORDER BY current_patients DESC
  `.trim();
}
