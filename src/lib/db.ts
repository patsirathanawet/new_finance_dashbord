import type { REPRecord, STMRecord } from '../types/upload';
import type { Claim16Record, Claim16FileData } from '../types/claim16';
import { getBackend } from './backendApi';

/* ============================================================================
 *  Claim16: REST — ใช้ backend API
 * ========================================================================= */

interface BackendClaim16Record {
  id: string;
  hospitalId: string;
  hospitalCode: string;
  fileName: string;
  source: 'file_upload' | 'hosxp_fetch';
  totalRows: number;
  fileCount: number;
  errorCount: number;
  warningCount: number;
  isValidated: boolean;
  importedAt: string | null;
  rawData: { files: Claim16FileData[] };
  summary: Claim16Record['summary'] | null;
  validationIssues: Claim16Record['validationIssues'];
  uploadedByName: string | null;
  uploadedAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deduped?: boolean;
}

export interface SaveResult {
  /** true = backend update record เดิมเพราะ hash/business_key ตรง */
  deduped: boolean;
  serverId: string;
}

function fromBackendClaim16(r: BackendClaim16Record): Claim16Record {
  return {
    id: r.id,
    fileName: r.fileName,
    hospitalCode: r.hospitalCode,
    uploadedAt: r.uploadedAt,
    uploadedBy: r.uploadedByName ?? 'ไม่ระบุ',
    files: r.rawData?.files ?? [],
    totalRows: r.totalRows,
    validationIssues: r.validationIssues ?? [],
    isValidated: r.isValidated,
    summary: r.summary ?? undefined,
  };
}

function toClaim16CreatePayload(r: Claim16Record) {
  return {
    fileName: r.fileName,
    hospitalCode: r.hospitalCode,
    source: 'file_upload' as const,
    totalRows: r.totalRows,
    files: r.files,
    validationIssues: r.validationIssues,
    summary: r.summary,
    isValidated: r.isValidated,
    importedAt: r.summary?.importedAt ?? new Date().toISOString(),
  };
}

export const claim16DB = {
  async save(record: Claim16Record): Promise<SaveResult> {
    const isClient = record.id.startsWith('c16_');
    if (isClient) {
      const res = await getBackend().post<BackendClaim16Record>('/claim16', toClaim16CreatePayload(record));
      record.id = res.data.id;
      return { deduped: res.data.deduped ?? false, serverId: res.data.id };
    } else {
      await getBackend().put(`/claim16/${record.id}`, {
        validationIssues: record.validationIssues,
        summary: record.summary,
        isValidated: record.isValidated,
        importedAt: record.summary?.importedAt ?? null,
      });
      return { deduped: false, serverId: record.id };
    }
  },

  async get(id: string): Promise<Claim16Record | undefined> {
    try {
      const res = await getBackend().get<BackendClaim16Record>(`/claim16/${id}`);
      return fromBackendClaim16(res.data);
    } catch {
      return undefined;
    }
  },

  async getAll(): Promise<Claim16Record[]> {
    const res = await getBackend().get<{ items: BackendClaim16Record[] }>('/claim16', {
      params: { limit: 200 },
    });
    return res.data.items.map((r) => fromBackendClaim16({ ...r, rawData: r.rawData ?? { files: [] } }));
  },

  async getByHospital(hospitalCode: string): Promise<Claim16Record[]> {
    const res = await getBackend().get<{ items: BackendClaim16Record[] }>('/claim16', {
      params: { hospitalCode, limit: 200 },
    });
    return res.data.items.map((r) => fromBackendClaim16({ ...r, rawData: r.rawData ?? { files: [] } }));
  },

  async delete(id: string): Promise<void> {
    await getBackend().delete(`/claim16/${id}`);
  },
};

/* ============================================================================
 *  REP: REST (Phase 3.5) — backend serializes/deserializes via raw_data JSONB
 * ========================================================================= */

/** Backend response shape: id = business_key, fields ของ REPRecord อยู่ที่ top-level */
type BackendREPResponse = REPRecord & { deduped?: boolean };

export const repDB = {
  async save(record: REPRecord): Promise<SaveResult> {
    const res = await getBackend().post<BackendREPResponse>('/rep', record);
    return { deduped: res.data.deduped ?? false, serverId: res.data.id };
  },

  async get(id: string): Promise<REPRecord | undefined> {
    try {
      const res = await getBackend().get<REPRecord>(`/rep/${encodeURIComponent(id)}`);
      return res.data;
    } catch {
      return undefined;
    }
  },

  async getAll(): Promise<REPRecord[]> {
    const res = await getBackend().get<{ items: REPRecord[] }>('/rep', {
      params: { limit: 500 },
    });
    return res.data.items;
  },

  async getByHospital(hospitalCode: string): Promise<REPRecord[]> {
    const res = await getBackend().get<{ items: REPRecord[] }>('/rep', {
      params: { hospitalCode, limit: 500 },
    });
    return res.data.items;
  },

  async delete(id: string): Promise<void> {
    await getBackend().delete(`/rep/${encodeURIComponent(id)}`);
  },
};

/* ============================================================================
 *  STM: REST
 * ========================================================================= */

type BackendSTMResponse = STMRecord & { deduped?: boolean };

export const stmDB = {
  async save(record: STMRecord): Promise<SaveResult> {
    const res = await getBackend().post<BackendSTMResponse>('/stm', record);
    return { deduped: res.data.deduped ?? false, serverId: res.data.id };
  },

  async get(id: string): Promise<STMRecord | undefined> {
    try {
      const res = await getBackend().get<STMRecord>(`/stm/${encodeURIComponent(id)}`);
      return res.data;
    } catch {
      return undefined;
    }
  },

  async getAll(): Promise<STMRecord[]> {
    const res = await getBackend().get<{ items: STMRecord[] }>('/stm', {
      params: { limit: 500 },
    });
    return res.data.items;
  },

  async getByHospital(hospitalCode: string): Promise<STMRecord[]> {
    const res = await getBackend().get<{ items: STMRecord[] }>('/stm', {
      params: { hospitalCode, limit: 500 },
    });
    return res.data.items;
  },

  async delete(id: string): Promise<void> {
    await getBackend().delete(`/stm/${encodeURIComponent(id)}`);
  },
};
