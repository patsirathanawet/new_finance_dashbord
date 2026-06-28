import { useQuery } from '@tanstack/react-query';
import type { UseQueryOptions } from '@tanstack/react-query';
import { executeSQL } from '../lib/api';
import { useSessionStore } from '../store/sessionStore';

/** ตรวจสอบว่าตารางมีอยู่ใน DB ที่เชื่อมต่ออยู่หรือไม่ */
export function useTableExists(tableName: string): boolean {
  const availableTables = useSessionStore((s) => s.availableTables);
  return availableTables.includes(tableName.toLowerCase());
}

export function useSQL<T = Record<string, unknown>>(
  queryKey: string[],
  sql: string,
  options?: Omit<UseQueryOptions<T[], Error>, 'queryKey' | 'queryFn'>
) {
  const isConnected = useSessionStore((s) => s.isConnected);

  return useQuery<T[], Error>({
    queryKey,
    queryFn: () => executeSQL<T>(sql),
    enabled: isConnected && !!sql && (options?.enabled !== false),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
    ...options,
  });
}

export function useSQLFirst<T = Record<string, unknown>>(
  queryKey: string[],
  sql: string,
  options?: Omit<UseQueryOptions<T | null, Error>, 'queryKey' | 'queryFn'>
) {
  const isConnected = useSessionStore((s) => s.isConnected);

  return useQuery<T | null, Error>({
    queryKey,
    queryFn: async () => {
      const rows = await executeSQL<T>(sql);
      return rows[0] ?? null;
    },
    enabled: isConnected && !!sql && (options?.enabled !== false),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
    ...options,
  });
}
