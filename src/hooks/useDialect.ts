import { useQuery } from '@tanstack/react-query';
import { useSessionStore } from '../store/sessionStore';
import { resolveDialect } from '../lib/sqlCompat';
import type { DbDialect } from '../lib/sqlCompat';
import { getDbConfig } from '../lib/backendApi';

/**
 * ดึง DB dialect สำหรับ query builders
 * Priority:
 *   1. db_config.dbType (admin ตั้งใน /settings/db-config) — source of truth ของ HOSxP จริง
 *   2. BMS session databaseType — fallback ถ้ายังไม่ได้ตั้ง db_config
 *   3. 'mysql' default
 */
export function useDialect(): DbDialect {
  const databaseType = useSessionStore((s) => s.databaseType);
  const apiToken = useSessionStore((s) => s.apiToken);

  const { data: dbConfig } = useQuery({
    queryKey: ['db-config-dialect'],
    queryFn: getDbConfig,
    staleTime: 60 * 60 * 1000,  // 1 ชั่วโมง — เปลี่ยน config ไม่บ่อย
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
    enabled: !!apiToken,
  });

  // ถ้ามี db_config configured → ใช้ dbType จาก config
  if (dbConfig?.configured && dbConfig.dbType) {
    return dbConfig.dbType;
  }
  // Fallback ไป BMS session
  return resolveDialect(databaseType);
}
