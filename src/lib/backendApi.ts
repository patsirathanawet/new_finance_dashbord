/**
 * Backend API client (talks to Fastify backend at /api/*)
 * แยกจาก api.ts ที่คุยกับ HOSxP โดยตรง
 */
import axios, { type AxiosInstance } from 'axios';
import { useSessionStore } from '../store/sessionStore';

/**
 * URL ของ backend API
 *  - dev (vite serve port 5173): VITE_BACKEND_URL=http://localhost:4000
 *  - prod (backend serve dist): VITE_BACKEND_URL='' → relative same-origin
 *  - default: '' (relative) — ใช้ได้ใน prod เลย
 */
const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? '';

let backendInstance: AxiosInstance | null = null;

function createBackendInstance(): AxiosInstance {
  const instance = axios.create({
    baseURL: `${BACKEND_URL}/api`,
    timeout: 60000,
    headers: { 'Content-Type': 'application/json' },
  });

  // Request interceptor: แนบ JWT bearer ทุก request
  instance.interceptors.request.use((cfg) => {
    const token = useSessionStore.getState().apiToken;
    if (token) {
      cfg.headers.Authorization = `Bearer ${token}`;
    }
    return cfg;
  });

  // Response interceptor: จับ 401 → clear session (ยกเว้น dev-token ที่ใช้ใน local dev mode)
  instance.interceptors.response.use(
    (res) => res,
    (err) => {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        const token = useSessionStore.getState().apiToken;
        if (token !== 'dev-token') {
          useSessionStore.getState().clearSession();
        }
      }
      return Promise.reject(err);
    },
  );

  return instance;
}

export function getBackend(): AxiosInstance {
  if (!backendInstance) {
    backendInstance = createBackendInstance();
  }
  return backendInstance;
}

/* ------------------------------------------------------------------ */
/*  Auth                                                              */
/* ------------------------------------------------------------------ */

export interface BackendAuthUser {
  userId: string;
  hospitalId: string;
  hospitalCode: string;
  role: 'user' | 'admin' | 'viewer';
  name: string;
}

export interface BackendAuthResponse {
  token: string;
  user: BackendAuthUser;
}

/** แลก BMS session ID → JWT token จาก backend */
export async function backendLogin(bmsSessionId: string): Promise<BackendAuthResponse> {
  const res = await getBackend().post<BackendAuthResponse>('/auth/session', { bmsSessionId });
  return res.data;
}

/** Dev login (เฉพาะ NODE_ENV=development ฝั่ง backend) */
export async function backendDevLogin(
  hospitalCode: string,
  userName: string,
  role: 'user' | 'admin' | 'viewer' = 'admin',
): Promise<BackendAuthResponse> {
  const res = await getBackend().post<BackendAuthResponse>('/auth/dev-login', {
    hospitalCode,
    userName,
    role,
  });
  return res.data;
}

/** HOSxP login — ใช้ username/password ของ HOSxP application */
export async function hosxpLogin(username: string, password: string): Promise<BackendAuthResponse & { method?: string }> {
  const res = await getBackend().post<BackendAuthResponse & { method?: string }>('/auth/hosxp-login', {
    username,
    password,
  });
  return res.data;
}

/* ------------------------------------------------------------------ */
/*  Public Setup (ไม่ต้อง JWT)                                          */
/* ------------------------------------------------------------------ */

export interface SetupStatus {
  configured: boolean;
}

export interface SetupResult {
  ok: boolean;
  hospital: { code: string; name: string };
  configId: string;
  testResult: TestConnectionResult;
  mode?: 'created' | 'updated';
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const res = await getBackend().get<SetupStatus>('/setup/status');
  return res.data;
}

/** ดึง config ปัจจุบัน (public, password masked) — ใช้ใน SetupPage */
export async function getSetupDbConfig(): Promise<DbConfigState> {
  const res = await getBackend().get<DbConfigState>('/setup/db-config');
  return res.data;
}

/** Public test connection — password ว่าง = ใช้ของเดิม */
export async function setupTestDbConfig(payload: {
  dbType: HosxpDbType;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
}): Promise<TestConnectionResult> {
  const res = await getBackend().post<TestConnectionResult>('/setup/db-config/test', payload);
  return res.data;
}

/** Upsert connection (public) — ถ้า password ว่างและมี config เดิม → ใช้ password เดิม */
export async function setupDbConfig(payload: {
  dbType: HosxpDbType;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
}): Promise<SetupResult> {
  const res = await getBackend().post<SetupResult>('/setup/db-config', payload);
  return res.data;
}

export async function backendMe(): Promise<{ user: BackendAuthUser }> {
  const res = await getBackend().get<{ user: BackendAuthUser }>('/auth/me');
  return res.data;
}

/* ------------------------------------------------------------------ */
/*  Health                                                            */
/* ------------------------------------------------------------------ */

export async function backendHealth(): Promise<{ status: string }> {
  const res = await getBackend().get('/health');
  return res.data;
}

/* ------------------------------------------------------------------ */
/*  Dashboard — claim16 monthly summary                               */
/* ------------------------------------------------------------------ */

export interface MonthlyStat {
  month: string;          // "YYYY-MM"
  opdVisits: number;
  ipdAdmissions: number;
  totalVisits: number;
  totalAmount: number;
}

export interface Claim16MonthlyResponse {
  months: MonthlyStat[];
  total: {
    opdVisits: number;
    ipdAdmissions: number;
    totalVisits: number;
    totalAmount: number;
  };
  recordCount: number;
}

export async function fetchClaim16Monthly(): Promise<Claim16MonthlyResponse> {
  const res = await getBackend().get<Claim16MonthlyResponse>('/dashboard/claim16-monthly');
  return res.data;
}

/* ------------------------------------------------------------------ */
/*  DB Config (HOSxP connection)                                      */
/* ------------------------------------------------------------------ */

export type HosxpDbType = 'mysql' | 'postgresql';

export interface DbConfigPayload {
  dbType: HosxpDbType;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  requiredTables?: string[];
}

export interface DbConfigState {
  configured: boolean;
  id?: string;
  dbType?: HosxpDbType;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;          // masked
  requiredTables?: string[];
  lastTestedAt?: string | null;
  lastTestStatus?: 'ok' | 'error' | null;
  lastTestMessage?: string | null;
  updatedByName?: string | null;
  updatedAt?: string;
  defaultRequiredTables: readonly string[];
}

export interface TestConnectionResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export async function getDbConfig(): Promise<DbConfigState> {
  const res = await getBackend().get<DbConfigState>('/db-config');
  return res.data;
}

export async function testDbConfig(payload: Omit<DbConfigPayload, 'requiredTables'>): Promise<TestConnectionResult> {
  const res = await getBackend().post<TestConnectionResult>('/db-config/test', payload);
  return res.data;
}

export async function saveDbConfig(payload: DbConfigPayload): Promise<{ id: string; testResult: TestConnectionResult }> {
  const res = await getBackend().post<{ id: string; testResult: TestConnectionResult }>('/db-config', payload);
  return res.data;
}

export async function updateRequiredTables(tables: string[]): Promise<{ requiredTables: string[] }> {
  const res = await getBackend().put<{ requiredTables: string[] }>('/db-config/required-tables', { tables });
  return res.data;
}

/* ------------------------------------------------------------------ */
/*  Claim DB Config (ฐานข้อมูลเก็บไฟล์ตอบกลับ REP/STM — คนละ DB กับ HOSxP) */
/* ------------------------------------------------------------------ */

export interface ClaimDbConfigState {
  configured: boolean;
  id?: string;
  dbType?: HosxpDbType;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;            // masked
  lastTestedAt?: string | null;
  lastTestStatus?: 'ok' | 'error' | null;
  lastTestMessage?: string | null;
  tablesCreatedAt?: string | null;
  tablesCreatedBy?: string | null;
  updatedByName?: string | null;
  updatedAt?: string;
}

export interface ClaimDbPayload {
  dbType: HosxpDbType;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;   // ว่าง = ใช้ของเดิม
}

export interface CreateTablesResult {
  ok: boolean;
  created: string[];
  error?: string;
}

export async function getClaimDbConfig(): Promise<ClaimDbConfigState> {
  const res = await getBackend().get<ClaimDbConfigState>('/claim-db-config');
  return res.data;
}

export async function testClaimDbConfig(payload: ClaimDbPayload): Promise<TestConnectionResult> {
  const res = await getBackend().post<TestConnectionResult>('/claim-db-config/test', payload);
  return res.data;
}

export async function saveClaimDbConfig(payload: ClaimDbPayload): Promise<{ id: string; testResult: TestConnectionResult }> {
  const res = await getBackend().post<{ id: string; testResult: TestConnectionResult }>('/claim-db-config', payload);
  return res.data;
}

export async function createClaimTables(): Promise<CreateTablesResult> {
  const res = await getBackend().post<CreateTablesResult>('/claim-db-config/create-tables', {});
  return res.data;
}

export async function checkClaimTables(): Promise<{ rep_head: boolean; rep_detail: boolean; eclaim_error: boolean }> {
  const res = await getBackend().get<{ rep_head: boolean; rep_detail: boolean; eclaim_error: boolean }>('/claim-db-config/check-tables');
  return res.data;
}

export async function createSsopRepTables(): Promise<CreateTablesResult> {
  const res = await getBackend().post<CreateTablesResult>('/claim-db-config/create-ssop-rep-tables', {});
  return res.data;
}

export async function checkSsopRepTables(): Promise<{ ssop_rep_head: boolean; ssop_rep_detail: boolean }> {
  const res = await getBackend().get<{ ssop_rep_head: boolean; ssop_rep_detail: boolean }>('/claim-db-config/check-ssop-rep-tables');
  return res.data;
}

export async function createCsopTables(): Promise<CreateTablesResult> {
  const res = await getBackend().post<CreateTablesResult>('/claim-db-config/create-csop-tables', {});
  return res.data;
}

export async function checkCsopTables(): Promise<{ csop_rep_head: boolean; csop_rep_head_detail: boolean; csop_error: boolean }> {
  const res = await getBackend().get<{ csop_rep_head: boolean; csop_rep_head_detail: boolean; csop_error: boolean }>('/claim-db-config/check-csop-tables');
  return res.data;
}

export async function createAipnTables(): Promise<CreateTablesResult> {
  const res = await getBackend().post<CreateTablesResult>('/claim-db-config/create-aipn-tables', {});
  return res.data;
}

export async function checkAipnTables(): Promise<{ aipn_rep_head: boolean; aipn_rep_head_detail: boolean }> {
  const res = await getBackend().get<{ aipn_rep_head: boolean; aipn_rep_head_detail: boolean }>('/claim-db-config/check-aipn-tables');
  return res.data;
}

export async function deleteClaimDbConfig(): Promise<void> {
  await getBackend().delete('/claim-db-config');
}

/* ------------------------------------------------------------------ */
/*  Claim DB — Import REP                                              */
/* ------------------------------------------------------------------ */

export interface RepImportPayload {
  repNo: string;
  hospitalCode?: string;
  invoiceDoc?: string;
  issuedAt?: string;
  totalSubmitted: number;
  totalPassed: number;
  totalFailed: number;
  passedAmount: number;
  failedAmount: number;
  totalAmount: number;
  detailRows: Record<string, unknown>[];
}

export interface RepImportResult {
  alreadyImported: boolean;
  repNo: string;
  message?: string;
  headInserted?: number;
  detailInserted?: number;
}

export async function importRepToClaimDb(payload: RepImportPayload): Promise<RepImportResult> {
  const res = await getBackend().post<RepImportResult>('/claim-db/rep-import', payload);
  return res.data;
}

export interface SsopRepImportPayload {
  ackNo: string;
  docType?: string;
  hospitalCode?: string;
  mainHospitalCode?: string;
  mainHospitalName?: string;
  batchRef?: string;
  station?: string;
  ackAt?: string;
  totalSubmitted: number;
  totalPassed: number;
  totalFailed: number;
  detailRows: Record<string, unknown>[];
}

export interface SsopRepImportResult {
  alreadyImported: boolean;
  ackNo: string;
  message?: string;
  headInserted?: number;
  detailInserted?: number;
}

export async function importSsopRepToClaimDb(payload: SsopRepImportPayload): Promise<SsopRepImportResult> {
  const res = await getBackend().post<SsopRepImportResult>('/claim-db/ssop-rep-import', payload);
  return res.data;
}

export interface CsopImportPayload {
  ackNo: string;
  docType?: string;
  hospitalCode?: string;
  batchRef?: string;
  station?: string;
  ackAt?: string;
  totalSubmitted: number;
  totalPassed: number;
  totalFailed: number;
  detailRows: Record<string, unknown>[];
}

export interface CsopImportResult {
  alreadyImported: boolean;
  ackNo: string;
  message?: string;
  headInserted?: number;
  detailInserted?: number;
}

export async function importCsopToClaimDb(payload: CsopImportPayload): Promise<CsopImportResult> {
  const res = await getBackend().post<CsopImportResult>('/claim-db/csop-import', payload);
  return res.data;
}

export interface AipnImportPayload {
  ackNo: string;
  docType?: string;
  hospitalCode?: string;
  batchNo?: string;
  batchRef?: string;
  ackAt?: string;
  totalSubmitted: number;
  totalPassed: number;
  totalFailed: number;
  detailRows: Record<string, unknown>[];
}

export interface AipnImportResult {
  alreadyImported: boolean;
  ackNo: string;
  message?: string;
  headInserted?: number;
  detailInserted?: number;
}

export async function importAipnToClaimDb(payload: AipnImportPayload): Promise<AipnImportResult> {
  const res = await getBackend().post<AipnImportResult>('/claim-db/aipn-import', payload);
  return res.data;
}

/* ------------------------------------------------------------------ */
/*  Claim DB — Read queries (rep_head / rep_detail)                    */
/* ------------------------------------------------------------------ */

export interface ClaimSummary {
  batches: number;
  submitted: number;
  passed: number;
  failed: number;
  passedAmount: number;
  failedAmount: number;
  totalAmount: number;
}

export interface RepBatch {
  repNo: string;
  hospitalCode: string;
  invoiceDoc: string;
  issuedAt: string;
  totalSubmitted: number;
  totalPassed: number;
  totalFailed: number;
  passedAmount: number;
  failedAmount: number;
  totalAmount: number;
  createdAt: string | null;
}

export interface RepBatchList {
  items: RepBatch[];
  total: number;
  limit: number;
  offset: number;
}

export interface RepBatchDetail {
  head: Record<string, unknown>;
  details: Record<string, unknown>[];
}

export interface MonthlyTrendRow {
  month: string;
  batches: number;
  submitted: number;
  passed: number;
  failed: number;
  passedAmount: number;
  failedAmount: number;
  totalAmount: number;
}

export interface ClaimQueryParams {
  fundCode?: string;
  startDate?: string;   // YYYY-MM-DD
  endDate?: string;     // YYYY-MM-DD
}

export async function getClaimSummary(params: ClaimQueryParams = {}): Promise<ClaimSummary> {
  const res = await getBackend().get<ClaimSummary>('/claim-db/summary', { params });
  return res.data;
}

export async function listRepBatches(params: ClaimQueryParams = {}, limit = 100, offset = 0): Promise<RepBatchList> {
  const res = await getBackend().get<RepBatchList>('/claim-db/rep-batches', {
    params: { ...params, limit, offset },
  });
  return res.data;
}

export async function getRepBatch(repNo: string): Promise<RepBatchDetail> {
  const res = await getBackend().get<RepBatchDetail>(`/claim-db/rep-batches/${encodeURIComponent(repNo)}`);
  return res.data;
}

/* ------------------------------------------------------------------ */
/*  Claim DB — Read queries (ssop_rep_head / ssop_rep_detail)          */
/* ------------------------------------------------------------------ */

export interface SsopRepBatch {
  ackNo: string;
  docType: string;
  hospitalCode: string;
  mainHospitalCode: string;
  mainHospitalName: string | null;
  batchRef: string;
  station: string | null;
  ackAt: string | null;
  totalSubmitted: number;
  totalPassed: number;
  totalFailed: number;
}

export interface SsopRepBatchList {
  items: SsopRepBatch[];
  total: number;
  limit: number;
  offset: number;
}

export interface SsopRepBatchDetail {
  head: Record<string, unknown>;
  details: Record<string, unknown>[];
}

export async function listSsopRepBatches(
  params: { startDate?: string; endDate?: string } = {},
  limit = 100,
  offset = 0,
): Promise<SsopRepBatchList> {
  const res = await getBackend().get<SsopRepBatchList>('/claim-db/ssop-rep-batches', {
    params: { ...params, limit, offset },
  });
  return res.data;
}

export async function getSsopRepBatch(ackNo: string): Promise<SsopRepBatchDetail> {
  const res = await getBackend().get<SsopRepBatchDetail>(`/claim-db/ssop-rep-batches/${encodeURIComponent(ackNo)}`);
  return res.data;
}

export async function getSsopRepSummary(params: { startDate?: string; endDate?: string } = {}): Promise<ClaimSummary> {
  const res = await getBackend().get<ClaimSummary>('/claim-db/ssop-rep-summary', { params });
  return res.data;
}

/* ------------------------------------------------------------------ */
/*  Claim DB — Read queries (csop_rep_head / csop_rep_head_detail)     */
/* ------------------------------------------------------------------ */

export interface CsopRepBatch {
  ackNo: string;
  docType: string;
  hospitalCode: string;
  batchRef: string | null;
  station: string | null;
  ackAt: string | null;
  totalSubmitted: number;
  totalPassed: number;
  totalFailed: number;
}

export interface CsopRepBatchList {
  items: CsopRepBatch[];
  total: number;
  limit: number;
  offset: number;
}

export interface CsopRepBatchDetail {
  head: Record<string, unknown>;
  details: Record<string, unknown>[];
}

export async function listCsopRepBatches(
  params: { startDate?: string; endDate?: string } = {},
  limit = 100,
  offset = 0,
): Promise<CsopRepBatchList> {
  const res = await getBackend().get<CsopRepBatchList>('/claim-db/csop-rep-batches', {
    params: { ...params, limit, offset },
  });
  return res.data;
}

export async function getCsopRepBatch(ackNo: string): Promise<CsopRepBatchDetail> {
  const res = await getBackend().get<CsopRepBatchDetail>(`/claim-db/csop-rep-batches/${encodeURIComponent(ackNo)}`);
  return res.data;
}

export async function getCsopRepSummary(params: { startDate?: string; endDate?: string } = {}): Promise<ClaimSummary> {
  const res = await getBackend().get<ClaimSummary>('/claim-db/csop-rep-summary', { params });
  return res.data;
}

/* ------------------------------------------------------------------ */
/*  Claim DB — Read queries (aipn_rep_head / aipn_rep_head_detail)     */
/* ------------------------------------------------------------------ */

export interface AipnRepBatch {
  ackNo: string;
  docType: string;
  hospitalCode: string;
  batchNo: string | null;
  batchRef: string | null;
  ackAt: string | null;
  totalSubmitted: number;
  totalPassed: number;
  totalFailed: number;
}

export interface AipnRepBatchList {
  items: AipnRepBatch[];
  total: number;
  limit: number;
  offset: number;
}

export interface AipnRepBatchDetail {
  head: Record<string, unknown>;
  details: Record<string, unknown>[];
}

export async function listAipnRepBatches(
  params: { startDate?: string; endDate?: string } = {},
  limit = 100,
  offset = 0,
): Promise<AipnRepBatchList> {
  const res = await getBackend().get<AipnRepBatchList>('/claim-db/aipn-rep-batches', {
    params: { ...params, limit, offset },
  });
  return res.data;
}

export async function getAipnRepBatch(ackNo: string): Promise<AipnRepBatchDetail> {
  const res = await getBackend().get<AipnRepBatchDetail>(`/claim-db/aipn-rep-batches/${encodeURIComponent(ackNo)}`);
  return res.data;
}

export async function getAipnRepSummary(params: { startDate?: string; endDate?: string } = {}): Promise<ClaimSummary> {
  const res = await getBackend().get<ClaimSummary>('/claim-db/aipn-rep-summary', { params });
  return res.data;
}

export async function getClaimMonthlyTrend(params: ClaimQueryParams = {}): Promise<{ months: MonthlyTrendRow[] }> {
  const res = await getBackend().get<{ months: MonthlyTrendRow[] }>('/claim-db/monthly-trend', { params });
  return res.data;
}

export interface ErrorCodeRow {
  code: string;
  count: number;
  totalAmount: number;
}

export interface ErrorSummary {
  errors: ErrorCodeRow[];
  totalFailedRows: number;
  uniqueCodes: number;
}

export async function getClaimErrorSummary(params: ClaimQueryParams = {}): Promise<ErrorSummary> {
  const res = await getBackend().get<ErrorSummary>('/claim-db/error-summary', { params });
  return res.data;
}

export interface ErrorDetailRow {
  repNo: string;
  seqNo: number | null;
  admitDate: string;
  hn: string;
  vn?: string;
  an: string;
  patientName: string;
  errorCode: string;
  reasonCode?: string;
  reason?: string;
}

export async function getClaimErrorDetail(
  code: string,
  params: ClaimQueryParams = {},
): Promise<{ code: string; rows: ErrorDetailRow[] }> {
  const res = await getBackend().get<{ code: string; rows: ErrorDetailRow[] }>('/claim-db/error-detail', {
    params: { ...params, code },
  });
  return res.data;
}

export interface FailedExportRow {
  repNo: string;
  seqNo: number | null;
  admitDate: string;
  dischargeDate: string;
  hn: string;
  an: string;
  pid: string;
  patientName: string;
  patientType: string;
  fund: string;
  errorCode: string;
  errorDescription: string;
  compAmount: number;
  compPp: number;
  chargeAmount: number;
  chargePp: number;
  drg: string;
  rw: number | null;
}

export async function getFailedExport(
  params: ClaimQueryParams = {},
): Promise<{ rows: FailedExportRow[]; total: number }> {
  const res = await getBackend().get<{ rows: FailedExportRow[]; total: number }>('/claim-db/failed-export', { params });
  return res.data;
}

/* ------------------------------------------------------------------ */
/*  Claim DB — eclaim_error reference table                            */
/* ------------------------------------------------------------------ */

export interface EclaimErrorCode {
  code: string;
  description: string | null;
  resolution: string | null;
}

export async function listEclaimErrorCodes(): Promise<{ codes: EclaimErrorCode[]; total: number }> {
  const res = await getBackend().get<{ codes: EclaimErrorCode[]; total: number }>('/claim-db/eclaim-error-codes');
  return res.data;
}

export async function seedEclaimErrorCodes(
  rows: EclaimErrorCode[],
  replace = false,
): Promise<{ ok: boolean; upserted: number; replaced: boolean }> {
  const res = await getBackend().post<{ ok: boolean; upserted: number; replaced: boolean }>(
    '/claim-db/eclaim-error-codes/seed',
    { rows, replace },
  );
  return res.data;
}

export async function listCsopErrorCodes(): Promise<{ codes: EclaimErrorCode[]; total: number }> {
  const res = await getBackend().get<{ codes: EclaimErrorCode[]; total: number }>('/claim-db/csop-error-codes');
  return res.data;
}

/** เพิ่มเฉพาะรหัสที่ยังไม่มีในตาราง csop_error — รหัสที่มีอยู่แล้วจะถูกข้าม ไม่แก้ทับ */
export async function seedCsopErrorCodes(
  rows: EclaimErrorCode[],
): Promise<{ ok: boolean; inserted: number; skipped: number }> {
  const res = await getBackend().post<{ ok: boolean; inserted: number; skipped: number }>(
    '/claim-db/csop-error-codes/seed',
    { rows, replace: false },
  );
  return res.data;
}

export interface ProbeResult {
  tables: Record<string, boolean>;
}

export async function probeDbTables(opts?: {
  tables?: string[];
  adhoc?: Omit<DbConfigPayload, 'requiredTables'>;
}): Promise<ProbeResult> {
  const body = { ...(opts?.adhoc ?? {}), tables: opts?.tables };
  const res = await getBackend().post<ProbeResult>('/db-config/probe-tables', body);
  return res.data;
}

export async function deleteDbConfig(): Promise<void> {
  await getBackend().delete('/db-config');
}

/* ------------------------------------------------------------------ */
/*  HOSxP query (proxy ผ่าน backend pool)                              */
/* ------------------------------------------------------------------ */

export interface HosxpQueryResponse<T = Record<string, unknown>> {
  MessageCode: number;
  Message: string;
  data: T[];
  rowCount: number;
}

export async function hosxpQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const res = await getBackend().post<HosxpQueryResponse<T>>('/hosxp/query', { sql });
  return res.data.data;
}

/* ------------------------------------------------------------------ */
/*  Error helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * ดึงข้อความ error ที่อ่านง่ายจาก axios error
 * 1) backend Thai message (response.data.message)
 * 2) error.message
 * 3) String(e)
 */
export function extractErrorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as { message?: string; error?: string } | undefined;
    if (data?.message) return data.message;
    if (data?.error) return `${data.error}: ${e.message}`;
    if (e.response?.status === 401) return 'Token หมดอายุ — กรุณา login ใหม่';
    if (e.response?.status === 403) return 'ไม่มีสิทธิ์ทำรายการนี้';
    if (e.response?.status === 404) return 'ไม่พบข้อมูล';
    if (!e.response) return `เชื่อมต่อ backend ไม่ได้: ${e.message}`;
    return `HTTP ${e.response.status}: ${e.message}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
