import { create } from 'zustand';
import { repDB, stmDB } from '../lib/db';
import type { REPRecord, STMRecord } from '../types/upload';

interface UploadState {
  repRecords: REPRecord[];
  stmRecords: STMRecord[];
  isLoading: boolean;
  error: string | null;

  // Load all records from IndexedDB
  loadAll: () => Promise<void>;
  // Load records for a specific hospital (pass '*' for all)
  loadByHospital: (hospitalCode: string) => Promise<void>;

  saveREP: (record: REPRecord) => Promise<void>;
  saveSTM: (record: STMRecord) => Promise<void>;
  deleteREP: (id: string) => Promise<void>;
  deleteSTM: (id: string) => Promise<void>;
}

export const useUploadStore = create<UploadState>((set, get) => ({
  repRecords: [],
  stmRecords: [],
  isLoading: false,
  error: null,

  loadAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const [repRecords, stmRecords] = await Promise.all([
        repDB.getAll(),
        stmDB.getAll(),
      ]);
      set({ repRecords, stmRecords });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  loadByHospital: async (hospitalCode: string) => {
    set({ isLoading: true, error: null });
    try {
      const [repRecords, stmRecords] =
        hospitalCode === '*'
          ? await Promise.all([repDB.getAll(), stmDB.getAll()])
          : await Promise.all([
              repDB.getByHospital(hospitalCode),
              stmDB.getByHospital(hospitalCode),
            ]);

      // Sort by uploadedAt desc
      repRecords.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      stmRecords.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

      set({ repRecords, stmRecords });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  saveREP: async (record: REPRecord) => {
    await repDB.save(record);
    // Update local state
    const existing = get().repRecords;
    const idx = existing.findIndex((r) => r.id === record.id);
    if (idx >= 0) {
      set({ repRecords: existing.map((r) => (r.id === record.id ? record : r)) });
    } else {
      set({ repRecords: [record, ...existing] });
    }
  },

  saveSTM: async (record: STMRecord) => {
    await stmDB.save(record);
    const existing = get().stmRecords;
    const idx = existing.findIndex((r) => r.id === record.id);
    if (idx >= 0) {
      set({ stmRecords: existing.map((r) => (r.id === record.id ? record : r)) });
    } else {
      set({ stmRecords: [record, ...existing] });
    }
  },

  deleteREP: async (id: string) => {
    await repDB.delete(id);
    set({ repRecords: get().repRecords.filter((r) => r.id !== id) });
  },

  deleteSTM: async (id: string) => {
    await stmDB.delete(id);
    set({ stmRecords: get().stmRecords.filter((r) => r.id !== id) });
  },
}));
