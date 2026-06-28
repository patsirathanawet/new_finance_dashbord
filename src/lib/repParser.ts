import * as XLSX from 'xlsx';
import type { REPRecord, REPCase, REPChargeType, REPError } from '../types/upload';

/**
 * Decode TIS-620 / Windows-874 encoded bytes to Unicode string.
 * Thai range 0xA0–0xFF maps to Unicode Thai block U+0E00–U+0E5F.
 */
export function decodeTIS620(buffer: ArrayBuffer): string {
  // Try TextDecoder first (most browsers support windows-874)
  try {
    return new TextDecoder('windows-874').decode(buffer);
  } catch {
    // Manual fallback
    const bytes = new Uint8Array(buffer);
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === 0x0D) continue; // skip CR
      if (b >= 0xA0 && b <= 0xFF) {
        result += String.fromCharCode(b - 0xA0 + 0x0E00);
      } else {
        result += String.fromCharCode(b);
      }
    }
    return result;
  }
}

function parseAmount(s: string): number {
  return parseFloat(s.replace(/,/g, '')) || 0;
}

/**
 * Parse a single DRG/FFS/PD case line:
 * *| pcode tcode AN , DRG, (rw) adjrw[X ccuf], amdrg, name[:err[:desc][,...]]
 * *| pcode tcode AN , name[:err[:desc][,...]]
 */
function parseCaseLine(
  line: string,
  section: REPCase['section'],
  sectionNo: number,
  agency: string,
  chargeType: REPChargeType,
): REPCase | null {
  const rest = line.slice(2).trim();
  const baseMatch = /^(\d)\s+([ATC])\s+(\d+)\s*,?\s*(.*)$/s.exec(rest);
  if (!baseMatch) return null;

  const pcode = parseInt(baseMatch[1]);
  const tcode = baseMatch[2] as 'A' | 'T' | 'C';
  const an = baseMatch[3].trim();
  let remainder = baseMatch[4].trim();

  let drg: string | undefined;
  let rw: number | undefined;
  let adjrw: number | undefined;
  let ccuf: number | undefined;
  let amdrg: number | undefined;

  if (chargeType === 'DRG') {
    // DRG, (rw) adjrw [X ccuf], amdrg, name...
    const drgMatch = /^(\w+)\s*,\s*\(([0-9.]+)\)\s+([0-9.]+)(?:\s+X\s+([0-9.]+))?\s*,\s*([0-9.]+)\s*,\s*(.+)$/s.exec(remainder);
    if (drgMatch) {
      drg = drgMatch[1];
      rw = parseFloat(drgMatch[2]);
      adjrw = parseFloat(drgMatch[3]);
      if (drgMatch[4]) ccuf = parseFloat(drgMatch[4]);
      amdrg = parseFloat(drgMatch[5]);
      remainder = drgMatch[6];
    }
  }

  // Parse "name[:errcode[:desc][,errcode[:desc]...]]"
  const colonIdx = remainder.indexOf(':');
  let patientName: string;
  const errors: REPError[] = [];

  if (colonIdx >= 0) {
    patientName = remainder.slice(0, colonIdx).trim();
    const errStr = remainder.slice(colonIdx + 1).trim();
    // Split by comma, each part is "code[:desc]"
    for (const part of errStr.split(',')) {
      const errMatch = /^(\d+)(?::(.+))?$/.exec(part.trim());
      if (errMatch) {
        errors.push({ code: errMatch[1], desc: errMatch[2]?.trim() });
      }
    }
  } else {
    patientName = remainder.trim();
  }

  return { pcode, tcode, an, chargeType, drg, rw, adjrw, ccuf, amdrg, patientName, errors, section, sectionNo, agency };
}

/**
 * Parse a complete REP file (ArrayBuffer, TIS-620 encoded).
 */
export function parseREPFile(
  buffer: ArrayBuffer,
  fileName: string,
  uploadedBy: string,
): REPRecord {
  const text = decodeTIS620(buffer);
  const lines = text.split('\n');

  // Extract hospital code and batch number from filename
  // e.g. "10673_CIGNREP_2933.REP"
  let hospitalCode = '';
  let batchNo = '';
  const fnMatch = /^(\d+)_\w+_(\d+)/i.exec(fileName);
  if (fnMatch) {
    hospitalCode = fnMatch[1];
    batchNo = fnMatch[2];
  }

  let hospitalName = '';
  let refNo = '';
  let issueDate = '';
  let totalSubmitted = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalAmount = 0;
  let amountRoom = 0;
  let amountTreatment = 0;
  const batchRefs: string[] = [];

  // --- Parse header fields ---
  for (const line of lines) {
    const hnMatch = /<<(.+)>>/.exec(line);
    if (hnMatch) hospitalName = hnMatch[1].trim();

    if (!hospitalCode) {
      const hcMatch = /รหัส\s*ร\.พ\.\s*=\s*(\S+)/.exec(line);
      if (hcMatch) hospitalCode = hcMatch[1];
    }
    if (!batchNo) {
      const bnMatch = /เลขที่เอกสารตอบรับ\s*=\s*(\S+)/.exec(line);
      if (bnMatch) batchNo = bnMatch[1];
    }
    if (!refNo) {
      const rnMatch = /เลขที่อ้างอิง\s*=\s*(\S+)/.exec(line);
      if (rnMatch) refNo = rnMatch[1];
    }
    if (!issueDate) {
      const dtMatch = /วันที่ออกเอกสาร\s*=\s*(.+?)(?:\s*เวลา|$)/.exec(line);
      if (dtMatch) issueDate = dtMatch[1].trim();
    }
    if (!totalSubmitted) {
      const tsMatch = /รายการที่ส่งไป\s*=\s*(\d+)/.exec(line);
      if (tsMatch) totalSubmitted = parseInt(tsMatch[1]);
    }
    if (!totalPassed) {
      const tpMatch = /รายการที่ตรวจผ่าน\s*=\s*(\d+)/.exec(line);
      if (tpMatch) totalPassed = parseInt(tpMatch[1]);
    }
    if (!totalFailed) {
      const tfMatch = /รายการที่ตรวจไม่ผ่าน\s*=\s*(\d+)/.exec(line);
      if (tfMatch) totalFailed = parseInt(tfMatch[1]);
    }
    if (!totalAmount) {
      const amMatch = /จำนวนเงินรวม\s*=\s*([\d,.]+)/.exec(line);
      if (amMatch) totalAmount = parseAmount(amMatch[1]);
    }
    if (!amountRoom) {
      const arMatch = /ค่าห้อง.+?=\s*([\d,.]+)/.exec(line);
      if (arMatch) amountRoom = parseAmount(arMatch[1]);
    }
    if (!amountTreatment) {
      const atMatch = /ค่ารักษาพยาบาลอื่นๆ\s*=\s*([\d,.]+)/.exec(line);
      if (atMatch) amountTreatment = parseAmount(atMatch[1]);
    }
    const brMatch = /งวดเลขที่ส่ง\s*:\s*(.+)/.exec(line);
    if (brMatch && batchRefs.length === 0) {
      batchRefs.push(...brMatch[1].split(',').map((s) => s.trim()).filter(Boolean));
    }
  }

  // --- Parse case lines ---
  const cases: REPCase[] = [];
  let currentSection: REPCase['section'] = 'CIPN';
  let currentSectionNo = 1;
  let currentAgency = '';
  let currentChargeType: REPChargeType = 'DRG';

  for (const line of lines) {
    // Section marker: CIPN or CSMBS passed section
    if (/\(CIPN\)/.test(line) && /ตรวจผ่านแล้ว/.test(line)) {
      currentSection = 'CIPN';
    } else if (/\(CSMBS\)/.test(line) && /ตรวจผ่านแล้ว/.test(line)) {
      currentSection = 'CSMBS';
    } else if (/ไม่ผ่าน|รอการพิจารณา/.test(line)) {
      currentSection = 'WAIT';
    }

    // ตอนที่ N ... agency name at end of line
    const tonMatch = /ตอนที่\s*(\d+)\s+เบิกจ่าย.+?(?:ฯ\s*|สำหรับ\s*)(.+)$/.exec(line);
    if (tonMatch) {
      currentSectionNo = parseInt(tonMatch[1]);
      currentAgency = tonMatch[2].trim();
    }

    // Charge type sub-sections
    if (/\(FFS\)/.test(line) && /จ่ายตามเรียกเก็บ/.test(line)) {
      currentChargeType = 'FFS';
    } else if (/\(DRG\)/.test(line) && /กลุ่มวินิจฉัย/.test(line)) {
      currentChargeType = 'DRG';
    } else if (/\(PD\)/.test(line) && /พักรอจำหน่าย/.test(line)) {
      currentChargeType = 'PD';
    }

    // Data line
    if (line.startsWith('*|')) {
      const c = parseCaseLine(line, currentSection, currentSectionNo, currentAgency, currentChargeType);
      if (c) cases.push(c);
    }
  }

  // Footer: **= batchRef, count, amount  (first line = main batch)
  const footerLine = lines.find((l) => /^\*\*=\s*\d{4}/.test(l.trim()));
  if (footerLine && !totalAmount) {
    const fm = /^\*\*=\s*\w+,\s*(\d+),\s*([\d.]+)/.exec(footerLine.trim());
    if (fm) {
      totalPassed = totalPassed || parseInt(fm[1]);
      totalAmount = totalAmount || parseFloat(fm[2]);
    }
  }

  return {
    id: `${hospitalCode}_${batchNo}`,
    hospitalCode: hospitalCode || 'UNKNOWN',
    hospitalName: hospitalName || hospitalCode,
    batchNo: batchNo || 'UNKNOWN',
    refNo,
    issueDate,
    totalSubmitted: totalSubmitted || cases.length,
    totalPassed: totalPassed || cases.filter((c) => c.tcode === 'A').length,
    totalFailed: totalFailed || cases.filter((c) => c.tcode !== 'A').length,
    totalAmount,
    passedAmount: 0,
    failedAmount: 0,
    amountRoom,
    amountTreatment,
    cases,
    detailRows: [],
    batchRefs,
    fileName,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    fundType: 'CIPN_CSMBS',
  };
}

/* =========================================================================
 *  XLS / XLSX parser — สำหรับไฟล์ REP ที่เป็น Excel (NHSO portal ใหม่)
 * ========================================================================= */

function parseNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v.replace(/,/g, '')) || 0;
  return 0;
}

interface RepColMap {
  seq?: number;
  an?: number;
  hn?: number;
  name?: number;
  drg?: number;
  rw?: number;
  adjrw?: number;
  amount?: number;
  errorCode?: number;
  errorDesc?: number;
  status?: number;
}

function findRepHeaderRow(rows: unknown[][]): number {
  const KEYWORDS = ['AN', 'ลำดับ', 'ชื่อ', 'DRG', 'RW', 'รหัส', 'จำนวนเงิน', 'ค่ารักษา', 'ข้อผิดพลาด'];
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const text = row.filter(Boolean).map(String).join(' ');
    const matches = KEYWORDS.filter((k) => text.includes(k));
    if (matches.length >= 2) return i;
  }
  return -1;
}

function buildRepColMap(headerRow: unknown[]): RepColMap {
  const map: RepColMap = {};
  headerRow.forEach((h, i) => {
    const s = String(h ?? '').trim();
    if (!s) return;
    const upper = s.toUpperCase();
    if (/ลำดับ|^ที่$|^No\.?$/i.test(s) && map.seq === undefined) map.seq = i;
    else if (/(^|\s)AN(\s|$)/.test(upper) && map.an === undefined) map.an = i;
    else if (/(^|\s)HN(\s|$)/.test(upper) && map.hn === undefined) map.hn = i;
    else if (/(ชื่อ.*สกุล|ผู้ป่วย|name)/i.test(s) && map.name === undefined) map.name = i;
    else if (/DRG/i.test(upper) && map.drg === undefined) map.drg = i;
    else if (/AdjRW|น้ำหนัก.*ปรับ/i.test(s) && map.adjrw === undefined) map.adjrw = i;
    else if (/RW|น้ำหนัก/i.test(s) && map.rw === undefined) map.rw = i;
    else if (/จำนวนเงิน|ค่ารักษา|ยอด|amount/i.test(s) && map.amount === undefined) map.amount = i;
    else if (/รหัส.*(ข้อผิด|error)|error.*code/i.test(s) && map.errorCode === undefined) map.errorCode = i;
    else if (/(ข้อผิด|error).*ราย|คำอธิบาย/i.test(s) && map.errorDesc === undefined) map.errorDesc = i;
    else if (/สถานะ|ผ่าน|status/i.test(s) && map.status === undefined) map.status = i;
  });
  return map;
}

function isRepDataRow(row: unknown[], colMap: RepColMap): boolean {
  const seqVal = colMap.seq !== undefined ? row[colMap.seq] : undefined;
  const anVal = colMap.an !== undefined ? row[colMap.an] : undefined;
  const nameVal = colMap.name !== undefined ? row[colMap.name] : undefined;
  if (seqVal !== undefined && seqVal !== null && seqVal !== '') {
    const n = Number(seqVal);
    if (!isNaN(n) && n > 0) return true;
  }
  if (anVal && String(anVal).trim().length > 0) return true;
  if (nameVal && String(nameVal).trim().length > 2) {
    const s = String(nameVal).trim();
    if (/[฀-๿]/.test(s) || /นาย|นาง|น\.ส/.test(s)) return true;
  }
  return false;
}

function extractRepRow(row: unknown[], colMap: RepColMap): REPCase {
  const num = (i?: number) => (i !== undefined ? parseNumber(row[i]) : undefined);
  const str = (i?: number) => (i !== undefined ? String(row[i] ?? '').trim() : '');

  const statusStr = str(colMap.status);
  // สถานะ: 'A'/'ผ่าน' = ผ่าน, อื่นๆ = ต้องแก้ไข
  const tcode: REPCase['tcode'] = /ผ่าน|^A$/i.test(statusStr) ? 'A' : 'C';

  // Errors — อาจมีหลาย code แยกด้วย , หรือ ;
  const errors: REPError[] = [];
  const errCode = str(colMap.errorCode);
  const errDesc = str(colMap.errorDesc);
  if (errCode) {
    errCode.split(/[,;]/).forEach((c) => {
      const code = c.trim();
      if (code) errors.push({ code, desc: errDesc || undefined });
    });
  }

  return {
    pcode: 0,
    tcode,
    an: str(colMap.an) || str(colMap.hn),
    chargeType: 'DRG',
    drg: str(colMap.drg) || undefined,
    rw: num(colMap.rw),
    adjrw: num(colMap.adjrw),
    amdrg: num(colMap.amount),
    patientName: str(colMap.name),
    errors,
    section: tcode === 'A' ? 'CIPN' : 'WAIT',
    sectionNo: 1,
    agency: '',
  };
}

/**
 * Parse NHSO eClaim REP xls format:
 *   Sheets: Detail | Summary | Data Instrument | Data Sheet 0
 *   Detail row 0-3: metadata (วันที่ออก, เลขที่เอกสาร, รหัสรพ.+ชื่อ)
 *   Detail row 4-5: multi-row header
 *   Detail row 6..N: data rows (col 0=REP NO., col 1=seq, col 4=AN, col 6=name,
 *                                col 10=ชดเชย, col 11=PP, col 12=errorCode, col 13=fund,
 *                                col 27=DRG, col 28=RW, col 7=OP/IP)
 *   Summary row 5: รพ., REP NO., ทั้งหมด, ผ่าน, ไม่ผ่าน, totals...
 */
function parseREPXLSNhso(
  workbook: XLSX.WorkBook,
  fileName: string,
  uploadedBy: string,
): REPRecord | null {
  const detail = workbook.Sheets['Detail'];
  if (!detail) return null;

  const detailRows: unknown[][] = XLSX.utils.sheet_to_json(detail, {
    header: 1, defval: null, blankrows: false,
  });

  // --- Metadata จาก 4 rows บน ---
  let hospitalCode = '';
  let hospitalName = '';
  let invoiceDoc = '';
  let issueDate = '';

  const scanCells = (row: unknown[] | undefined) => (row ?? []).filter((c) => typeof c === 'string') as string[];

  for (const cell of scanCells(detailRows[0])) {
    const m = /ออกรายงานวันที่\s+(\S+)(?:\s+เวลา\s+(\S+))?/.exec(cell);
    if (m && !issueDate) issueDate = m[2] ? `${m[1]} ${m[2]}` : m[1];
  }
  for (const cell of scanCells(detailRows[1])) {
    const m = /เลขที่เอกสาร\s+(\S+)/.exec(cell);
    if (m && !invoiceDoc) invoiceDoc = m[1];
  }
  for (const cell of scanCells(detailRows[2])) {
    const m = /โรงพยาบาล\s+(\d{4,5})\s+(.+?)$/.exec(cell);
    if (m && !hospitalCode) {
      hospitalCode = m[1];
      hospitalName = m[2].trim();
    }
  }

  // --- Data rows: row 6 onwards, until first row where col 1 (ลำดับที่) ไม่ใช่ตัวเลข ---
  const cases: REPCase[] = [];
  const detailRowsOut: Record<string, unknown>[] = [];
  let batchNo = '';
  let passedAmount = 0;
  let failedAmount = 0;

  const numOrNull = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '' || v === '-') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const strOrNull = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  };

  for (let i = 6; i < detailRows.length; i++) {
    const row = detailRows[i] ?? [];
    const seq = row[1];
    if (typeof seq !== 'number' || seq <= 0) break;   // เริ่มเข้า footnote section แล้ว

    const repNo = String(row[0] ?? '').trim();
    if (repNo && !batchNo) batchNo = repNo;

    const tranId = String(row[2] ?? '').trim();
    const an = String(row[4] ?? '').trim();
    const hn = String(row[3] ?? '').trim();
    const name = String(row[6] ?? '').trim();
    const ptype = String(row[7] ?? '').trim();
    const compAmt = parseNumber(row[10]);
    const ppAmt = parseNumber(row[11]);
    const errCode = String(row[12] ?? '').trim();
    const fund = String(row[13] ?? '').trim();
    const drg = String(row[27] ?? '').trim();
    const rw = parseNumber(row[28]);
    const chargeAmt = parseNumber(row[29]);
    const chargePp = parseNumber(row[30]);

    const totalAmt = compAmt + ppAmt;
    const passed = !errCode || errCode === '-';
    const tcode: REPCase['tcode'] = passed ? 'A' : 'C';

    // Aggregate amounts
    if (passed) {
      passedAmount += totalAmt;
    } else {
      failedAmount += chargeAmt + chargePp;   // ยอดที่เรียกเก็บแต่ไม่ผ่าน
    }

    const errors: REPError[] = [];
    if (errCode && errCode !== '-') {
      errCode.split(/[,;]/).forEach((c) => {
        const code = c.trim();
        if (code) errors.push({ code });
      });
    }

    cases.push({
      pcode: 0,
      tcode,
      an: an || hn || tranId,
      chargeType: ptype === 'IP' ? 'DRG' : 'FFS',
      drg: drg || undefined,
      rw: rw || undefined,
      adjrw: undefined,
      ccuf: undefined,
      amdrg: totalAmt,
      patientName: name,
      errors,
      section: passed ? 'CIPN' : 'WAIT',
      sectionNo: 1,
      agency: fund,
    });

    // เก็บทุก 59 columns สำหรับ insert ลง rep_detail (key = snake_case ตาม schema)
    detailRowsOut.push({
      rep_no: repNo,
      seq_no: seq,
      tran_id: tranId,
      hn: strOrNull(row[3]),
      an: strOrNull(row[4]),
      pid: strOrNull(row[5]),
      patient_name: strOrNull(row[6]),
      patient_type: strOrNull(row[7]),
      admit_date: strOrNull(row[8]),
      discharge_date: strOrNull(row[9]),
      comp_amount: numOrNull(row[10]),
      comp_pp: numOrNull(row[11]),
      error_code: strOrNull(row[12]),
      fund: strOrNull(row[13]),
      service_type: strOrNull(row[14]),
      referral: strOrNull(row[15]),
      eligibility: strOrNull(row[16]),
      right_use: strOrNull(row[17]),
      right_primary: strOrNull(row[18]),
      right_secondary: strOrNull(row[19]),
      href: strOrNull(row[20]),
      hcode: strOrNull(row[21]),
      prov1: strOrNull(row[22]),
      agency_code: strOrNull(row[23]),
      agency_name: strOrNull(row[24]),
      proj: strOrNull(row[25]),
      pa: strOrNull(row[26]),
      drg: strOrNull(row[27]),
      rw: numOrNull(row[28]),
      charge_amount: numOrNull(row[29]),
      charge_pp: numOrNull(row[30]),
      claimable: numOrNull(row[31]),
      non_claimable: numOrNull(row[32]),
      self_pay: numOrNull(row[33]),
      pay_rate: strOrNull(row[34]),
      late_ps: strOrNull(row[35]),
      late_ps_pct: strOrNull(row[36]),
      ccuf: strOrNull(row[37]),
      adj_rw: numOrNull(row[38]),
      prb: numOrNull(row[39]),
      case_ipcs: numOrNull(row[40]),
      case_ipcs_ors: numOrNull(row[41]),
      case_opcs: numOrNull(row[42]),
      case_pacs: numOrNull(row[43]),
      case_instcs: numOrNull(row[44]),
      case_otcs: numOrNull(row[45]),
      case_pp: numOrNull(row[46]),
      case_drug: numOrNull(row[47]),
      deny_ipcs: strOrNull(row[48]),
      deny_opcs: strOrNull(row[49]),
      deny_pacs: strOrNull(row[50]),
      deny_instcs: strOrNull(row[51]),
      deny_otcs: strOrNull(row[52]),
      ors: strOrNull(row[53]),
      va: strOrNull(row[54]),
      audit_results: strOrNull(row[55]),
      seq_no_full: strOrNull(row[56]),
      invoice_no: strOrNull(row[57]),
      invoice_lt: strOrNull(row[58]),
    });
  }

  // --- Totals จาก Summary sheet (ถ้ามี) ---
  let totalSubmitted = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  const summary = workbook.Sheets['Summary'];
  if (summary) {
    const sumRows: unknown[][] = XLSX.utils.sheet_to_json(summary, {
      header: 1, defval: null, blankrows: false,
    });
    // หา row ที่มี numeric ที่ col 3 (ทั้งหมด)
    for (const row of sumRows) {
      if (!Array.isArray(row)) continue;
      if (typeof row[3] === 'number' && row[3] > 0) {
        if (!batchNo && typeof row[2] === 'string') batchNo = row[2];
        if (!hospitalCode && row[1]) hospitalCode = String(row[1]).trim();
        totalSubmitted = row[3] as number;
        totalPassed = (typeof row[4] === 'number' ? row[4] : 0) as number;
        totalFailed = (typeof row[5] === 'number' ? row[5] : 0) as number;
        break;
      }
    }
  }

  const passedFromCases = cases.filter((c) => c.tcode === 'A').length;

  return {
    id: `${hospitalCode || 'UNKNOWN'}_${batchNo || 'UNKNOWN'}`,
    hospitalCode: hospitalCode || 'UNKNOWN',
    hospitalName: hospitalName || hospitalCode,
    batchNo: batchNo || 'UNKNOWN',
    refNo: invoiceDoc,
    issueDate,
    totalSubmitted: totalSubmitted || cases.length,
    totalPassed: totalPassed || passedFromCases,
    totalFailed: totalFailed || (cases.length - passedFromCases),
    totalAmount: passedAmount + failedAmount,   // รวมยอดผ่าน + ยอดไม่ผ่าน
    passedAmount,
    failedAmount,
    amountRoom: 0,
    amountTreatment: 0,
    cases,
    detailRows: detailRowsOut,
    batchRefs: [],
    fileName,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    fundType: 'NHSO',
  };
}

/** Generic fallback parser — keyword-based column detection */
function parseREPXLSGeneric(
  workbook: XLSX.WorkBook,
  fileName: string,
  uploadedBy: string,
): REPRecord {
  const allCases: REPCase[] = [];
  let hospitalCode = '';
  let hospitalName = '';
  let batchNo = '';
  let refNo = '';
  let issueDate = '';
  let totalSubmitted = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalAmount = 0;

  const fnMatch = /^(\d{4,5})[_-]?\w*[_-]?(\d+)?/i.exec(fileName);
  if (fnMatch) {
    hospitalCode = fnMatch[1];
    if (fnMatch[2]) batchNo = fnMatch[2];
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1, defval: null, blankrows: false,
    });

    for (const row of rows.slice(0, 15)) {
      const text = row.filter(Boolean).map(String).join(' ');
      if (!hospitalName) {
        const m = /<<\s*(.+?)\s*>>|โรงพยาบาล[:\s]+(.+?)(?:\s{2,}|$)/.exec(text);
        if (m) hospitalName = (m[1] || m[2] || '').trim();
      }
      if (!hospitalCode) {
        const m = /รหัส\s*ร\.?พ\.?\s*[:=]?\s*(\d{4,5})/.exec(text);
        if (m) hospitalCode = m[1];
      }
      if (!batchNo) {
        const m = /(?:เลขที่เอกสารตอบรับ|งวด(?:ที่)?)\s*[:=]?\s*(\S+)/.exec(text);
        if (m) batchNo = m[1];
      }
      if (!refNo) {
        const m = /เลขที่อ้างอิง\s*[:=]?\s*(\S+)/.exec(text);
        if (m) refNo = m[1];
      }
      if (!issueDate) {
        const m = /วันที่(?:ออก(?:เอกสาร)?|รายงาน)?\s*[:=]?\s*(.+?)(?:\s+เวลา|\s{2,}|$)/.exec(text);
        if (m) issueDate = m[1].trim();
      }
      if (!totalSubmitted) {
        const m = /รายการที่ส่ง(?:ไป)?\s*[:=]?\s*(\d+)/.exec(text);
        if (m) totalSubmitted = parseInt(m[1]);
      }
      if (!totalPassed) {
        const m = /รายการที่(?:ตรวจ)?ผ่าน\s*[:=]?\s*(\d+)/.exec(text);
        if (m) totalPassed = parseInt(m[1]);
      }
      if (!totalFailed) {
        const m = /รายการที่(?:ตรวจ)?ไม่ผ่าน\s*[:=]?\s*(\d+)/.exec(text);
        if (m) totalFailed = parseInt(m[1]);
      }
      if (!totalAmount) {
        const m = /(?:จำนวนเงินรวม|ยอดรวม|รวมเงิน)\s*[:=]?\s*([\d,.]+)/.exec(text);
        if (m) totalAmount = parseNumber(m[1]);
      }
    }

    const headerIdx = findRepHeaderRow(rows);
    if (headerIdx < 0) continue;
    const colMap = buildRepColMap(rows[headerIdx]);
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!isRepDataRow(row, colMap)) continue;
      const c = extractRepRow(row, colMap);
      if (c.an || c.patientName) allCases.push(c);
    }
  }

  const sumFromCases = allCases.reduce((s, c) => s + (c.amdrg ?? 0), 0);
  const passedFromCases = allCases.filter((c) => c.tcode === 'A').length;

  return {
    id: `${hospitalCode || 'UNKNOWN'}_${batchNo || 'UNKNOWN'}`,
    hospitalCode: hospitalCode || 'UNKNOWN',
    hospitalName: hospitalName || hospitalCode,
    batchNo: batchNo || 'UNKNOWN',
    refNo,
    issueDate,
    totalSubmitted: totalSubmitted || allCases.length,
    totalPassed: totalPassed || passedFromCases,
    totalFailed: totalFailed || (allCases.length - passedFromCases),
    totalAmount: totalAmount || sumFromCases,
    passedAmount: 0,    // generic parser ไม่ได้คำนวณ — ใช้ totalAmount เป็น proxy ตอน display
    failedAmount: 0,
    amountRoom: 0,
    amountTreatment: 0,
    cases: allCases,
    detailRows: [],
    batchRefs: [],
    fileName,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    fundType: 'NHSO',
  };
}

/** Parse XLS/XLSX REP file — auto-detect NHSO format vs generic */
export function parseREPXLS(
  buffer: ArrayBuffer,
  fileName: string,
  uploadedBy: string,
): REPRecord {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', codepage: 874 });

  // ลอง NHSO format ก่อน (มี sheet 'Detail')
  if (workbook.SheetNames.includes('Detail')) {
    const result = parseREPXLSNhso(workbook, fileName, uploadedBy);
    if (result && result.cases.length > 0) return result;
  }

  // Fallback: generic keyword-based
  return parseREPXLSGeneric(workbook, fileName, uploadedBy);
}

/**
 * Auto-detect REP format and parse:
 *  - .REP  → TIS-620 text parser
 *  - .xls / .xlsx → Excel parser
 *  - อื่นๆ → ลอง text parser ก่อน
 */
export function parseREP(
  buffer: ArrayBuffer,
  fileName: string,
  uploadedBy: string,
): REPRecord {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'xls' || ext === 'xlsx') {
    return parseREPXLS(buffer, fileName, uploadedBy);
  }
  return parseREPFile(buffer, fileName, uploadedBy);
}
