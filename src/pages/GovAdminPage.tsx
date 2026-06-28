import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, FileText, FileSpreadsheet, Eye, Search, ChevronDown,
} from 'lucide-react';
import { useUploadStore } from '../store/uploadStore';
import { formatCurrency, formatNumber, formatPercent } from '../lib/formatUtils';
import PieChartComponent from '../components/charts/PieChartComponent';
import BarChartComponent from '../components/charts/BarChartComponent';
import type { REPRecord, STMRecord } from '../types/upload';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface HospitalSummary {
  hospitalCode: string;
  hospitalName: string;
  repCount: number;
  stmCount: number;
  repTotalSubmitted: number;
  repTotalPassed: number;
  repTotalFailed: number;
  repTotalAmount: number;
  stmTotalCases: number;
  stmTotalAmount: number;
}

/* ------------------------------------------------------------------ */
/*  Helper: aggregate by hospital                                     */
/* ------------------------------------------------------------------ */

function buildHospitalSummaries(
  repRecords: REPRecord[],
  stmRecords: STMRecord[],
): HospitalSummary[] {
  const map = new Map<string, HospitalSummary>();

  const getOrCreate = (code: string, name: string): HospitalSummary => {
    let s = map.get(code);
    if (!s) {
      s = {
        hospitalCode: code,
        hospitalName: name || code,
        repCount: 0, stmCount: 0,
        repTotalSubmitted: 0, repTotalPassed: 0, repTotalFailed: 0, repTotalAmount: 0,
        stmTotalCases: 0, stmTotalAmount: 0,
      };
      map.set(code, s);
    }
    // Update name if we get a better one
    if (name && s.hospitalName === code) s.hospitalName = name;
    return s;
  };

  for (const r of repRecords) {
    const s = getOrCreate(r.hospitalCode, r.hospitalName);
    s.repCount++;
    s.repTotalSubmitted += r.totalSubmitted;
    s.repTotalPassed += r.totalPassed;
    s.repTotalFailed += r.totalFailed;
    s.repTotalAmount += r.totalAmount;
  }

  for (const r of stmRecords) {
    const s = getOrCreate(r.hospitalCode, r.hospitalName);
    s.stmCount++;
    s.stmTotalCases += r.totalCases;
    s.stmTotalAmount += r.totalAmount;
  }

  return Array.from(map.values()).sort((a, b) => {
    const totalA = a.repTotalAmount + a.stmTotalAmount;
    const totalB = b.repTotalAmount + b.stmTotalAmount;
    return totalB - totalA;
  });
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function KPIBox({ label, value, sub, colorClass = 'text-gray-900' }: {
  label: string; value: string; sub?: string; colorClass?: string;
}) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                    */
/* ------------------------------------------------------------------ */

export default function GovAdminPage() {
  const navigate = useNavigate();
  const { repRecords, stmRecords } = useUploadStore();
  const [selectedHospital, setSelectedHospital] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Build summaries
  const allSummaries = useMemo(
    () => buildHospitalSummaries(repRecords, stmRecords),
    [repRecords, stmRecords],
  );

  // Filtered REP/STM for selected hospital
  const filteredREP = useMemo(
    () => selectedHospital === 'all' ? repRecords : repRecords.filter((r) => r.hospitalCode === selectedHospital),
    [repRecords, selectedHospital],
  );
  const filteredSTM = useMemo(
    () => selectedHospital === 'all' ? stmRecords : stmRecords.filter((r) => r.hospitalCode === selectedHospital),
    [stmRecords, selectedHospital],
  );

  // Aggregate KPIs for selected scope
  const kpi = useMemo(() => {
    const summaries = selectedHospital === 'all'
      ? allSummaries
      : allSummaries.filter((s) => s.hospitalCode === selectedHospital);

    return summaries.reduce(
      (acc, s) => ({
        hospitals: acc.hospitals + 1,
        repFiles: acc.repFiles + s.repCount,
        stmFiles: acc.stmFiles + s.stmCount,
        repSubmitted: acc.repSubmitted + s.repTotalSubmitted,
        repPassed: acc.repPassed + s.repTotalPassed,
        repFailed: acc.repFailed + s.repTotalFailed,
        repAmount: acc.repAmount + s.repTotalAmount,
        stmCases: acc.stmCases + s.stmTotalCases,
        stmAmount: acc.stmAmount + s.stmTotalAmount,
      }),
      { hospitals: 0, repFiles: 0, stmFiles: 0, repSubmitted: 0, repPassed: 0, repFailed: 0, repAmount: 0, stmCases: 0, stmAmount: 0 },
    );
  }, [allSummaries, selectedHospital]);

  const approvalRate = kpi.repSubmitted > 0 ? (kpi.repPassed / kpi.repSubmitted) * 100 : 0;

  // Pie chart: REP amount per hospital
  const pieData = useMemo(() => {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
    return allSummaries.slice(0, 8).map((s, i) => ({
      name: s.hospitalName,
      value: s.repTotalAmount + s.stmTotalAmount,
      color: colors[i % colors.length],
    })).filter((d) => d.value > 0);
  }, [allSummaries]);

  // Bar chart: REP passed vs failed per hospital
  const barData = useMemo(() => {
    return allSummaries.map((s) => ({
      name: s.hospitalCode,
      ผ่าน: s.repTotalPassed,
      ไม่ผ่าน: s.repTotalFailed,
    }));
  }, [allSummaries]);

  // Search in table
  const filteredSummaries = useMemo(() => {
    if (!search) return allSummaries;
    const q = search.toLowerCase();
    return allSummaries.filter(
      (s) => s.hospitalCode.toLowerCase().includes(q) || s.hospitalName.toLowerCase().includes(q),
    );
  }, [allSummaries, search]);

  const selectedLabel = selectedHospital === 'all'
    ? 'ทุกโรงพยาบาล'
    : allSummaries.find((s) => s.hospitalCode === selectedHospital)?.hospitalName || selectedHospital;

  return (
    <div className="space-y-5">
      {/* Hospital selector */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-gray-900">ภาพรวม Admin — ข้าราชการ / กรมบัญชีกลาง</h2>
          <p className="text-sm text-gray-500 mt-0.5">ข้อมูลรวมจากไฟล์ REP/STM ที่อัปโหลดทุกโรงพยาบาล</p>
        </div>

        {/* Dropdown hospital selector */}
        <div className="relative">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 transition-colors text-sm min-w-[220px]"
          >
            <Building2 className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <span className="flex-1 text-left truncate font-medium text-gray-800">{selectedLabel}</span>
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isDropdownOpen && (
            <div className="absolute right-0 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
              {/* All option */}
              <button
                onClick={() => { setSelectedHospital('all'); setIsDropdownOpen(false); }}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-primary-50 transition-colors flex items-center gap-2 ${
                  selectedHospital === 'all' ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700'
                }`}
              >
                <Building2 className="w-4 h-4 flex-shrink-0" />
                ทุกโรงพยาบาล ({allSummaries.length})
              </button>
              <div className="border-t border-gray-100" />

              {/* Hospital list */}
              <div className="max-h-60 overflow-y-auto">
                {allSummaries.map((s) => (
                  <button
                    key={s.hospitalCode}
                    onClick={() => { setSelectedHospital(s.hospitalCode); setIsDropdownOpen(false); }}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-primary-50 transition-colors ${
                      selectedHospital === s.hospitalCode ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate">{s.hospitalName}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0 ml-2">{s.hospitalCode}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      REP {s.repCount} ไฟล์ · STM {s.stmCount} ไฟล์
                    </p>
                  </button>
                ))}
                {allSummaries.length === 0 && (
                  <p className="px-4 py-3 text-sm text-gray-400 text-center">ยังไม่มีข้อมูล</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPIBox
          label="โรงพยาบาล"
          value={formatNumber(kpi.hospitals)}
          sub="แห่ง"
          colorClass="text-primary-700"
        />
        <KPIBox
          label="ไฟล์ REP / STM"
          value={`${formatNumber(kpi.repFiles)} / ${formatNumber(kpi.stmFiles)}`}
          sub="ไฟล์"
        />
        <KPIBox
          label="ส่งเคลม REP ทั้งหมด"
          value={formatNumber(kpi.repSubmitted)}
          sub={`ผ่าน ${formatNumber(kpi.repPassed)} · ไม่ผ่าน ${formatNumber(kpi.repFailed)}`}
        />
        <KPIBox
          label="อัตราผ่าน REP"
          value={formatPercent(approvalRate)}
          colorClass={approvalRate >= 80 ? 'text-green-700' : approvalRate >= 60 ? 'text-yellow-700' : 'text-red-700'}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KPIBox label="ยอดเงิน REP" value={formatCurrency(kpi.repAmount)} colorClass="text-primary-700" />
        <KPIBox label="ยอดเงิน STM" value={formatCurrency(kpi.stmAmount)} colorClass="text-green-700" />
        <KPIBox label="ยอดรวมทั้งหมด" value={formatCurrency(kpi.repAmount + kpi.stmAmount)} colorClass="text-primary-700" />
      </div>

      {/* Charts */}
      {allSummaries.length > 0 && selectedHospital === 'all' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Pie: สัดส่วนยอดเงินตามโรงพยาบาล */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">สัดส่วนยอดเงินตามโรงพยาบาล</h3>
            <PieChartComponent
              data={pieData}
              height={240}
              formatter={(v) => formatCurrency(v)}
              innerRadius={50}
              outerRadius={90}
            />
          </div>

          {/* Bar: ผ่าน vs ไม่ผ่าน ตามโรงพยาบาล */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">ผลตรวจสอบ REP ตามโรงพยาบาล</h3>
            <BarChartComponent
              data={barData}
              xAxisKey="name"
              height={240}
              bars={[
                { dataKey: 'ผ่าน', name: 'ผ่าน', color: '#10b981' },
                { dataKey: 'ไม่ผ่าน', name: 'ไม่ผ่าน', color: '#ef4444' },
              ]}
              yAxisFormatter={(v) => formatNumber(v)}
            />
          </div>
        </div>
      )}

      {/* Hospital Summary Table (all mode) */}
      {selectedHospital === 'all' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
            <h3 className="text-sm font-semibold text-gray-700">
              สรุปตามโรงพยาบาล ({formatNumber(filteredSummaries.length)})
            </h3>
            <div className="relative ml-auto">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="ค้นหาโรงพยาบาล"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="text-xs pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-400 w-48"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-3 py-2 text-left font-medium text-gray-500">โรงพยาบาล</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">REP</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">STM</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">ส่งเคลม</th>
                  <th className="px-2 py-2 text-right font-medium text-green-600">ผ่าน</th>
                  <th className="px-2 py-2 text-right font-medium text-red-500">ไม่ผ่าน</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">อัตราผ่าน</th>
                  <th className="px-2 py-2 text-right font-medium text-primary-600">ยอด REP</th>
                  <th className="px-2 py-2 text-right font-medium text-green-600">ยอด STM</th>
                  <th className="px-2 py-2 text-center font-medium text-gray-500 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredSummaries.map((s) => {
                  const rate = s.repTotalSubmitted > 0 ? (s.repTotalPassed / s.repTotalSubmitted) * 100 : 0;
                  return (
                    <tr key={s.hospitalCode} className="hover:bg-gray-50/50">
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-gray-800">{s.hospitalName}</p>
                        <p className="text-gray-400">{s.hospitalCode}</p>
                      </td>
                      <td className="px-2 py-2.5 text-right text-gray-700">{s.repCount}</td>
                      <td className="px-2 py-2.5 text-right text-gray-700">{s.stmCount}</td>
                      <td className="px-2 py-2.5 text-right text-gray-700">{formatNumber(s.repTotalSubmitted)}</td>
                      <td className="px-2 py-2.5 text-right text-green-700 font-medium">{formatNumber(s.repTotalPassed)}</td>
                      <td className="px-2 py-2.5 text-right text-red-600">{formatNumber(s.repTotalFailed)}</td>
                      <td className="px-2 py-2.5 text-right">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          rate >= 80 ? 'bg-green-100 text-green-700'
                          : rate >= 60 ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                        }`}>
                          {formatPercent(rate)}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-right text-primary-700 font-medium whitespace-nowrap">
                        {formatCurrency(s.repTotalAmount)}
                      </td>
                      <td className="px-2 py-2.5 text-right text-green-700 font-medium whitespace-nowrap">
                        {formatCurrency(s.stmTotalAmount)}
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <button
                          onClick={() => setSelectedHospital(s.hospitalCode)}
                          className="p-1 text-primary-500 hover:bg-primary-50 rounded transition-colors"
                          title="ดูรายละเอียด"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredSummaries.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-gray-400">ไม่พบข้อมูล</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Selected Hospital Detail: REP list */}
      {selectedHospital !== 'all' && filteredREP.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary-500" />
              ไฟล์ REP ({filteredREP.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-3 py-2 text-left font-medium text-gray-500">ไฟล์</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">งวด</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">ส่ง</th>
                  <th className="px-2 py-2 text-right font-medium text-green-600">ผ่าน</th>
                  <th className="px-2 py-2 text-right font-medium text-red-500">ไม่ผ่าน</th>
                  <th className="px-2 py-2 text-right font-medium text-primary-600">ยอดเงิน</th>
                  <th className="px-2 py-2 text-center font-medium text-gray-500 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredREP.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/50">
                    <td className="px-3 py-2 text-gray-800 truncate max-w-[200px]">{r.fileName}</td>
                    <td className="px-2 py-2 text-right text-gray-700">{r.batchNo}</td>
                    <td className="px-2 py-2 text-right text-gray-700">{formatNumber(r.totalSubmitted)}</td>
                    <td className="px-2 py-2 text-right text-green-700 font-medium">{formatNumber(r.totalPassed)}</td>
                    <td className="px-2 py-2 text-right text-red-600">{formatNumber(r.totalFailed)}</td>
                    <td className="px-2 py-2 text-right text-primary-700 font-medium whitespace-nowrap">{formatCurrency(r.totalAmount)}</td>
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={() => navigate(`/government/rep/${r.id}`)}
                        className="p-1 text-primary-500 hover:bg-primary-50 rounded transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Selected Hospital Detail: STM list */}
      {selectedHospital !== 'all' && filteredSTM.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-green-500" />
              ไฟล์ STM ({filteredSTM.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-3 py-2 text-left font-medium text-gray-500">ไฟล์</th>
                  <th className="px-2 py-2 text-left font-medium text-gray-500">เลขที่เอกสาร</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">จำนวนราย</th>
                  <th className="px-2 py-2 text-right font-medium text-green-600">ยอดพึงรับ</th>
                  <th className="px-2 py-2 text-center font-medium text-gray-500 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredSTM.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/50">
                    <td className="px-3 py-2 text-gray-800 truncate max-w-[200px]">{r.fileName}</td>
                    <td className="px-2 py-2 text-gray-700">{r.docNo}</td>
                    <td className="px-2 py-2 text-right text-gray-700">{formatNumber(r.totalCases)}</td>
                    <td className="px-2 py-2 text-right text-green-700 font-medium whitespace-nowrap">{formatCurrency(r.totalAmount)}</td>
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={() => navigate(`/government/stm/${r.id}`)}
                        className="p-1 text-primary-500 hover:bg-primary-50 rounded transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {allSummaries.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">ยังไม่มีข้อมูลจากโรงพยาบาลใดๆ</p>
          <p className="text-xs mt-1">อัปโหลดไฟล์ REP หรือ STM ในแทบ "เอกสารเคลม" เพื่อเริ่มต้น</p>
        </div>
      )}
    </div>
  );
}
