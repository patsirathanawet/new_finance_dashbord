/**
 * SQL Dialect Compatibility Layer
 * รองรับทั้ง MySQL และ PostgreSQL
 */

export type DbDialect = 'mysql' | 'postgresql';

/** แปลง bms_database_type string เป็น DbDialect */
export function resolveDialect(raw?: string | null): DbDialect {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('postgres') || s.includes('pg') || s === 'pgsql') return 'postgresql';
  return 'mysql'; // default
}

/** FORMAT วันที่เป็น YYYY-MM สำหรับ GROUP BY เดือน */
export function sqlFormatMonth(col: string, d: DbDialect): string {
  return d === 'postgresql'
    ? `TO_CHAR(${col}, 'YYYY-MM')`
    : `DATE_FORMAT(${col}, '%Y-%m')`;
}

/** วันที่ปัจจุบัน */
export function sqlToday(d: DbDialect): string {
  return d === 'postgresql' ? 'CURRENT_DATE' : 'CURDATE()';
}

/**
 * จำนวนวันระหว่างสองวันที่ (date1 - date2)
 * ผลเป็น numeric (อาจ decimal สำหรับ PG)
 */
export function sqlDateDiffDays(date1: string, date2: string, d: DbDialect): string {
  return d === 'postgresql'
    ? `EXTRACT(epoch FROM (${date1}::timestamp - ${date2}::timestamp)) / 86400.0`
    : `DATEDIFF(${date1}, ${date2})`;
}

/** ROUND ที่ใช้ได้ทั้งสอง DB */
export function sqlRound(expr: string, decimals: number, d: DbDialect): string {
  return d === 'postgresql'
    ? `ROUND((${expr})::numeric, ${decimals})`
    : `ROUND(${expr}, ${decimals})`;
}

/**
 * AVG LOS (Length of Stay) ในวัน
 * รับ date1 = วันจำหน่าย (หรือ today), date2 = วันรับเข้า
 */
export function sqlAvgLOS(date1: string, date2: string, d: DbDialect): string {
  const diff = sqlDateDiffDays(date1, date2, d);
  return sqlRound(`AVG(${diff})`, 1, d);
}
