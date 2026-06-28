import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Search } from 'lucide-react';
import { useUploadStore } from '../store/uploadStore';
import { repDB } from '../lib/db';
import { formatCurrency, formatNumber } from '../lib/formatUtils';
import PieChartComponent from '../components/charts/PieChartComponent';
import BarChartComponent from '../components/charts/BarChartComponent';
import type { REPRecord } from '../types/upload';

const TCODE_META: Record<string, { label: string; color: string; bg: string }> = {
  A: { label: 'ผ่าน', color: 'text-green-700', bg: 'bg-green-100' },
  T: { label: 'รอใบรับรอง', color: 'text-yellow-700', bg: 'bg-yellow-100' },
  C: { label: 'ต้องแก้ไข', color: 'text-red-700', bg: 'bg-red-100' },
};

export default function GovREPPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const repRecords = useUploadStore((s) => s.repRecords);

  const fromStore = useMemo(
    () => (id ? repRecords.find((r) => r.id === id) ?? null : null),
    [id, repRecords],
  );

  const { data: fetchedRecord, isFetching } = useQuery<REPRecord | null, Error, REPRecord | null>({
    queryKey: ['govRepRecord', id],
    queryFn: async () => (id ? repDB.get(id).then((r) => r ?? null) : null),
    enabled: Boolean(id && !fromStore),
    staleTime: Infinity,
  });

  const record = fromStore ?? fetchedRecord;
  const loading = Boolean(!record && id && isFetching);
  const [tcodeFilter, setTcodeFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [search, setSearch] = useState('');

  const stats = useMemo(() => {
    if (!record) return null;
    const passed = record.cases.filter((c) => c.tcode === 'A').length;
    const wait = record.cases.filter((c) => c.tcode === 'T').length;
    const failed = record.cases.filter((c) => c.tcode === 'C').length;

    const errorMap: Record<string, number> = {};
    for (const c of record.cases) {
      for (const e of c.errors) {
        errorMap[e.code] = (errorMap[e.code] ?? 0) + 1;
      }
    }
    const topErrors = Object.entries(errorMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([code, count]) => ({ name: code, count }));

    const cipn = record.cases.filter((c) => c.section === 'CIPN').length;
    const csmbs = record.cases.filter((c) => c.section === 'CSMBS').length;
    const waitSect = record.cases.filter((c) => c.section === 'WAIT').length;

    return { passed, wait, failed, topErrors, cipn, csmbs, waitSect };
  }, [record]);

  const filteredCases = useMemo(() => {
    if (!record) return [];
    return record.cases.filter((c) => {
      if (tcodeFilter !== 'all' && c.tcode !== tcodeFilter) return false;
      if (sectionFilter !== 'all' && c.section !== sectionFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!c.an.toLowerCase().includes(q) && !c.patientName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [record, tcodeFilter, sectionFilter, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
        กำลังโหลด...
      </div>
    );
  }
  if (!record) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 text-sm">ไม่พบข้อมูล REP</p>
        <button onClick={() => navigate(-1)} className="mt-3 text-primary-600 text-sm hover:underline">
          ← กลับ
        </button>
      </div>
    );
  }

  const pieData = stats
    ? [
        { name: 'ผ่าน', value: stats.passed, color: '#10b981' },
        { name: 'รอใบรับรอง', value: stats.wait, color: '#f59e0b' },
        { name: 'ต้องแก้ไข', value: stats.failed, color: '#ef4444' },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors flex-shrink-0 mt-0.5"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <FileText className="w-5 h-5 text-primary-500" />
            <h2 className="text-xl font-bold text-gray-900">{record.fileName}</h2>
          </div>
          <p className="text-sm text-gray-500">
            {record.hospitalName || record.hospitalCode} · งวดที่ {record.batchNo}
            {record.issueDate && ` · ${record.issueDate}`}
            {record.refNo && ` · Ref: ${record.refNo}`}
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">ส่งทั้งหมด</p>
          <p className="text-2xl font-bold text-gray-900">{formatNumber(record.totalSubmitted)}</p>
          <p className="text-xs text-gray-400 mt-0.5">ราย</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4 shadow-sm border border-green-100">
          <p className="text-xs text-gray-500 mb-1">ผ่านการอนุมัติ</p>
          <p className="text-2xl font-bold text-green-700">{formatNumber(record.totalPassed)}</p>
          <p className="text-xs text-green-600 mt-0.5">
            {record.totalSubmitted > 0
              ? `${((record.totalPassed / record.totalSubmitted) * 100).toFixed(1)}%`
              : '0%'}
          </p>
        </div>
        <div className="bg-red-50 rounded-xl p-4 shadow-sm border border-red-100">
          <p className="text-xs text-gray-500 mb-1">ไม่ผ่าน / รอ</p>
          <p className="text-2xl font-bold text-red-600">
            {formatNumber(record.totalFailed + (stats?.wait ?? 0))}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">ราย</p>
        </div>
        <div className="bg-primary-50 rounded-xl p-4 shadow-sm border border-primary-100">
          <p className="text-xs text-gray-500 mb-1">ยอดเงินรวม</p>
          <p className="text-xl font-bold text-primary-700">{formatCurrency(record.totalAmount)}</p>
          {record.amountRoom > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">ค่าห้อง {formatCurrency(record.amountRoom)}</p>
          )}
        </div>
      </div>

      {/* Charts */}
      {stats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">ผลการตรวจสอบ</h3>
            <PieChartComponent
              data={pieData}
              height={220}
              formatter={(v) => `${formatNumber(v)} ราย`}
              innerRadius={60}
              outerRadius={90}
            />
          </div>
          {stats.topErrors.length > 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                รหัสข้อผิดพลาด (top {stats.topErrors.length})
              </h3>
              <BarChartComponent
                data={stats.topErrors}
                bars={[{ dataKey: 'count', name: 'จำนวน', color: '#ef4444' }]}
                xAxisKey="name"
                height={220}
                yAxisFormatter={(v) => formatNumber(v)}
              />
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center justify-center">
              <p className="text-sm text-gray-400">ไม่มีรหัสข้อผิดพลาด</p>
            </div>
          )}
        </div>
      )}

      {/* Section Summary */}
      {stats && (stats.cipn > 0 || stats.csmbs > 0) && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">สรุปตามกลุ่ม</h3>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'CIPN', count: stats.cipn, colorBg: 'bg-primary-50', colorText: 'text-primary-700' },
              { label: 'CSMBS', count: stats.csmbs, colorBg: 'bg-purple-50', colorText: 'text-purple-700' },
              { label: 'WAIT', count: stats.waitSect, colorBg: 'bg-gray-50', colorText: 'text-gray-600' },
            ]
              .filter(({ count }) => count > 0)
              .map(({ label, count, colorBg, colorText }) => (
                <div key={label} className={`rounded-lg p-3 text-center ${colorBg}`}>
                  <p className={`text-xs mb-1 opacity-70 ${colorText}`}>{label}</p>
                  <p className={`text-lg font-bold ${colorText}`}>{formatNumber(count)} ราย</p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Case Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">
            รายการเคส ({filteredCases.length}/{record.cases.length})
          </h3>
          <div className="flex flex-wrap gap-1 ml-2">
            {(['all', 'A', 'T', 'C'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTcodeFilter(t)}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                  tcodeFilter === t
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t === 'all' ? 'ทั้งหมด' : TCODE_META[t].label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {(['all', 'CIPN', 'CSMBS', 'WAIT'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSectionFilter(s)}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                  sectionFilter === s
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s === 'all' ? 'ทุก Section' : s}
              </button>
            ))}
          </div>
          <div className="relative ml-auto">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="ค้นหา AN / ชื่อ"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-xs pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-400 w-44"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2 text-left font-medium text-gray-500 w-8">#</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">AN</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">ชื่อ-สกุล</th>
                <th className="px-2 py-2 text-center font-medium text-gray-500">Section</th>
                <th className="px-2 py-2 text-center font-medium text-gray-500">ประเภท</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500">DRG</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500">adjRW</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500">ยอดเงิน</th>
                <th className="px-2 py-2 text-center font-medium text-gray-500">สถานะ</th>
                <th className="px-2 py-2 text-left font-medium text-gray-500">รหัสข้อผิดพลาด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredCases.map((c, idx) => {
                const meta = TCODE_META[c.tcode] ?? {
                  label: c.tcode,
                  color: 'text-gray-600',
                  bg: 'bg-gray-100',
                };
                return (
                  <tr key={`${c.an}-${idx}`} className="hover:bg-gray-50/50">
                    <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                    <td className="px-3 py-2 font-mono text-gray-700">{c.an}</td>
                    <td className="px-3 py-2 text-gray-800 whitespace-nowrap">{c.patientName}</td>
                    <td className="px-2 py-2 text-center">
                      <span
                        className={`px-1.5 py-0.5 rounded text-xs ${
                          c.section === 'CIPN'
                            ? 'bg-primary-50 text-primary-600'
                            : c.section === 'CSMBS'
                            ? 'bg-purple-50 text-purple-600'
                            : 'bg-gray-50 text-gray-500'
                        }`}
                      >
                        {c.section}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center text-gray-600">{c.chargeType}</td>
                    <td className="px-2 py-2 text-right text-gray-700">{c.drg ?? '-'}</td>
                    <td className="px-2 py-2 text-right text-gray-700 font-mono">
                      {c.adjrw != null ? c.adjrw.toFixed(4) : '-'}
                    </td>
                    <td className="px-2 py-2 text-right font-medium text-primary-700 whitespace-nowrap">
                      {c.amdrg != null ? formatCurrency(c.amdrg) : '-'}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${meta.bg} ${meta.color}`}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      {c.errors.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {c.errors.map((e, i) => (
                            <span
                              key={i}
                              title={e.desc}
                              className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded text-xs cursor-default"
                            >
                              {e.code}
                            </span>
                          ))}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredCases.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-gray-400">
                    ไม่พบข้อมูล
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
