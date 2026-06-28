import { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Database, Server, Plug, Save, CheckCircle, AlertCircle, Loader, Hammer, Upload, FileSpreadsheet,
} from 'lucide-react';
import {
  getClaimDbConfig, testClaimDbConfig, saveClaimDbConfig,
  createCsopTables, checkCsopTables,
  createSsopRepTables, checkSsopRepTables,
  createAipnTables, checkAipnTables,
  listCsopErrorCodes, seedCsopErrorCodes,
  listAipnErrorCodes, seedAipnErrorCodes,
  extractErrorMessage,
  type HosxpDbType, type TestConnectionResult, type ClaimDbConfigState, type EclaimErrorCode,
} from '../lib/backendApi';
import { useSessionStore } from '../store/sessionStore';

interface FormState {
  dbType: HosxpDbType;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

const DEFAULT_FORM: FormState = {
  dbType: 'postgresql',
  host: '',
  port: 5432,
  database: '',
  username: '',
  password: '',
};

/** กล่องแสดงปลายทางที่จะสร้างตาราง — ใช้ซ้ำทุกหัวข้อ (CSOP/SSOP/AIPN) */
function TargetDbBanner({ serverState }: { serverState: ClaimDbConfigState | null }) {
  if (serverState?.configured) {
    return (
      <div className="bg-primary-50 border border-primary-100 rounded-2xl px-4 py-3 flex items-start gap-2.5">
        <Database className="w-4 h-4 text-primary-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs">
          <p className="font-semibold text-primary-800">จะสร้างไปที่ฐานข้อมูลปลายทางนี้:</p>
          <p className="font-mono text-primary-700 mt-0.5 break-all">
            {serverState.dbType}://{serverState.username}@{serverState.host}:{serverState.port}/<strong>{serverState.database}</strong>
          </p>
          <p className="text-primary-600/70 mt-1">
            (ค่าจาก connection ที่บันทึกไว้ในฟอร์มด้านบน — แก้ค่าแล้ว "บันทึก" ใหม่ก่อนกด)
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 text-xs text-amber-700">
      ⚠ ยังไม่ได้บันทึก connection — กรอกฟอร์มด้านบนแล้วกด "บันทึก" ก่อน
    </div>
  );
}

/** กริดแสดงสถานะตาราง (มีอยู่ / ยังไม่มี) — ใช้ซ้ำทุกหัวข้อ */
function TablesStatusGrid<T extends string>({ status, tables }: { status: Record<T, boolean> | null; tables: readonly T[] }) {
  if (!status) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      {tables.map((t) => (
        <div
          key={t}
          className={`flex items-center gap-2 px-3 py-2 rounded-2xl text-sm ${status[t] ? 'bg-emerald-50' : 'bg-gray-50'}`}
        >
          {status[t] ? (
            <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-gray-400 flex-shrink-0" />
          )}
          <span className="font-mono text-xs flex-1">{t}</span>
          <span className={`text-xs font-medium ${status[t] ? 'text-emerald-700' : 'text-gray-500'}`}>
            {status[t] ? 'มีอยู่' : 'ยังไม่มี'}
          </span>
        </div>
      ))}
    </div>
  );
}

const CSOP_TABLE_NAMES = ['csop_rep_head', 'csop_rep_head_detail', 'csop_error'] as const;
const SSOP_TABLE_NAMES = ['ssop_rep_head', 'ssop_rep_detail'] as const;
const AIPN_TABLE_NAMES = ['aipn_rep_head', 'aipn_rep_head_detail', 'aipn_error'] as const;

export default function ClaimDbConfigPage() {
  const isAdmin = useSessionStore((s) => s.isAdmin);

  const [loading, setLoading] = useState(true);
  const [serverState, setServerState] = useState<ClaimDbConfigState | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [usernameTouched, setUsernameTouched] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // สถานะตารางของแต่ละหัวข้อ — แสดงในกริดรวมเดียว (สร้างจริงผ่านปุ่มเดียวด้านล่าง)
  const [csopTablesStatus, setCsopTablesStatus] = useState<Record<(typeof CSOP_TABLE_NAMES)[number], boolean> | null>(null);
  const [ssopTablesStatus, setSsopTablesStatus] = useState<Record<(typeof SSOP_TABLE_NAMES)[number], boolean> | null>(null);
  const [aipnTablesStatus, setAipnTablesStatus] = useState<Record<(typeof AIPN_TABLE_NAMES)[number], boolean> | null>(null);

  // ปุ่มเดียวสร้างตารางทั้งหมด (CSOP + SSOP + AIPN) ในฐานข้อมูลปลายทางเดียวกัน
  const [creatingAll, setCreatingAll] = useState(false);
  const [createAllResults, setCreateAllResults] = useState<{ label: string; ok: boolean; message: string }[] | null>(null);

  // Import error code — ของหัวข้อ CSOP (csop_error)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [errorCodesCount, setErrorCodesCount] = useState<number | null>(null);

  // Import error code — ของหัวข้อ AIPN (aipn_error)
  const aipnFileInputRef = useRef<HTMLInputElement>(null);
  const [importingAipn, setImportingAipn] = useState(false);
  const [importAipnResult, setImportAipnResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [aipnErrorCodesCount, setAipnErrorCodesCount] = useState<number | null>(null);

  function looksLikeGarbledText(value: string | null | undefined): boolean {
    if (!value) return false;
    const text = String(value);
    if (text.includes('�')) return true;
    return /[ÃÂà¸à¹âï¿½]/.test(text);
  }

  function findEncodingIssues(rows: EclaimErrorCode[]): string | null {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (looksLikeGarbledText(row.description) || looksLikeGarbledText(row.resolution)) {
        return `พบตัวอักษรผิดพลาดในบรรทัด ${index + 1} ของไฟล์ Errcode_CSOP กรุณาตรวจสอบ encoding ก่อนนำเข้า`;
      }
    }
    return null;
  }

  const reload = useCallback(async () => {
    try {
      const s = await getClaimDbConfig();
      setServerState(s);
      if (s.configured) {
        setForm({
          dbType: s.dbType ?? 'postgresql',
          host: s.host ?? '',
          port: s.port ?? 5432,
          database: s.database ?? '',
          username: '',         // เว้นว่าง — ใช้ของเดิมถ้าไม่กรอก (placeholder บอกค่าปัจจุบัน)
          password: '',
        });
        setPasswordTouched(false);
        setUsernameTouched(false);
        // ตรวจตารางในปลายทาง + count error codes
        try {
          const ts = await checkCsopTables();
          setCsopTablesStatus(ts);
          if (ts.csop_error) {
            try {
              const list = await listCsopErrorCodes();
              setErrorCodesCount(list.total);
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
        try { setSsopTablesStatus(await checkSsopRepTables()); } catch { /* ignore */ }
        try {
          const ts = await checkAipnTables();
          setAipnTablesStatus(ts);
          if (ts.aipn_error) {
            try {
              const list = await listAipnErrorCodes();
              setAipnErrorCodesCount(list.total);
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      }
    } catch (e) {
      console.error('load claim-db-config failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Import xlsx (Errcode_CSOP_*.xlsx จริง — 2 คอลัมน์: Errcode, Errdesc) → bulk upsert ลง csop_error */
  const handleImportFile = async (file: File) => {
    setImporting(true);
    setImportResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array', codepage: 874 });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });

      // skip header row — first cell มักเป็น "Errcode" (ไฟล์จริง) หรือ "รหัส .../Code" (ไฟล์รูปแบบเก่า)
      // ไฟล์จริงของ บก. มีรหัสซ้ำกันบางตัว (เช่น C00, L02) — เก็บแค่รายการล่าสุดของแต่ละรหัส กัน ON CONFLICT ชนกันเอง
      const byCode = new Map<string, EclaimErrorCode>();
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] ?? [];
        const codeRaw = r[0];
        if (codeRaw === null || codeRaw === undefined || codeRaw === '') continue;
        const code = String(codeRaw).trim();
        // ข้าม header
        if (/รหัส|^code$|^errcode$/i.test(code)) continue;
        const desc = r[1] != null ? String(r[1]).trim() : null;
        const reso = r[2] != null ? String(r[2]).trim() : null;
        byCode.set(code, { code, description: desc, resolution: reso });
      }
      const dataRows: EclaimErrorCode[] = [...byCode.values()];

      if (dataRows.length === 0) {
        setImportResult({ ok: false, message: 'ไม่พบข้อมูลในไฟล์ (ต้องมีคอลัมน์: Errcode | Errdesc)' });
        return;
      }

      const issue = findEncodingIssues(dataRows);
      if (issue) {
        setImportResult({ ok: false, message: issue });
        return;
      }

      const result = await seedCsopErrorCodes(dataRows);
      setImportResult({
        ok: true,
        message: result.skipped > 0
          ? `นำเข้าใหม่ ${result.inserted} รหัสสำเร็จ (ข้าม ${result.skipped} รหัสที่มีอยู่แล้ว)`
          : `นำเข้าใหม่ ${result.inserted} รหัสสำเร็จ`,
      });
      try {
        const list = await listCsopErrorCodes();
        setErrorCodesCount(list.total);
      } catch { /* ignore */ }
    } catch (e) {
      setImportResult({ ok: false, message: extractErrorMessage(e) });
    } finally {
      setImporting(false);
    }
  };

/** Import error_aipn — รับได้ทั้ง .pdf (aipnedcode.pdf ตัวจริงจาก สปส.) และ .xlsx (3 คอลัมน์: รหัส | คำอธิบาย | วิธีแก้ไข) → bulk insert (skip ถ้ามีอยู่แล้ว) ลง aipn_error */
  const handleImportAipnFile = async (file: File) => {
    setImportingAipn(true);
    setImportAipnResult(null);
    try {
      const buf = await file.arrayBuffer();
      const isPdf = /\.pdf$/i.test(file.name);

      let dataRows: EclaimErrorCode[];
      if (isPdf) {
        const { parseAipnErrorPdf } = await import('../lib/aipnErrorPdfParser');
        dataRows = await parseAipnErrorPdf(buf);
      } else {
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array', codepage: 874 });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });

        const byCode = new Map<string, EclaimErrorCode>();
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i] ?? [];
          const codeRaw = r[0];
          if (codeRaw === null || codeRaw === undefined || codeRaw === '') continue;
          const code = String(codeRaw).trim();
          // ข้าม header
          if (/รหัส|^code$|^edcode$/i.test(code)) continue;
          const desc = r[1] != null ? String(r[1]).trim() : null;
          const reso = r[2] != null ? String(r[2]).trim() : null;
          byCode.set(code, { code, description: desc, resolution: reso });
        }
        dataRows = [...byCode.values()];
      }

      if (dataRows.length === 0) {
        setImportAipnResult({ ok: false, message: 'ไม่พบข้อมูลในไฟล์ (รองรับ .pdf ตัวจริงจาก สปส. หรือ .xlsx คอลัมน์: รหัส | คำอธิบาย | วิธีแก้ไข)' });
        return;
      }

      const issue = findEncodingIssues(dataRows);
      if (issue) {
        setImportAipnResult({ ok: false, message: issue });
        return;
      }

      const result = await seedAipnErrorCodes(dataRows);
      setImportAipnResult({
        ok: true,
        message: result.skipped > 0
          ? `นำเข้าใหม่ ${result.inserted} รหัสสำเร็จ (ข้าม ${result.skipped} รหัสที่มีอยู่แล้ว)`
          : `นำเข้าใหม่ ${result.inserted} รหัสสำเร็จ`,
      });
      try {
        const list = await listAipnErrorCodes();
        setAipnErrorCodesCount(list.total);
      } catch { /* ignore */ }
    } catch (e) {
      setImportAipnResult({ ok: false, message: extractErrorMessage(e) });
    } finally {
      setImportingAipn(false);
    }
  };

  useEffect(() => { reload(); }, [reload]);

  const setDbType = (t: HosxpDbType) => {
    setForm((f) => ({ ...f, dbType: t, port: t === 'postgresql' ? 5432 : 3306 }));
  };

  // username/password ถ้าผู้ใช้ไม่กรอก → ใช้ของเดิม (effectiveUsername = saved)
  const effectiveUsername = usernameTouched ? form.username : (serverState?.username ?? '');
  const canSubmit = !!form.host && !!effectiveUsername;

  const handleTest = async () => {
    if (!form.host || !effectiveUsername) {
      setTestResult({ ok: false, error: 'กรุณากรอกข้อมูลให้ครบ' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testClaimDbConfig({
        dbType: form.dbType,
        host: form.host,
        port: form.port,
        database: form.database,
        username: effectiveUsername,
        password: passwordTouched ? form.password : '',
      });
      setTestResult(result);
    } catch (e) {
      setTestResult({ ok: false, error: extractErrorMessage(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    try {
      await saveClaimDbConfig({
        dbType: form.dbType,
        host: form.host,
        port: form.port,
        database: form.database,
        username: effectiveUsername,
        password: passwordTouched ? form.password : '',
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      await reload();
    } catch (e) {
      setSaveError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  /** กดปุ่มเดียว สร้างตารางของ CSOP + SSOP + AIPN ให้ครบในฐานข้อมูลปลายทางเดียวกัน (idempotent ทุกตาราง) */
  const handleCreateAllTables = async () => {
    setCreatingAll(true);
    setCreateAllResults(null);
    const results: { label: string; ok: boolean; message: string }[] = [];

    try {
      const r = await createCsopTables();
      results.push({ label: 'CSOP', ok: r.ok, message: r.ok ? `สร้างสำเร็จ: ${r.created.join(', ')}` : (r.error || 'สร้างตารางล้มเหลว') });
    } catch (e) {
      results.push({ label: 'CSOP', ok: false, message: extractErrorMessage(e) });
    }
    try {
      const r = await createSsopRepTables();
      results.push({ label: 'SSOP', ok: r.ok, message: r.ok ? `สร้างสำเร็จ: ${r.created.join(', ')}` : (r.error || 'สร้างตารางล้มเหลว') });
    } catch (e) {
      results.push({ label: 'SSOP', ok: false, message: extractErrorMessage(e) });
    }
    try {
      const r = await createAipnTables();
      results.push({ label: 'AIPN', ok: r.ok, message: r.ok ? `สร้างสำเร็จ: ${r.created.join(', ')}` : (r.error || 'สร้างตารางล้มเหลว') });
    } catch (e) {
      results.push({ label: 'AIPN', ok: false, message: extractErrorMessage(e) });
    }

    setCreateAllResults(results);
    try { setCsopTablesStatus(await checkCsopTables()); } catch { /* ignore */ }
    try { setSsopTablesStatus(await checkSsopRepTables()); } catch { /* ignore */ }
    try { setAipnTablesStatus(await checkAipnTables()); } catch { /* ignore */ }
    await reload();
    setCreatingAll(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader className="w-6 h-6 text-primary-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 bg-primary-100 rounded-2xl flex items-center justify-center">
          <Database className="w-6 h-6 text-primary-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">ตั้งค่าฐานข้อมูลสำหรับเก็บไฟล์ตอบกลับ</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            ฐานข้อมูล (คนละตัวกับ HOSxP) สำหรับเก็บข้อมูลที่นำเข้าจากไฟล์ REP/STM
            {!isAdmin && <span className="ml-2 text-xs text-amber-600">— admin เท่านั้นที่บันทึก/แก้ได้</span>}
          </p>
        </div>
      </div>

      {/* Status banner */}
      {serverState?.configured && (
        <div className={`rounded-2xl p-4 flex items-start gap-3 ${
          serverState.lastTestStatus === 'ok' ? 'bg-emerald-50' : 'bg-amber-50'
        }`}>
          {serverState.lastTestStatus === 'ok' ? (
            <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-800">
              ตั้งค่าแล้ว ({serverState.dbType})
            </p>
            <p className="text-xs text-gray-600 mt-0.5">
              {serverState.host}:{serverState.port}/{serverState.database} · user: {serverState.username}
            </p>
            {serverState.lastTestStatus && (
              <p className="text-xs text-gray-500 mt-1">
                ผลทดสอบล่าสุด ({serverState.lastTestStatus}): {serverState.lastTestMessage}
              </p>
            )}
            {serverState.tablesCreatedAt && (
              <p className="text-xs text-emerald-700 mt-1">
                ✓ สร้างตารางในปลายทางเรียบร้อย ({serverState.tablesCreatedBy})
              </p>
            )}
          </div>
        </div>
      )}

      {/* Connection form — Thai labels เหมือนหน้า /setup */}
      <div className="bg-white rounded-2xl shadow-soft p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-primary-600" />
          <h2 className="text-sm font-semibold text-gray-900">ข้อมูลการเชื่อมต่อ</h2>
        </div>

        {/* ชื่อเครื่อง */}
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1.5 block">ชื่อเครื่อง</label>
          <input
            type="text"
            value={form.host}
            onChange={(e) => setForm({ ...form, host: e.target.value })}
            placeholder="10.10.2.11"
            disabled={!isAdmin}
            className="w-full px-4 py-2.5 rounded-2xl bg-primary-50/50 focus:outline-none focus:ring-2 focus:ring-primary-300 text-sm font-mono"
          />
        </div>

        {/* ชื่อฐานข้อมูล */}
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1.5 block">ชื่อฐานข้อมูล</label>
          <input
            type="text"
            value={form.database}
            onChange={(e) => setForm({ ...form, database: e.target.value })}
            placeholder="claim_db"
            disabled={!isAdmin}
            className="w-full px-4 py-2.5 rounded-2xl bg-primary-50/50 focus:outline-none focus:ring-2 focus:ring-primary-300 text-sm font-mono"
          />
        </div>

        {/* รหัสใช้งาน + รหัสผ่าน */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1.5 block">รหัสใช้งาน</label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => { setForm({ ...form, username: e.target.value }); setUsernameTouched(true); }}
              placeholder={serverState?.username ? `${serverState.username} (เว้นว่าง = ใช้ของเดิม)` : 'postgres'}
              disabled={!isAdmin}
              autoComplete="off"
              className="w-full px-4 py-2.5 rounded-2xl bg-primary-50/50 focus:outline-none focus:ring-2 focus:ring-primary-300 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1.5 block">รหัสผ่าน</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => { setForm({ ...form, password: e.target.value }); setPasswordTouched(true); }}
              placeholder={serverState?.configured ? '•••••••• (เว้นว่าง = ใช้รหัสเดิม)' : '••••••••'}
              disabled={!isAdmin}
              className="w-full px-4 py-2.5 rounded-2xl bg-primary-50/50 focus:outline-none focus:ring-2 focus:ring-primary-300 text-sm font-mono"
            />
          </div>
        </div>

        {/* ช่องเชื่อมต่อ + ประเภทฐานข้อมูล */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1.5 block">ช่องเชื่อมต่อ</label>
            <input
              type="number"
              value={form.port}
              onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 0 })}
              disabled={!isAdmin}
              className="w-full px-4 py-2.5 rounded-2xl bg-primary-50/50 focus:outline-none focus:ring-2 focus:ring-primary-300 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1.5 block">ประเภทฐานข้อมูล</label>
            <select
              value={form.dbType}
              onChange={(e) => setDbType(e.target.value as HosxpDbType)}
              disabled={!isAdmin}
              className="w-full px-4 py-2.5 rounded-2xl bg-primary-50/50 focus:outline-none focus:ring-2 focus:ring-primary-300 text-sm"
            >
              <option value="postgresql">PostgreSQL</option>
              <option value="mysql">MySQL / MariaDB</option>
            </select>
          </div>
        </div>

        {/* Test button + result */}
        <div className="flex items-center gap-2 flex-wrap pt-2">
          <button
            onClick={handleTest}
            disabled={!isAdmin || testing || !canSubmit}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-700 bg-primary-100 rounded-2xl hover:bg-primary-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing ? <Loader className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
            ทดสอบการเชื่อมต่อ
          </button>
          {testResult && (
            <div className={`text-xs px-3 py-2 rounded-2xl ${
              testResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}>
              {testResult.ok
                ? `เชื่อมต่อสำเร็จ ${testResult.latencyMs ? `(${testResult.latencyMs}ms)` : ''}`
                : `ล้มเหลว: ${testResult.error}`}
            </div>
          )}
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={!isAdmin || saving || !canSubmit || (!form.password && !serverState?.configured)}
        className="w-full flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-2xl hover:from-emerald-600 hover:to-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-soft"
      >
        {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        บันทึกข้อมูลเชื่อมต่อ
      </button>
      {saveError && (
        <div className="text-xs text-red-700 bg-red-50 rounded-2xl p-3">
          <AlertCircle className="inline w-3.5 h-3.5 mr-1" />
          {saveError}
        </div>
      )}
      {saveSuccess && (
        <div className="text-xs text-emerald-700 bg-emerald-50 rounded-2xl p-3">
          <CheckCircle className="inline w-3.5 h-3.5 mr-1" />
          บันทึกสำเร็จ
        </div>
      )}

      {/* ============================== สร้างตารางทั้งหมด (ปุ่มเดียว) ============================== */}
      <div className="bg-white rounded-2xl shadow-soft p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Hammer className="w-5 h-5 text-primary-600" />
          <h2 className="text-sm font-semibold text-gray-900">สร้างตารางในฐานข้อมูลปลายทาง (ทั้งหมด)</h2>
        </div>

        <p className="text-xs text-gray-500">
          กดปุ่มเดียว ระบบจะสร้างตารางของ <strong>CSOP + SSOP + AIPN</strong> ให้ครบในฐานข้อมูลปลายทางเดียวกัน —
          idempotent ทุกตาราง (รันซ้ำได้ ไม่ลบของเดิม)
        </p>

        <TargetDbBanner serverState={serverState} />

        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold text-primary-700 mb-1.5">CSOP</p>
            <TablesStatusGrid status={csopTablesStatus} tables={CSOP_TABLE_NAMES} />
          </div>
          <div>
            <p className="text-xs font-semibold text-purple-700 mb-1.5">SSOP</p>
            <TablesStatusGrid status={ssopTablesStatus} tables={SSOP_TABLE_NAMES} />
          </div>
          <div>
            <p className="text-xs font-semibold text-purple-700 mb-1.5">AIPN</p>
            <TablesStatusGrid status={aipnTablesStatus} tables={AIPN_TABLE_NAMES} />
          </div>
        </div>

        <button
          onClick={handleCreateAllTables}
          disabled={!isAdmin || creatingAll || !serverState?.configured}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-primary-500 to-primary-700 rounded-2xl hover:from-primary-600 hover:to-primary-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-soft"
        >
          {creatingAll ? <Loader className="w-4 h-4 animate-spin" /> : <Hammer className="w-4 h-4" />}
          สร้างตารางทั้งหมด (CSOP + SSOP + AIPN)
        </button>

        {createAllResults && (
          <div className="space-y-1.5">
            {createAllResults.map((r) => (
              <div
                key={r.label}
                className={`text-xs rounded-2xl p-3 ${r.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}
              >
                {r.ok ? <CheckCircle className="inline w-3.5 h-3.5 mr-1" /> : <AlertCircle className="inline w-3.5 h-3.5 mr-1" />}
                <strong>{r.label}:</strong> {r.message}
              </div>
            ))}
          </div>
        )}

        {!serverState?.configured && (
          <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-2xl">
            ⚠ ต้องบันทึก connection ก่อน ถึงจะสร้างตารางได้
          </p>
        )}
      </div>

      {/* ============================== หัวข้อ CSOP ============================== */}
      <div className="pt-2">
        <h2 className="text-sm font-bold text-primary-700 uppercase tracking-wide">หัวข้อ CSOP</h2>
        <p className="text-xs text-gray-400 mt-0.5">สิทธิข้าราชการผู้ป่วยนอก — กรมบัญชีกลาง</p>
      </div>

      {/* Import error codes section — csop_error + aipn_error */}
      <div className="bg-white rounded-2xl shadow-soft p-6 space-y-4">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-primary-600" />
          <h3 className="text-sm font-semibold text-gray-900">นำเข้ารหัส Error Code (csop_error / aipn_error)</h3>
        </div>

        <p className="text-xs text-gray-500">
          <strong>error_csop</strong> — ไฟล์จริงจากกรมบัญชีกลาง 2 คอลัมน์: <strong>Errcode | Errdesc</strong> ·{' '}
          <strong>error_aipn</strong> — รับได้ทั้ง <strong>.pdf ตัวจริงจาก สปส.</strong> (เช่น aipnedcode.pdf) หรือ{' '}
          <strong>.xlsx</strong> 3 คอลัมน์: รหัส | คำอธิบาย | วิธีแก้ไข —
          รหัสที่มีอยู่แล้วในตารางจะถูก<strong>ข้าม</strong> ส่วนรหัสที่ยังไม่มีจะถูกเพิ่มเข้าไปใหม่
        </p>

        {errorCodesCount !== null && (
          <div className="bg-emerald-50 rounded-2xl px-4 py-2.5 text-xs text-emerald-800">
            <CheckCircle className="inline w-3.5 h-3.5 mr-1" />
            ปัจจุบันมี <strong>{errorCodesCount}</strong> รหัสในตาราง csop_error
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!isAdmin || importing || !csopTablesStatus?.csop_error}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-primary-500 to-primary-700 rounded-2xl hover:from-primary-600 hover:to-primary-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-soft"
          >
            {importing ? <Loader className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            เลือกไฟล์ error_csop
          </button>

          <input
            ref={aipnFileInputRef}
            type="file"
            accept=".pdf,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportAipnFile(f);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => aipnFileInputRef.current?.click()}
            disabled={!isAdmin || importingAipn || !aipnTablesStatus?.aipn_error}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-purple-500 to-purple-700 rounded-2xl hover:from-purple-600 hover:to-purple-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-soft"
          >
            {importingAipn ? <Loader className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            เลือกไฟล์ error_aipn
          </button>

          {!csopTablesStatus?.csop_error && (
            <span className="text-xs text-amber-600">ต้องสร้างตาราง csop_error ก่อน (กดปุ่ม "สร้างตาราง" ด้านบน)</span>
          )}
          {!aipnTablesStatus?.aipn_error && (
            <span className="text-xs text-amber-600">ต้องสร้างตาราง aipn_error ก่อน (กดปุ่ม "สร้างตาราง" ด้านบน)</span>
          )}
        </div>

        {aipnErrorCodesCount !== null && (
          <div className="bg-purple-50 rounded-2xl px-4 py-2.5 text-xs text-purple-800">
            <CheckCircle className="inline w-3.5 h-3.5 mr-1" />
            ปัจจุบันมี <strong>{aipnErrorCodesCount}</strong> รหัสในตาราง aipn_error
          </div>
        )}

        {importResult && (
          <div className={`text-xs rounded-2xl p-3 ${importResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {importResult.ok ? <CheckCircle className="inline w-3.5 h-3.5 mr-1" /> : <AlertCircle className="inline w-3.5 h-3.5 mr-1" />}
            <strong>error_csop:</strong> {importResult.message}
          </div>
        )}
        {importAipnResult && (
          <div className={`text-xs rounded-2xl p-3 ${importAipnResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {importAipnResult.ok ? <CheckCircle className="inline w-3.5 h-3.5 mr-1" /> : <AlertCircle className="inline w-3.5 h-3.5 mr-1" />}
            <strong>error_aipn:</strong> {importAipnResult.message}
          </div>
        )}
      </div>

      {/* ============================== หัวข้อ CIPN ============================== */}
      <div className="pt-2">
        <h2 className="text-sm font-bold text-primary-700 uppercase tracking-wide">หัวข้อ CIPN</h2>
        <p className="text-xs text-gray-400 mt-0.5">สิทธิข้าราชการผู้ป่วยใน — กรมบัญชีกลาง</p>
      </div>
      <div className="bg-white rounded-2xl shadow-soft p-6 text-center text-gray-400">
        <p className="text-sm">ยังไม่มีตาราง — รอเชื่อมแหล่งข้อมูลในอนาคต</p>
      </div>

    </div>
  );
}
