import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SessionState {
  sessionId: string | null;
  apiUrl: string | null;
  apiAuthKey: string | null;
  databaseName: string | null;
  databaseType: string | null;
  availableTables: string[];   // ตารางที่ probe พบว่ามีอยู่จริงใน DB
  bmsUrl: string | null;
  bmsSessionCode: string | null;
  userName: string | null;
  location: string | null;
  hospitalCode: string | null; // รหัสโรงพยาบาล เช่น "10673"
  isConnected: boolean;
  isAdmin: boolean;            // Admin mode: เห็นข้อมูลทุกโรงพยาบาล
  // Backend JWT (จาก Fastify backend) สำหรับเรียก /api/claim16, /api/dashboard ฯลฯ
  apiToken: string | null;
  backendUserId: string | null;
  backendHospitalId: string | null;
  setSession: (data: {
    sessionId: string;
    apiUrl: string;
    apiAuthKey: string;
    databaseName: string;
    databaseType: string;
    availableTables: string[];
    bmsUrl: string;
    bmsSessionCode: string;
    userName?: string;
    location?: string;
    hospitalCode?: string;
  }) => void;
  setBackendAuth: (data: {
    apiToken: string;
    backendUserId: string;
    backendHospitalId: string;
    role: 'user' | 'admin' | 'viewer';
  }) => void;
  setAdmin: (isAdmin: boolean) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      sessionId: null,
      apiUrl: null,
      apiAuthKey: null,
      databaseName: null,
      databaseType: null,
      availableTables: [],
      bmsUrl: null,
      bmsSessionCode: null,
      userName: null,
      location: null,
      hospitalCode: null,
      isConnected: false,
      isAdmin: false,
      apiToken: null,
      backendUserId: null,
      backendHospitalId: null,
      setSession: (data) =>
        set({
          sessionId: data.sessionId,
          apiUrl: data.apiUrl,
          apiAuthKey: data.apiAuthKey,
          databaseName: data.databaseName,
          databaseType: data.databaseType,
          availableTables: data.availableTables,
          bmsUrl: data.bmsUrl,
          bmsSessionCode: data.bmsSessionCode,
          userName: data.userName ?? null,
          location: data.location ?? null,
          hospitalCode: data.hospitalCode ?? null,
          isConnected: true,
        }),
      setBackendAuth: (data) =>
        set({
          apiToken: data.apiToken,
          backendUserId: data.backendUserId,
          backendHospitalId: data.backendHospitalId,
          isAdmin: data.role === 'admin',
        }),
      setAdmin: (isAdmin) => set({ isAdmin }),
      clearSession: () =>
        set({
          sessionId: null,
          apiUrl: null,
          apiAuthKey: null,
          databaseName: null,
          databaseType: null,
          availableTables: [],
          bmsUrl: null,
          bmsSessionCode: null,
          userName: null,
          location: null,
          hospitalCode: null,
          isConnected: false,
          isAdmin: false,
          apiToken: null,
          backendUserId: null,
          backendHospitalId: null,
        }),
    }),
    {
      name: 'bms-session-storage',
      partialize: (state) => ({
        sessionId: state.sessionId,
        apiUrl: state.apiUrl,
        apiAuthKey: state.apiAuthKey,
        databaseName: state.databaseName,
        databaseType: state.databaseType,
        availableTables: state.availableTables,
        bmsUrl: state.bmsUrl,
        bmsSessionCode: state.bmsSessionCode,
        userName: state.userName,
        location: state.location,
        hospitalCode: state.hospitalCode,
        isConnected: state.isConnected,
        isAdmin: state.isAdmin,
        apiToken: state.apiToken,
        backendUserId: state.backendUserId,
        backendHospitalId: state.backendHospitalId,
      }),
    }
  )
);
