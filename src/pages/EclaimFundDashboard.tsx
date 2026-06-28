import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Navigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  FileBarChart, Users, CheckCircle2, AlertTriangle, Coins, Loader, X, AlertOctagon,
  ChevronDown, ChevronRight, Download,
} from 'lucide-react';
import {
  ResponsiveContainer, Tooltip, Legend, PieChart, Pie, Cell,
} from 'recharts';
import {
  getClaimSummary, listRepBatches, getRepBatch, getClaimErrorSummary, getClaimErrorDetail,
  listEclaimErrorCodes, getFailedExport,
  listSsopRepBatches, getSsopRepBatch, getSsopRepSummary,
  listCsopRepBatches, getCsopRepBatch, getCsopRepSummary,
  listAipnRepBatches, getAipnRepBatch, getAipnRepSummary,
  extractErrorMessage,
  type ClaimSummary, type RepBatch, type RepBatchDetail, type ErrorSummary, type ErrorDetailRow,
  type SsopRepBatch, type SsopRepBatchDetail,
  type CsopRepBatch, type CsopRepBatchDetail,
  type AipnRepBatch, type AipnRepBatchDetail,
} from '../lib/backendApi';
import { formatCurrency, formatNumber } from '../lib/formatUtils';
import { useDateFilter } from '../hooks/useDateFilter';
import { getFundMeta, type FundMeta } from '../lib/eclaimFunds';

function KPICard({
  title, value, subtitle, icon: Icon, color,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: typeof Users;
  color: 'primary' | 'emerald' | 'red' | 'amber';
}) {
  const colorMap = {
    primary: 'bg-primary-50 text-primary-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    red:     'bg-red-50 text-red-600',
    amber:   'bg-amber-50 text-amber-600',
  };
  return (
    <div className="bg-white rounded-2xl shadow-soft p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-gray-500">{title}</p>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${colorMap[color]}`}>
          <Icon className="w-4.5 h-4.5" />
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
    </div>
  );
}

/** Pie chart 2 รูปต่อ rep — รูปซ้าย = จำนวน visit ผ่าน/ไม่ผ่าน, รูปขวา = ยอดเงิน ผ่าน/ไม่ผ่าน */
function RepPieCharts({ head }: { head: Record<string, unknown> }) {
  const passedCount = Number(head.total_passed ?? 0);
  const failedCount = Number(head.total_failed ?? 0);
  const passedAmt = Number(head.passed_amount ?? 0);
  const failedAmt = Number(head.failed_amount ?? 0);

  const visitData = [
    { name: 'ผ่าน', value: passedCount, color: '#10b981' },
    { name: 'ไม่ผ่าน', value: failedCount, color: '#ef4444' },
  ].filter((d) => d.value > 0);

  const amountData = [
    { name: 'ยอดที่ผ่าน', value: passedAmt, color: '#10b981' },
    { name: 'ยอดที่ไม่ผ่าน', value: failedAmt, color: '#ef4444' },
  ].filter((d) => d.value > 0);

  if (visitData.length === 0 && amountData.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
      {/* จำนวน visit */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4">
        <h4 className="text-xs font-semibold text-gray-700 mb-2 text-center">สัดส่วนจำนวน Visit</h4>
        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={visitData}
                cx="50%"
                cy="50%"
                outerRadius={70}
                innerRadius={35}
                dataKey="value"
                labelLine={false}
                label={({ percent }) =>
                  percent != null && percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ''
                }
              >
                {visitData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip
                formatter={(value, _name, item) => {
                  const v = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
                  const total = visitData.reduce((s, d) => s + d.value, 0);
                  const pct = total > 0 ? (v / total) * 100 : 0;
                  return [`${formatNumber(v)} ราย (${pct.toFixed(1)}%)`, String(item?.name ?? '')];
                }}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                content={() => (
                  <div className="flex justify-center gap-4 pt-1 text-xs">
                    {visitData.map((d) => (
                      <div key={d.name} className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
                        <span className="text-gray-600">{d.name}</span>
                        <span className="font-mono font-semibold">{formatNumber(d.value)}</span>
                      </div>
                    ))}
                  </div>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ยอดเงิน */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4">
        <h4 className="text-xs font-semibold text-gray-700 mb-2 text-center">สัดส่วนยอดเงิน</h4>
        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={amountData}
                cx="50%"
                cy="50%"
                outerRadius={70}
                innerRadius={35}
                dataKey="value"
                labelLine={false}
                label={({ percent }) =>
                  percent != null && percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ''
                }
              >
                {amountData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip
                formatter={(value, _name, item) => {
                  const v = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
                  const total = amountData.reduce((s, d) => s + d.value, 0);
                  const pct = total > 0 ? (v / total) * 100 : 0;
                  return [`${formatCurrency(v)} (${pct.toFixed(1)}%)`, String(item?.name ?? '')];
                }}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend
                content={() => (
                  <div className="flex justify-center gap-4 pt-1 text-xs">
                    {amountData.map((d) => (
                      <div key={d.name} className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
                        <span className="text-gray-600">{d.name}</span>
                        <span className="font-mono font-semibold">{formatCurrency(d.value)}</span>
                      </div>
                    ))}
                  </div>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function DetailDrawer({ repNo, onClose }: { repNo: string; onClose: () => void }) {
  const { data, isLoading, error: queryError } = useQuery<RepBatchDetail | null>({
    queryKey: ['repBatch', repNo],
    queryFn: async () => getRepBatch(repNo),
    enabled: Boolean(repNo),
    retry: false,
    staleTime: Infinity,
  });

  const loading = isLoading;
  const error = queryError instanceof Error ? queryError.message : null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-soft w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-primary-500 to-primary-700 px-6 py-4 flex items-center justify-between text-white">
          <h2 className="text-sm font-semibold">รายละเอียดงวด: {repNo}</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-6 h-6 text-primary-600 animate-spin" />
            </div>
          )}
          {error && <div className="text-red-700 bg-red-50 p-3 rounded-2xl text-sm">{error}</div>}
          {data && (
            <>
              {/* Head summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <div className="bg-gray-50 rounded-2xl p-3 text-center">
                  <p className="text-xs text-gray-500">ส่งทั้งหมด</p>
                  <p className="text-lg font-bold text-gray-900">{formatNumber(Number(data.head.total_submitted))}</p>
                </div>
                <div className="bg-green-50 rounded-2xl p-3 text-center">
                  <p className="text-xs text-gray-500">ผ่าน</p>
                  <p className="text-lg font-bold text-green-700">{formatNumber(Number(data.head.total_passed))}</p>
                </div>
                <div className="bg-red-50 rounded-2xl p-3 text-center">
                  <p className="text-xs text-gray-500">ไม่ผ่าน</p>
                  <p className="text-lg font-bold text-red-700">{formatNumber(Number(data.head.total_failed))}</p>
                </div>
                <div className="bg-primary-50 rounded-2xl p-3 text-center">
                  <p className="text-xs text-gray-500">ยอดรวม</p>
                  <p className="text-lg font-bold text-primary-700">{formatCurrency(Number(data.head.passed_amount ?? 0) + Number(data.head.failed_amount ?? 0))}</p>
                </div>
              </div>

              {/* Pie charts: visits + amount */}
              <RepPieCharts head={data.head} />

              {/* Detail table */}
              <div className="overflow-x-auto rounded-2xl border border-gray-100">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">#</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">AN/HN</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">ชื่อ-สกุล</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">วันเข้า</th>
                      <th className="px-2 py-2 text-right font-semibold text-gray-600">ชดเชย</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">กองทุน</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.details.map((d, i) => {
                      const compAmt = Number(d.comp_amount ?? 0) + Number(d.comp_pp ?? 0);
                      const err = String(d.error_code ?? '').trim();
                      const passed = !err || err === '-';
                      return (
                        <tr key={i} className={passed ? '' : 'bg-red-50/30'}>
                          <td className="px-2 py-1.5 text-gray-500">{String(d.seq_no)}</td>
                          <td className="px-2 py-1.5 font-mono">{String(d.an || d.hn || '-')}</td>
                          <td className="px-2 py-1.5">{String(d.patient_name ?? '-')}</td>
                          <td className="px-2 py-1.5 text-gray-500">{String(d.admit_date ?? '-')}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{formatCurrency(compAmt)}</td>
                          <td className="px-2 py-1.5 text-xs text-gray-600">{String(d.fund ?? '-')}</td>
                          <td className={`px-2 py-1.5 text-xs ${passed ? 'text-gray-400' : 'text-red-700 font-semibold'}`}>{err || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-3 text-center">{data.details.length} รายการ</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Detail drawer สำหรับเอกสารตอบรับ สปส. (ssop_rep_head/detail) — แสดงเฉพาะหน้า SSS */
function SsopDetailDrawer({ ackNo, onClose }: { ackNo: string; onClose: () => void }) {
  const { data, isLoading, error: queryError } = useQuery<SsopRepBatchDetail | null>({
    queryKey: ['ssopRepBatch', ackNo],
    queryFn: async () => getSsopRepBatch(ackNo),
    enabled: Boolean(ackNo),
    retry: false,
    staleTime: Infinity,
  });

  const loading = isLoading;
  const error = queryError instanceof Error ? queryError.message : null;
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-soft w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-purple-500 to-purple-700 px-6 py-4 flex items-center justify-between text-white">
          <h2 className="text-sm font-semibold">เอกสารตอบรับ สปส. เลขที่ตอบรับ: {ackNo}</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-6 h-6 text-purple-600 animate-spin" />
            </div>
          )}
          {error && <div className="text-red-700 bg-red-50 p-3 rounded-2xl text-sm">{error}</div>}
          {data && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <div className="bg-gray-50 rounded-2xl p-3 text-center">
                  <p className="text-xs text-gray-500">ส่งทั้งหมด</p>
                  <p className="text-lg font-bold text-gray-900">{formatNumber(Number(data.head.total_submitted))}</p>
                </div>
                <div className="bg-green-50 rounded-2xl p-3 text-center">
                  <p className="text-xs text-gray-500">ผ่าน</p>
                  <p className="text-lg font-bold text-green-700">{formatNumber(Number(data.head.total_passed))}</p>
                </div>
                <div className="bg-red-50 rounded-2xl p-3 text-center">
                  <p className="text-xs text-gray-500">ไม่ผ่าน</p>
                  <p className="text-lg font-bold text-red-700">{formatNumber(Number(data.head.total_failed))}</p>
                </div>
                <div className="bg-purple-50 rounded-2xl p-3 text-center">
                  <p className="text-xs text-gray-500">สถานพยาบาลผู้รักษา</p>
                  <p className="text-sm font-bold text-purple-700">
                    {String(data.head.main_hospital_name ?? '-')} ({String(data.head.main_hospital_code ?? '-')})
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-gray-100">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">#</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">สถานะ</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">Inv No.</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">PID</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">วันที่ทำรายการ</th>
                      <th className="px-2 py-2 text-right font-semibold text-gray-600">ยอดเบิก</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">CheckCode</th>
                      <th className="px-2 py-2 text-center font-semibold text-gray-600">รายละเอียดยา</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.details.map((d, i) => {
                      const passed = String(d.status) === 'passed';
                      const drugDetail = d.drug_detail as unknown[] | null;
                      const hasDrugDetail = Array.isArray(drugDetail) && drugDetail.length > 0;
                      return (
                        <Fragment key={i}>
                          <tr className={passed ? '' : 'bg-red-50/30'}>
                            <td className="px-2 py-1.5 text-gray-500">{String(d.line_no)}</td>
                            <td className={`px-2 py-1.5 font-semibold ${passed ? 'text-green-700' : 'text-red-700'}`}>
                              {passed ? 'ผ่าน' : 'ไม่ผ่าน'}
                            </td>
                            <td className="px-2 py-1.5 font-mono">{String(d.inv_no ?? '-')}</td>
                            <td className="px-2 py-1.5 font-mono">{String(d.pid ?? '-')}</td>
                            <td className="px-2 py-1.5 text-gray-500">{String(d.dt_tran ?? '-')}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{formatCurrency(Number(d.claim_amt ?? 0))}</td>
                            <td className="px-2 py-1.5 text-xs text-red-700 font-semibold">{String(d.check_codes ?? '-') || '-'}</td>
                            <td className="px-2 py-1.5 text-center">
                              {hasDrugDetail && (
                                <button
                                  onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                                  className="text-purple-600 hover:underline"
                                >
                                  {expandedRow === i ? 'ซ่อน' : 'ดู'}
                                </button>
                              )}
                            </td>
                          </tr>
                          {expandedRow === i && hasDrugDetail && (
                            <tr className="bg-purple-50/30">
                              <td colSpan={8} className="px-3 py-2">
                                <pre className="text-[11px] whitespace-pre-wrap text-gray-700 bg-white rounded-xl p-3 border border-purple-100 overflow-x-auto">
                                  {JSON.stringify(drugDetail, null, 2)}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-3 text-center">{data.details.length} รายการ</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Detail drawer สำหรับเอกสารตอบรับ CSOP (csop_rep_head/detail) — แสดงเฉพาะหน้า CSOP */
function CsopDetailDrawer({ ackNo, onClose }: { ackNo: string; onClose: () => void }) {
  const { data, isLoading, error: queryError } = useQuery<CsopRepBatchDetail | null>({
    queryKey: ['csopRepBatch', ackNo],
    queryFn: async () => getCsopRepBatch(ackNo),
    enabled: Boolean(ackNo),
    retry: false,
    staleTime: Infinity,
  });

  const loading = isLoading;
  const error = queryError instanceof Error ? queryError.message : null;
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-soft w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-primary-500 to-primary-700 px-6 py-4 flex items-center justify-between text-white">
          <h2 className="text-sm font-semibold">เอกสารตอบรับ CSOP เลขที่ตอบรับ: {ackNo}</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-6 h-6 text-primary-600 animate-spin" />
            </div>
          )}
          {error && <div className="text-red-700 bg-red-50 p-3 rounded-2xl text-sm">{error}</div>}
          {data && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <div className="bg-gray-50 rounded-2xl p-3 text-center">
                  <p className="text-xs text-gray-500">ส่งทั้งหมด</p>
                  <p className="text-lg font-bold text-gray-900">{formatNumber(Number(data.head.total_submitted))}</p>
                </div>
                <div className="bg-green-50 rounded-2xl p-3 text-center">
                  <p className="text-xs text-gray-500">ผ่าน</p>
                  <p className="text-lg font-bold text-green-700">{formatNumber(Number(data.head.total_passed))}</p>
                </div>
                <div className="bg-red-50 rounded-2xl p-3 text-center">
                  <p className="text-xs text-gray-500">ไม่ผ่าน</p>
                  <p className="text-lg font-bold text-red-700">{formatNumber(Number(data.head.total_failed))}</p>
                </div>
                <div className="bg-primary-50 rounded-2xl p-3 text-center">
                  <p className="text-xs text-gray-500">สถานี</p>
                  <p className="text-sm font-bold text-primary-700">{String(data.head.station ?? '-')}</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-gray-100">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">#</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">สถานะ</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">Inv No.</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">HN</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">วันที่ทำรายการ</th>
                      <th className="px-2 py-2 text-right font-semibold text-gray-600">ยอดเบิก</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">CheckCode</th>
                      <th className="px-2 py-2 text-center font-semibold text-gray-600">รายละเอียด</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.details.map((d, i) => {
                      const passed = String(d.status) === 'passed';
                      const billItemsDetail = d.bill_items_detail as unknown[] | null;
                      const drugDetail = d.drug_detail as unknown[] | null;
                      const hasDetail = (Array.isArray(billItemsDetail) && billItemsDetail.length > 0)
                        || (Array.isArray(drugDetail) && drugDetail.length > 0);
                      return (
                        <Fragment key={i}>
                          <tr className={passed ? '' : 'bg-red-50/30'}>
                            <td className="px-2 py-1.5 text-gray-500">{String(d.line_no)}</td>
                            <td className={`px-2 py-1.5 font-semibold ${passed ? 'text-green-700' : 'text-red-700'}`}>
                              {passed ? 'ผ่าน' : 'ไม่ผ่าน'}
                            </td>
                            <td className="px-2 py-1.5 font-mono">{String(d.inv_no ?? '-')}</td>
                            <td className="px-2 py-1.5 font-mono">{String(d.hn ?? '-')}</td>
                            <td className="px-2 py-1.5 text-gray-500">{String(d.dt_tran ?? '-')}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{formatCurrency(Number(d.claim_amt ?? 0))}</td>
                            <td className="px-2 py-1.5 text-xs text-red-700 font-semibold">{String(d.check_codes ?? '-') || '-'}</td>
                            <td className="px-2 py-1.5 text-center">
                              {hasDetail && (
                                <button
                                  onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                                  className="text-primary-600 hover:underline"
                                >
                                  {expandedRow === i ? 'ซ่อน' : 'ดู'}
                                </button>
                              )}
                            </td>
                          </tr>
                          {expandedRow === i && hasDetail && (
                            <tr className="bg-primary-50/30">
                              <td colSpan={8} className="px-3 py-2">
                                <pre className="text-[11px] whitespace-pre-wrap text-gray-700 bg-white rounded-xl p-3 border border-primary-100 overflow-x-auto">
                                  {JSON.stringify({ billItemsDetail, drugDetail }, null, 2)}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-3 text-center">{data.details.length} รายการ</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Detail drawer สำหรับเอกสารตอบรับ AIPN (aipn_rep_head/detail) — แสดงเฉพาะหน้า AIPN */
function AipnDetailDrawer({ ackNo, onClose }: { ackNo: string; onClose: () => void }) {
  const { data, isLoading, error: queryError } = useQuery<AipnRepBatchDetail | null>({
    queryKey: ['aipnRepBatch', ackNo],
    queryFn: async () => getAipnRepBatch(ackNo),
    enabled: Boolean(ackNo),
    retry: false,
    staleTime: Infinity,
  });

  const loading = isLoading;
  const error = queryError instanceof Error ? queryError.message : null;
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-soft w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-purple-500 to-purple-700 px-6 py-4 flex items-center justify-between text-white">
          <h2 className="text-sm font-semibold">เอกสารตอบรับ AIPN เลขที่ตอบรับ: {ackNo}</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-6 h-6 text-purple-600 animate-spin" />
            </div>
          )}
          {error && <div className="text-red-700 bg-red-50 p-3 rounded-2xl text-sm">{error}</div>}
          {data && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <div className="bg-gray-50 rounded-2xl p-3 text-center">
                  <p className="text-xs text-gray-500">ส่งทั้งหมด</p>
                  <p className="text-lg font-bold text-gray-900">{formatNumber(Number(data.head.total_submitted))}</p>
                </div>
                <div className="bg-green-50 rounded-2xl p-3 text-center">
                  <p className="text-xs text-gray-500">ผ่าน</p>
                  <p className="text-lg font-bold text-green-700">{formatNumber(Number(data.head.total_passed))}</p>
                </div>
                <div className="bg-red-50 rounded-2xl p-3 text-center">
                  <p className="text-xs text-gray-500">ไม่ผ่าน</p>
                  <p className="text-lg font-bold text-red-700">{formatNumber(Number(data.head.total_failed))}</p>
                </div>
                <div className="bg-purple-50 rounded-2xl p-3 text-center">
                  <p className="text-xs text-gray-500">งวดที่ส่ง</p>
                  <p className="text-sm font-bold text-purple-700">{String(data.head.batch_no ?? '-')}</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-gray-100">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">#</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">สถานะ</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">AN</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">ชื่อ-สกุล</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">DRG</th>
                      <th className="px-2 py-2 text-right font-semibold text-gray-600">ยอดจ่าย</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">CheckCode</th>
                      <th className="px-2 py-2 text-center font-semibold text-gray-600">รายละเอียด</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.details.map((d, i) => {
                      const passed = String(d.status) === 'passed';
                      const subDetail = d.sub_detail as unknown;
                      const hasDetail = subDetail != null;
                      return (
                        <Fragment key={i}>
                          <tr className={passed ? '' : 'bg-red-50/30'}>
                            <td className="px-2 py-1.5 text-gray-500">{String(d.line_no)}</td>
                            <td className={`px-2 py-1.5 font-semibold ${passed ? 'text-green-700' : 'text-red-700'}`}>
                              {passed ? 'ผ่าน' : 'ไม่ผ่าน'}
                            </td>
                            <td className="px-2 py-1.5 font-mono">{String(d.an ?? '-')}</td>
                            <td className="px-2 py-1.5">{String(d.patient_name ?? '-')}</td>
                            <td className="px-2 py-1.5 font-mono">{String(d.drg ?? '-')}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{formatCurrency(Number(d.amount ?? 0))}</td>
                            <td className="px-2 py-1.5 text-xs text-red-700 font-semibold">{String(d.check_codes ?? '-') || '-'}</td>
                            <td className="px-2 py-1.5 text-center">
                              {hasDetail && (
                                <button
                                  onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                                  className="text-purple-600 hover:underline"
                                >
                                  {expandedRow === i ? 'ซ่อน' : 'ดู'}
                                </button>
                              )}
                            </td>
                          </tr>
                          {expandedRow === i && hasDetail && (
                            <tr className="bg-purple-50/30">
                              <td colSpan={8} className="px-3 py-2">
                                <pre className="text-[11px] whitespace-pre-wrap text-gray-700 bg-white rounded-xl p-3 border border-purple-100 overflow-x-auto">
                                  {JSON.stringify(subDetail, null, 2)}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-3 text-center">{data.details.length} รายการ</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Route wrapper — resolve fund จาก URL param ก่อนเข้า dashboard */
export default function EclaimFundDashboardRoute() {
  const { fundSlug } = useParams<{ fundSlug: string }>();
  const fund = getFundMeta(fundSlug);
  if (!fund) return <Navigate to="/" replace />;
  return <Dashboard key={fund.slug} fund={fund} />;
}

function Dashboard({ fund }: { fund: FundMeta }) {
  const FundIcon = fund.icon;
  const isSsopFund = fund.code === 'SSOP';
  const isCsopFund = fund.code === 'CSOP';
  const isAipnFund = fund.code === 'AIPN';
  const isCipnFund = fund.code === 'CIPN';
  // กองทุนที่มีตารางของตัวเอง (ไม่ใช้ rep_head เดิม) — CSOP/AIPN/SSOP แทนที่ของเดิมทั้งหมด, CIPN ยังไม่มีตาราง
  const usesOwnTable = isCsopFund || isAipnFund || isSsopFund || isCipnFund;
  const [selectedRepNo, setSelectedRepNo] = useState<string | null>(null);
  const [selectedAckNo, setSelectedAckNo] = useState<string | null>(null);
  const [selectedCsopAckNo, setSelectedCsopAckNo] = useState<string | null>(null);
  const [selectedAipnAckNo, setSelectedAipnAckNo] = useState<string | null>(null);

  // Expandable error rows — code → loaded rows (cache); null = loading
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [errorDetailCache, setErrorDetailCache] = useState<Record<string, ErrorDetailRow[] | 'loading' | 'error'>>({});

  // Error code → description map (loaded once จาก eclaim_error table)
  const [errorDescMap, setErrorDescMap] = useState<Record<string, string>>({});
  const getErrorDescription = (code: string): string | null => errorDescMap[code] ?? null;

  // โหลด error code reference table 1 ครั้ง
  useEffect(() => {
    listEclaimErrorCodes()
      .then((r) => {
        const m: Record<string, string> = {};
        for (const c of r.codes) {
          if (c.description) m[c.code] = c.description;
        }
        setErrorDescMap(m);
      })
      .catch(() => { /* eclaim_error table ยังไม่มี / ยังไม่ seed — แสดงแค่ code */ });
  }, []);

  const { startDateSQL, endDateSQL } = useDateFilter();

  const { data: queryData, isLoading, error: queryError } = useQuery<{
    summary: ClaimSummary;
    batches: RepBatch[];
    errorSummary: ErrorSummary;
  } | null>({
    queryKey: ['eclaimDashboard', fund.code, startDateSQL, endDateSQL],
    queryFn: async () => {
      const params = { fundCode: fund.code, startDate: startDateSQL, endDate: endDateSQL };
      const [s, l, e] = await Promise.all([
        getClaimSummary(params),
        listRepBatches(params, 200, 0),
        getClaimErrorSummary(params),
      ]);
      return { summary: s, batches: l.items, errorSummary: e };
    },
    enabled: Boolean(startDateSQL && endDateSQL) && !usesOwnTable,
    retry: false,
  });

  const summary = queryData?.summary ?? null;
  const batches = queryData?.batches ?? [];
  const errorSummary = queryData?.errorSummary ?? null;
  const loading = isLoading;
  const error = queryError instanceof Error ? queryError.message : null;

  // เอกสารตอบรับ สปส. (ssop_rep_head) — แสดงเพิ่มเฉพาะหน้า SSS ต่อจากตาราง rep_head เดิม
  const { data: ssopBatches, isLoading: ssopLoading, error: ssopQueryError } = useQuery<SsopRepBatch[]>({
    queryKey: ['ssopRepBatches', startDateSQL, endDateSQL],
    queryFn: async () => {
      const r = await listSsopRepBatches({ startDate: startDateSQL, endDate: endDateSQL }, 200, 0);
      return r.items;
    },
    enabled: isSsopFund && Boolean(startDateSQL && endDateSQL),
    retry: false,
  });
  const ssopError = ssopQueryError instanceof Error ? ssopQueryError.message : null;

  // สรุปยอด ssop_rep (จำนวนงวด / ยอดที่ผ่าน / ยอดที่ไม่ผ่าน / ยอดรวม) — ต้อง query แยกเพราะยอดเงินอยู่ระดับ detail
  const { data: ssopSummary } = useQuery<ClaimSummary>({
    queryKey: ['ssopRepSummary', startDateSQL, endDateSQL],
    queryFn: async () => getSsopRepSummary({ startDate: startDateSQL, endDate: endDateSQL }),
    enabled: isSsopFund && Boolean(startDateSQL && endDateSQL),
    retry: false,
  });
  // เอกสารตอบรับ CSOP (csop_rep_head) — แทนที่ rep_head เดิมทั้งหมด (ไม่ merge)
  const { data: csopBatches, isLoading: csopLoading, error: csopQueryError } = useQuery<CsopRepBatch[]>({
    queryKey: ['csopRepBatches', startDateSQL, endDateSQL],
    queryFn: async () => {
      const r = await listCsopRepBatches({ startDate: startDateSQL, endDate: endDateSQL }, 200, 0);
      return r.items;
    },
    enabled: isCsopFund && Boolean(startDateSQL && endDateSQL),
    retry: false,
  });
  const csopError = csopQueryError instanceof Error ? csopQueryError.message : null;

  const { data: csopSummary } = useQuery<ClaimSummary>({
    queryKey: ['csopRepSummary', startDateSQL, endDateSQL],
    queryFn: async () => getCsopRepSummary({ startDate: startDateSQL, endDate: endDateSQL }),
    enabled: isCsopFund && Boolean(startDateSQL && endDateSQL),
    retry: false,
  });

  // เอกสารตอบรับ AIPN (aipn_rep_head)
  const { data: aipnBatches, isLoading: aipnLoading, error: aipnQueryError } = useQuery<AipnRepBatch[]>({
    queryKey: ['aipnRepBatches', startDateSQL, endDateSQL],
    queryFn: async () => {
      const r = await listAipnRepBatches({ startDate: startDateSQL, endDate: endDateSQL }, 200, 0);
      return r.items;
    },
    enabled: isAipnFund && Boolean(startDateSQL && endDateSQL),
    retry: false,
  });
  const aipnError = aipnQueryError instanceof Error ? aipnQueryError.message : null;

  const { data: aipnSummary } = useQuery<ClaimSummary>({
    queryKey: ['aipnRepSummary', startDateSQL, endDateSQL],
    queryFn: async () => getAipnRepSummary({ startDate: startDateSQL, endDate: endDateSQL }),
    enabled: isAipnFund && Boolean(startDateSQL && endDateSQL),
    retry: false,
  });

  // หน้า CSOP/AIPN/SSOP: ใช้ยอดจากตารางของตัวเองล้วนๆ (แทนที่ rep_head เดิมทั้งหมด) — CIPN ยังไม่มีข้อมูล
  const displaySummary = useMemo<ClaimSummary | null>(() => {
    if (isCsopFund) return csopSummary ?? null;
    if (isAipnFund) return aipnSummary ?? null;
    if (isSsopFund) return ssopSummary ?? null;
    if (isCipnFund) return null;
    return summary;
  }, [isSsopFund, isCsopFund, isAipnFund, isCipnFund, summary, ssopSummary, csopSummary, aipnSummary]);

  const toggleErrorRow = async (code: string) => {
    // ถ้ากด code เดิม → ย่อ
    if (expandedCode === code) {
      setExpandedCode(null);
      return;
    }
    setExpandedCode(code);
    // load ถ้ายังไม่มี cache
    if (!errorDetailCache[code] || errorDetailCache[code] === 'error') {
      setErrorDetailCache((c) => ({ ...c, [code]: 'loading' }));
      try {
        const r = await getClaimErrorDetail(code, {
          fundCode: fund.code,
          startDate: startDateSQL,
          endDate: endDateSQL,
        });
        setErrorDetailCache((c) => ({ ...c, [code]: r.rows }));
      } catch {
        setErrorDetailCache((c) => ({ ...c, [code]: 'error' }));
      }
    }
  };

  // เคลียร์ cache เมื่อ date filter เปลี่ยน (ข้อมูลเก่าใช้ไม่ได้)
  useEffect(() => {
    setErrorDetailCache({});
    setExpandedCode(null);
  }, [startDateSQL, endDateSQL]);

  // Export Excel — รายการที่ติด C ทั้งหมด (filtered ตาม fund + date range)
  const [exporting, setExporting] = useState(false);
  const handleExportFailed = async () => {
    setExporting(true);
    try {
      const { rows, total } = await getFailedExport({
        fundCode: fund.code,
        startDate: startDateSQL,
        endDate: endDateSQL,
      });
      if (total === 0) {
        alert('ไม่พบรายการที่ติด C ในช่วงที่เลือก');
        return;
      }

      // Map → Thai column headers
      const data = rows.map((r, i) => ({
        'อันดับ': i + 1,
        'งวด': r.repNo,
        'ลำดับใน REP': r.seqNo,
        'วันที่รับบริการ': r.admitDate,
        'วันที่จำหน่าย': r.dischargeDate,
        'HN': r.hn,
        'AN': r.an,
        'PID': r.pid,
        'ชื่อ-สกุล': r.patientName,
        'ประเภท': r.patientType,
        'กองทุน': r.fund,
        'รหัส Error': r.errorCode,
        'คำอธิบาย Error': r.errorDescription,
        'DRG': r.drg,
        'RW': r.rw ?? '',
        'ชดเชยสุทธิ (ค่ารักษา)': r.compAmount,
        'ชดเชยสุทธิ (PP)': r.compPp,
        'เรียกเก็บ (ค่ารักษา)': r.chargeAmount,
        'เรียกเก็บ (PP)': r.chargePp,
      }));

      const sheet = XLSX.utils.json_to_sheet(data);
      // ตั้ง column widths คร่าวๆ
      sheet['!cols'] = [
        { wch: 6 }, { wch: 12 }, { wch: 8 }, { wch: 18 }, { wch: 18 },
        { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 30 }, { wch: 6 },
        { wch: 12 }, { wch: 12 }, { wch: 60 }, { wch: 10 }, { wch: 6 },
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheet, `${fund.code} ติด C`);

      // ชื่อไฟล์: failed_<FUND>_<YYYYMMDD>_<YYYYMMDD>.xlsx
      const stamp = `${startDateSQL?.replace(/-/g, '') ?? 'all'}_${endDateSQL?.replace(/-/g, '') ?? 'all'}`;
      XLSX.writeFile(wb, `failed_${fund.code}_${stamp}.xlsx`);
    } catch (e) {
      alert(extractErrorMessage(e));
    } finally {
      setExporting(false);
    }
  };


  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className={`w-14 h-14 ${fund.iconBg} rounded-2xl flex items-center justify-center flex-shrink-0`}>
          <FundIcon className={`w-7 h-7 ${fund.iconColor}`} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {fund.name} <span className="text-base text-gray-400 font-normal">[{fund.code}]</span>
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{fund.description}</p>
        </div>
      </div>

      {/* Date filter ใช้ DateRangePicker ที่ Header (Layout) — sync ผ่าน useDateFilter store */}

      {/* Loading / error states */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader className="w-6 h-6 text-primary-600 animate-spin" />
        </div>
      )}
      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-2xl text-sm">{error}</div>
      )}

      {!loading && !error && (<>
      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          title="จำนวนงวด"
          value={formatNumber(displaySummary?.batches ?? 0)}
          subtitle={`รวม ${formatNumber(displaySummary?.submitted ?? 0)} ราย`}
          icon={FileBarChart}
          color="primary"
        />
        <KPICard
          title="ผ่าน"
          value={`${formatNumber(displaySummary?.passed ?? 0)}`}
          subtitle={`ยอด ${formatCurrency(displaySummary?.passedAmount ?? 0)}`}
          icon={CheckCircle2}
          color="emerald"
        />
        <KPICard
          title="ไม่ผ่าน"
          value={formatNumber(displaySummary?.failed ?? 0)}
          subtitle={`ยอด ${formatCurrency(displaySummary?.failedAmount ?? 0)}`}
          icon={AlertTriangle}
          color="red"
        />
        <KPICard
          title="ยอดรวม"
          value={formatCurrency(displaySummary?.totalAmount ?? 0)}
          subtitle={`ผ่าน ${formatCurrency(displaySummary?.passedAmount ?? 0)}`}
          icon={Coins}
          color="amber"
        />
      </div>

      {/* Monthly trend chart — ปิดไว้ก่อนตามคำขอ
      {trend.length > 0 && ( ... )}
      */}

      {/* Batches table (rep_head) — ไม่แสดงสำหรับ CSOP/AIPN/CIPN ที่มีตารางของตัวเอง */}
      {!usesOwnTable && (
      <div className="bg-white rounded-2xl shadow-soft overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">รายการงวด (rep_head)</h3>
          <p className="text-xs text-gray-400">{batches.length} งวด</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">งวด</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">เลขที่เอกสาร</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">วันที่</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">ส่งทั้งหมด</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">ผ่าน</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">ไม่ผ่าน</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">ยอดที่ผ่าน</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">ยอดที่ไม่ผ่าน</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">ยอดรวม</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {batches.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-gray-400">ยังไม่มีข้อมูล — นำเข้าไฟล์ REP ที่หน้า "เอกสารเคลม REP/STM"</td>
                </tr>
              )}
              {batches.map((b) => (
                <tr
                  key={b.repNo}
                  onClick={() => setSelectedRepNo(b.repNo)}
                  className="hover:bg-primary-50 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2 font-mono font-semibold text-primary-700">{b.repNo}</td>
                  <td className="px-3 py-2 text-gray-600 truncate max-w-[200px]" title={b.invoiceDoc}>{b.invoiceDoc}</td>
                  <td className="px-3 py-2 text-gray-500">{b.issuedAt}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatNumber(b.totalSubmitted)}</td>
                  <td className="px-3 py-2 text-right font-mono text-green-700">{formatNumber(b.totalPassed)}</td>
                  <td className="px-3 py-2 text-right font-mono text-red-700">{formatNumber(b.totalFailed)}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-700">{formatCurrency(b.passedAmount)}</td>
                  <td className="px-3 py-2 text-right font-mono text-amber-700">{formatCurrency(b.failedAmount)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-primary-700">{formatCurrency(b.passedAmount + b.failedAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* CSOP batches table (csop_rep_head) — แทนที่ rep_head เดิม */}
      {isCsopFund && (
      <div className="bg-white rounded-2xl shadow-soft overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">เอกสารตอบรับ CSOP (csop_rep_head)</h3>
          <p className="text-xs text-gray-400">{csopBatches?.length ?? 0} เอกสาร</p>
        </div>
        {csopLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader className="w-5 h-5 text-primary-600 animate-spin" />
          </div>
        )}
        {csopError && <div className="text-red-700 bg-red-50 p-4 text-sm">{csopError}</div>}
        {!csopLoading && !csopError && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">เลขที่ตอบรับ</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">รหัส รพ.</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">งวดส่งของ รพ.</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">วันที่ออกเลขตอบรับ</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">ส่งทั้งหมด</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">ผ่าน</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">ไม่ผ่าน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(!csopBatches || csopBatches.length === 0) && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-gray-400">
                      ยังไม่มีข้อมูล — นำเข้าไฟล์ตอบกลับ CSOP (.zip) ที่หน้า "เอกสารเคลม REP/STM"
                    </td>
                  </tr>
                )}
                {csopBatches?.map((b) => (
                  <tr
                    key={b.ackNo}
                    onClick={() => setSelectedCsopAckNo(b.ackNo)}
                    className="hover:bg-primary-50 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2 font-mono font-semibold text-primary-700">{b.ackNo}</td>
                    <td className="px-3 py-2 text-gray-600 font-mono">{b.hospitalCode}</td>
                    <td className="px-3 py-2 text-gray-600 truncate max-w-[260px]" title={b.batchRef ?? ''}>{b.batchRef ?? '-'}</td>
                    <td className="px-3 py-2 text-gray-500">{b.ackAt ?? '-'}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatNumber(b.totalSubmitted)}</td>
                    <td className="px-3 py-2 text-right font-mono text-green-700">{formatNumber(b.totalPassed)}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-700">{formatNumber(b.totalFailed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* AIPN batches table (aipn_rep_head) */}
      {isAipnFund && (
      <div className="bg-white rounded-2xl shadow-soft overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">เอกสารตอบรับ AIPN (aipn_rep_head)</h3>
          <p className="text-xs text-gray-400">{aipnBatches?.length ?? 0} เอกสาร</p>
        </div>
        {aipnLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader className="w-5 h-5 text-purple-600 animate-spin" />
          </div>
        )}
        {aipnError && <div className="text-red-700 bg-red-50 p-4 text-sm">{aipnError}</div>}
        {!aipnLoading && !aipnError && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">เลขที่ตอบรับ</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">รหัส รพ.</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">งวดที่ส่ง</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">วันที่ออกเลขตอบรับ</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">ส่งทั้งหมด</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">ผ่าน</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">ไม่ผ่าน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(!aipnBatches || aipnBatches.length === 0) && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-gray-400">
                      ยังไม่มีข้อมูล — นำเข้าไฟล์ตอบกลับ AIPN (.zip) ที่หน้า "เอกสารเคลม REP/STM"
                    </td>
                  </tr>
                )}
                {aipnBatches?.map((b) => (
                  <tr
                    key={b.ackNo}
                    onClick={() => setSelectedAipnAckNo(b.ackNo)}
                    className="hover:bg-purple-50 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2 font-mono font-semibold text-purple-700">{b.ackNo}</td>
                    <td className="px-3 py-2 text-gray-600 font-mono">{b.hospitalCode}</td>
                    <td className="px-3 py-2 text-gray-600">{b.batchNo ?? '-'} {b.batchRef ? `(${b.batchRef})` : ''}</td>
                    <td className="px-3 py-2 text-gray-500">{b.ackAt ?? '-'}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatNumber(b.totalSubmitted)}</td>
                    <td className="px-3 py-2 text-right font-mono text-green-700">{formatNumber(b.totalPassed)}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-700">{formatNumber(b.totalFailed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* CIPN — ยังไม่มีตาราง/แหล่งข้อมูล รอเชื่อมในอนาคต */}
      {isCipnFund && (
        <div className="bg-white rounded-2xl shadow-soft p-10 text-center text-gray-400">
          <FileBarChart className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">ยังไม่มีข้อมูล</p>
          <p className="text-xs mt-1">หน้าสิทธิข้าราชการผู้ป่วยใน [CIPN] รอเชื่อมแหล่งข้อมูลในอนาคต</p>
        </div>
      )}

      {/* SSOP batches table (ssop_rep_head) — แทนที่ rep_head เดิม */}
      {isSsopFund && (
      <div className="bg-white rounded-2xl shadow-soft overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">เอกสารตอบรับ สปส. (ssop_rep_head)</h3>
            <p className="text-xs text-gray-400">{ssopBatches?.length ?? 0} เอกสาร</p>
          </div>
          {ssopLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader className="w-5 h-5 text-purple-600 animate-spin" />
            </div>
          )}
          {ssopError && <div className="text-red-700 bg-red-50 p-4 text-sm">{ssopError}</div>}
          {!ssopLoading && !ssopError && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">เลขที่ตอบรับ</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">สถานพยาบาลผู้รักษา</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">งวดส่งของ รพ.</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">วันที่ออกเลขตอบรับ</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">ส่งทั้งหมด</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">ผ่าน</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">ไม่ผ่าน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(!ssopBatches || ssopBatches.length === 0) && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-gray-400">
                        ยังไม่มีข้อมูล — นำเข้าไฟล์ตอบกลับ สปส. (.zip) ที่หน้า "เอกสารเคลม REP/STM"
                      </td>
                    </tr>
                  )}
                  {ssopBatches?.map((b) => (
                    <tr
                      key={b.ackNo}
                      onClick={() => setSelectedAckNo(b.ackNo)}
                      className="hover:bg-purple-50 cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2 font-mono font-semibold text-purple-700">{b.ackNo}</td>
                      <td className="px-3 py-2 text-gray-600">{b.mainHospitalName} ({b.mainHospitalCode})</td>
                      <td className="px-3 py-2 text-gray-600 truncate max-w-[200px]" title={b.batchRef}>{b.batchRef}</td>
                      <td className="px-3 py-2 text-gray-500">{b.ackAt ?? '-'}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatNumber(b.totalSubmitted)}</td>
                      <td className="px-3 py-2 text-right font-mono text-green-700">{formatNumber(b.totalPassed)}</td>
                      <td className="px-3 py-2 text-right font-mono text-red-700">{formatNumber(b.totalFailed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Error code summary */}
      {errorSummary && errorSummary.errors.length > 0 && (
        <div className="bg-white rounded-2xl shadow-soft overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <AlertOctagon className="w-4 h-4 text-red-600" />
              <h3 className="text-sm font-semibold text-gray-700">สรุปข้อผิดพลาด (Error Code)</h3>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-xs text-gray-400">
                {errorSummary.uniqueCodes} รหัส · ติด C รวม {formatNumber(errorSummary.totalFailedRows)} ราย
              </p>
              <button
                onClick={handleExportFailed}
                disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-2xl hover:from-emerald-600 hover:to-emerald-700 transition-all disabled:opacity-50 shadow-soft"
                title={`Export รายการที่ติด C ของ ${fund.code} เป็น Excel`}
              >
                {exporting ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Export Excel
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">อันดับ</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase">รหัส Error</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">จำนวน (ราย)</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">% ของทั้งหมด</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase">ยอดเงิน (รวม)</th>
                  <th className="px-3 py-2.5 text-center font-semibold text-gray-600 uppercase">รายละเอียด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {errorSummary.errors.map((e, i) => {
                  const pct = errorSummary.totalFailedRows > 0
                    ? (e.count / errorSummary.totalFailedRows) * 100
                    : 0;
                  const isExpanded = expandedCode === e.code;
                  const cacheEntry = errorDetailCache[e.code];
                  return (
                    <Fragment key={e.code}>
                      <tr
                        onClick={() => toggleErrorRow(e.code)}
                        className={`hover:bg-red-50/30 cursor-pointer transition-colors ${isExpanded ? 'bg-red-50/40' : ''}`}
                      >
                        <td className="px-3 py-2 text-gray-500 font-mono align-top">
                          <span className="inline-flex items-center gap-1">
                            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            {i + 1}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="font-mono font-bold text-red-700">{e.code}</div>
                          {getErrorDescription(e.code) && (
                            <div className="text-xs text-gray-600 mt-0.5 font-normal whitespace-normal max-w-md">
                              {getErrorDescription(e.code)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold align-top">{formatNumber(e.count)}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-600 align-top">{pct.toFixed(1)}%</td>
                        <td className="px-3 py-2 text-right font-mono text-amber-700 align-top">{formatCurrency(e.totalAmount)}</td>
                        <td className="px-3 py-2 text-center align-top">
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 transition-colors">
                            {isExpanded ? (
                              <>
                                <ChevronDown className="w-3.5 h-3.5" />
                                &lt;&lt; ซ่อนรายละเอียด &gt;&gt;
                              </>
                            ) : (
                              <>
                                <ChevronRight className="w-3.5 h-3.5" />
                                &lt;&lt; ดูรายละเอียด &gt;&gt;
                              </>
                            )}
                          </span>
                        </td>
                      </tr>

                      {/* Expanded subset: รายชื่อข้อมูลผิดพลาด */}
                      {isExpanded && (
                        <tr className="bg-red-50/20">
                          <td colSpan={6} className="px-3 py-3">
                            <div className="bg-white rounded-2xl border border-red-100 overflow-hidden">
                              <div className="px-3 py-2 border-b border-red-100 bg-red-50/30 text-xs font-semibold text-red-800 flex items-center justify-between gap-3">
                                <span className="truncate">
                                  รายชื่อข้อมูลผิดพลาด — รหัส {e.code}
                                  {getErrorDescription(e.code) && (
                                    <span className="text-gray-600 font-normal ml-1">({getErrorDescription(e.code)})</span>
                                  )}
                                </span>
                                <span className="text-gray-500 font-normal">
                                  {Array.isArray(cacheEntry) ? `${cacheEntry.length} ราย` : ''}
                                </span>
                              </div>

                              {cacheEntry === 'loading' && (
                                <div className="flex items-center justify-center py-6">
                                  <Loader className="w-5 h-5 text-red-600 animate-spin" />
                                </div>
                              )}
                              {cacheEntry === 'error' && (
                                <div className="text-xs text-red-700 p-3">โหลดข้อมูลล้มเหลว — คลิ๊กที่แถวอีกครั้งเพื่อลองใหม่</div>
                              )}
                              {Array.isArray(cacheEntry) && cacheEntry.length === 0 && (
                                <div className="text-xs text-gray-400 text-center py-6">ไม่พบรายการ</div>
                              )}
                              {Array.isArray(cacheEntry) && cacheEntry.length > 0 && (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="px-3 py-2 text-left font-semibold text-gray-600">อันดับ</th>
                                        <th className="px-3 py-2 text-left font-semibold text-gray-600">วันที่รับบริการ</th>
                                        <th className="px-3 py-2 text-left font-semibold text-gray-600">HN</th>
                                        <th className="px-3 py-2 text-left font-semibold text-gray-600">VN</th>
                                        <th className="px-3 py-2 text-left font-semibold text-gray-600">AN</th>
                                        <th className="px-3 py-2 text-left font-semibold text-gray-600">ชื่อ-สกุล</th>
                                        <th className="px-3 py-2 text-left font-semibold text-gray-600">รหัสเหตุผลการใช้ยา</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {cacheEntry.map((row, idx) => {
                                        const reasonId = String(row.reasonCode ?? row.reason ?? row.errorCode ?? '-');
                                        return (
                                          <tr key={`${row.repNo}-${row.seqNo}-${idx}`} className="hover:bg-red-50/20">
                                            <td className="px-3 py-1.5 text-gray-500 font-mono">{idx + 1}</td>
                                            <td className="px-3 py-1.5 text-gray-600">{row.admitDate || '-'}</td>
                                            <td className="px-3 py-1.5 font-mono">{row.hn || '-'}</td>
                                            <td className="px-3 py-1.5 font-mono">{row.vn || '-'}</td>
                                            <td className="px-3 py-1.5 font-mono">{row.an || '-'}</td>
                                            <td className="px-3 py-1.5">{row.patientName || '-'}</td>
                                            <td className="px-3 py-1.5 text-xs font-semibold text-gray-700">{reasonId}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      </>)}

      {selectedRepNo && <DetailDrawer repNo={selectedRepNo} onClose={() => setSelectedRepNo(null)} />}
      {selectedAckNo && <SsopDetailDrawer ackNo={selectedAckNo} onClose={() => setSelectedAckNo(null)} />}
      {selectedCsopAckNo && <CsopDetailDrawer ackNo={selectedCsopAckNo} onClose={() => setSelectedCsopAckNo(null)} />}
      {selectedAipnAckNo && <AipnDetailDrawer ackNo={selectedAipnAckNo} onClose={() => setSelectedAipnAckNo(null)} />}
    </div>
  );
}
