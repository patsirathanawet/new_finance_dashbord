import { createHash } from 'node:crypto';

/**
 * คำนวณ SHA-256 hash ของ rawData (16 files data)
 * - Stable: same content = same hash
 * - Order-independent? NO — JSON.stringify ขึ้นกับ key order ดังนั้น sort key ก่อน
 * - Hash เฉพาะ files content ไม่รวม metadata เช่น uploadedAt
 */
export function computeContentHash(rawData: unknown): string {
  const stable = stableStringify(rawData);
  return createHash('sha256').update(stable, 'utf8').digest('hex');
}

/** JSON.stringify ที่ sort keys เพื่อให้ output deterministic */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}
