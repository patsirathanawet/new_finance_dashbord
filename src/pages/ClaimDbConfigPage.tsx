import { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Database, Server, Plug, Save, CheckCircle, AlertCircle, Loader, Hammer, Upload, FileSpreadsheet,
} from 'lucide-react';
import {
  getClaimDbConfig, testClaimDbConfig, saveClaimDbConfig,
  createClaimTables, checkClaimTables,
  createSsopRepTables, checkSsopRepTables,
  listEclaimErrorCodes, seedEclaimErrorCodes,
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

  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [tablesStatus, setTablesStatus] = useState<{ rep_head: boolean; rep_detail: boolean; eclaim_error: boolean } | null>(null);

  const [creatingSsop, setCreatingSsop] = useState(false);
  const [createSsopResult, setCreateSsopResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [ssopTablesStatus, setSsopTablesStatus] = useState<{ ssop_rep_head: boolean; ssop_rep_detail: boolean } | null>(null);

  // Error code import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [errorCodesCount, setErrorCodesCount] = useState<number | null>(null);

  function looksLikeGarbledText(value: string | null | undefined): boolean {
    if (!value) return false;
    const text = String(value);
    if (text.includes('�')) return true;
    return /[ÃÂà¸à¹âï¿½]/.test(text);
  }

  function findEncodingIssues(rows: EclaimErrorCode[]): string | null {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (looksLikeGarbledText(row.description) || looksLikeGarbledText(row.resolution)) {
        return `พบตัวอักษรผิดพลาดในบรรทัด ${index + 1} ของไฟล์ search_c.xlsx กรุณาตรวจสอบ encoding ก่อนนำเข้า`;
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
          const ts = await checkClaimTables();
          setTablesStatus(ts);
          if (ts.eclaim_error) {
            try {
              const list = await listEclaimErrorCodes();
              setErrorCodesCount(list.total);
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
        try { setSsopTablesStatus(await checkSsopRepTables()); } catch { /* ignore */ }
      }
    } catch (e) {
      console.error('load claim-db-config failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Import xlsx → parse 3 columns (code, description, resolution) → bulk upsert */
  const handleImportFile = async (file: File) => {
    setImporting(true);
    setImportResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array', codepage: 874 });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });

      // skip header row — first cell มักเป็น "รหัส C/Deny/Verify"
      const dataRows: EclaimErrorCode[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] ?? [];
        const codeRaw = r[0];
        if (codeRaw === null || codeRaw === undefined || codeRaw === '') continue;
        const code = String(codeRaw).trim();
        // ข้าม header
        if (/รหัส|^Code$/i.test(code)) continue;
        const desc = r[1] != null ? String(r[1]).trim() : null;
        const reso = r[2] != null ? String(r[2]).trim() : null;
        dataRows.push({ code, description: desc, resolution: reso });
      }

      if (dataRows.length === 0) {
        setImportResult({ ok: false, message: 'ไม่พบข้อมูลในไฟล์ (ต้องมีคอลัมน์: รหัส | รายละเอียด | แนวทางแก้ไข)' });
        return;
      }

      const issue = findEncodingIssues(dataRows);
      if (issue) {
        setImportResult({ ok: false, message: issue });
        return;
      }

      const result = await seedEclaimErrorCodes(dataRows, true);
      setImportResult({ ok: true, message: `import ${result.upserted} รหัสสำเร็จ` });
      setErrorCodesCount(result.upserted);
    } catch (e) {
      setImportResult({ ok: false, message: extractErrorMessage(e) });
    } finally {
      setImporting(false);
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

  const handleCreateTables = async () => {
    setCreating(true);
    setCreateResult(null);
    try {
      const r = await createClaimTables();
      if (r.ok) {
        setCreateResult({ ok: true, message: `สร้างตารางสำเร็จ: ${r.created.join(', ')}` });
      } else {
        setCreateResult({ ok: false, message: r.error || 'สร้างตารางล้มเหลว' });
      }
      try { setTablesStatus(await checkClaimTables()); } catch { /* ignore */ }
      await reload();
    } catch (e) {
      setCreateResult({ ok: false, message: extractErrorMessage(e) });
    } finally {
      setCreating(false);
    }
  };

  const handleCreateSsopRepTables = async () => {
    setCreatingSsop(true);
    setCreateSsopResult(null);
    try {
      const r = await createSsopRepTables();
      if (r.ok) {
        setCreateSsopResult({ ok: true, message: `สร้างตารางสำเร็จ: ${r.created.join(', ')}` });
      } else {
        setCreateSsopResult({ ok: false, message: r.error || 'สร้างตารางล้มเหลว' });
      }
      try { setSsopTablesStatus(await checkSsopRepTables()); } catch { /* ignore */ }
    } catch (e) {
      setCreateSsopResult({ ok: false, message: extractErrorMessage(e) });
    } finally {
      setCreatingSsop(false);
    }
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

      {/* Create tables section */}
      <div className="bg-white rounded-2xl shadow-soft p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Hammer className="w-5 h-5 text-primary-600" />
          <h2 className="text-sm font-semibold text-gray-900">สร้างตารางในฐานข้อมูลปลายทาง</h2>
        </div>

        <p className="text-xs text-gray-500">
          สร้าง <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">rep_head</code> (สรุปต่องวด) +{' '}
          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">rep_detail</code> (รายละเอียดทุก case) —{' '}
          idempotent (รันซ้ำได้)
        </p>

        {/* Target DB banner — ระบุชัดว่าจะสร้างที่ไหน */}
        {serverState?.configured ? (
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
        ) : (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 text-xs text-amber-700">
            ⚠ ยังไม่ได้บันทึก connection — กรอกฟอร์มด้านบนแล้วกด "บันทึก" ก่อน
          </div>
        )}

        {tablesStatus && (
          <div className="grid grid-cols-2 gap-2">
            {(['rep_head', 'rep_detail', 'eclaim_error'] as const).map((t) => (
              <div
                key={t}
                className={`flex items-center gap-2 px-3 py-2 rounded-2xl text-sm ${
                  tablesStatus[t] ? 'bg-emerald-50' : 'bg-gray-50'
                }`}
              >
                {tablesStatus[t] ? (
                  <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-gray-400 flex-shrink-0" />
                )}
                <span className="font-mono text-xs flex-1">{t}</span>
                <span className={`text-xs font-medium ${tablesStatus[t] ? 'text-emerald-700' : 'text-gray-500'}`}>
                  {tablesStatus[t] ? 'มีอยู่' : 'ยังไม่มี'}
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleCreateTables}
          disabled={!isAdmin || creating || !serverState?.configured}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-primary-500 to-primary-700 rounded-2xl hover:from-primary-600 hover:to-primary-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-soft"
        >
          {creating ? <Loader className="w-4 h-4 animate-spin" /> : <Hammer className="w-4 h-4" />}
          สร้างตาราง (rep_head + rep_detail)
        </button>

        {createResult && (
          <div className={`text-xs rounded-2xl p-3 ${
            createResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}>
            {createResult.ok ? <CheckCircle className="inline w-3.5 h-3.5 mr-1" /> : <AlertCircle className="inline w-3.5 h-3.5 mr-1" />}
            {createResult.message}
          </div>
        )}

        {!serverState?.configured && (
          <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-2xl">
            ⚠ ต้องบันทึก connection ก่อน ถึงจะสร้างตารางได้
          </p>
        )}
      </div>

      {/* Create SSOP REP tables section */}
      <div className="bg-white rounded-2xl shadow-soft p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Hammer className="w-5 h-5 text-primary-600" />
          <h2 className="text-sm font-semibold text-gray-900">สร้างตารางเอกสารตอบกลับ สปส. (SSOP)</h2>
        </div>

        <p className="text-xs text-gray-500">
          สร้าง <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">ssop_rep_head</code> (สรุปต่อเลขที่ตอบรับ) +{' '}
          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">ssop_rep_detail</code> (รายการเบิกทุกบรรทัด) —{' '}
          idempotent (รันซ้ำได้)
        </p>

        {serverState?.configured ? (
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
        ) : (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 text-xs text-amber-700">
            ⚠ ยังไม่ได้บันทึก connection — กรอกฟอร์มด้านบนแล้วกด "บันทึก" ก่อน
          </div>
        )}

        {ssopTablesStatus && (
          <div className="grid grid-cols-2 gap-2">
            {(['ssop_rep_head', 'ssop_rep_detail'] as const).map((t) => (
              <div
                key={t}
                className={`flex items-center gap-2 px-3 py-2 rounded-2xl text-sm ${
                  ssopTablesStatus[t] ? 'bg-emerald-50' : 'bg-gray-50'
                }`}
              >
                {ssopTablesStatus[t] ? (
                  <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-gray-400 flex-shrink-0" />
                )}
                <span className="font-mono text-xs flex-1">{t}</span>
                <span className={`text-xs font-medium ${ssopTablesStatus[t] ? 'text-emerald-700' : 'text-gray-500'}`}>
                  {ssopTablesStatus[t] ? 'มีอยู่' : 'ยังไม่มี'}
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleCreateSsopRepTables}
          disabled={!isAdmin || creatingSsop || !serverState?.configured}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-primary-500 to-primary-700 rounded-2xl hover:from-primary-600 hover:to-primary-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-soft"
        >
          {creatingSsop ? <Loader className="w-4 h-4 animate-spin" /> : <Hammer className="w-4 h-4" />}
          สร้างตาราง (ssop_rep_head + ssop_rep_detail)
        </button>

        {createSsopResult && (
          <div className={`text-xs rounded-2xl p-3 ${
            createSsopResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}>
            {createSsopResult.ok ? <CheckCircle className="inline w-3.5 h-3.5 mr-1" /> : <AlertCircle className="inline w-3.5 h-3.5 mr-1" />}
            {createSsopResult.message}
          </div>
        )}

        {!serverState?.configured && (
          <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-2xl">
            ⚠ ต้องบันทึก connection ก่อน ถึงจะสร้างตารางได้
          </p>
        )}
      </div>

      {/* Import error codes section */}
      <div className="bg-white rounded-2xl shadow-soft p-6 space-y-4">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-primary-600" />
          <h2 className="text-sm font-semibold text-gray-900">นำเข้ารหัส Error Code (eclaim_error)</h2>
        </div>

        <p className="text-xs text-gray-500">
          อัปโหลดไฟล์ .xlsx ที่มี 3 คอลัมน์: <strong>รหัส | รายละเอียด | แนวทางแก้ไข</strong> —
          ระบบจะแทนข้อมูลเดิมทั้งหมดด้วย list ใหม่ (replace mode)
        </p>

        {errorCodesCount !== null && (
          <div className="bg-emerald-50 rounded-2xl px-4 py-2.5 text-xs text-emerald-800">
            <CheckCircle className="inline w-3.5 h-3.5 mr-1" />
            ปัจจุบันมี <strong>{errorCodesCount}</strong> รหัสในตาราง eclaim_error
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
            disabled={!isAdmin || importing || !tablesStatus?.eclaim_error}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-primary-500 to-primary-700 rounded-2xl hover:from-primary-600 hover:to-primary-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-soft"
          >
            {importing ? <Loader className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            เลือกไฟล์ search_c.xlsx
          </button>
          {!tablesStatus?.eclaim_error && (
            <span className="text-xs text-amber-600">ต้องสร้างตาราง eclaim_error ก่อน (กดปุ่ม "สร้างตาราง")</span>
          )}
        </div>

        {importResult && (
          <div className={`text-xs rounded-2xl p-3 ${importResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {importResult.ok ? <CheckCircle className="inline w-3.5 h-3.5 mr-1" /> : <AlertCircle className="inline w-3.5 h-3.5 mr-1" />}
            {importResult.message}
          </div>
        )}
      </div>
    </div>
  );
}
