import { config } from '../config.js';

interface HosxpSessionResponse {
  MessageCode: number;
  Message: string;
  result?: {
    user_info?: Record<string, string>;
    key_value?: Record<string, string> | string;
  };
}

export interface HosxpSessionInfo {
  userName: string;
  userKey: string;          // doctor_code หรือเทียบเท่า
  hospitalCode: string;     // 5-digit
  hospitalName: string;
}

/**
 * Validate BMS session กับ HOSxP — คืนข้อมูล user/hospital
 * ใช้ตอน frontend login → backend สร้าง JWT
 */
export async function validateHosxpSession(sessionId: string): Promise<HosxpSessionInfo> {
  const url = `${config.hosxpSessionUrl}?Action=GET&code=${encodeURIComponent(sessionId)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`HOSxP session check failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as HosxpSessionResponse;

  if (body.MessageCode === 500) {
    throw new Error('SESSION_EXPIRED');
  }
  if (body.MessageCode !== 200) {
    throw new Error(`HOSxP session error: ${body.MessageCode} ${body.Message}`);
  }

  const userInfo = body.result?.user_info ?? {};
  const kv = (typeof body.result?.key_value === 'object' ? body.result.key_value : {}) as Record<string, string>;

  const dbName = userInfo['bms_database_name'] || kv['bms_database_name'] || '';
  const rawHcode =
    userInfo['hcode'] || userInfo['hosxp.hcode'] || userInfo['hospital_code'] ||
    kv['hcode'] || kv['hosxp.hcode'] || '';
  const hospitalCode = rawHcode || (dbName.match(/(\d{5})/)?.[1] ?? '');

  if (!hospitalCode) {
    throw new Error('ไม่พบรหัสโรงพยาบาลใน HOSxP session');
  }

  return {
    userName: userInfo['name'] || 'Unknown',
    userKey: userInfo['doctor_code'] || userInfo['user_code'] || userInfo['name'] || hospitalCode,
    hospitalCode,
    hospitalName: userInfo['location'] || `รพ. ${hospitalCode}`,
  };
}
