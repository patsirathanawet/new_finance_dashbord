import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Upload, FolderArchive, Trash2, CheckCircle, AlertCircle, AlertTriangle,
  Info, Loader, Search, FileText, ShieldCheck, Eye, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import { useClaim16Store } from '../store/claim16Store';
import { parseClaim16Folder, validateClaim16, buildClaim16Summary } from '../lib/claim16Parser';
import { extractErrorMessage } from '../lib/backendApi';
import { useInvalidateClaim16Monthly } from '../queries/claim16Dashboard';
import { formatNumber, formatCurrency } from '../lib/formatUtils';
import type { Claim16Record, ValidationIssue, ValidationSeverity } from '../types/claim16';

/* ------------------------------------------------------------------ */
/*  Severity helpers                                                  */
/* ------------------------------------------------------------------ */

const SEV_CONFIG: Record<ValidationSeverity, { icon: typeof AlertCircle; color: string; bg: string; label: string }> = {
  error:   { icon: AlertCircle,   color: 'text-red-600',    bg: 'bg-red-50',    label: 'ข้อผิดพลาด' },
  warning: { icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-50', label: 'คำเตือน' },
  info:    { icon: Info,          color: 'text-primary-600',   bg: 'bg-primary-50',   label: 'แจ้งเตือน' },
};

function formatUploadDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/* ------------------------------------------------------------------ */
/*  Record Card                                                       */
/* ------------------------------------------------------------------ */

function Claim16Card({
  record,
  onDelete,
  onValidate,
  onImport,
  onToggleDetail,
  isExpanded,
}: {
  record: Claim16Record;
  onDelete: (id: string) => void;
  onValidate: (id: string) => void;
  onImport: (id: string) => void;
  onToggleDetail: (id: string) => void;
  isExpanded: boolean;
}) {
  const errors = record.validationIssues.filter((i) => i.severity === 'error').length;
  const warnings = record.validationIssues.filter((i) => i.severity === 'warning').length;

  return (
    <div className="bg-white rounded-2xl shadow-soft overflow-hidden">
      {/* Header */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 bg-primary-50 rounded-2xl flex items-center justify-center flex-shrink-0">
              <FolderArchive className="w-5 h-5 text-primary-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">บันทึกไฟล์ข้อมูลแล้ว</p>
              <p className="text-xs text-gray-400 mt-0.5">
                รพ. {record.hospitalCode} · {formatUploadDate(record.uploadedAt)} · {record.uploadedBy}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!record.isValidated ? (
              <button
                onClick={() => onValidate(record.id)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-primary-600 text-white rounded-2xl hover:bg-primary-700 transition-colors shadow-soft"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Check
              </button>
            ) : (
              <>
                <button
                  onClick={() => onToggleDetail(record.id)}
                  className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-primary-700 bg-primary-50 rounded-2xl hover:bg-primary-100 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {isExpanded ? 'ซ่อน' : 'ดูผล'}
                  {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                {!record.summary && (
                  <button
                    onClick={() => onImport(record.id)}
                    className="flex items-center gap-1 px-3 py-2 text-xs font-medium bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-colors shadow-soft"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    นำเข้าข้อมูลที่ผ่าน
                  </button>
                )}
              </>
            )}
            <button
              onClick={() => onDelete(record.id)}
              className="p-2 text-red-400 hover:bg-red-50 rounded-2xl transition-colors"
              title="ลบ"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* File summary chips */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {record.files.map((f) => (
            <span key={f.name} className="text-xs px-2.5 py-1 bg-primary-50 text-primary-700 rounded-full font-medium">
              {f.name} <span className="text-primary-400">({formatNumber(f.rowCount)})</span>
            </span>
          ))}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-gray-50 rounded-2xl p-3 text-center">
            <p className="text-xs text-gray-500 mb-0.5">ไฟล์</p>
            <p className="text-base font-bold text-gray-900">{record.files.length} / 16</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-3 text-center">
            <p className="text-xs text-gray-500 mb-0.5">แถวทั้งหมด</p>
            <p className="text-base font-bold text-gray-900">{formatNumber(record.totalRows)}</p>
          </div>
          <div className={`rounded-2xl p-3 text-center ${
            !record.isValidated ? 'bg-gray-50' : errors === 0 ? 'bg-emerald-50' : 'bg-red-50'
          }`}>
            <p className="text-xs text-gray-500 mb-0.5">สถานะ</p>
            {!record.isValidated ? (
              <p className="text-base font-bold text-gray-400">ยังไม่ตรวจ</p>
            ) : errors === 0 && warnings === 0 ? (
              <p className="text-base font-bold text-emerald-700">ผ่านทั้งหมด</p>
            ) : (
              <p className="text-base font-bold text-red-600">
                {errors > 0 && `${formatNumber(errors)} error`}
                {errors > 0 && warnings > 0 && ' · '}
                {warnings > 0 && `${formatNumber(warnings)} warn`}
              </p>
            )}
          </div>
        </div>

        {/* Imported summary */}
        {record.summary && (
          <div className="mt-3 bg-gradient-to-r from-emerald-50 to-emerald-100/40 rounded-2xl p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
              <p className="text-xs font-semibold text-emerald-700">นำเข้าข้อมูลที่ผ่านแล้ว</p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="text-center">
                <p className="text-xs text-gray-500">OPD</p>
                <p className="text-sm font-bold text-emerald-700">{formatNumber(record.summary.opdVisits)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">IPD</p>
                <p className="text-sm font-bold text-emerald-700">{formatNumber(record.summary.ipdAdmissions)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">Visit รวม</p>
                <p className="text-sm font-bold text-emerald-700">{formatNumber(record.summary.totalVisits)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">มูลค่ารวม</p>
                <p className="text-sm font-bold text-primary-700">{formatCurrency(record.summary.totalAmount)}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Expanded validation results */}
      {isExpanded && record.isValidated && (
        <ValidationResultsPanel issues={record.validationIssues} record={record} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Validation Results Panel — แสดงแทบแยกตามแฟ้ม                       */
/* ------------------------------------------------------------------ */

/** สร้าง lookup HN → ชื่อผู้ป่วย จาก PAT, lookup AN → HN จาก IPD */
function buildPatientLookups(record: Claim16Record) {
  const hnToName = new Map<string, string>();
  const anToHn = new Map<string, string>();
  const anToAdmit = new Map<string, { dateadm: string; datedsc: string }>();

  const pat = record.files.find((f) => f.name === 'PAT');
  if (pat) {
    for (const row of pat.rows) {
      const hn = row.hn || '';
      const name = row.namepat || [row.title, row.fname, row.lname].filter(Boolean).join(' ') || '';
      if (hn && name) hnToName.set(hn, name);
    }
  }

  const ipd = record.files.find((f) => f.name === 'IPD');
  if (ipd) {
    for (const row of ipd.rows) {
      if (row.an && row.hn) anToHn.set(row.an, row.hn);
      if (row.an) {
        anToAdmit.set(row.an, { dateadm: row.dateadm || '', datedsc: row.datedsc || '' });
      }
    }
  }

  // INS: hn → cid mapping (ใช้เป็น fallback)
  const ins = record.files.find((f) => f.name === 'INS');
  if (ins) {
    for (const row of ins.rows) {
      const hn = row.hn || '';
      if (hn && !hnToName.has(hn)) hnToName.set(hn, `HN: ${hn}`);
    }
  }

  return { hnToName, anToHn, anToAdmit };
}

/** format วันที่ YYYYMMDD → DD/MM/YYYY (พ.ศ.) */
function formatClaimDate(d: string): string {
  if (!d || d.length < 8) return d || '-';
  const cleaned = d.replace(/-/g, '');
  const y = parseInt(cleaned.slice(0, 4));
  const m = cleaned.slice(4, 6);
  const day = cleaned.slice(6, 8);
  // ถ้าปี > 2400 แสดงว่าเป็น พ.ศ. อยู่แล้ว
  const beYear = y > 2400 ? y : y + 543;
  return `${day}/${m}/${beYear}`;
}

/** แฟ้มที่เป็น IPD (ใช้ AN, มีวัน admit/discharge) */
const IPD_FILES = new Set(['IPD', 'IRF', 'IDX', 'IOP', 'DRG', 'LVD']);

/** ดึง HN + วันที่ จาก issue row data */
function getPatientInfo(
  issue: ValidationIssue,
  record: Claim16Record,
  anToHn: Map<string, string>,
  anToAdmit: Map<string, { dateadm: string; datedsc: string }>,
): { hn: string; dateopd: string; dateadm: string; datedsc: string; an: string } {
  const fileData = record.files.find((f) => f.name === issue.file);
  if (!fileData || issue.row <= 0) return { hn: '', dateopd: '', dateadm: '', datedsc: '', an: '' };
  const row = fileData.rows[issue.row - 1];
  if (!row) return { hn: '', dateopd: '', dateadm: '', datedsc: '', an: '' };

  const hn = row.hn || (row.an ? anToHn.get(row.an) || '' : '') || issue.value || '';
  const an = row.an || '';
  const dateopd = row.dateopd || row.date || '';

  // ถ้าเป็นแฟ้ม IPD → ดึงวัน admit/discharge จาก IPD
  let dateadm = row.dateadm || '';
  let datedsc = row.datedsc || '';
  if (!dateadm && an) {
    const admit = anToAdmit.get(an);
    if (admit) {
      dateadm = admit.dateadm;
      datedsc = admit.datedsc;
    }
  }

  return { hn, dateopd, dateadm, datedsc, an };
}

function ValidationResultsPanel({
  issues,
  record,
}: {
  issues: ValidationIssue[];
  record: Claim16Record;
}) {
  // แฟ้มที่มี issue
  const filesWithIssues = useMemo(() => {
    const fileNames = new Set(issues.map((i) => i.file));
    return Array.from(fileNames);
  }, [issues]);

  const [activeTab, setActiveTab] = useState<string>(filesWithIssues[0] || '');
  const [search, setSearch] = useState('');

  const { hnToName, anToHn, anToAdmit } = useMemo(() => buildPatientLookups(record), [record]);

  // ตรวจว่าแทบนี้เป็น IPD หรือ OPD
  const isIpdTab = IPD_FILES.has(activeTab);

  // Group issues ตาม file → แต่ละ file group ตาม HN
  const tabData = useMemo(() => {
    const fileIssues = issues.filter((i) => i.file === activeTab);

    // Group ตาม HN
    const hnMap = new Map<string, {
      hn: string; name: string; an: string;
      dateopd: string; dateadm: string; datedsc: string;
      issues: ValidationIssue[];
    }>();

    for (const issue of fileIssues) {
      const info = getPatientInfo(issue, record, anToHn, anToAdmit);
      const key = info.hn || `_row_${issue.row}`;
      const existing = hnMap.get(key);
      if (existing) {
        existing.issues.push(issue);
        // อัปเดตวันที่ถ้ายังไม่มี
        if (!existing.dateopd && info.dateopd) existing.dateopd = info.dateopd;
        if (!existing.dateadm && info.dateadm) existing.dateadm = info.dateadm;
        if (!existing.datedsc && info.datedsc) existing.datedsc = info.datedsc;
        if (!existing.an && info.an) existing.an = info.an;
      } else {
        const name = info.hn ? (hnToName.get(info.hn) || '') : '';
        hnMap.set(key, { hn: info.hn, name, an: info.an, dateopd: info.dateopd, dateadm: info.dateadm, datedsc: info.datedsc, issues: [issue] });
      }
    }

    let patients = Array.from(hnMap.values());

    if (search) {
      const q = search.toLowerCase();
      patients = patients.filter((p) =>
        p.hn.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.issues.some((i) => i.message.toLowerCase().includes(q))
      );
    }

    return patients;
  }, [issues, activeTab, record, hnToName, anToHn, anToAdmit, search]);

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;

  // Count per file — แยก row errors (แถวจริง) กับ cross-file (row=0)
  const fileCount = useMemo(() => {
    const map = new Map<string, { rowErrors: number; crossErrors: number; warnings: number }>();
    for (const i of issues) {
      const s = map.get(i.file) ?? { rowErrors: 0, crossErrors: 0, warnings: 0 };
      if (i.severity === 'error') {
        if (i.row > 0) s.rowErrors++;
        else s.crossErrors++;
      }
      if (i.severity === 'warning') s.warnings++;
      map.set(i.file, s);
    }
    return map;
  }, [issues]);

  return (
    <div className="border-t border-primary-100/50">
      {/* Summary bar */}
      <div className="px-5 py-4 bg-primary-50/60 flex flex-wrap items-center gap-3">
        <h4 className="text-sm font-semibold text-gray-800">ผลการตรวจสอบ</h4>
        {errorCount > 0 && (
          <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-red-100 text-red-700 rounded-full font-medium">
            <AlertCircle className="w-3 h-3" /> {formatNumber(errorCount)} errors
          </span>
        )}
        {warnCount > 0 && (
          <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full font-medium">
            <AlertTriangle className="w-3 h-3" /> {formatNumber(warnCount)} warnings
          </span>
        )}
        {issues.length === 0 && (
          <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full font-medium">
            <CheckCircle className="w-3 h-3" /> ไม่พบปัญหา
          </span>
        )}
        {/* Search */}
        {issues.length > 0 && (
          <div className="relative ml-auto">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="ค้นหา HN / ชื่อ"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-xs pl-8 pr-3 py-2 bg-white rounded-full focus:outline-none focus:ring-2 focus:ring-primary-200 w-48 shadow-card"
            />
          </div>
        )}
      </div>

      {/* File tabs — แสดงทุกแฟ้ม พร้อมจำนวนผ่าน/ไม่ผ่าน */}
      {record.files.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-3 overflow-x-auto bg-white border-b border-primary-100/50">
          {record.files.map((f) => {
            const fc = fileCount.get(f.name);
            // นับ unique แถวที่มี error (row > 0) เพื่อหักออกจาก rowCount
            const errorRowSet = new Set<number>();
            for (const iss of issues) {
              if (iss.file === f.name && iss.severity === 'error' && iss.row > 0) {
                errorRowSet.add(iss.row);
              }
            }
            const rowErrorCount = errorRowSet.size;
            const totalIssues = (fc?.rowErrors ?? 0) + (fc?.crossErrors ?? 0) + (fc?.warnings ?? 0);
            const passedCount = f.rowCount > 0 ? Math.max(0, f.rowCount - rowErrorCount) : 0;
            const hasIssues = totalIssues > 0;
            const isActive = activeTab === f.name;
            return (
              <button
                key={f.name}
                onClick={() => setActiveTab(f.name)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-2xl transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-primary-600 text-white shadow-soft'
                    : hasIssues
                    ? 'bg-white text-gray-700 hover:bg-primary-50 shadow-card'
                    : 'bg-white text-gray-400 hover:bg-gray-50 shadow-card'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{f.name}</span>
                {f.rowCount > 0 && !hasIssues && (
                  <span className={`px-1.5 py-0.5 rounded-full text-xs leading-none ${
                    isActive ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {formatNumber(f.rowCount)} ผ่าน
                  </span>
                )}
                {hasIssues && (
                  <span className="flex items-center gap-1">
                    {passedCount > 0 && (
                      <span className={`px-1.5 py-0.5 rounded-full text-xs leading-none ${
                        isActive ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {formatNumber(passedCount)}
                      </span>
                    )}
                    <span className={`px-1.5 py-0.5 rounded-full text-xs leading-none ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : (fc?.rowErrors ?? 0) + (fc?.crossErrors ?? 0) > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {formatNumber(totalIssues)}
                    </span>
                  </span>
                )}
                {f.rowCount === 0 && !hasIssues && (
                  <span className="px-1.5 py-0.5 rounded-full text-xs leading-none bg-gray-100 text-gray-400">
                    ว่าง
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Patient list for active tab */}
      {tabData.length > 0 && (
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-thin">
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className="bg-primary-100/60 backdrop-blur-sm">
                <th className="px-3 py-3 text-left font-semibold text-primary-800 w-8">#</th>
                <th className="px-3 py-3 text-left font-semibold text-primary-800 w-20">HN</th>
                <th className="px-3 py-3 text-left font-semibold text-primary-800 w-40">ชื่อ-สกุล</th>
                {isIpdTab ? (
                  <>
                    <th className="px-2 py-3 text-center font-semibold text-primary-800 w-14">AN</th>
                    <th className="px-2 py-3 text-center font-semibold text-primary-800 w-24">วัน Admit</th>
                    <th className="px-2 py-3 text-center font-semibold text-primary-800 w-24">วัน D/C</th>
                  </>
                ) : (
                  <th className="px-2 py-3 text-center font-semibold text-primary-800 w-24">วันที่รับบริการ</th>
                )}
                <th className="px-2 py-3 text-center font-semibold text-primary-800 w-16">ระดับ</th>
                <th className="px-3 py-3 text-left font-semibold text-primary-800">หมายเหตุ (ต้องแก้ไข)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary-50/50 bg-white">
              {tabData.map((patient, pIdx) => {
                return patient.issues.map((issue, iIdx) => {
                  const sev = SEV_CONFIG[issue.severity];
                  const SevIcon = sev.icon;
                  const isFirstRow = iIdx === 0;
                  return (
                    <tr
                      key={`${pIdx}-${iIdx}`}
                      className={`hover:bg-gray-50/50 ${isFirstRow && pIdx > 0 ? 'border-t-2 border-gray-200' : ''}`}
                    >
                      {isFirstRow ? (
                        <>
                          <td className="px-3 py-2 text-gray-400 align-top" rowSpan={patient.issues.length}>
                            {pIdx + 1}
                          </td>
                          <td className="px-3 py-2 font-mono text-gray-800 align-top whitespace-nowrap" rowSpan={patient.issues.length}>
                            {patient.hn || '-'}
                          </td>
                          <td className="px-3 py-2 text-gray-700 align-top" rowSpan={patient.issues.length}>
                            {patient.name || '-'}
                          </td>
                          {isIpdTab ? (
                            <>
                              <td className="px-2 py-2 text-center text-gray-600 align-top whitespace-nowrap" rowSpan={patient.issues.length}>
                                {patient.an || '-'}
                              </td>
                              <td className="px-2 py-2 text-center text-gray-600 align-top whitespace-nowrap" rowSpan={patient.issues.length}>
                                {formatClaimDate(patient.dateadm)}
                              </td>
                              <td className="px-2 py-2 text-center text-gray-600 align-top whitespace-nowrap" rowSpan={patient.issues.length}>
                                {formatClaimDate(patient.datedsc)}
                              </td>
                            </>
                          ) : (
                            <td className="px-2 py-2 text-center text-gray-600 align-top whitespace-nowrap" rowSpan={patient.issues.length}>
                              {formatClaimDate(patient.dateopd)}
                            </td>
                          )}
                        </>
                      ) : null}
                      <td className="px-2 py-1.5 text-center">
                        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs ${sev.bg} ${sev.color}`}>
                          <SevIcon className="w-3 h-3" />
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-gray-800">
                        {issue.message}
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ไม่มี issue ในแทบนี้ */}
      {activeTab && tabData.length === 0 && (
        <div className="px-4 py-8 text-center text-sm">
          {search ? (
            <p className="text-gray-400">ไม่พบรายการตามเงื่อนไข</p>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle className="w-8 h-8 text-green-400" />
              <p className="text-green-600 font-medium">ผ่านการตรวจสอบทั้งหมด</p>
              {(() => {
                const f = record.files.find((f) => f.name === activeTab);
                return f ? <p className="text-gray-400">{formatNumber(f.rowCount)} รายการ ไม่พบข้อผิดพลาด</p> : null;
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                         */
/* ------------------------------------------------------------------ */

export default function GovClaim16Page() {
  const userName = useSessionStore((s) => s.userName);
  const hospitalCode = useSessionStore((s) => s.hospitalCode);
  const isAdmin = useSessionStore((s) => s.isAdmin);
  const { records, save, update, delete: deleteRecord } = useClaim16Store();
  const invalidateMonthly = useInvalidateClaim16Monthly();

  const [isDragging, setIsDragging] = useState(false);
  const [parseStatus, setParseStatus] = useState<'idle' | 'parsing' | 'success' | 'saved' | 'error'>('idle');
  const [parseError, setParseError] = useState('');
  const [parsedRecord, setParsedRecord] = useState<Claim16Record | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState('');

  useEffect(() => {
    useClaim16Store.getState().loadByHospital(isAdmin ? '*' : hospitalCode ?? '*');
  }, [isAdmin, hospitalCode]);

  const handleFolder = useCallback(async (files: File[]) => {
    setParseStatus('parsing');
    setParseError('');
    setParsedRecord(null);

    // Debug: แสดงข้อมูลไฟล์บนหน้าจอ
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sample = files.slice(0, 8).map((f: any) =>
      `${f.name} | relPath="${f.webkitRelativePath || ''}" | size=${f.size}`
    );
    setDebugInfo(`ไฟล์ทั้งหมด: ${files.length}\n${sample.join('\n')}`);

    try {
      // ตรวจขนาดไฟล์ก่อน — ถ้าทุกไฟล์ size=0 แปลว่า browser อ่านไม่ได้
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      if (totalSize === 0) {
        throw new Error(
          'ไฟล์ทั้งหมดมีขนาด 0 bytes — browser อ่านไฟล์ไม่ได้\n' +
          'อาจเกิดจาก: (1) ไฟล์เป็นไฟล์เปล่า (2) ไฟล์อยู่บน OneDrive/cloud ที่ยังไม่ sync ลงเครื่อง ' +
          '(3) ไฟล์อยู่บน network drive ที่ไม่มีสิทธิ์อ่าน\n' +
          'ลอง: copy ไฟล์มาวางในเครื่อง local แล้วลากเข้ามาใหม่',
        );
      }

      // ดึงชื่อโฟลเดอร์: ลอง webkitRelativePath ก่อน, fallback ใช้ชื่อไฟล์
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const relPath: string = (files[0] as any)?.webkitRelativePath || '';
      const folderName = (relPath ? relPath.split('/')[0] : null)
        || files[0]?.name?.replace(/\.txt$/i, '') || 'โฟลเดอร์';
      const record = await parseClaim16Folder(files, folderName, userName ?? 'ไม่ระบุ');

      // Hospital validation — แจ้งเตือนแต่ไม่ block (เพื่อให้ทดสอบได้)
      if (!isAdmin && hospitalCode && record.hospitalCode !== hospitalCode && record.hospitalCode !== 'UNKNOWN') {
        record.validationIssues.push({
          file: 'INS',
          row: 0,
          field: 'hcode',
          severity: 'warning',
          message: `รหัสโรงพยาบาลในไฟล์ (${record.hospitalCode}) ไม่ตรงกับที่ login (${hospitalCode})`,
          value: record.hospitalCode,
        });
      }

      // Validate ทันทีหลัง parse
      const issues = validateClaim16(record);
      record.validationIssues = issues;
      record.isValidated = true;

      setParsedRecord(record);
      setParseStatus('success');
    } catch (e) {
      setParseError(String(e));
      setParseStatus('error');
    }
  }, [userName, hospitalCode, isAdmin]);

  const [isSaving, setIsSaving] = useState(false);
  const [dedupNotice, setDedupNotice] = useState<string | null>(null);

  const confirmSaveAndImport = async () => {
    if (!parsedRecord) return;
    setIsSaving(true);
    setDedupNotice(null);
    try {
      // สร้าง summary (นับเฉพาะแถวที่ผ่าน)
      const summary = buildClaim16Summary(parsedRecord);
      const recordWithSummary: Claim16Record = { ...parsedRecord, summary };
      const result = await save(recordWithSummary);
      // อัปเดต parsedRecord ให้มี summary แสดงบนหน้าจอ (ไม่เคลียร์)
      setParsedRecord(recordWithSummary);
      setParseStatus('saved');
      setDebugInfo('');
      if (result.deduped) {
        setDedupNotice('ข้อมูลชุดนี้ถูกบันทึกไว้แล้วก่อนหน้านี้ — ระบบอัปเดต record เดิมให้แทน (ไม่นับซ้ำในยอดสรุป)');
      }
      invalidateMonthly();
    } catch (e) {
      setParseError(`บันทึกไม่สำเร็จ: ${extractErrorMessage(e)}`);
      setParseStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleValidate = async (id: string) => {
    const record = records.find((r) => r.id === id);
    if (!record) return;
    const issues = validateClaim16(record);
    const updated: Claim16Record = { ...record, validationIssues: issues, isValidated: true };
    await update(updated);
    setExpandedId(id);
  };

  const handleImport = async (id: string) => {
    const record = records.find((r) => r.id === id);
    if (!record) return;
    const summary = buildClaim16Summary(record);
    const updated: Claim16Record = { ...record, summary };
    await update(updated);
    invalidateMonthly();
  };

  const handleDelete = async (id: string) => {
    await deleteRecord(id);
    invalidateMonthly();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFolder(files);
  };


  const visibleRecords = isAdmin
    ? records
    : records.filter((r) => !hospitalCode || r.hospitalCode === hospitalCode || r.hospitalCode === 'UNKNOWN');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">นำเข้าไฟล์ 16 แฟ้ม เพื่อตรวจสอบ</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          เลือกไฟล์ .txt จากโฟลเดอร์ 16 แฟ้ม ระบบจะตรวจสอบข้อมูลให้อัตโนมัติ
          {isAdmin && <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Admin Mode</span>}
        </p>
      </div>

      {/* Upload Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => document.getElementById('claim16-input')?.click()}
        className={`border-2 border-dashed rounded-2xl p-7 text-center transition-all cursor-pointer ${
          isDragging
            ? 'border-primary-500 bg-primary-50'
            : 'border-primary-200 bg-white hover:border-primary-400 hover:bg-primary-50/40'
        }`}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 bg-gradient-to-br from-primary-100 to-primary-200/70 rounded-2xl flex items-center justify-center">
            <FolderArchive className="w-7 h-7 text-primary-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">เลือกไฟล์ 16 แฟ้ม</p>
            <p className="text-xs text-gray-500 mt-1">เปิดโฟลเดอร์แล้วเลือกไฟล์ .txt ทั้งหมด (Ctrl+A)</p>
            <p className="text-xs text-gray-400 mt-1">INS.txt, PAT.txt, OPD.txt, IPD.txt, CHT.txt ฯลฯ</p>
          </div>
          <Upload className="w-4 h-4 text-primary-400" />
        </div>
        <input
          id="claim16-input"
          type="file"
          accept=".txt,.TXT"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleFolder(files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Parse status */}
      {parseStatus === 'parsing' && (
        <div className="flex items-center gap-2 text-sm text-primary-600">
          <Loader className="w-4 h-4 animate-spin" /> กำลังอ่านไฟล์...
        </div>
      )}
      {parseStatus === 'error' && (
        <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {parseError}
          </div>
          {debugInfo && (
            <pre className="text-xs text-gray-500 bg-white p-2 rounded border border-gray-200 whitespace-pre-wrap">{debugInfo}</pre>
          )}
        </div>
      )}

      {/* Parsed preview + validation results */}
      {parsedRecord && (parseStatus === 'success' || parseStatus === 'saved') && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {/* Header */}
          <div className={`border-b p-4 ${parseStatus === 'saved' ? 'bg-primary-50 border-primary-200' : 'bg-green-50 border-green-200'}`}>
            {/* Dedup notice — เฉพาะเมื่อ backend ตรวจเจอ hash ซ้ำ */}
            {parseStatus === 'saved' && dedupNotice && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">{dedupNotice}</p>
              </div>
            )}

            {/* บันทึกสำเร็จ banner */}
            {parseStatus === 'saved' && parsedRecord.summary && (
              <div className="bg-primary-100 border border-primary-300 rounded-lg p-3 mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-4 h-4 text-primary-600" />
                  <p className="text-sm font-semibold text-primary-800">บันทึกและนำเข้าสำเร็จ!</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="bg-white rounded-lg p-2 text-center">
                    <p className="text-xs text-gray-500">OPD Visits</p>
                    <p className="text-lg font-bold text-primary-700">{formatNumber(parsedRecord.summary.opdVisits)}</p>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center">
                    <p className="text-xs text-gray-500">IPD Admissions</p>
                    <p className="text-lg font-bold text-purple-700">{formatNumber(parsedRecord.summary.ipdAdmissions)}</p>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center">
                    <p className="text-xs text-gray-500">Visit รวม</p>
                    <p className="text-lg font-bold text-green-700">{formatNumber(parsedRecord.summary.totalVisits)}</p>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center">
                    <p className="text-xs text-gray-500">มูลค่ารวม</p>
                    <p className="text-lg font-bold text-green-700">{formatCurrency(parsedRecord.summary.totalAmount)}</p>
                  </div>
                </div>
                <p className="text-xs text-primary-600 mt-2">ยอดจะแสดงในแทบ "ภาพรวมการเงิน" แล้ว</p>
              </div>
            )}

            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <p className="text-sm font-medium text-green-800">
                  {parsedRecord.fileName} — รพ. {parsedRecord.hospitalCode} —{' '}
                  {parsedRecord.files.length} ไฟล์, {formatNumber(parsedRecord.totalRows)} แถว
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setParsedRecord(null); setParseStatus('idle'); }}
                  className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded"
                >
                  {parseStatus === 'saved' ? 'ปิด' : 'ยกเลิก'}
                </button>
                {parseStatus === 'success' && (
                  <button
                    onClick={confirmSaveAndImport}
                    disabled={isSaving}
                    className="flex items-center gap-1 text-xs font-medium bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    {isSaving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                    {isSaving ? 'กำลังบันทึก...' : 'บันทึกและนำเข้าข้อมูลที่ผ่าน'}
                  </button>
                )}
              </div>
            </div>

            {/* File list chips */}
            <div className="flex flex-wrap gap-1.5">
              {parsedRecord.files.map((f) => (
                <span key={f.name} className="text-xs px-2 py-1 bg-white/60 text-green-800 rounded border border-green-200">
                  <FileText className="w-3 h-3 inline mr-1" />
                  {f.name}.txt — {formatNumber(f.rowCount)} แถว
                </span>
              ))}
            </div>
          </div>

          {/* Validation results */}
          {parsedRecord.isValidated && (
            <ValidationResultsPanel issues={parsedRecord.validationIssues} record={parsedRecord} />
          )}

          {/* ปุ่มด้านล่าง (เฉพาะก่อน save) */}
          {parseStatus === 'success' && (
            <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 py-3 flex items-center justify-between">
              <div className="text-xs text-gray-500">
                {(() => {
                  const errs = parsedRecord.validationIssues.filter((i) => i.severity === 'error').length;
                  const warns = parsedRecord.validationIssues.filter((i) => i.severity === 'warning').length;
                  const passed = parsedRecord.totalRows - errs;
                  return `ผ่าน ${formatNumber(passed)} รายการ · ${formatNumber(errs)} errors · ${formatNumber(warns)} warnings`;
                })()}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setParsedRecord(null); setParseStatus('idle'); }}
                  className="text-xs text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-100"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={confirmSaveAndImport}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 text-sm font-medium bg-green-600 text-white px-5 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {isSaving ? <Loader className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  {isSaving ? 'กำลังบันทึก...' : 'บันทึกและนำเข้าข้อมูลที่ผ่าน'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Saved records */}
      {visibleRecords.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            ไฟล์ที่บันทึกไว้ ({visibleRecords.length})
          </h3>
          <div className="space-y-3">
            {visibleRecords.map((r) => (
              <Claim16Card
                key={r.id}
                record={r}
                onDelete={handleDelete}
                onValidate={handleValidate}
                onImport={handleImport}
                onToggleDetail={(id) => setExpandedId(expandedId === id ? null : id)}
                isExpanded={expandedId === r.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {visibleRecords.length === 0 && !parsedRecord && parseStatus === 'idle' && (
        <div className="text-center py-12 text-gray-400">
          <FolderArchive className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">ยังไม่มีไฟล์ 16 แฟ้มที่บันทึกไว้</p>
          <p className="text-xs mt-1">เลือกไฟล์ .txt จากโฟลเดอร์ 16 แฟ้มด้านบนเพื่อเริ่มต้น</p>
        </div>
      )}
    </div>
  );
}
