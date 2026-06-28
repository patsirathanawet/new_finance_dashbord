import { create } from 'zustand';
import { claim16DB, type SaveResult } from '../lib/db';
import type { Claim16Record } from '../types/claim16';

interface Claim16State {
  records: Claim16Record[];
  isLoading: boolean;
  error: string | null;

  loadAll: () => Promise<void>;
  loadByHospital: (hospitalCode: string) => Promise<void>;
  save: (record: Claim16Record) => Promise<SaveResult>;
  update: (record: Claim16Record) => Promise<void>;
  delete: (id: string) => Promise<void>;
}

export const useClaim16Store = create<Claim16State>((set, get) => ({
  records: [],
  isLoading: false,
  error: null,

  loadAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const records = await claim16DB.getAll();
      records.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      set({ records });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  loadByHospital: async (hospitalCode: string) => {
    set({ isLoading: true, error: null });
    try {
      const records = hospitalCode === '*'
        ? await claim16DB.getAll()
        : await claim16DB.getByHospital(hospitalCode);
      records.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      set({ records });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  save: async (record: Claim16Record) => {
    const result = await claim16DB.save(record);
    const existing = get().records;
    const idx = existing.findIndex((r) => r.id === record.id);
    if (idx >= 0) {
      set({ records: existing.map((r) => (r.id === record.id ? record : r)) });
    } else {
      set({ records: [record, ...existing] });
    }
    return result;
  },

  update: async (record: Claim16Record) => {
    await claim16DB.save(record);
    set({ records: get().records.map((r) => (r.id === record.id ? record : r)) });
  },

  delete: async (id: string) => {
    await claim16DB.delete(id);
    set({ records: get().records.filter((r) => r.id !== id) });
  },
}));
