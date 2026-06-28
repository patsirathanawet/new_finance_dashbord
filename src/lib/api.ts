import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { format } from 'date-fns';

// HOSxP PasteJSON endpoint สำหรับ validate session
const HOSXP_PASTE_URL = 'https://hosxp.net/phapi/PasteJSON';

let apiInstance: AxiosInstance | null = null;
let currentApiUrl: string | null = null;
let currentAuthKey: string | null = null;

export function createApiInstance(apiUrl: string, authKey: string): AxiosInstance {
  // ตัด trailing slash ออก ป้องกัน double-slash ใน URL
  const normalizedUrl = apiUrl.replace(/\/+$/, '');
  currentApiUrl = normalizedUrl;
  currentAuthKey = authKey;
  apiInstance = axios.create({
    baseURL: normalizedUrl,
    timeout: 30000,
    headers: {
      'Authorization': `Bearer ${authKey}`,
      'Content-Type': 'application/json',
    },
  });
  return apiInstance;
}

export function getApiInstance(): AxiosInstance | null {
  return apiInstance;
}

export function getCurrentApiUrl(): string | null {
  return currentApiUrl;
}

export function getCurrentAuthKey(): string | null {
  return currentAuthKey;
}

// Minify SQL — ลบ comment และ whitespace ซ้ำ
function minifySql(sql: string): string {
  return sql
    .replace(/--.*$/gm, '')           // ลบ single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // ลบ multi-line comments
    .replace(/\s+/g, ' ')             // ย่อ whitespace
    .trim();
}

/**
 * Run a SELECT query against the hospital's HOSxP DB.
 *
 * เปลี่ยนจากเดิม (HTTP → HOSxP /api/sql) → ใช้ backend proxy `/api/hosxp/query`
 * ซึ่งใช้ connection pool ที่ตั้งค่าใน DbConfigPage (encrypted in DB)
 */
export async function executeSQL<T = Record<string, unknown>>(
  sql: string
): Promise<T[]> {
  const { hosxpQuery } = await import('./backendApi');
  const minified = minifySql(sql);
  try {
    return await hosxpQuery<T>(minified);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const data = err.response?.data as { error?: string; message?: string } | undefined;
      if (err.response?.status === 412 || data?.error === 'NoConfig') {
        throw new Error(
          data?.message ?? 'ยังไม่ตั้งค่า DB connection — ไปที่หน้า "ตั้งค่าฐานข้อมูล" เพื่อตั้งค่า'
        );
      }
      if (data?.message) throw new Error(data.message);
      throw new Error(`HTTP ${err.response?.status ?? '?'}: ${err.message}`);
    }
    throw err;
  }

}

export interface SessionInfo {
  apiUrl: string;
  apiAuthKey: string;
  databaseName: string;
  databaseType: string;
  bmsUrl: string;
  bmsSessionCode: string;
  userName: string;
  location: string;
  hospitalCode: string;
}

export async function validateSession(sessionId: string): Promise<SessionInfo> {
  // เรียก HOSxP PasteJSON เพื่อ validate session และดึง connection config
  const response = await axios.get<{
    MessageCode: number;
    Message: string;
    result?: {
      user_info?: Record<string, string>;
      key_value?: Record<string, string> | string;
    };
  }>(`${HOSXP_PASTE_URL}?Action=GET&code=${encodeURIComponent(sessionId)}`, {
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' },
  });

  const body = response.data;

  if (body.MessageCode === 500) {
    throw new Error('Session หมดอายุ กรุณาขอ Session ID ใหม่');
  }
  if (body.MessageCode !== 200) {
    throw new Error(`Session ไม่ถูกต้อง (${body.MessageCode}): ${body.Message}`);
  }

  const userInfo = body.result?.user_info ?? {};
  const keyValue = body.result?.key_value;
  const kvObj = typeof keyValue === 'object' && keyValue !== null ? keyValue : {};

  // Fallback priority ตาม BMS-SESSION-HOW-TO-USE.md
  const apiUrl =
    kvObj['hosxp.api_url'] ||
    userInfo['hosxp.api_url'] ||
    userInfo['bms_url'] ||
    '';

  const apiAuthKey =
    kvObj['hosxp.api_auth_key'] ||
    userInfo['hosxp.api_auth_key'] ||
    userInfo['bms_session_code'] ||
    (typeof keyValue === 'string' ? keyValue : '') ||
    '';

  if (!apiUrl) {
    throw new Error('ไม่พบ API URL ใน session กรุณาติดต่อผู้ดูแลระบบ');
  }

  const databaseName = userInfo['bms_database_name'] || kvObj['bms_database_name'] || '';
  // Try to extract hospital code (5-digit Thai hospital code)
  const rawHcode =
    userInfo['hcode'] || userInfo['hosxp.hcode'] || userInfo['hospital_code'] ||
    kvObj['hcode'] || kvObj['hosxp.hcode'] || '';
  // Fallback: extract 5-digit number from database name (e.g. "hosxp_10673")
  const hospitalCode = rawHcode || (databaseName.match(/(\d{5})/)?.[1] ?? '');

  return {
    apiUrl,
    apiAuthKey,
    databaseName,
    databaseType: userInfo['bms_database_type'] || kvObj['bms_database_type'] || '',
    bmsUrl: userInfo['bms_url'] || apiUrl,
    bmsSessionCode: userInfo['bms_session_code'] || apiAuthKey,
    userName: userInfo['name'] || '',
    location: userInfo['location'] || '',
    hospitalCode,
  };
}

/**
 * ตรวจสอบตารางที่มีอยู่จริงใน database
 * รองรับทั้ง MySQL และ PostgreSQL ผ่าน information_schema.tables
 * (ทั้งสอง DB รองรับ standard นี้)
 */
export const OPTIONAL_TABLES = [
  'ovst_billing',   // claim submission records (MySQL HOSxP)
  'reimbursement',  // claim reimbursement (HOSxP)
  'er_regist',      // ER registration
  'an_stat',        // IPD admission stats
  'ward',           // Ward info
] as const;

export type OptionalTable = typeof OPTIONAL_TABLES[number];

export async function probeExistingTables(): Promise<string[]> {
  // ใช้ backend probe endpoint แทน — ไม่ต้องผ่าน apiInstance
  try {
    const { probeDbTables } = await import('./backendApi');
    const result = await probeDbTables({ tables: [...OPTIONAL_TABLES] });
    return Object.entries(result.tables)
      .filter(([, exists]) => exists)
      .map(([name]) => name.toLowerCase());
  } catch {
    return [];
  }
}

export function formatDateForSQL(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}
