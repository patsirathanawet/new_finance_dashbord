import { useState, useEffect, useCallback } from 'react';
import {
  Table, CheckCircle, AlertCircle, Loader, KeyRound, ListChecks, Plus, X,
} from 'lucide-react';
import {
  getDbConfig, probeDbTables, updateRequiredTables,
  type DbConfigState,
} from '../lib/backendApi';
import { useSessionStore } from '../store/sessionStore';

export default function DbConfigPage() {
  const isAdmin = useSessionStore((s) => s.isAdmin);

  const [loading, setLoading] = useState(true);
  const [serverState, setServerState] = useState<DbConfigState | null>(null);

  const [probing, setProbing] = useState(false);
  const [tableResults, setTableResults] = useState<Record<string, boolean> | null>(null);

  const [tables, setTables] = useState<string[]>([]);
  const [newTable, setNewTable] = useState('');

  const [savingTables, setSavingTables] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const s = await getDbConfig();
      setServerState(s);
      if (s.configured) {
        setTables((s.requiredTables as string[]) ?? []);
      } else {
        setTables([...s.defaultRequiredTables]);
      }
    } catch (e) {
      console.error('load db-config failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleProbe = async () => {
    setProbing(true);
    setTableResults(null);
    try {
      const result = await probeDbTables({ tables });
      setTableResults(result.tables);
    } catch (e) {
      console.error('probe failed', e);
      setTableResults({});
    } finally {
      setProbing(false);
    }
  };

  const addTable = () => {
    const t = newTable.trim().toLowerCase();
    if (!t || tables.includes(t)) return;
    setTables([...tables, t]);
    setNewTable('');
  };

  const removeTable = (t: string) => setTables(tables.filter((x) => x !== t));

  const saveTables = async () => {
    setSavingTables(true);
    setSaveMessage(null);
    try {
      await updateRequiredTables(tables);
      setSaveMessage({ kind: 'ok', text: 'บันทึก list ตารางสำเร็จ' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (e) {
      setSaveMessage({
        kind: 'err',
        text: e instanceof Error ? e.message : 'บันทึกล้มเหลว',
      });
    } finally {
      setSavingTables(false);
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
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 bg-primary-100 rounded-2xl flex items-center justify-center">
          <Table className="w-6 h-6 text-primary-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">จัดการตารางที่ใช้งาน</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            กำหนด list ตารางที่ระบบต้องเข้าถึงในฐานข้อมูล HOSxP และตรวจสอบว่ามีอยู่จริง
            {!isAdmin && <span className="ml-2 text-xs text-amber-600">— admin เท่านั้นที่บันทึกได้</span>}
          </p>
        </div>
      </div>

      {!serverState?.configured && (
        <div className="bg-amber-50 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-800">ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล</p>
            <p className="text-xs text-gray-600 mt-0.5">
              ไปที่หน้า <a href="/setup" className="text-primary-700 underline">ตั้งค่าฐานข้อมูล HOSxP</a> ก่อน เพื่อเปิดใช้การตรวจสอบตาราง
            </p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-soft p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-primary-600" />
            <h2 className="text-sm font-semibold text-gray-900">
              ตารางที่จำเป็น
              <span className="ml-2 text-xs text-gray-400 font-normal">({tables.length} ตาราง)</span>
            </h2>
          </div>
          <button
            onClick={handleProbe}
            disabled={probing || !serverState?.configured}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-primary-600 rounded-2xl hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {probing ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
            ตรวจสอบ
          </button>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newTable}
              onChange={(e) => setNewTable(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTable()}
              placeholder="เพิ่มชื่อตาราง..."
              className="flex-1 px-3 py-2 rounded-2xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-300 text-sm font-mono"
            />
            <button
              onClick={addTable}
              disabled={!newTable.trim()}
              className="p-2 text-primary-700 bg-primary-100 rounded-2xl hover:bg-primary-200 transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="space-y-1.5">
          {tables.map((t) => {
            const status = tableResults?.[t];
            const checked = status === true;
            const missing = status === false;
            return (
              <div
                key={t}
                className={`flex items-center gap-2 px-3 py-2 rounded-2xl text-sm ${
                  checked ? 'bg-emerald-50' : missing ? 'bg-red-50' : 'bg-gray-50'
                }`}
              >
                {checked && <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />}
                {missing && <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />}
                {status === undefined && <KeyRound className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                <span className="font-mono flex-1">{t}</span>
                {checked && <span className="text-xs text-emerald-600 font-medium">มีอยู่</span>}
                {missing && <span className="text-xs text-red-600 font-medium">ไม่พบ</span>}
                {isAdmin && (
                  <button
                    onClick={() => removeTable(t)}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          {tables.length === 0 && (
            <p className="text-xs text-gray-400 py-2 text-center">ยังไม่มีตารางในรายการ</p>
          )}
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={saveTables}
              disabled={savingTables}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-2xl hover:from-emerald-600 hover:to-emerald-700 transition-all disabled:opacity-50 shadow-soft"
            >
              {savingTables ? <Loader className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              บันทึกรายการตาราง
            </button>
            {saveMessage && (
              <span className={`text-xs ${saveMessage.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                {saveMessage.text}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
