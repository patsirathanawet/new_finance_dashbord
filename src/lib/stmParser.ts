import * as XLSX from 'xlsx';
import type { STMRecord, STMCase, STMType } from '../types/upload';

/**
 * Detect STM type from filename:
 * STM_XXXXX_OP202403_22.xls  → BMT
 * eclaim_XXXXX_OPBMT_...xls  → BMT
 * COCDSTM / COCDSUM .xml     → GC
 * etc.
 */
function detectSTMType(fileName: string): STMType {
  const fn = fileName.toUpperCase();
  if (fn.includes('BMT') || fn.includes('OPBMT')) return 'BMT';
  if (fn.includes('COCD') || fn.includes('GC')) return 'GC';
  if (fn.includes('ECT') || fn.includes('ELECTION')) return 'ECT';
  if (fn.includes('GCK') || fn.includes('BKK') || fn.includes('กรุงเทพ')) return 'GCK';
  if (fn.includes('GCP') || fn.includes('PATTAYA')) return 'GCP';
  if (fn.includes('FRD')) return 'FRD';
  return 'OTHER';
}

/**
 * Extract period from filename: STM_10673_OP202403_22 → "202403"
 */
function extractPeriod(fileName: string): string | undefined {
  const m = /OP(\d{6})/.exec(fileName.toUpperCase());
  return m ? m[1] : undefined;
}

/**
 * Extract hospital code from filename:
 * STM_10673_OP202403_22.xls    → "10673"
 * eclaim_10673_OPBMT_...xls   → "10673"
 * 10673_COCDSTM_20170902.xml  → "10673"
 */
function extractHospitalCode(fileName: string): string {
  const m = /(?:STM_|eclaim_|^)(\d{5})(?:_|$)/.exec(fileName);
  return m ? m[1] : '';
}

/**
 * Extract doc number from filename:
 * STM_10673_OP202403_22.xls   → "10673_OP202403_22"
 * eclaim_10673_OPBMT_25670312_145209870.xls → "eclaim_10673_OPBMT_25670312_145209870"
 */
function extractDocNo(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, ''); // remove extension
  const m = /^(?:STM_)(.+)$/.exec(base);
  return m ? m[1] : base;
}

function parseNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v.replace(/,/g, '')) || 0;
  return 0;
}

function parseDate(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  return String(v);
}

/**
 * Find the row index that looks like a header (contains Thai column names).
 * Returns -1 if not found.
 */
function findHeaderRow(rows: unknown[][]): number {
  const HEADER_KEYWORDS = ['ลำดับ', 'ชื่อ', 'วันเข้า', 'พึงรับ', 'ชดเชย', 'เบิก'];
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const text = row.filter(Boolean).map(String).join(' ');
    const matches = HEADER_KEYWORDS.filter((k) => text.includes(k));
    if (matches.length >= 2) return i;
  }
  return -1;
}

/**
 * Map column headers to field names
 */
interface ColMap {
  seq?: number;
  name?: number;
  admitDate?: number;
  dischargeDate?: number;
  totalAmount?: number;
  roomFee?: number;
  prostheticFee?: number;
  drugFee?: number;
  treatmentFee?: number;
  transportFee?: number;
  waitingFee?: number;
  otherFee?: number;
  claimable?: number;
  nonClaimable?: number;
  selfPay?: number;
}

function buildColMap(headerRow: unknown[]): ColMap {
  const map: ColMap = {};
  headerRow.forEach((h, i) => {
    const s = String(h ?? '').trim();
    if (/ลำดับ/.test(s)) map.seq = i;
    else if (/ชื่อ/.test(s) && /สกุล/.test(s)) map.name = i;
    else if (/วันเข้ารักษา|วันที่รับ|admit/i.test(s)) map.admitDate = i;
    else if (/วันจำหน่าย|discharge/i.test(s)) map.dischargeDate = i;
    else if (/พึงรับทั้งหมด|ชดเชยสุทธิ|จ่ายชดเชย/.test(s)) map.totalAmount = i;
    else if (/ค่าห้อง/.test(s)) map.roomFee = i;
    else if (/ค่าอวัยวะ|อุปกรณ์/.test(s)) map.prostheticFee = i;
    else if (/ค่ายา/.test(s)) map.drugFee = i;
    else if (/ค่ารักษา/.test(s) && !s.includes('ทั้งหมด')) map.treatmentFee = i;
    else if (/ค่ารถ|ค่าพาหนะ/.test(s)) map.transportFee = i;
    else if (/พักรอจำหน่าย/.test(s)) map.waitingFee = i;
    else if (/ค่าบริการอื่น|บริการอื่น/.test(s)) map.otherFee = i;
    else if (/เบิกได้(?!ไม่)/.test(s)) map.claimable = i;
    else if (/เบิกไม่ได้/.test(s)) map.nonClaimable = i;
    else if (/ชำระเอง/.test(s)) map.selfPay = i;
  });
  return map;
}

function isDataRow(row: unknown[], colMap: ColMap): boolean {
  // A data row has a sequence number or a non-empty name
  const seqVal = colMap.seq !== undefined ? row[colMap.seq] : undefined;
  const nameVal = colMap.name !== undefined ? row[colMap.name] : undefined;
  if (seqVal !== undefined && seqVal !== null && seqVal !== '') {
    const n = Number(seqVal);
    if (!isNaN(n) && n > 0) return true;
  }
  if (nameVal && String(nameVal).trim().length > 2) {
    // Has a Thai-looking name
    const s = String(nameVal).trim();
    return /[\u0E00-\u0E7F]/.test(s) || /นาย|นาง|น\.ส/.test(s);
  }
  return false;
}

function extractRowData(row: unknown[], colMap: ColMap, seq: number): STMCase {
  const getNum = (idx?: number) => (idx !== undefined ? parseNumber(row[idx]) : undefined);
  const getDate = (idx?: number) => (idx !== undefined ? parseDate(row[idx]) : undefined);
  const getName = (idx?: number) => (idx !== undefined ? String(row[idx] ?? '').trim() : '');

  const rawName = getName(colMap.name);
  const totalAmount = getNum(colMap.totalAmount) ?? 0;

  return {
    seq: colMap.seq !== undefined ? (parseNumber(row[colMap.seq]) || seq) : seq,
    patientName: rawName,
    admitDate: getDate(colMap.admitDate),
    dischargeDate: getDate(colMap.dischargeDate),
    totalAmount,
    roomFee: getNum(colMap.roomFee),
    prostheticFee: getNum(colMap.prostheticFee),
    drugFee: getNum(colMap.drugFee),
    treatmentFee: getNum(colMap.treatmentFee),
    transportFee: getNum(colMap.transportFee),
    waitingFee: getNum(colMap.waitingFee),
    otherFee: getNum(colMap.otherFee),
    claimable: getNum(colMap.claimable),
    nonClaimable: getNum(colMap.nonClaimable),
    selfPay: getNum(colMap.selfPay),
    isPass: totalAmount > 0,
  };
}

/**
 * Parse XLS STM file (BIFF8 / Excel 97-2003)
 */
export function parseSTMXLS(
  buffer: ArrayBuffer,
  fileName: string,
  uploadedBy: string,
): STMRecord {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', codepage: 874 });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to array of arrays
  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });

  // Extract metadata from header rows (first ~10 rows)
  let hospitalCode = extractHospitalCode(fileName);
  let hospitalName = '';
  let docNo = extractDocNo(fileName);
  let issueDate: string | undefined;

  for (const row of rawRows.slice(0, 10)) {
    const text = row.filter(Boolean).map(String).join(' ');
    const hnMatch = /โรงพยาบาล\s+(\d{5})\s+(.+?)(?:\s+$|$)/.exec(text);
    if (hnMatch) {
      hospitalCode = hospitalCode || hnMatch[1];
      hospitalName = hnMatch[2].trim();
    }
    const docMatch = /เลขที่เอกสาร\s+(\S+)/.exec(text);
    if (docMatch) docNo = docMatch[1];
    const dtMatch = /ออกรายงานวันที่\s+(.+?)\s+เวลา/.exec(text);
    if (dtMatch) issueDate = dtMatch[1].trim();
  }

  // Find header row
  const headerIdx = findHeaderRow(rawRows);
  if (headerIdx < 0) {
    return buildEmptySTM(fileName, uploadedBy, hospitalCode, hospitalName, docNo);
  }

  const colMap = buildColMap(rawRows[headerIdx]);
  const cases: STMCase[] = [];
  let seq = 1;

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!isDataRow(row, colMap)) continue;
    const c = extractRowData(row, colMap, seq);
    if (c.patientName || c.totalAmount > 0) {
      cases.push(c);
      seq++;
    }
  }

  const totalAmount = cases.reduce((s, c) => s + c.totalAmount, 0);
  const passedCases = cases.filter((c) => c.isPass).length;

  return {
    id: `${hospitalCode}_${docNo}`,
    hospitalCode: hospitalCode || 'UNKNOWN',
    hospitalName: hospitalName || hospitalCode,
    docNo,
    period: extractPeriod(fileName),
    stmType: detectSTMType(fileName),
    issueDate,
    totalCases: cases.length,
    totalAmount,
    passedCases,
    failedCases: cases.length - passedCases,
    cases,
    fileName,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    fundType: 'CIPN_CSMBS',
  };
}

/**
 * Parse XML STM file (กรมบัญชีกลาง format)
 */
export function parseSTMXML(
  text: string,
  fileName: string,
  uploadedBy: string,
): STMRecord {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');

  const get = (tag: string) => doc.querySelector(tag)?.textContent?.trim() ?? '';

  const hospitalCode = get('hcode') || extractHospitalCode(fileName);
  const hospitalName = get('hname');
  const docNo = get('stmno') || extractDocNo(fileName);
  const issueDate = get('dateIssue');
  const totalAmount = parseFloat(get('amount')) || 0;
  const totalCases = parseInt(get('acount')) || 0;

  // STMdat sections → summary cases
  const cases: STMCase[] = [];
  let seq = 1;
  doc.querySelectorAll('STMdat').forEach((node) => {
    const name = node.getAttribute('name') ?? node.getAttribute('desc1') ?? '';
    const total = parseFloat(node.querySelector('Gtotal')?.textContent ?? '0') || 0;
    const count = parseInt(node.querySelector('Tcount')?.textContent ?? '0') || 0;
    if (count > 0 || total > 0) {
      cases.push({
        seq: seq++,
        patientName: name,
        totalAmount: total,
        isPass: true,
      });
    }
  });

  return {
    id: `${hospitalCode}_${docNo}`,
    hospitalCode: hospitalCode || 'UNKNOWN',
    hospitalName: hospitalName || hospitalCode,
    docNo,
    stmType: 'GC',
    issueDate,
    totalCases,
    totalAmount,
    passedCases: totalCases,
    cases,
    fileName,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    fundType: 'CIPN_CSMBS',
  };
}

function buildEmptySTM(
  fileName: string,
  uploadedBy: string,
  hospitalCode: string,
  hospitalName: string,
  docNo: string,
): STMRecord {
  return {
    id: `${hospitalCode}_${docNo}`,
    hospitalCode: hospitalCode || 'UNKNOWN',
    hospitalName: hospitalName || hospitalCode,
    docNo,
    stmType: detectSTMType(fileName),
    period: extractPeriod(fileName),
    totalCases: 0,
    totalAmount: 0,
    cases: [],
    fileName,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    fundType: 'CIPN_CSMBS',
  };
}

/**
 * Auto-detect file type and parse STM file.
 */
export async function parseSTMFile(
  buffer: ArrayBuffer,
  fileName: string,
  uploadedBy: string,
): Promise<STMRecord> {
  const ext = fileName.split('.').pop()?.toLowerCase();

  if (ext === 'xml') {
    const text = new TextDecoder('utf-8').decode(buffer);
    return parseSTMXML(text, fileName, uploadedBy);
  }

  // XLS/XLSX
  return parseSTMXLS(buffer, fileName, uploadedBy);
}
