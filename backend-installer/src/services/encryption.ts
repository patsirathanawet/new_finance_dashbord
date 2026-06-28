import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../config.js';

/**
 * AES-256-GCM encryption for sensitive config values (DB passwords)
 * Key derived from JWT_SECRET via scrypt (stable, deterministic)
 *
 * Output format (hex):
 *   IV (12 bytes / 24 hex) + AuthTag (16 bytes / 32 hex) + Ciphertext
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;          // 256 bits
const IV_LENGTH = 12;           // GCM standard
const SALT = 'bms-finance-db-config-v1';  // fixed salt — key is deterministic per JWT_SECRET

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  cachedKey = scryptSync(config.jwt.secret, SALT, KEY_LENGTH);
  return cachedKey;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('hex');
}

export function decrypt(encryptedHex: string): string {
  const buf = Buffer.from(encryptedHex, 'hex');
  if (buf.length < IV_LENGTH + 16 + 1) {
    throw new Error('Invalid encrypted payload (too short)');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = buf.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/** ปกปิด password เพื่อ return ให้ client (เห็นแค่ความยาว ไม่เห็นค่าจริง) */
export function maskPassword(plaintext: string): string {
  if (!plaintext) return '';
  return '•'.repeat(Math.min(plaintext.length, 12));
}
