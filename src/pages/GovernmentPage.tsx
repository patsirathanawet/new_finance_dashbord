import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart2, ShieldCheck, FolderArchive, Users, DollarSign, Calendar } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import FinanceFundPage from './FinanceFundPage';
import GovAdminPage from './GovAdminPage';
import { PTTYPE } from '../queries/finance';
import { useSessionStore } from '../store/sessionStore';
import { useClaim16Store } from '../store/claim16Store';
import { useClaim16Monthly } from '../queries/claim16Dashboard';
import { formatNumber, formatCurrency } from '../lib/formatUtils';

/** "2024-07" → "ก.ค. 67" (พ.ศ. ย่อ) */
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function formatThaiMonth(ym: string): string {
  const [y, m] = ym.split('-');
  const beYear = (parseInt(y, 10) + 543) % 100;
  const monthIdx = parseInt(m, 10) - 1;
  return `${TH_MONTHS[monthIdx] ?? m} ${String(beYear).padStart(2, '0')}`;
}

export default function GovernmentPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'overview';

  const hospitalCode = useSessionStore((s) => s.hospitalCode);
  const isAdmin = useSessionStore((s) => s.isAdmin);

  // Load claim16 records (สำหรับสรุป 16 แฟ้มในหน้านี้)
  useEffect(() => {
    useClaim16Store.getState().loadByHospital(isAdmin ? '*' : hospitalCode ?? '*');
  }, [isAdmin, hospitalCode]);

  // ข้อมูลยอดต่อเดือนจาก backend (รวมจาก rawData ของทุก record ที่ imported)
  const monthlyQuery = useClaim16Monthly();
  const monthly = monthlyQuery.data;

  // เลือกเดือน "all" = รวมทั้งหมด, หรือ "YYYY-MM"
  const [selectedMonth, setSelectedMonth] = useState<string>('all');

  // สรุปที่จะแสดงใน card — ตาม selectedMonth
  const displayedStats = useMemo(() => {
    if (!monthly) return null;
    if (selectedMonth === 'all') return { ...monthly.total, label: 'ทั้งหมด' };
    const m = monthly.months.find((x) => x.month === selectedMonth);
    if (!m) return { opdVisits: 0, ipdAdmissions: 0, totalVisits: 0, totalAmount: 0, label: formatThaiMonth(selectedMonth) };
    return {
      opdVisits: m.opdVisits,
      ipdAdmissions: m.ipdAdmissions,
      totalVisits: m.totalVisits,
      totalAmount: m.totalAmount,
      label: formatThaiMonth(selectedMonth),
    };
  }, [monthly, selectedMonth]);

  const hasData = !!monthly && monthly.recordCount > 0;

  return (
    <div className="space-y-5">
      {/* Tab navigation — pill style */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {[
          { key: 'overview', label: 'ภาพรวมการเงิน', icon: BarChart2 },
          // 'claim16' (นำเข้า 16 แฟ้ม) — ปิดไว้ก่อน
          // 'claims' (เอกสารเคลม REP/STM) — ย้ายไปเป็น sidebar menu /claims แล้ว
          ...(isAdmin ? [{ key: 'admin', label: 'ภาพรวม Admin', icon: ShieldCheck }] : []),
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setSearchParams({ tab: key })}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-2xl transition-all whitespace-nowrap ${
              tab === key
                ? 'bg-primary-600 text-white shadow-soft'
                : 'bg-white text-gray-600 hover:text-primary-700 hover:bg-primary-50 shadow-card'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <>
          <FinanceFundPage
            title="ข้าราชการ / กรมบัญชีกลาง"
            pttype={PTTYPE.GOVERNMENT}
            fundDescription="กองทุนสวัสดิการรักษาพยาบาลข้าราชการ (กรมบัญชีกลาง OFC)"
          />

          {/* ยอดจาก 16 แฟ้มที่นำเข้าแล้ว — แยกตามเดือน */}
          {hasData && displayedStats && monthly && (
            <div className="bg-white rounded-2xl shadow-soft p-6 space-y-5">
              {/* Header + month selector */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-primary-50 flex items-center justify-center">
                    <FolderArchive className="w-5 h-5 text-primary-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">ข้อมูลจาก 16 แฟ้มที่นำเข้าแล้ว</h3>
                    <p className="text-xs text-gray-400">{monthly.recordCount} ชุดข้อมูล</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-primary-50 px-3 py-2 rounded-2xl">
                  <Calendar className="w-4 h-4 text-primary-600" />
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="text-sm bg-transparent focus:outline-none text-primary-700 font-medium pr-2"
                  >
                    <option value="all">ทั้งหมด</option>
                    {monthly.months.map((m) => (
                      <option key={m.month} value={m.month}>{formatThaiMonth(m.month)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-gradient-to-br from-primary-50 to-primary-100/50 rounded-2xl p-4">
                  <Users className="w-5 h-5 text-primary-600 mb-2" />
                  <p className="text-xs text-gray-500">จำนวน Visit ({displayedStats.label})</p>
                  <p className="text-2xl font-bold text-primary-700 mt-1">{formatNumber(displayedStats.totalVisits)}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    OPD {formatNumber(displayedStats.opdVisits)} · IPD {formatNumber(displayedStats.ipdAdmissions)}
                  </p>
                </div>
                <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 rounded-2xl p-4">
                  <DollarSign className="w-5 h-5 text-emerald-600 mb-2" />
                  <p className="text-xs text-gray-500">มูลค่ารวม ({displayedStats.label})</p>
                  <p className="text-2xl font-bold text-emerald-700 mt-1">{formatCurrency(displayedStats.totalAmount)}</p>
                </div>
                <div className="bg-gradient-to-br from-primary-50 to-primary-100/50 rounded-2xl p-4">
                  <Users className="w-5 h-5 text-primary-600 mb-2" />
                  <p className="text-xs text-gray-500">OPD Visits</p>
                  <p className="text-2xl font-bold text-primary-700 mt-1">{formatNumber(displayedStats.opdVisits)}</p>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 rounded-2xl p-4">
                  <Users className="w-5 h-5 text-purple-600 mb-2" />
                  <p className="text-xs text-gray-500">IPD Admissions</p>
                  <p className="text-2xl font-bold text-purple-700 mt-1">{formatNumber(displayedStats.ipdAdmissions)}</p>
                </div>
              </div>

              {/* Monthly trend chart */}
              {monthly.months.length > 1 && (
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-xs text-gray-500 mb-2">แนวโน้มต่อเดือน</p>
                  <div style={{ width: '100%', height: 220 }}>
                    <ResponsiveContainer>
                      <BarChart
                        data={monthly.months.map((m) => ({ ...m, label: formatThaiMonth(m.month) }))}
                        margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                        <Tooltip
                          formatter={(value, name) => {
                            const v = typeof value === 'number' ? value : parseFloat(String(value));
                            return name === 'มูลค่ารวม' ? formatCurrency(v) : formatNumber(v);
                          }}
                          contentStyle={{ fontSize: 12 }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar yAxisId="left" dataKey="opdVisits" name="OPD" fill="#6366f1" radius={[3, 3, 0, 0]} />
                        <Bar yAxisId="left" dataKey="ipdAdmissions" name="IPD" fill="#a855f7" radius={[3, 3, 0, 0]} />
                        <Bar yAxisId="right" dataKey="totalAmount" name="มูลค่ารวม" fill="#10b981" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Loading / empty state */}
          {monthlyQuery.isLoading && (
            <div className="text-xs text-gray-400">กำลังโหลดข้อมูลสรุป 16 แฟ้ม...</div>
          )}
        </>
      )}
      {tab === 'admin' && isAdmin && <GovAdminPage />}
    </div>
  );
}
