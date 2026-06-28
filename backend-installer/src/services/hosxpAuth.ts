/**
 * HOSxP user authentication — 2-stage lookup
 *  Stage 1: officer table (officer_login_name + officer_login_password_md5)
 *  Stage 2: opduser table (loginname + passweb) — fallback ถ้าหาใน officer ไม่เจอ
 *
 *  เทียบ MD5(input) (upper-case) กับ column _md5 / passweb
 *  หมายเหตุ: officer_login_password / opduser.password เก็บเป็น BMS proprietary encryption
 *  (fixed-prefix hex 70-72 ตัว) ที่ไม่มี algorithm เปิดเผย — HOSxP เองก็เทียบกับ MD5 column
 */
import { createHash } from 'node:crypto';
import { runQuery, type DbType } from './hosxpPool.js';
import type { Pool as PgPool } from 'pg';
import type { Pool as MySqlPool } from 'mysql2/promise';

type CachedPool = { type: DbType; pool: PgPool | MySqlPool };

function sqlEsc(s: string): string {
  return s.replace(/'/g, "''");
}

function md5Upper(s: string): string {
  return createHash('md5').update(s, 'utf8').digest('hex').toUpperCase();
}

export interface HosxpAuthResult {
  ok: boolean;
  loginname?: string;
  userCode?: string;
  fullName?: string;
  position?: string;
  method?: string;
  error?: string;
}

/** Stage 1: ตรวจที่ officer table */
async function authFromOfficer(
  cached: CachedPool,
  username: string,
  password: string,
): Promise<{ found: boolean; result?: HosxpAuthResult }> {
  const escUser = sqlEsc(username);
  const expectMd5 = md5Upper(password);

  const concatFullName = cached.type === 'postgresql'
    ? "COALESCE(NULLIF(officer_pname || officer_fname || ' ' || officer_lname, ''), officer_name, officer_login_name)"
    : "COALESCE(NULLIF(CONCAT(officer_pname, officer_fname, ' ', officer_lname), ''), officer_name, officer_login_name)";

  const sql = `
    SELECT officer_login_name,
           officer_login_password_md5,
           ${concatFullName} AS full_name,
           COALESCE(officer_doctor_code, '') AS user_code
    FROM officer
    WHERE officer_login_name = '${escUser}'
    LIMIT 1
  `;
  try {
    const r = await runQuery(cached, sql);
    if (r.rows.length === 0) return { found: false };

    const row = r.rows[0];
    const storedMd5 = String(row.officer_login_password_md5 ?? '').toUpperCase();
    if (!storedMd5) {
      // มี user แต่ไม่มี md5 → fail (ไม่ต้อง fallback ไป opduser เพราะ user เจอแล้ว)
      return { found: true, result: { ok: false, error: 'username หรือ password ไม่ถูกต้อง' } };
    }

    if (storedMd5 === expectMd5) {
      return {
        found: true,
        result: {
          ok: true,
          loginname: String(row.officer_login_name ?? username),
          userCode: String(row.user_code ?? username),
          fullName: String(row.full_name ?? username),
          position: '',
          method: 'officer.md5',
        },
      };
    }
    return { found: true, result: { ok: false, error: 'username หรือ password ไม่ถูกต้อง' } };
  } catch (err) {
    // ตาราง officer อาจไม่มี — return found:false เพื่อ fallback
    const msg = err instanceof Error ? err.message : String(err);
    if (/relation .* does not exist|Table .* doesn't exist/i.test(msg)) {
      return { found: false };
    }
    throw err;
  }
}

/** Stage 2: ตรวจที่ opduser table (เทียบกับ passweb = MD5 32 hex) */
async function authFromOpduser(
  cached: CachedPool,
  username: string,
  password: string,
): Promise<HosxpAuthResult> {
  const escUser = sqlEsc(username);
  const expectMd5 = md5Upper(password);

  const fullName = cached.type === 'postgresql'
    ? "COALESCE(name, loginname)"
    : "COALESCE(name, loginname)";
  const userCode = "COALESCE(doctorcode, staffcode, loginname)";

  const sql = `
    SELECT loginname,
           passweb,
           ${fullName} AS full_name,
           ${userCode} AS user_code,
           COALESCE(position, '') AS position_name
    FROM opduser
    WHERE loginname = '${escUser}'
    LIMIT 1
  `;
  try {
    const r = await runQuery(cached, sql);
    if (r.rows.length === 0) {
      return { ok: false, error: 'username หรือ password ไม่ถูกต้อง' };
    }
    const row = r.rows[0];
    const storedMd5 = String(row.passweb ?? '').toUpperCase();
    if (storedMd5 && storedMd5 === expectMd5) {
      return {
        ok: true,
        loginname: String(row.loginname ?? username),
        userCode: String(row.user_code ?? username),
        fullName: String(row.full_name ?? username),
        position: String(row.position_name ?? ''),
        method: 'opduser.passweb',
      };
    }
    return { ok: false, error: 'username หรือ password ไม่ถูกต้อง' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? `opduser query failed: ${err.message}` : 'opduser query failed',
    };
  }
}

/**
 * Authenticate — ลอง officer ก่อน, ถ้าไม่เจอ user ค่อย fallback opduser
 */
export async function authenticateHosxpUser(
  cached: CachedPool,
  username: string,
  password: string,
): Promise<HosxpAuthResult> {
  if (!username || !password) {
    return { ok: false, error: 'username/password ว่าง' };
  }

  // Stage 1: officer
  const officerOutcome = await authFromOfficer(cached, username, password);
  if (officerOutcome.found && officerOutcome.result) {
    return officerOutcome.result;
  }

  // Stage 2: opduser (เฉพาะกรณีไม่เจอ user ใน officer)
  return await authFromOpduser(cached, username, password);
}

/** ดึง hospitalcode + hospitalname จาก opdconfig */
export async function getHospitalFromOpdConfig(
  cached: CachedPool,
): Promise<{ code: string; name: string } | null> {
  try {
    const result = await runQuery(cached, 'SELECT hospitalcode, hospitalname FROM opdconfig LIMIT 1');
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      code: String(row.hospitalcode ?? ''),
      name: String(row.hospitalname ?? ''),
    };
  } catch {
    return null;
  }
}
