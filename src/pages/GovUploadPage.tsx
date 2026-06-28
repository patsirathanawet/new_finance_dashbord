import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileText, FileSpreadsheet, FileArchive, Trash2, Eye, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import { useUploadStore } from '../store/uploadStore';
import { parseREP } from '../lib/repParser';
import {
  importRepToClaimDb, importSsopRepToClaimDb, importCsopToClaimDb, importAipnToClaimDb, importAipnStmToClaimDb,
  extractErrorMessage,
} from '../lib/backendApi';
import { parseSTMFile } from '../lib/stmParser';
import { parseSsopRepZip } from '../lib/ssopRepParser';
import { parseCsopRepZip } from '../lib/csopRepParser';
import { parseAipnRepZip } from '../lib/aipnRepParser';
import { parseAipnStmZip } from '../lib/aipnStmParser';
import { formatCurrency, formatNumber } from '../lib/formatUtils';
import type { REPRecord, STMRecord, SsopRepRecord, CsopRepRecord, AipnRepRecord, AipnStmRecord } from '../types/upload';

type ParseStatus = 'idle' | 'parsing' | 'success' | 'error';
type ZipRecord = SsopRepRecord | CsopRepRecord | AipnRepRecord;

interface FileItem {
  file: File;
  status: ParseStatus;
  error?: string;
  record?: REPRecord | STMRecord | ZipRecord | AipnStmRecord;
  fileType: 'REP' | 'STM' | 'SSOP' | 'CSOP' | 'AIPN' | 'AIPN_STM';
}

/** ไฟล์ .zip ในโซน REP มีหลายรูปแบบ (SSOP/CSOP/AIPN) — ลองตามลำดับ ใครพบไฟล์ marker ของตัวเองก่อนคือ match */
async function detectAndParseZip(
  buf: ArrayBuffer,
  fileName: string,
  uploadedBy: string,
): Promise<{ type: 'SSOP' | 'CSOP' | 'AIPN'; record: ZipRecord }> {
  const attempts: Array<{ type: 'SSOP' | 'CSOP' | 'AIPN'; parse: () => Promise<ZipRecord> }> = [
    { type: 'CSOP', parse: () => parseCsopRepZip(buf, fileName, uploadedBy) },
    { type: 'SSOP', parse: () => parseSsopRepZip(buf, fileName, uploadedBy) },
    { type: 'AIPN', parse: () => parseAipnRepZip(buf, fileName, uploadedBy) },
  ];
  const errors: string[] = [];
  for (const a of attempts) {
    try {
      const record = await a.parse();
      return { type: a.type, record };
    } catch (e) {
      errors.push(`${a.type}: ${String(e instanceof Error ? e.message : e)}`);
    }
  }
  throw new Error(`ไม่รู้จักรูปแบบไฟล์ ZIP นี้ — ${errors.join(' / ')}`);
}

function formatUploadDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function REPCard({ record, onDelete }: { record: REPRecord; onDelete: (id: string) => void }) {
  const navigate = useNavigate();
  const passRate = record.totalSubmitted > 0
    ? ((record.totalPassed / record.totalSubmitted) * 100).toFixed(1)
    : '0';

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 bg-primary-50 rounded-lg flex items-center justify-center flex-shrink-0">
            <FileText className="w-4.5 h-4.5 text-primary-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{record.fileName}</p>
            <p className="text-xs text-gray-400">อัปโหลด {formatUploadDate(record.uploadedAt)} โดย {record.uploadedBy}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => navigate(`/government/rep/${record.id}`)}
            className="p-1.5 text-primary-500 hover:bg-primary-50 rounded-lg transition-colors"
            title="ดูรายละเอียด"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(record.id)}
            className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
            title="ลบ"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        <div className="bg-gray-50 rounded-lg p-2 text-center">
          <p className="text-xs text-gray-500 mb-0.5">งวดที่</p>
          <p className="text-sm font-bold text-gray-900">{record.batchNo}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-2 text-center">
          <p className="text-xs text-gray-500 mb-0.5">ส่งทั้งหมด</p>
          <p className="text-sm font-bold text-gray-900">{formatNumber(record.totalSubmitted)} ราย</p>
        </div>
        <div className="bg-green-50 rounded-lg p-2 text-center">
          <p className="text-xs text-gray-500 mb-0.5">ผ่าน</p>
          <p className="text-sm font-bold text-green-700">
            {formatNumber(record.totalPassed)} ({passRate}%)
          </p>
        </div>
        <div className="bg-red-50 rounded-lg p-2 text-center">
          <p className="text-xs text-gray-500 mb-0.5">ไม่ผ่าน</p>
          <p className="text-sm font-bold text-red-700">
            {formatNumber(record.totalFailed)} ราย
          </p>
        </div>
        <div className="bg-emerald-50 rounded-lg p-2 text-center">
          <p className="text-xs text-gray-500 mb-0.5">ยอดที่ผ่าน</p>
          <p className="text-sm font-bold text-emerald-700">{formatCurrency(record.passedAmount || record.totalAmount)}</p>
        </div>
        <div className="bg-amber-50 rounded-lg p-2 text-center">
          <p className="text-xs text-gray-500 mb-0.5">ยอดที่ไม่ผ่าน</p>
          <p className="text-sm font-bold text-amber-700">{formatCurrency(record.failedAmount)}</p>
        </div>
        <div className="bg-primary-50 rounded-lg p-2 text-center">
          <p className="text-xs text-gray-500 mb-0.5">ยอดรวม</p>
          <p className="text-sm font-bold text-primary-700">{formatCurrency(record.totalAmount)}</p>
        </div>
      </div>
    </div>
  );
}

function STMCard({ record, onDelete }: { record: STMRecord; onDelete: (id: string) => void }) {
  const navigate = useNavigate();
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 bg-green-50 rounded-lg flex items-center justify-center flex-shrink-0">
            <FileSpreadsheet className="w-4.5 h-4.5 text-green-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{record.fileName}</p>
            <p className="text-xs text-gray-400">อัปโหลด {formatUploadDate(record.uploadedAt)} โดย {record.uploadedBy}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => navigate(`/government/stm/${record.id}`)}
            className="p-1.5 text-primary-500 hover:bg-primary-50 rounded-lg transition-colors"
            title="ดูรายละเอียด"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(record.id)}
            className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
            title="ลบ"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div className="bg-gray-50 rounded-lg p-2 text-center">
          <p className="text-xs text-gray-500 mb-0.5">เลขที่เอกสาร</p>
          <p className="text-xs font-semibold text-gray-900 truncate">{record.docNo}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-2 text-center">
          <p className="text-xs text-gray-500 mb-0.5">จำนวนราย</p>
          <p className="text-sm font-bold text-gray-900">{formatNumber(record.totalCases)} ราย</p>
        </div>
        <div className="bg-green-50 rounded-lg p-2 text-center">
          <p className="text-xs text-gray-500 mb-0.5">ยอดพึงรับ</p>
          <p className="text-sm font-bold text-green-700">{formatCurrency(record.totalAmount)}</p>
        </div>
      </div>
    </div>
  );
}

export default function GovUploadPage() {
  const navigate = useNavigate();
  const userName = useSessionStore((s) => s.userName);
  const hospitalCode = useSessionStore((s) => s.hospitalCode);
  const isAdmin = useSessionStore((s) => s.isAdmin);
  const { repRecords, stmRecords, saveREP, saveSTM, deleteREP, deleteSTM } = useUploadStore();

  const [pendingFiles, setPendingFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const repDropRef = useRef<HTMLDivElement>(null);
  const stmDropRef = useRef<HTMLDivElement>(null);

  const addFiles = useCallback(
    async (files: File[], fileType: 'REP' | 'STM') => {
      const newItems: FileItem[] = files.map((f) => ({ file: f, status: 'parsing', fileType }));
      setPendingFiles((prev) => [...prev, ...newItems]);

      for (const item of newItems) {
        const buf = await item.file.arrayBuffer();
        try {
          let record: REPRecord | STMRecord | ZipRecord | AipnStmRecord;
          let actualType: FileItem['fileType'] = item.fileType;

          if (fileType === 'REP' && /\.zip$/i.test(item.file.name)) {
            // ไฟล์ .zip ในโซน REP → ตรวจรูปแบบอัตโนมัติ: CSOP (COCDBIL) / SSOP (SOCDBMN) / AIPN (SIGNREP)
            const detected = await detectAndParseZip(buf, item.file.name, userName ?? 'ไม่ระบุ');
            record = detected.record;
            actualType = detected.type;
            if (!isAdmin && hospitalCode && record.hospitalCode !== hospitalCode) {
              setPendingFiles((prev) =>
                prev.map((p) =>
                  p.file === item.file
                    ? { ...p, status: 'error', error: `รหัสโรงพยาบาลในไฟล์ (${record.hospitalCode}) ไม่ตรงกับที่ login (${hospitalCode})` }
                    : p
                )
              );
              continue;
            }
          } else if (fileType === 'REP') {
            record = parseREP(buf, item.file.name, userName ?? 'ไม่ระบุ');
            const rep = record as REPRecord;
            // Hospital validation
            if (!isAdmin && hospitalCode && rep.hospitalCode !== hospitalCode) {
              setPendingFiles((prev) =>
                prev.map((p) =>
                  p.file === item.file
                    ? { ...p, status: 'error', error: `รหัสโรงพยาบาลในไฟล์ (${rep.hospitalCode}) ไม่ตรงกับที่ login (${hospitalCode})` }
                    : p
                )
              );
              continue;
            }
          } else if (/\.zip$/i.test(item.file.name)) {
            // ไฟล์ .zip ในโซน STM → ใบแจ้งยอดเงินที่เบิกได้ AIPN (SIGNSTMM/SIGNSTMS.xml)
            record = await parseAipnStmZip(buf, item.file.name, userName ?? 'ไม่ระบุ');
            actualType = 'AIPN_STM';
            const stm = record as AipnStmRecord;
            if (!isAdmin && hospitalCode && stm.hospitalCode !== hospitalCode) {
              setPendingFiles((prev) =>
                prev.map((p) =>
                  p.file === item.file
                    ? { ...p, status: 'error', error: `รหัสโรงพยาบาลในไฟล์ (${stm.hospitalCode}) ไม่ตรงกับที่ login (${hospitalCode})` }
                    : p
                )
              );
              continue;
            }
          } else {
            record = await parseSTMFile(buf, item.file.name, userName ?? 'ไม่ระบุ');
            const stm = record as STMRecord;
            if (!isAdmin && hospitalCode && stm.hospitalCode !== hospitalCode) {
              setPendingFiles((prev) =>
                prev.map((p) =>
                  p.file === item.file
                    ? { ...p, status: 'error', error: `รหัสโรงพยาบาลในไฟล์ (${stm.hospitalCode}) ไม่ตรงกับที่ login (${hospitalCode})` }
                    : p
                )
              );
              continue;
            }
          }

          setPendingFiles((prev) =>
            prev.map((p) => (p.file === item.file ? { ...p, status: 'success', record, fileType: actualType } : p))
          );
        } catch (e) {
          setPendingFiles((prev) =>
            prev.map((p) =>
              p.file === item.file ? { ...p, status: 'error', error: String(e) } : p
            )
          );
        }
      }
    },
    [userName, hospitalCode, isAdmin]
  );

  const confirmSave = async () => {
    const messages: string[] = [];
    for (const item of pendingFiles) {
      if (item.status !== 'success' || !item.record) continue;

      if (item.fileType === 'REP') {
        const rep = item.record as REPRecord;
        // ส่งไปที่ claim DB (rep_head + rep_detail) — ตรวจซ้ำด้วย rep_no
        try {
          const result = await importRepToClaimDb({
            repNo: rep.batchNo,
            hospitalCode: rep.hospitalCode,
            invoiceDoc: rep.refNo,
            issuedAt: rep.issueDate,
            totalSubmitted: rep.totalSubmitted,
            totalPassed: rep.totalPassed,
            totalFailed: rep.totalFailed,
            passedAmount: rep.passedAmount ?? 0,
            failedAmount: rep.failedAmount ?? 0,
            totalAmount: rep.totalAmount,
            detailRows: rep.detailRows ?? [],
          });
          if (result.alreadyImported) {
            messages.push(`⚠ ${item.file.name}: ${result.message ?? 'มีการนำเข้าแล้ว'}`);
          } else {
            messages.push(`✓ ${item.file.name}: นำเข้า ${result.detailInserted} รายการ`);
            // เก็บ local state ของ REP ด้วย (สำหรับแสดงในตารางด้านล่าง)
            await saveREP(rep);
          }
        } catch (e) {
          messages.push(`✗ ${item.file.name}: ${extractErrorMessage(e)}`);
        }
      } else if (item.fileType === 'SSOP') {
        const rec = item.record as SsopRepRecord;
        // ส่งไปที่ claim DB (ssop_rep_head + ssop_rep_detail) — ตรวจซ้ำด้วย ack_no
        try {
          const detailRows = rec.claimLines.map((l) => ({
            ack_no: rec.ackNo,
            line_no: l.lineNo,
            status: l.status,
            station: l.station,
            hcode: l.hcode,
            hmain: l.hmain,
            auth_code: l.authCode,
            dt_tran: l.dtTran,
            inv_no: l.invNo,
            pid: l.pid,
            bp: l.bp,
            amount: l.amount,
            claim_amt: l.claimAmt,
            check_codes: l.checkCodes.join(','),
            drug_detail: l.drugDetail.length > 0 ? l.drugDetail : null,
          }));
          const result = await importSsopRepToClaimDb({
            ackNo: rec.ackNo,
            docType: rec.docType,
            hospitalCode: rec.hospitalCode,
            mainHospitalCode: rec.mainHospitalCode,
            mainHospitalName: rec.mainHospitalName ?? '',
            batchRef: rec.batchRef,
            station: rec.station ?? '',
            ackAt: rec.ackAt ?? '',
            totalSubmitted: rec.totalSubmitted,
            totalPassed: rec.totalPassed,
            totalFailed: rec.totalFailed,
            detailRows,
          });
          if (result.alreadyImported) {
            messages.push(`⚠ ${item.file.name}: ${result.message ?? 'มีการนำเข้าแล้ว'}`);
          } else {
            messages.push(`✓ ${item.file.name}: นำเข้า ${result.detailInserted} รายการ (ssop_rep)`);
          }
        } catch (e) {
          messages.push(`✗ ${item.file.name}: ${extractErrorMessage(e)}`);
        }
      } else if (item.fileType === 'CSOP') {
        const rec = item.record as CsopRepRecord;
        // ส่งไปที่ claim DB (csop_rep_head + csop_rep_head_detail) — ตรวจซ้ำด้วย ack_no
        try {
          const detailRows = rec.claimLines.map((l) => ({
            ack_no: rec.ackNo,
            line_no: l.lineNo,
            status: l.status,
            station: l.station,
            auth_code: l.authCode,
            dt_tran: l.dtTran,
            inv_no: l.invNo,
            bill_no: l.billNo,
            hn: l.hn,
            member_no: l.memberNo,
            claim_amt: l.claimAmt,
            check_codes: l.checkCodes.join(','),
            bill_items_detail: l.billItemsDetail.length > 0 ? l.billItemsDetail : null,
            drug_detail: l.drugDetail.length > 0 ? l.drugDetail : null,
          }));
          const result = await importCsopToClaimDb({
            ackNo: rec.ackNo,
            docType: rec.docType,
            hospitalCode: rec.hospitalCode,
            batchRef: rec.batchRef,
            station: rec.station ?? '',
            ackAt: rec.ackAt ?? '',
            totalSubmitted: rec.totalSubmitted,
            totalPassed: rec.totalPassed,
            totalFailed: rec.totalFailed,
            detailRows,
          });
          if (result.alreadyImported) {
            messages.push(`⚠ ${item.file.name}: ${result.message ?? 'มีการนำเข้าแล้ว'}`);
          } else {
            messages.push(`✓ ${item.file.name}: นำเข้า ${result.detailInserted} รายการ (csop_rep)`);
          }
        } catch (e) {
          messages.push(`✗ ${item.file.name}: ${extractErrorMessage(e)}`);
        }
      } else if (item.fileType === 'AIPN') {
        const rec = item.record as AipnRepRecord;
        // ส่งไปที่ claim DB (aipn_rep_head + aipn_rep_head_detail) — ตรวจซ้ำด้วย ack_no
        try {
          const detailRows = rec.claimLines.map((l) => ({
            ack_no: rec.ackNo,
            line_no: l.lineNo,
            status: l.status,
            pcode: l.pcode,
            iptype: l.iptype,
            care_as: l.careAs,
            ss: l.ss,
            hmain: l.hmain,
            hcare: l.hcare,
            an: l.an,
            drg: l.drg,
            rw: l.rw,
            adjrw: l.adjrw,
            service_type: l.serviceType,
            service_subtype: l.serviceSubtype,
            pt: l.pt,
            amount: l.amount,
            patient_name: l.patientName,
            check_codes: l.checkCodes.join(','),
            sub_detail: l.subDetail,
          }));
          const result = await importAipnToClaimDb({
            ackNo: rec.ackNo,
            docType: rec.docType,
            hospitalCode: rec.hospitalCode,
            batchNo: rec.batchNo ?? '',
            batchRef: rec.batchRef ?? '',
            ackAt: rec.ackAt ?? '',
            totalSubmitted: rec.totalSubmitted,
            totalPassed: rec.totalPassed,
            totalFailed: rec.totalFailed,
            detailRows,
          });
          if (result.alreadyImported) {
            messages.push(`⚠ ${item.file.name}: ${result.message ?? 'มีการนำเข้าแล้ว'}`);
          } else {
            messages.push(`✓ ${item.file.name}: นำเข้า ${result.detailInserted} รายการ (aipn_rep)`);
          }
        } catch (e) {
          messages.push(`✗ ${item.file.name}: ${extractErrorMessage(e)}`);
        }
      } else if (item.fileType === 'AIPN_STM') {
        const rec = item.record as AipnStmRecord;
        // ส่งไปที่ claim DB (aipn_stm) — เพิ่มเฉพาะ (stm_no, an) ที่ยังไม่มี
        try {
          const result = await importAipnStmToClaimDb({
            hospitalCode: rec.hospitalCode,
            statements: rec.statements.map((s) => ({
              stmNo: s.stmNo,
              stmType: s.stmType,
              period: s.period,
              periodDesc: s.periodDesc,
              dateDue: s.dateDue,
              cases: s.cases,
              totalAdjrw: s.totalAdjrw,
              bills: s.bills,
            })),
          });
          messages.push(
            result.skipped > 0
              ? `✓ ${item.file.name}: นำเข้าใหม่ ${result.inserted} รายการ (ข้าม ${result.skipped} รายการที่มีอยู่แล้ว) (aipn_stm)`
              : `✓ ${item.file.name}: นำเข้า ${result.inserted} รายการ (aipn_stm)`
          );
        } catch (e) {
          messages.push(`✗ ${item.file.name}: ${extractErrorMessage(e)}`);
        }
      } else {
        await saveSTM(item.record as STMRecord);
        messages.push(`✓ ${item.file.name}: บันทึก STM`);
      }
    }
    setPendingFiles([]);
    if (messages.length > 0) alert(messages.join('\n'));
  };

  const handleDrop = (e: React.DragEvent, fileType: 'REP' | 'STM') => {
    e.preventDefault();
    setIsDragging(false);
    const accepted = Array.from(e.dataTransfer.files).filter((f) => {
      const ext = f.name.split('.').pop()?.toUpperCase();
      return fileType === 'REP'
        ? ['REP', 'XLS', 'XLSX', 'ZIP'].includes(ext ?? '')
        : ['XLS', 'XLSX', 'XML', 'ZIP'].includes(ext ?? '');
    });
    if (accepted.length) addFiles(accepted, fileType);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>, fileType: 'REP' | 'STM') => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) addFiles(files, fileType);
    e.target.value = '';
  };

  const successCount = pendingFiles.filter((p) => p.status === 'success').length;

  // Filter records by hospital (or all if admin)
  const visibleREP = isAdmin
    ? repRecords
    : repRecords.filter((r) => !hospitalCode || r.hospitalCode === hospitalCode);
  const visibleSTM = isAdmin
    ? stmRecords
    : stmRecords.filter((r) => !hospitalCode || r.hospitalCode === hospitalCode);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">อัปโหลดไฟล์ REP / STM</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          อัปโหลดผลการตรวจสอบเคลม (REP) และรายงานยอดเบิก (STM)
          {isAdmin && <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Admin Mode</span>}
        </p>
      </div>

      {/* Upload Zones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* REP Upload */}
        <div
          ref={repDropRef}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => handleDrop(e, 'REP')}
          className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${isDragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-primary-300 hover:bg-primary-50/30'}`}
          onClick={() => document.getElementById('rep-input')?.click()}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
              <FileText className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">ไฟล์ REP</p>
              <p className="text-xs text-gray-500 mt-0.5">ผลการตรวจสอบเคลม (ตอบกลับจาก CIPN/CSMBS/NHSO) หรือไฟล์ตอบกลับ CSOP/SSOP/AIPN</p>
              <p className="text-xs text-gray-400 mt-1">ลากวาง หรือคลิกเพื่อเลือกไฟล์ .REP / .XLS / .XLSX / .ZIP</p>
            </div>
            <Upload className="w-4 h-4 text-gray-400" />
          </div>
          <input
            id="rep-input"
            type="file"
            accept=".rep,.xls,.xlsx,.zip,.REP,.XLS,.XLSX,.ZIP"
            multiple
            className="hidden"
            onChange={(e) => handleFileInput(e, 'REP')}
          />
        </div>

        {/* STM Upload */}
        <div
          ref={stmDropRef}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => handleDrop(e, 'STM')}
          className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${isDragging ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-green-300 hover:bg-green-50/30'}`}
          onClick={() => document.getElementById('stm-input')?.click()}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
              <FileSpreadsheet className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">ไฟล์ STM</p>
              <p className="text-xs text-gray-500 mt-0.5">รายงานยอดเงินที่เบิกได้ (Statement)</p>
              <p className="text-xs text-gray-400 mt-1">ลากวาง หรือคลิกเพื่อเลือกไฟล์ .XLS / .XML / .ZIP (AIPN)</p>
            </div>
            <Upload className="w-4 h-4 text-gray-400" />
          </div>
          <input
            id="stm-input"
            type="file"
            accept=".xls,.xlsx,.xml,.zip,.XLS,.XLSX,.XML,.ZIP"
            multiple
            className="hidden"
            onChange={(e) => handleFileInput(e, 'STM')}
          />
        </div>
      </div>

      {/* Pending Files */}
      {pendingFiles.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">ไฟล์ที่รอบันทึก ({pendingFiles.length} ไฟล์)</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPendingFiles([])}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded"
              >
                ล้างทั้งหมด
              </button>
              {successCount > 0 && (
                <button
                  onClick={confirmSave}
                  className="text-xs font-medium bg-primary-600 text-white px-3 py-1.5 rounded-lg hover:bg-primary-700 transition-colors"
                >
                  บันทึก {successCount} ไฟล์
                </button>
              )}
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {pendingFiles.map((item, idx) => (
              <div key={idx} className="px-5 py-3 flex items-center gap-3">
                {item.fileType === 'REP' && <FileText className="w-4 h-4 text-primary-400 flex-shrink-0" />}
                {item.fileType === 'STM' && <FileSpreadsheet className="w-4 h-4 text-green-400 flex-shrink-0" />}
                {(item.fileType === 'SSOP' || item.fileType === 'CSOP' || item.fileType === 'AIPN' || item.fileType === 'AIPN_STM') &&
                  <FileArchive className="w-4 h-4 text-purple-400 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{item.file.name}</p>
                  {item.error && <p className="text-xs text-red-500 mt-0.5">{item.error}</p>}
                  {item.status === 'success' && item.record && (
                    <p className="text-xs text-green-600 mt-0.5">
                      {item.fileType === 'REP' &&
                        `รพ. ${(item.record as REPRecord).hospitalCode} — งวด ${(item.record as REPRecord).batchNo} — ${formatNumber((item.record as REPRecord).totalSubmitted)} ราย`}
                      {item.fileType === 'STM' &&
                        `รพ. ${(item.record as STMRecord).hospitalCode} — ${(item.record as STMRecord).docNo}`}
                      {(item.fileType === 'SSOP' || item.fileType === 'CSOP' || item.fileType === 'AIPN') &&
                        `[${item.fileType}] รพ. ${(item.record as ZipRecord).hospitalCode} — เลขที่ตอบรับ ${(item.record as ZipRecord).ackNo} — ` +
                        `ส่ง ${formatNumber((item.record as ZipRecord).totalSubmitted)} ราย (ผ่าน ${formatNumber((item.record as ZipRecord).totalPassed)} / ` +
                        `ไม่ผ่าน ${formatNumber((item.record as ZipRecord).totalFailed)})`}
                      {item.fileType === 'AIPN_STM' &&
                        `[AIPN STM] รพ. ${(item.record as AipnStmRecord).hospitalCode} — งวด ${(item.record as AipnStmRecord).period} — ` +
                        (item.record as AipnStmRecord).statements
                          .map((s) => `${s.stmType}: ${formatNumber(s.bills.length)} ราย`)
                          .join(', ')}
                    </p>
                  )}
                </div>
                <div className="flex-shrink-0">
                  {item.status === 'parsing' && <Loader className="w-4 h-4 text-primary-400 animate-spin" />}
                  {item.status === 'success' && <CheckCircle className="w-4 h-4 text-green-500" />}
                  {item.status === 'error' && <AlertCircle className="w-4 h-4 text-red-400" />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Saved REP Records */}
      {visibleREP.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">ไฟล์ REP ที่บันทึกไว้ ({visibleREP.length})</h3>
            <button
              onClick={() => navigate('/government/rep')}
              className="text-xs text-primary-600 hover:underline"
            >
              ดูทั้งหมด →
            </button>
          </div>
          <div className="space-y-2">
            {visibleREP.slice(0, 5).map((r) => (
              <REPCard key={r.id} record={r} onDelete={deleteREP} />
            ))}
          </div>
        </div>
      )}

      {/* Saved STM Records */}
      {visibleSTM.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">ไฟล์ STM ที่บันทึกไว้ ({visibleSTM.length})</h3>
            <button
              onClick={() => navigate('/government/stm')}
              className="text-xs text-green-600 hover:underline"
            >
              ดูทั้งหมด →
            </button>
          </div>
          <div className="space-y-2">
            {visibleSTM.slice(0, 5).map((r) => (
              <STMCard key={r.id} record={r} onDelete={deleteSTM} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {visibleREP.length === 0 && visibleSTM.length === 0 && pendingFiles.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <Upload className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">ยังไม่มีไฟล์ที่บันทึกไว้</p>
          <p className="text-xs mt-1">อัปโหลดไฟล์ REP หรือ STM ด้านบนเพื่อเริ่มต้น</p>
        </div>
      )}
    </div>
  );
}
