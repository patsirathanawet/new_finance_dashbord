import { useCallback } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { hosxpLogin, getDbConfig, backendDevLogin } from '../lib/backendApi';

const DEFAULT_DEV_AVAILABLE_TABLES = [
  'ovst_billing',
  'reimbursement',
  'er_regist',
  'an_stat',
  'ward',
].map((t) => t.toLowerCase());

/**
 * Hook สำหรับ HOSxP login (username + password)
 * ⚠️ ชื่อ useBmsSession เก็บไว้เพื่อ compatibility — แต่ logic ภายในใช้ HOSxP login แล้ว
 */
export function useBmsSession() {
  const { isConnected, userName, location, clearSession } = useSessionStore();

  /** Login ผ่าน HOSxP username/password → backend verify → JWT
   *  หลัง login ดึง requiredTables จาก db-config มาใส่ availableTables
   *  เพื่อให้ useTableExists() ทำงานถูกต้อง (ไม่งั้น KPI เตียง, OPD, ฯลฯ จะไม่รัน query)
   */
  const loginWithHosxp = useCallback(async (username: string, password: string): Promise<void> => {
    const result = await hosxpLogin(username, password);

    // เซ็ต JWT ก่อน เพื่อให้ getDbConfig() ใช้ token ได้
    useSessionStore.getState().setBackendAuth({
      apiToken: result.token,
      backendUserId: result.user.userId,
      backendHospitalId: result.user.hospitalId,
      role: result.user.role,
    });

    // ดึง required_tables จาก saved config — fallback เป็น list ว่างถ้า fail
    let availableTables: string[] = [];
    try {
      const cfg = await getDbConfig();
      if (cfg.configured && cfg.requiredTables) {
        availableTables = (cfg.requiredTables as string[]).map((t) => t.toLowerCase());
      }
    } catch {
      // ignore — เริ่มด้วย list ว่าง, จะเปิดได้หลัง configure tables
    }

    useSessionStore.getState().setSession({
      sessionId: `hosxp:${result.user.userId}`,
      apiUrl: '',
      apiAuthKey: '',
      databaseName: '',
      databaseType: '',
      availableTables,
      bmsUrl: '',
      bmsSessionCode: '',
      userName: result.user.name,
      location: '',
      hospitalCode: result.user.hospitalCode,
    });
  }, []);

  const loginWithDevAdmin = useCallback(async (): Promise<void> => {
    if (import.meta.env.DEV) {
      try {
        const result = await backendDevLogin('10673', 'admin', 'admin');

        useSessionStore.getState().setBackendAuth({
          apiToken: result.token,
          backendUserId: result.user.userId,
          backendHospitalId: result.user.hospitalId,
          role: result.user.role,
        });

        useSessionStore.getState().setSession({
          sessionId: `dev:${result.user.userId}`,
          apiUrl: '',
          apiAuthKey: '',
          databaseName: '',
          databaseType: '',
          availableTables: DEFAULT_DEV_AVAILABLE_TABLES,
          bmsUrl: '',
          bmsSessionCode: '',
          userName: result.user.name,
          location: '',
          hospitalCode: result.user.hospitalCode,
        });
        return;
      } catch {
        // fallback to local dev session when backend dev-login is unavailable
      }

      useSessionStore.getState().setBackendAuth({
        apiToken: 'dev-token',
        backendUserId: 'dev-admin',
        backendHospitalId: '10673',
        role: 'admin',
      });

      useSessionStore.getState().setSession({
        sessionId: 'dev:admin',
        apiUrl: '',
        apiAuthKey: '',
        databaseName: '',
        databaseType: '',
        availableTables: DEFAULT_DEV_AVAILABLE_TABLES,
        bmsUrl: '',
        bmsSessionCode: '',
        userName: 'Dev Admin',
        location: '',
        hospitalCode: '10673',
      });
      return;
    }

    const result = await backendDevLogin('10673', 'admin', 'admin');
    useSessionStore.getState().setBackendAuth({
      apiToken: result.token,
      backendUserId: result.user.userId,
      backendHospitalId: result.user.hospitalId,
      role: result.user.role,
    });

    useSessionStore.getState().setSession({
      sessionId: `dev:${result.user.userId}`,
      apiUrl: '',
      apiAuthKey: '',
      databaseName: '',
      databaseType: '',
      availableTables: DEFAULT_DEV_AVAILABLE_TABLES,
      bmsUrl: '',
      bmsSessionCode: '',
      userName: result.user.name,
      location: '',
      hospitalCode: result.user.hospitalCode,
    });
  }, []);

  const logout = useCallback(() => {
    clearSession();
  }, [clearSession]);

  /** ตรวจสอบ session ที่ persist ไว้ — ถ้ามี JWT ถือว่า login ค้างอยู่
   *  Side effect: ถ้า availableTables ว่าง (เคย login ก่อน fix) → ดึงใหม่จาก /db-config
   */
  const initFromStorage = useCallback(async (): Promise<boolean> => {
    const storedState = useSessionStore.getState();
    if (!storedState.apiToken || !storedState.isConnected) return false;

    // กู้คืน availableTables ถ้าว่าง (session เก่าก่อน fix)
    if (storedState.availableTables.length === 0) {
      try {
        const cfg = await getDbConfig();
        if (cfg.configured && cfg.requiredTables) {
          const tables = (cfg.requiredTables as string[]).map((t) => t.toLowerCase());
          useSessionStore.setState({ availableTables: tables });
        }
      } catch {
        // ignore — user สามารถ logout/login ใหม่เพื่อ refresh ได้
      }
    }
    return true;
  }, []);

  return {
    isConnected,
    userName,
    location,
    loginWithHosxp,
    loginWithDevAdmin,
    logout,
    initFromStorage,
  };
}
