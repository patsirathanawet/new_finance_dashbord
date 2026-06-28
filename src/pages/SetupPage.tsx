import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Database, Server, Plug, Save, CheckCircle, AlertCircle, Loader, Activity,
} from 'lucide-react';
import {
  getSetupDbConfig, setupTestDbConfig, setupDbConfig, extractErrorMessage,
  type HosxpDbType, type TestConnectionResult,
} from '../lib/backendApi';

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

export default function SetupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [alreadyConfigured, setAlreadyConfigured] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedHospital, setSavedHospital] = useState<{ code: string; name: string; mode?: string } | null>(null);

  // โหลด config เดิม (ถ้ามี) — pre-fill ฟอร์ม
  useEffect(() => {
    getSetupDbConfig()
      .then((cfg) => {
        if (cfg.configured) {
          setAlreadyConfigured(true);
          setForm({
            dbType: cfg.dbType ?? 'postgresql',
            host: cfg.host ?? '',
            port: cfg.port ?? 5432,
            database: cfg.database ?? '',
            username: cfg.username ?? '',
            password: '',
          });
        }
      })
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  }, []);

  const setDbType = (t: HosxpDbType) => {
    setForm((f) => ({ ...f, dbType: t, port: t === 'postgresql' ? 5432 : 3306 }));
  };

  const handleTest = async () => {
    if (!form.host || !form.username) {
      setTestResult({ ok: false, error: 'กรอกข้อมูลให้ครบ' });
      return;
    }
    if (!alreadyConfigured && !form.password) {
      setTestResult({ ok: false, error: 'กรุณากรอกรหัสผ่าน' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await setupTestDbConfig({
        dbType: form.dbType,
        host: form.host,
        port: form.port,
        database: form.database,
        username: form.username,
        password: passwordTouched ? form.password : '',
      }));
    } catch (e) {
      setTestResult({ ok: false, error: extractErrorMessage(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const result = await setupDbConfig({
        dbType: form.dbType,
        host: form.host,
        port: form.port,
        database: form.database,
        username: form.username,
        password: passwordTouched ? form.password : '',
      });
      setSavedHospital({ ...result.hospital, mode: result.mode });
      setTimeout(() => navigate('/login', { replace: true }), 1500);
    } catch (e) {
      setSaveError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader className="w-6 h-6 text-primary-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 py-8">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-primary-500 to-primary-700 rounded-3xl shadow-soft mb-4">
            <Activity className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            {alreadyConfigured ? 'แก้ไขการเชื่อมต่อฐานข้อมูล' : 'ตั้งค่าระบบครั้งแรก'}
          </h1>
          <p className="text-gray-500 mt-2 text-sm">
            {alreadyConfigured
              ? 'ปรับการเชื่อมต่อฐานข้อมูล HOSxP'
              : 'เชื่อมต่อฐานข้อมูล HOSxP เพื่อเริ่มใช้งาน'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-soft overflow-hidden">
          <div className="bg-gradient-to-r from-primary-500 to-primary-700 px-6 py-4 flex items-center gap-2 text-white">
            <Database className="w-4 h-4" />
            <span className="text-sm font-medium">การเชื่อมต่อฐานข้อมูล</span>
          </div>

          <div className="p-6 space-y-4">
            {savedHospital && (
              <div className="bg-emerald-50 rounded-2xl p-4 flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-emerald-700">
                    {savedHospital.mode === 'updated' ? 'อัปเดตสำเร็จ!' : 'ตั้งค่าสำเร็จ!'}
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    โรงพยาบาล: {savedHospital.code} - {savedHospital.name}
                  </p>
                  <p className="text-xs text-emerald-600 mt-1">กำลังไปหน้า login...</p>
                </div>
              </div>
            )}

            {!savedHospital && (
              <>
                {/* ชื่อเครื่อง */}
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1.5 block">ชื่อเครื่อง</label>
                  <input
                    type="text"
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    placeholder="10.10.2.11"
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
                    placeholder="hosxp_rpsi"
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
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      placeholder="hosxprpsi"
                      className="w-full px-4 py-2.5 rounded-2xl bg-primary-50/50 focus:outline-none focus:ring-2 focus:ring-primary-300 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1.5 block">รหัสผ่าน</label>
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) => {
                        setForm({ ...form, password: e.target.value });
                        setPasswordTouched(true);
                      }}
                      placeholder={alreadyConfigured ? '•••••••• (เว้นว่าง = ใช้รหัสเดิม)' : '••••••••'}
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
                      className="w-full px-4 py-2.5 rounded-2xl bg-primary-50/50 focus:outline-none focus:ring-2 focus:ring-primary-300 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1.5 block">ประเภทฐานข้อมูล</label>
                    <select
                      value={form.dbType}
                      onChange={(e) => setDbType(e.target.value as HosxpDbType)}
                      className="w-full px-4 py-2.5 rounded-2xl bg-primary-50/50 focus:outline-none focus:ring-2 focus:ring-primary-300 text-sm"
                    >
                      <option value="postgresql">PostgreSQL</option>
                      <option value="mysql">MySQL / MariaDB</option>
                    </select>
                  </div>
                </div>

                {/* Test button + result */}
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <button
                    onClick={handleTest}
                    disabled={testing || !form.host || !form.username}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-700 bg-primary-100 rounded-2xl hover:bg-primary-200 transition-colors disabled:opacity-50"
                  >
                    {testing ? <Loader className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
                    ทดสอบการเชื่อมต่อ
                  </button>
                  {testResult && (
                    <div className={`text-xs px-3 py-2 rounded-2xl ${
                      testResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                    }`}>
                      {testResult.ok
                        ? `✓ เชื่อมต่อสำเร็จ (${testResult.latencyMs}ms)`
                        : `✗ ล้มเหลว: ${testResult.error}`}
                    </div>
                  )}
                </div>

                {saveError && (
                  <div className="bg-red-50 text-red-700 text-xs rounded-2xl p-3 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{saveError}</span>
                  </div>
                )}

                <button
                  onClick={handleSave}
                  disabled={saving || !form.host || !form.username || (!alreadyConfigured && !form.password)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-semibold rounded-2xl hover:from-emerald-600 hover:to-emerald-700 transition-all disabled:opacity-50 shadow-soft"
                >
                  {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {alreadyConfigured ? 'อัปเดต + ไปหน้า Login' : 'บันทึก + ไปหน้า Login'}
                </button>

                {alreadyConfigured && (
                  <button
                    onClick={() => navigate('/login')}
                    className="w-full text-xs text-primary-700 hover:text-primary-900 underline mt-1"
                  >
                    ข้ามไปหน้า login ทันที (ไม่แก้ไข)
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="mt-6 p-4 bg-amber-50 rounded-2xl text-xs text-amber-800">
          <p className="font-semibold mb-1 flex items-center gap-1">
            <Server className="w-3.5 h-3.5" /> สำคัญ
          </p>
          <ul className="space-y-1 list-disc list-inside">
            <li>ใช้ <strong>DB credentials</strong> ของฐานข้อมูล HOSxP (ไม่ใช่ user/password ของแอป HOSxP)</li>
            <li>หน้านี้เปิด public ได้แม้ login ไม่ผ่าน — เผื่อกรณีต้องแก้ connection</li>
            <li>หลังตั้งค่า login ด้วย username/password ของ HOSxP ที่หน้าถัดไป</li>
          </ul>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          BMS Finance Dashboard &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
