import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchClaim16Monthly, type Claim16MonthlyResponse } from '../lib/backendApi';
import { useSessionStore } from '../store/sessionStore';

export const CLAIM16_MONTHLY_QUERY_KEY = ['claim16-monthly'] as const;

/** Query monthly summary จาก backend (รวมยอดต่อเดือนจาก rawData) */
export function useClaim16Monthly() {
  const apiToken = useSessionStore((s) => s.apiToken);
  return useQuery<Claim16MonthlyResponse>({
    queryKey: CLAIM16_MONTHLY_QUERY_KEY,
    queryFn: fetchClaim16Monthly,
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
    enabled: !!apiToken,
  });
}

/** Hook สำหรับ invalidate cache ของ monthly query (เรียกหลัง save/import) */
export function useInvalidateClaim16Monthly() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: CLAIM16_MONTHLY_QUERY_KEY });
}
