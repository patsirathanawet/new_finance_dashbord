import { sqlFormatMonth, sqlRound } from '../lib/sqlCompat';
import type { DbDialect } from '../lib/sqlCompat';

export function buildERDoorToDoctorQuery(startDate: string, endDate: string, dialect: DbDialect): string {
  return `
    SELECT
      ${sqlRound('AVG(e.door_to_doctor_second / 60.0)', 1, dialect)} AS average_door_to_doctor_minutes
    FROM er_regist e
    WHERE e.vstdate BETWEEN '${startDate}' AND '${endDate}'
      AND e.door_to_doctor_second IS NOT NULL
  `.trim();
}

export function buildERLOSQuery(startDate: string, endDate: string, dialect: DbDialect): string {
  return `
    SELECT
      ${sqlRound('AVG(e.length_of_stay_second / 60.0)', 1, dialect)} AS average_length_of_stay_minutes
    FROM er_regist e
    WHERE e.vstdate BETWEEN '${startDate}' AND '${endDate}'
      AND e.length_of_stay_second IS NOT NULL
  `.trim();
}

export function buildERLWBSQuery(startDate: string, endDate: string, dialect: DbDialect): string {
  void dialect;
  return `
    SELECT
      COUNT(e.vn) AS left_without_being_seen_count
    FROM er_regist e
    WHERE e.vstdate BETWEEN '${startDate}' AND '${endDate}'
      AND e.er_result_code = 'LWBS'
  `.trim();
}

export function buildERVisitCountQuery(startDate: string, endDate: string, dialect: DbDialect): string {
  void dialect;
  return `
    SELECT
      COUNT(e.vn) AS total_er_visits,
      COUNT(CASE WHEN e.er_result_code = 'ADMIT' THEN 1 END) AS admitted_count,
      COUNT(CASE WHEN e.er_result_code = 'DISCHARGE' THEN 1 END) AS discharged_count
    FROM er_regist e
    WHERE e.vstdate BETWEEN '${startDate}' AND '${endDate}'
  `.trim();
}

export function buildERTriageQuery(startDate: string, endDate: string, dialect: DbDialect): string {
  void dialect;
  return `
    SELECT
      e.triage_level,
      COUNT(e.vn) AS count
    FROM er_regist e
    WHERE e.vstdate BETWEEN '${startDate}' AND '${endDate}'
      AND e.triage_level IS NOT NULL
    GROUP BY e.triage_level
    ORDER BY e.triage_level ASC
  `.trim();
}

export function buildERMonthlyTrendQuery(startDate: string, endDate: string, dialect: DbDialect): string {
  const month = sqlFormatMonth('e.vstdate', dialect);
  return `
    SELECT
      ${month} AS month,
      COUNT(e.vn) AS visit_count,
      ${sqlRound('AVG(e.door_to_doctor_second / 60.0)', 1, dialect)} AS avg_door_to_doctor,
      ${sqlRound('AVG(e.length_of_stay_second / 60.0)', 1, dialect)} AS avg_los
    FROM er_regist e
    WHERE e.vstdate BETWEEN '${startDate}' AND '${endDate}'
    GROUP BY ${month}
    ORDER BY month ASC
  `.trim();
}
