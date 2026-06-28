/**
 * รายชื่อ error code จาก eClaim NHSO + คำอธิบาย
 *
 * ★ วิธีเพิ่มรหัสใหม่ — แก้ไขไฟล์นี้แล้วใส่บรรทัด:
 *     '301': 'คำอธิบายของรหัส 301...',
 *
 * ★ รหัสที่ไม่อยู่ในนี้ — ระบบจะแสดงแค่ตัวรหัสเฉยๆ (เช่น "307")
 */

export const ECLAIM_ERROR_CODES: Record<string, string> = {
  '305': 'Approve Code ที่บันทึกเบิกในโปรแกรม e-Claim ไม่ตรงกันฐานข้อมูล EDC ของหน่วยบริการ',

  // เพิ่มรหัสอื่นๆ ตามไฟล์อ้างอิงของ สปสช. ที่ตรงกับโรงพยาบาล:
  // '301': '...',
  // '302': '...',
  // '307': '...',
};

/** คืนข้อความ "code : description" หรือ "code" ถ้าไม่มีใน dict */
export function formatErrorCode(code: string): string {
  const desc = ECLAIM_ERROR_CODES[code];
  return desc ? `${code} : ${desc}` : code;
}

/** คืนเฉพาะคำอธิบาย หรือ null ถ้าไม่มี */
export function getErrorDescription(code: string): string | null {
  return ECLAIM_ERROR_CODES[code] ?? null;
}
