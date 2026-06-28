import type {
  Claim16Record, Claim16FileData, Claim16FileName,
  ValidationIssue, Claim16Summary,
} from '../types/claim16';
import { CLAIM16_FILES } from '../types/claim16';
import errorCodesData from './errorCodes.json';

/** ฐานข้อมูล error codes จาก search_c.xlsx (989 รหัส) */
const ERROR_CODES: Record<string, { description: string; suggestion?: string }> = errorCodesData;

/** ค้นหา error code → คืน description + suggestion */
export function lookupErrorCode(code: string): { description: string; suggestion?: string } | null {
  return ERROR_CODES[code] ?? null;
}

/* ------------------------------------------------------------------ */
/*  Column definitions per file (pipe-delimited)                      */
/*  ปรับตาม ECLAIM format จริง                                        */
/* ------------------------------------------------------------------ */

const COLUMNS: Record<Claim16FileName, string[]> = {
  INS: ['hn', 'inscl', 'subtype', 'cid', 'datein', 'dateexp', 'hospmain', 'hospsub', 'govtype', 'govname', 'permitno', 'docno', 'ownrpid', 'ownname', 'seq', 'subinscl', 'reession', 'htype'],
  PAT: ['hcode', 'hn', 'changwat', 'amphur', 'dob', 'sex', 'marriage', 'occupa', 'nation', 'person_id', 'namepat', 'title', 'fname', 'lname', 'idtype'],
  OPD: ['hn', 'clinic', 'dateopd', 'timeopd', 'seq', 'uuc'],
  ORF: ['hn', 'dateopd', 'clinic', 'refer', 'refertype', 'seq'],
  ODX: ['hn', 'dateopd', 'clinic', 'diagcode', 'diagtype', 'provider', 'person_id', 'seq'],
  OOP: ['hn', 'dateopd', 'clinic', 'oper', 'dropid', 'person_id', 'seq'],
  IPD: ['hn', 'an', 'dateadm', 'timeadm', 'datedsc', 'timedsc', 'dischs', 'discht', 'wartefrom', 'warteto', 'los', 'session', 'department'],
  IRF: ['an', 'refer', 'refertype'],
  IDX: ['an', 'diagcode', 'diagtype', 'provider'],
  IOP: ['an', 'oper', 'optype', 'dropid', 'datein', 'timein', 'dateout', 'timeout'],
  CHT: ['hn', 'an', 'date', 'total', 'paid', 'pttype', 'person_id', 'seq'],
  CHA: ['hn', 'an', 'date', 'chrgitem', 'amount', 'person_id', 'seq'],
  AER: ['hn', 'an', 'dateopd', 'authae', 'ession', 'aession', 'aedate', 'aetime', 'aetype', 'refer_no', 'refmaession', 'iession', 'ucession', 'emession', 'seq', 'ae_servm', 'typein_ae'],
  ADP: ['hn', 'an', 'dateopd', 'type', 'code', 'qty', 'rate', 'seq', 'cagcode', 'dose', 'ca_type', 'serialno', 'totcopay', 'use_status', 'total', 'tmltcode', 'status1'],
  DRG: ['an', 'diagcode', 'drgcode', 'rw', 'adjrw', 'error', 'warning', 'actlos', 'grouper_version', 'cw'],
  LVD: ['an', 'dateout', 'datein', 'qtyday'],
  DRU: ['hcode', 'hn', 'an', 'clinic', 'person_id', 'date', 'drugid', 'drugname', 'qty', 'unit_price', 'total', 'drugplan', 'unit', 'dosage', 'seq'],
};

/* ------------------------------------------------------------------ */
/*  Parse pipe-delimited text → rows                                  */
/* ------------------------------------------------------------------ */

function parsePipeText(text: string, columns: string[]): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const rows: Record<string, string>[] = [];

  for (const line of lines) {
    const parts = line.split('|');
    const row: Record<string, string> = {};
    for (let i = 0; i < columns.length; i++) {
      row[columns[i]] = (parts[i] ?? '').trim();
    }
    // เก็บ field ที่เกินมาด้วย (บางไฟล์มี field มากกว่าที่กำหนด)
    for (let i = columns.length; i < parts.length; i++) {
      row[`_extra_${i}`] = (parts[i] ?? '').trim();
    }
    rows.push(row);
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/*  Find matching file in FileList                                    */
/*  รองรับ: INS.txt, INS_11308_20240801141551.txt                     */
/*  ใช้ไฟล์ชื่อสั้น (INS.txt) ก่อน ถ้าไม่มีค่อยใช้ชื่อยาว             */
/*  Filter เฉพาะ .txt เท่านั้น                                        */
/* ------------------------------------------------------------------ */

/**
 * ดึงชื่อไฟล์สุดท้าย (basename) จาก File object
 * ลอง webkitRelativePath → name → ตัดเอาส่วนหลัง / สุดท้าย
 */
function getBaseName(f: File): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rel: string = (f as any).webkitRelativePath || '';
  const raw = rel || f.name || '';
  // ตัดเอาส่วนหลัง / หรือ \ สุดท้าย
  const parts = raw.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || raw;
}

function findFileInList(fileList: File[], name: Claim16FileName): File | null {
  const upper = name.toUpperCase();

  // กรองเฉพาะไฟล์ที่ลงท้ายด้วย .txt (ใช้ทั้ง name และ webkitRelativePath)
  const txtFiles = fileList.filter((f) => {
    const bn = getBaseName(f);
    return /\.txt$/i.test(bn);
  });

  // หาแบบชื่อสั้นก่อน: INS.txt (exact match)
  const exact = txtFiles.find((f) => {
    return getBaseName(f).toUpperCase() === `${upper}.TXT`;
  });
  if (exact) return exact;

  // หาแบบชื่อยาว: INS_xxxxx.txt (ขึ้นต้นด้วย INS_)
  const prefixed = txtFiles.find((f) => {
    const fn = getBaseName(f).toUpperCase();
    return fn.startsWith(`${upper}_`) && fn.endsWith('.TXT');
  });
  return prefixed ?? null;
}

/* ------------------------------------------------------------------ */
/*  Parse Folder (FileList) → Claim16Record                           */
/* ------------------------------------------------------------------ */

export async function parseClaim16Folder(
  fileList: File[],
  folderName: string,
  uploadedBy: string,
): Promise<Claim16Record> {
  // DEBUG: log ไฟล์ทั้งหมดที่ได้รับ
  console.log(`[Claim16Parser] Received ${fileList.length} files from folder "${folderName}"`);
  fileList.slice(0, 10).forEach((f, i) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rel = (f as any).webkitRelativePath || '';
    console.log(`[Claim16Parser] [${i}] name="${f.name}" relPath="${rel}" baseName="${getBaseName(f)}" size=${f.size}`);
  });

  const files: Claim16FileData[] = [];
  let hospitalCode = '';
  let totalRows = 0;

  for (const name of CLAIM16_FILES) {
    const file = findFileInList(fileList, name);
    console.log(`[Claim16Parser] Looking for ${name}: ${file ? `FOUND → "${getBaseName(file)}"` : 'NOT FOUND'}`);
    if (!file) continue;

    const text = await file.text();
    const columns = COLUMNS[name];
    const rows = parsePipeText(text, columns);

    // Extract hospital code: จาก PAT (hcode เป็น field แรก) หรือจากชื่อโฟลเดอร์
    if (!hospitalCode && rows.length > 0) {
      if (rows[0].hcode) {
        hospitalCode = rows[0].hcode;
      }
    }

    totalRows += rows.length;
    files.push({ name, rows, rowCount: rows.length });
  }

  // Fallback 1: ดึง hospital code จากชื่อโฟลเดอร์ เช่น ECLAIM_11308_xxx
  if (!hospitalCode) {
    const folderMatch = /(\d{5})/.exec(folderName);
    if (folderMatch) hospitalCode = folderMatch[1];
  }

  // Fallback 2: ดึงจากชื่อไฟล์ใน list เช่น ADP_11308_20240730141904.txt
  // (ใช้กรณีที่ user เลือกไฟล์ตรงๆ ไม่ได้ลาก folder)
  if (!hospitalCode) {
    for (const f of fileList) {
      const m = /_(\d{5})_/.exec(getBaseName(f));
      if (m) {
        hospitalCode = m[1];
        break;
      }
    }
  }

  if (files.length === 0) {
    throw new Error('ไม่พบไฟล์ 16 แฟ้ม (.txt) ภายในโฟลเดอร์ (ต้องมี INS.txt, PAT.txt, OPD.txt ฯลฯ)');
  }

  return {
    id: `c16_${hospitalCode}_${Date.now()}`,
    fileName: folderName,
    hospitalCode: hospitalCode || 'UNKNOWN',
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    files,
    totalRows,
    validationIssues: [],
    isValidated: false,
  };
}

/* ------------------------------------------------------------------ */
/*  Validate                                                          */
/* ------------------------------------------------------------------ */

function isValidDate(s: string): boolean {
  if (!s) return false;
  // รูปแบบ YYYYMMDD หรือ YYYY-MM-DD
  const cleaned = s.replace(/-/g, '');
  if (cleaned.length !== 8) return false;
  const y = parseInt(cleaned.slice(0, 4));
  const m = parseInt(cleaned.slice(4, 6));
  const d = parseInt(cleaned.slice(6, 8));
  return y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

function isValidCID(cid: string): boolean {
  if (!cid || cid.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(cid[i]) * (13 - i);
  }
  const check = (11 - (sum % 11)) % 10;
  return check === parseInt(cid[12]);
}

/**
 * Lookup error code จาก search_c → สร้าง message พร้อมคำอธิบาย + แนวทางแก้ไข
 */
function buildErrorMessage(code: string, fallbackMsg: string): string {
  const ref = ERROR_CODES[code];
  if (ref) {
    return `[${code}] ${ref.description}${ref.suggestion ? ` → ${ref.suggestion}` : ''}`;
  }
  return fallbackMsg;
}

/**
 * ตรวจ error/warning codes จาก DRG หรือ field อื่นๆ
 * ถ้า code ตรงกับ search_c → ใช้ description จาก search_c
 * ถ้า code ขึ้นต้นด้วย W = warning, อื่นๆ = error
 */
function classifyCode(code: string): 'error' | 'warning' {
  return code.startsWith('W') ? 'warning' : 'error';
}

export function validateClaim16(record: Claim16Record): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fileMap = new Map(record.files.map((f) => [f.name, f]));

  // --- INS (C104, C105, C115, C116) ---
  const ins = fileMap.get('INS');
  if (ins) {
    ins.rows.forEach((row, i) => {
      if (!row.hn) {
        issues.push({ file: 'INS', row: i + 1, field: 'hn', severity: 'error', message: buildErrorMessage('105', 'ไม่มี HN'), value: '' });
      }
      if (!row.cid) {
        issues.push({ file: 'INS', row: i + 1, field: 'cid', severity: 'error', message: buildErrorMessage('104', 'ไม่มีเลขบัตรประชาชน'), value: '' });
      } else if (row.cid.length !== 13) {
        issues.push({ file: 'INS', row: i + 1, field: 'cid', severity: 'error', message: buildErrorMessage('116', 'เลขบัตรประชาชนผิดรูปแบบ'), value: row.cid });
      } else if (!isValidCID(row.cid)) {
        issues.push({ file: 'INS', row: i + 1, field: 'cid', severity: 'warning', message: buildErrorMessage('116', 'เลขบัตรประชาชนไม่ถูกต้อง'), value: row.cid });
      }
      if (!row.inscl) {
        issues.push({ file: 'INS', row: i + 1, field: 'inscl', severity: 'error', message: buildErrorMessage('115', 'ไม่มีรหัสสิทธิ'), value: '' });
      }
    });
  } else {
    issues.push({ file: 'INS', row: 0, field: '-', severity: 'error', message: 'ไม่พบไฟล์ INS.txt' });
  }

  // --- PAT (C101, C102, C103, C104) ---
  const pat = fileMap.get('PAT');
  if (pat) {
    pat.rows.forEach((row, i) => {
      if (!row.fname && !row.namepat) {
        issues.push({ file: 'PAT', row: i + 1, field: 'fname', severity: 'error', message: buildErrorMessage('101', 'ไม่มีชื่อ-สกุลผู้ป่วย'), value: '' });
      }
      if (!row.person_id) {
        issues.push({ file: 'PAT', row: i + 1, field: 'person_id', severity: 'error', message: buildErrorMessage('104', 'ไม่มี person_id'), value: '' });
      }
      if (!row.dob || !isValidDate(row.dob)) {
        issues.push({ file: 'PAT', row: i + 1, field: 'dob', severity: 'warning', message: buildErrorMessage('102', 'วันเกิดไม่ถูกต้อง'), value: row.dob });
      }
      if (!row.sex || !['1', '2'].includes(row.sex)) {
        issues.push({ file: 'PAT', row: i + 1, field: 'sex', severity: 'warning', message: buildErrorMessage('103', 'เพศไม่ถูกต้อง'), value: row.sex });
      }
    });
  }

  // --- OPD ---
  const opd = fileMap.get('OPD');
  if (opd) {
    opd.rows.forEach((row, i) => {
      if (!row.dateopd || !isValidDate(row.dateopd)) {
        issues.push({ file: 'OPD', row: i + 1, field: 'dateopd', severity: 'error', message: buildErrorMessage('124', 'วันที่ตรวจไม่ถูกต้อง'), value: row.dateopd });
      }
      if (!row.hn) {
        issues.push({ file: 'OPD', row: i + 1, field: 'hn', severity: 'error', message: buildErrorMessage('105', 'ไม่มี HN'), value: '' });
      }
    });
  }

  // --- ORF (ส่งต่อ OPD) ---
  const orf = fileMap.get('ORF');
  if (orf) {
    orf.rows.forEach((row, i) => {
      if (!row.refer) {
        issues.push({ file: 'ORF', row: i + 1, field: 'refer', severity: 'error', message: 'ไม่มีรหัสหน่วยบริการที่ส่งต่อ' });
      }
      if (!row.refertype) {
        issues.push({ file: 'ORF', row: i + 1, field: 'refertype', severity: 'warning', message: 'ไม่มีประเภทการส่งต่อ' });
      }
    });
  }

  // --- ODX ---
  const odx = fileMap.get('ODX');
  if (odx) {
    odx.rows.forEach((row, i) => {
      if (!row.diagcode) {
        issues.push({ file: 'ODX', row: i + 1, field: 'diagcode', severity: 'error', message: 'ไม่มีรหัสวินิจฉัย OPD' });
      }
      if (!row.diagtype) {
        issues.push({ file: 'ODX', row: i + 1, field: 'diagtype', severity: 'warning', message: 'ไม่มี diagtype (1=Principal, 2=Co-morbidity)' });
      }
    });
  }

  // --- OOP (หัตถการ OPD) ---
  const oop = fileMap.get('OOP');
  if (oop) {
    oop.rows.forEach((row, i) => {
      if (!row.oper) {
        issues.push({ file: 'OOP', row: i + 1, field: 'oper', severity: 'error', message: 'ไม่มีรหัสหัตถการ OPD' });
      }
    });
  }

  // --- IPD (C106, C107, C108, C109, C110, C111, C112) ---
  const ipd = fileMap.get('IPD');
  if (ipd) {
    ipd.rows.forEach((row, i) => {
      if (!row.an) {
        issues.push({ file: 'IPD', row: i + 1, field: 'an', severity: 'error', message: buildErrorMessage('106', 'ไม่มี AN'), value: '' });
      }
      if (!row.dateadm || !isValidDate(row.dateadm)) {
        issues.push({ file: 'IPD', row: i + 1, field: 'dateadm', severity: 'error', message: buildErrorMessage('107', 'วันที่รับไว้ไม่ถูกต้อง'), value: row.dateadm });
      }
      if (!row.datedsc || !isValidDate(row.datedsc)) {
        issues.push({ file: 'IPD', row: i + 1, field: 'datedsc', severity: 'warning', message: buildErrorMessage('108', 'ไม่มีวันที่จำหน่าย'), value: row.datedsc });
      }
      if (!row.timeadm) {
        issues.push({ file: 'IPD', row: i + 1, field: 'timeadm', severity: 'warning', message: buildErrorMessage('109', 'เวลาที่รับไว้ไม่มี'), value: '' });
      }
      if (!row.timedsc) {
        issues.push({ file: 'IPD', row: i + 1, field: 'timedsc', severity: 'warning', message: buildErrorMessage('110', 'เวลาที่จำหน่ายไม่มี'), value: '' });
      }
      if (!row.discht) {
        issues.push({ file: 'IPD', row: i + 1, field: 'discht', severity: 'warning', message: buildErrorMessage('111', 'ประเภทการจำหน่ายไม่มี'), value: '' });
      }
      if (!row.dischs) {
        issues.push({ file: 'IPD', row: i + 1, field: 'dischs', severity: 'warning', message: buildErrorMessage('112', 'สถานภาพเมื่อจำหน่ายไม่มี'), value: '' });
      }
      // C121: วัน/เวลารับไว้ หลังวันจำหน่าย
      if (row.dateadm && row.datedsc && isValidDate(row.dateadm) && isValidDate(row.datedsc)) {
        if (row.dateadm > row.datedsc) {
          issues.push({ file: 'IPD', row: i + 1, field: 'dateadm', severity: 'error', message: buildErrorMessage('121', 'วัน/เวลาที่รับไว้หลังวันที่จำหน่าย'), value: `${row.dateadm} > ${row.datedsc}` });
        }
      }
    });
  }

  // --- IRF (ส่งต่อ IPD) ---
  const irf = fileMap.get('IRF');
  if (irf) {
    irf.rows.forEach((row, i) => {
      if (!row.an) {
        issues.push({ file: 'IRF', row: i + 1, field: 'an', severity: 'error', message: 'ไม่มี AN' });
      }
      if (!row.refer) {
        issues.push({ file: 'IRF', row: i + 1, field: 'refer', severity: 'error', message: 'ไม่มีรหัสหน่วยบริการที่ส่งต่อ' });
      }
      if (!row.refertype) {
        issues.push({ file: 'IRF', row: i + 1, field: 'refertype', severity: 'warning', message: 'ไม่มีประเภทการส่งต่อ' });
      }
    });
  }

  // --- IDX ---
  const idx = fileMap.get('IDX');
  if (idx) {
    idx.rows.forEach((row, i) => {
      if (!row.diagcode) {
        issues.push({ file: 'IDX', row: i + 1, field: 'diagcode', severity: 'error', message: 'ไม่มีรหัสวินิจฉัย IPD' });
      }
      if (!row.diagtype) {
        issues.push({ file: 'IDX', row: i + 1, field: 'diagtype', severity: 'warning', message: 'ไม่มี diagtype (1=Principal, 4=Complication)' });
      }
    });
  }

  // --- IOP (หัตถการ IPD) ---
  const iop = fileMap.get('IOP');
  if (iop) {
    iop.rows.forEach((row, i) => {
      if (!row.an) {
        issues.push({ file: 'IOP', row: i + 1, field: 'an', severity: 'error', message: 'ไม่มี AN' });
      }
      if (!row.oper) {
        issues.push({ file: 'IOP', row: i + 1, field: 'oper', severity: 'error', message: 'ไม่มีรหัสหัตถการ IPD' });
      }
    });
  }

  // --- CHT (C117) ---
  const cht = fileMap.get('CHT');
  if (cht) {
    cht.rows.forEach((row, i) => {
      if (!row.total || isNaN(Number(row.total))) {
        issues.push({ file: 'CHT', row: i + 1, field: 'total', severity: 'error', message: buildErrorMessage('117', 'ยอดเงินไม่ถูกต้อง'), value: row.total });
      }
    });
  }

  // --- CHA (รายการ Charge) ---
  const cha = fileMap.get('CHA');
  if (cha) {
    cha.rows.forEach((row, i) => {
      if (!row.chrgitem) {
        issues.push({ file: 'CHA', row: i + 1, field: 'chrgitem', severity: 'error', message: 'ไม่มีรหัสรายการ charge' });
      }
      if (!row.amount || isNaN(Number(row.amount))) {
        issues.push({ file: 'CHA', row: i + 1, field: 'amount', severity: 'error', message: 'จำนวนเงินไม่ถูกต้อง', value: row.amount });
      }
    });
  }

  // --- AER (อุบัติเหตุ/ฉุกเฉิน) ---
  const aer = fileMap.get('AER');
  if (aer) {
    aer.rows.forEach((row, i) => {
      if (!row.aetype) {
        issues.push({ file: 'AER', row: i + 1, field: 'aetype', severity: 'warning', message: 'ไม่มีประเภทอุบัติเหตุ (aetype)' });
      }
      if (!row.hn && !row.an) {
        issues.push({ file: 'AER', row: i + 1, field: 'hn', severity: 'error', message: 'ไม่มี HN หรือ AN' });
      }
    });
  }

  // --- ADP (ค่ายา/เวชภัณฑ์) ---
  const adp = fileMap.get('ADP');
  if (adp) {
    adp.rows.forEach((row, i) => {
      if (!row.code) {
        issues.push({ file: 'ADP', row: i + 1, field: 'code', severity: 'error', message: 'ไม่มีรหัสรายการยา/เวชภัณฑ์' });
      }
      if (!row.type) {
        issues.push({ file: 'ADP', row: i + 1, field: 'type', severity: 'warning', message: 'ไม่มีประเภทรายการ (type)' });
      }
      if (row.total && Number(row.total) < 0) {
        issues.push({ file: 'ADP', row: i + 1, field: 'total', severity: 'warning', message: 'ยอดเงินติดลบ', value: row.total });
      }
    });
  }

  // --- LVD (วันลากลับบ้าน) ---
  const lvd = fileMap.get('LVD');
  if (lvd && lvd.rows.length > 0) {
    lvd.rows.forEach((row, i) => {
      if (!row.an) {
        issues.push({ file: 'LVD', row: i + 1, field: 'an', severity: 'error', message: 'ไม่มี AN' });
      }
      if (!row.dateout || !isValidDate(row.dateout)) {
        issues.push({ file: 'LVD', row: i + 1, field: 'dateout', severity: 'warning', message: 'วันที่ออกไม่ถูกต้อง', value: row.dateout });
      }
      if (!row.datein || !isValidDate(row.datein)) {
        issues.push({ file: 'LVD', row: i + 1, field: 'datein', severity: 'warning', message: 'วันที่กลับไม่ถูกต้อง', value: row.datein });
      }
    });
  }

  // --- DRG (ใช้ error/warning codes จาก search_c) ---
  const drg = fileMap.get('DRG');
  if (drg) {
    drg.rows.forEach((row, i) => {
      // Error codes: อาจมีหลายค่าคั่นด้วย comma
      if (row.error && row.error.trim() && row.error !== '0') {
        const codes = row.error.split(',').map((c) => c.trim()).filter(Boolean);
        for (const code of codes) {
          const sev = classifyCode(code);
          const ref = ERROR_CODES[code];
          issues.push({
            file: 'DRG', row: i + 1, field: 'error', severity: sev,
            message: ref ? `[${code}] ${ref.description}` : `DRG error: ${code}`,
            value: row.an || code,
          });
        }
      }
      // Warning codes
      if (row.warning && row.warning.trim() && row.warning !== '0') {
        const codes = row.warning.split(',').map((c) => c.trim()).filter(Boolean);
        for (const code of codes) {
          const ref = ERROR_CODES[code];
          issues.push({
            file: 'DRG', row: i + 1, field: 'warning', severity: 'warning',
            message: ref ? `[${code}] ${ref.description}` : `DRG warning: ${code}`,
            value: row.an || code,
          });
        }
      }
      if (!row.drgcode) {
        issues.push({ file: 'DRG', row: i + 1, field: 'drgcode', severity: 'error', message: 'ไม่มี DRG code' });
      }
    });
  }

  // --- DRU ---
  const dru = fileMap.get('DRU');
  if (dru) {
    dru.rows.forEach((row, i) => {
      if (!row.person_id) {
        issues.push({ file: 'DRU', row: i + 1, field: 'person_id', severity: 'warning', message: buildErrorMessage('104', 'ไม่มี person_id'), value: '' });
      }
    });
  }

  // --- Cross-file checks ---

  // IPD ↔ IDX: ทุก AN ใน IPD ต้องมีวินิจฉัยใน IDX
  if (ipd) {
    const idxANs = idx ? new Set(idx.rows.map((r) => r.an)) : new Set<string>();
    for (let i = 0; i < ipd.rows.length; i++) {
      const an = ipd.rows[i].an;
      if (an && !idxANs.has(an)) {
        issues.push({ file: 'IDX', row: 0, field: 'an', severity: 'error', message: `AN ${an} ไม่มีรหัสวินิจฉัยใน IDX (ต้องมีอย่างน้อย 1 Principal Dx)`, value: an });
      }
    }
  }

  // IPD ↔ CHT: ทุก AN ใน IPD ต้องมีข้อมูลค่าใช้จ่ายใน CHT
  if (ipd && cht) {
    const chtANs = new Set(cht.rows.map((r) => r.an).filter(Boolean));
    for (let i = 0; i < ipd.rows.length; i++) {
      const an = ipd.rows[i].an;
      if (an && !chtANs.has(an)) {
        issues.push({ file: 'CHT', row: 0, field: 'an', severity: 'warning', message: `AN ${an} ไม่มีข้อมูลค่าใช้จ่ายใน CHT`, value: an });
      }
    }
  }

  // IPD ↔ DRG: ทุก AN ใน IPD ต้องมี DRG
  if (ipd && drg) {
    const drgANs = new Set(drg.rows.map((r) => r.an).filter(Boolean));
    for (let i = 0; i < ipd.rows.length; i++) {
      const an = ipd.rows[i].an;
      if (an && !drgANs.has(an)) {
        issues.push({ file: 'DRG', row: 0, field: 'an', severity: 'warning', message: `AN ${an} ไม่มีข้อมูล DRG grouping`, value: an });
      }
    }
  }

  // OPD ↔ ODX: ทุก seq ใน OPD ต้องมีวินิจฉัยใน ODX
  if (opd && odx) {
    const odxSeqs = new Set(odx.rows.map((r) => r.seq));
    for (let i = 0; i < opd.rows.length; i++) {
      const seq = opd.rows[i].seq;
      if (seq && !odxSeqs.has(seq)) {
        issues.push({ file: 'ODX', row: 0, field: 'seq', severity: 'error', message: `seq ${seq} ไม่มีรหัสวินิจฉัยใน ODX (ต้องมีอย่างน้อย 1 Dx)`, value: seq });
      }
    }
  }

  // OPD ↔ INS: ทุก seq ใน OPD ต้องมีสิทธิใน INS
  if (opd && ins) {
    const insSeqs = new Set(ins.rows.map((r) => r.seq).filter(Boolean));
    if (insSeqs.size > 0) {
      for (let i = 0; i < opd.rows.length; i++) {
        const seq = opd.rows[i].seq;
        if (seq && !insSeqs.has(seq)) {
          issues.push({ file: 'INS', row: 0, field: 'seq', severity: 'warning', message: `seq ${seq} ไม่มีข้อมูลสิทธิใน INS`, value: seq });
        }
      }
    }
  }

  // OPD ↔ CHT: ทุก seq ใน OPD ต้องมีค่าใช้จ่ายใน CHT
  if (opd && cht) {
    const chtSeqs = new Set(cht.rows.map((r) => r.seq).filter(Boolean));
    if (chtSeqs.size > 0) {
      for (let i = 0; i < opd.rows.length; i++) {
        const seq = opd.rows[i].seq;
        if (seq && !chtSeqs.has(seq)) {
          issues.push({ file: 'CHT', row: 0, field: 'seq', severity: 'warning', message: `seq ${seq} ไม่มีข้อมูลค่าใช้จ่ายใน CHT`, value: seq });
        }
      }
    }
  }

  // Post-process: extract code จาก message prefix `[CODE]` → ตั้งค่า issue.code
  for (const issue of issues) {
    const m = /^\[(\w+)\]/.exec(issue.message);
    if (m) issue.code = m[1];
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/*  Build Summary — สรุปยอด visit + มูลค่า จากข้อมูลที่ผ่าน           */
/* ------------------------------------------------------------------ */

export function buildClaim16Summary(record: Claim16Record): Claim16Summary {
  const fileMap = new Map(record.files.map((f) => [f.name, f]));

  // นับจำนวน error ต่อ row (เพื่อหักแถวที่ error ออก)
  const errorRows = new Map<string, Set<number>>(); // file → set of row numbers with errors
  for (const issue of record.validationIssues) {
    if (issue.severity === 'error' && issue.row > 0) {
      const set = errorRows.get(issue.file) ?? new Set();
      set.add(issue.row);
      errorRows.set(issue.file, set);
    }
  }

  // OPD visits (ที่ไม่มี error)
  const opd = fileMap.get('OPD');
  const opdErrors = errorRows.get('OPD') ?? new Set();
  const opdVisits = opd ? opd.rows.filter((_, i) => !opdErrors.has(i + 1)).length : 0;

  // IPD admissions (ที่ไม่มี error)
  const ipd = fileMap.get('IPD');
  const ipdErrors = errorRows.get('IPD') ?? new Set();
  const ipdAdmissions = ipd ? ipd.rows.filter((_, i) => !ipdErrors.has(i + 1)).length : 0;

  // CHT: รวมยอดเงินเฉพาะแถวที่ไม่มี error
  const cht = fileMap.get('CHT');
  const chtErrors = errorRows.get('CHT') ?? new Set();
  let totalAmount = 0;
  let totalPaid = 0;
  if (cht) {
    cht.rows.forEach((row, i) => {
      if (!chtErrors.has(i + 1)) {
        totalAmount += parseFloat(row.total) || 0;
        totalPaid += parseFloat(row.paid) || 0;
      }
    });
  }

  return {
    opdVisits,
    ipdAdmissions,
    totalVisits: opdVisits + ipdAdmissions,
    totalAmount,
    totalPaid,
    importedAt: new Date().toISOString(),
  };
}
