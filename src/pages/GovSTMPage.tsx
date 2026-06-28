import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileSpreadsheet, Search } from 'lucide-react';
import { useUploadStore } from '../store/uploadStore';
import { stmDB } from '../lib/db';
import { formatCurrency, formatNumber } from '../lib/formatUtils';
import type { STMRecord } from '../types/upload';

export default function GovSTMPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const stmRecords = useUploadStore((s) => s.stmRecords);

  const fromStore = useMemo(
    () => (id ? stmRecords.find((r) => r.id === id) ?? null : null),
    [id, stmRecords],
  );

  const { data: fetchedRecord, isFetching } = useQuery<STMRecord | null, Error, STMRecord | null>({
    queryKey: ['govStmRecord', id],
    queryFn: async () => (id ? stmDB.get(id).then((r) => r ?? null) : null),
    enabled: Boolean(id && !fromStore),
    staleTime: Infinity,
  });

  const record = fromStore ?? fetchedRecord;
  const loading = Boolean(!record && id && isFetching);
  const [search, setSearch] = useState('');

  const feeTotal = useMemo(() => {
    if (!record) return null;
    return {
      room: record.cases.reduce((s, c) => s + (c.roomFee ?? 0), 0),
      treatment: record.cases.reduce((s, c) => s + (c.treatmentFee ?? 0), 0),
      drug: record.cases.reduce((s, c) => s + (c.drugFee ?? 0), 0),
      prosthetic: record.cases.reduce((s, c) => s + (c.prostheticFee ?? 0), 0),
      transport: record.cases.reduce((s, c) => s + (c.transportFee ?? 0), 0),
      waiting: record.cases.reduce((s, c) => s + (c.waitingFee ?? 0), 0),
      other: record.cases.reduce((s, c) => s + (c.otherFee ?? 0), 0),
      claimable: record.cases.reduce((s, c) => s + (c.claimable ?? 0), 0),
      nonClaimable: record.cases.reduce((s, c) => s + (c.nonClaimable ?? 0), 0),
      selfPay: record.cases.reduce((s, c) => s + (c.selfPay ?? 0), 0),
    };
  }, [record]);

  const filteredCases = useMemo(() => {
    if (!record) return [];
    if (!search) return record.cases;
    const q = search.toLowerCase();
    return record.cases.filter((c) => c.patientName.toLowerCase().includes(q));
  }, [record, search]);

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
        <p className="text-gray-500 text-sm">ไม่พบข้อมูล STM</p>
        <button onClick={() => navigate(-1)} className="mt-3 text-primary-600 text-sm hover:underline">
          ← กลับ
        </button>
      </div>
    );
  }

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
            <FileSpreadsheet className="w-5 h-5 text-green-500" />
            <h2 className="text-xl font-bold text-gray-900">{record.fileName}</h2>
          </div>
          <p className="text-sm text-gray-500">
            {record.hospitalName || record.hospitalCode} · เลขที่: {record.docNo}
            {record.period && ` · งวด ${record.period}`}
            {record.issueDate && ` · ${record.issueDate}`}
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">จำนวนราย</p>
          <p className="text-2xl font-bold text-gray-900">{formatNumber(record.totalCases)}</p>
          <p className="text-xs text-gray-400 mt-0.5">ราย</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4 shadow-sm border border-green-100">
          <p className="text-xs text-gray-500 mb-1">ยอดพึงรับทั้งหมด</p>
          <p className="text-xl font-bold text-green-700">{formatCurrency(record.totalAmount)}</p>
        </div>
        {feeTotal && (
          <>
            <div className="bg-primary-50 rounded-xl p-4 shadow-sm border border-primary-100">
              <p className="text-xs text-gray-500 mb-1">เบิกได้</p>
              <p className="text-xl font-bold text-primary-700">{formatCurrency(feeTotal.claimable)}</p>
            </div>
            <div className="bg-red-50 rounded-xl p-4 shadow-sm border border-red-100">
              <p className="text-xs text-gray-500 mb-1">เบิกไม่ได้</p>
              <p className="text-xl font-bold text-red-600">{formatCurrency(feeTotal.nonClaimable)}</p>
            </div>
          </>
        )}
      </div>

      {/* Fee Breakdown */}
      {feeTotal && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">รายละเอียดค่าใช้จ่าย</h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {[
              { label: 'ค่าห้อง', value: feeTotal.room },
              { label: 'ค่ารักษา', value: feeTotal.treatment },
              { label: 'ค่ายา', value: feeTotal.drug },
              { label: 'อวัยวะเทียม', value: feeTotal.prosthetic },
              { label: 'ค่ารถ', value: feeTotal.transport },
              { label: 'พักรอจำหน่าย', value: feeTotal.waiting },
              { label: 'ค่าบริการอื่นๆ', value: feeTotal.other },
            ]
              .filter((f) => f.value > 0)
              .map(({ label, value }) => (
                <div key={label} className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-xs text-gray-500 mb-0.5 leading-tight">{label}</p>
                  <p className="text-xs font-semibold text-gray-800">{formatCurrency(value)}</p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Case Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-700">
            รายการ ({filteredCases.length}/{record.cases.length})
          </h3>
          <div className="relative ml-auto">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="ค้นหาชื่อ"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-xs pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-green-400 w-44"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-2 py-2 text-right font-medium text-gray-500 w-10">ลำดับ</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">ชื่อ-สกุล</th>
                <th className="px-2 py-2 text-center font-medium text-gray-500">วันเข้า</th>
                <th className="px-2 py-2 text-center font-medium text-gray-500">วันออก</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500">ค่าห้อง</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500">ค่ารักษา</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500">ค่ายา</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500">อวัยวะ</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500">รถ</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500">รอจำหน่าย</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500">อื่นๆ</th>
                <th className="px-2 py-2 text-right font-medium text-green-600">เบิกได้</th>
                <th className="px-2 py-2 text-right font-medium text-red-500">เบิกไม่ได้</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500">ชำระเอง</th>
                <th className="px-2 py-2 text-right font-medium text-gray-700 bg-green-50/50">รวม</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredCases.map((c) => (
                <tr key={c.seq} className="hover:bg-gray-50/50">
                  <td className="px-2 py-2 text-right text-gray-400">{c.seq}</td>
                  <td className="px-3 py-2 text-gray-800 whitespace-nowrap">{c.patientName}</td>
                  <td className="px-2 py-2 text-center text-gray-600 whitespace-nowrap">
                    {c.admitDate ?? '-'}
                  </td>
                  <td className="px-2 py-2 text-center text-gray-600 whitespace-nowrap">
                    {c.dischargeDate ?? '-'}
                  </td>
                  <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap">
                    {c.roomFee != null ? formatCurrency(c.roomFee) : '-'}
                  </td>
                  <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap">
                    {c.treatmentFee != null ? formatCurrency(c.treatmentFee) : '-'}
                  </td>
                  <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap">
                    {c.drugFee != null ? formatCurrency(c.drugFee) : '-'}
                  </td>
                  <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap">
                    {c.prostheticFee != null ? formatCurrency(c.prostheticFee) : '-'}
                  </td>
                  <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap">
                    {c.transportFee != null ? formatCurrency(c.transportFee) : '-'}
                  </td>
                  <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap">
                    {c.waitingFee != null ? formatCurrency(c.waitingFee) : '-'}
                  </td>
                  <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap">
                    {c.otherFee != null ? formatCurrency(c.otherFee) : '-'}
                  </td>
                  <td className="px-2 py-2 text-right text-green-700 font-medium whitespace-nowrap">
                    {c.claimable != null ? formatCurrency(c.claimable) : '-'}
                  </td>
                  <td className="px-2 py-2 text-right text-red-600 whitespace-nowrap">
                    {c.nonClaimable != null ? formatCurrency(c.nonClaimable) : '-'}
                  </td>
                  <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap">
                    {c.selfPay != null ? formatCurrency(c.selfPay) : '-'}
                  </td>
                  <td className="px-2 py-2 text-right font-bold text-gray-900 whitespace-nowrap bg-green-50/50">
                    {formatCurrency(c.totalAmount)}
                  </td>
                </tr>
              ))}
              {filteredCases.length === 0 && (
                <tr>
                  <td colSpan={15} className="px-4 py-10 text-center text-gray-400">
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
