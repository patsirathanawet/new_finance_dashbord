import JSZip from 'jszip';
import { decodeTIS620 } from './repParser';
import type {
  AipnRepRecord, AipnRepClaimLine, AipnSubDetail, AipnBillItem, AipnSubLineEntry,
} from '../types/upload';

function toIsoDate(thDate: string, thTime?: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(thDate.trim());
  if (!m) return null;
  const year = String(parseInt(m[3], 10) - 543);
  const month = m[2].padStart(2, '0');
  const day = m[1].padStart(2, '0');
  return `${year}-${month}-${day}T${(thTime ?? '00:00:00').trim()}`;
}

interface ParsedSignrep {
  ackNo: string;
  hospitalCode: string;
  batchNo: string | null;
  batchRef: string | null;
  ackAt: string | null;
  totalSubmitted: number;
  totalPassed: number;
  totalFailed: number;
  claimLines: AipnRepClaimLine[];
}

// *| pcode tcode iptype CareAs, SS, HMain, HCare, AN, DRG, rw, adjrw, ST, SST, PT, Amt, name[:err[:dat][,...]]
const SIGNREP_LINE_RE =
  /^\*\|\s*(\d)\s+([AC])\s+(\S)\s+(\S)\s+(\S)\s*,\s*([^,]*),\s*([^,]*),\s*([^,]*),\s*([^,]*),\s*([^,]*),\s*([^,]*),\s*([^,]*),\s*([^,]*),\s*([^,]*),\s*([\d.]+)\s*,\s*(.+)$/;

function parseSignrep(text: string): ParsedSignrep {
  const lines = text.split('\n');
  const get = (re: RegExp): string | null => {
    for (const l of lines) { const m = re.exec(l); if (m) return m[1].trim(); }
    return null;
  };

  const ackNo = get(/เลขตอบรับที่\s*=\s*(\S+)/) ?? 'UNKNOWN';
  const hospitalCode = get(/รหัส ร\.พ\.\s*=\s*(\S+)/) ?? 'UNKNOWN';
  const batchNo = get(/งวดที่ส่งไป\s*=\s*(\S+)/);
  const batchRef = get(/เลขงวดที่ส่ง\s*:\s*(\S+)/);
  let ackAt: string | null = null;
  for (const l of lines) {
    const m = /วันที่ออกเลขตอบรับ\s*=\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+เวลา\s*:\s*(\d{2}:\d{2}:\d{2})/.exec(l);
    if (m) { ackAt = toIsoDate(m[1], m[2]); break; }
  }
  const totalSubmitted = parseInt(get(/รายการที่ส่งไป\s*=\s*(\d+)/) ?? '0', 10);
  const totalPassed = parseInt(get(/รายการที่ตรวจผ่าน\s*=\s*(\d+)/) ?? '0', 10);
  const totalFailed = parseInt(get(/รายการที่ตรวจไม่ผ่าน\s*=\s*(\d+)/) ?? '0', 10);

  const claimLines: AipnRepClaimLine[] = [];
  let lineNo = 0;
  for (const raw of lines) {
    const l = raw.trim();
    const m = SIGNREP_LINE_RE.exec(l);
    if (!m) continue;
    lineNo++;
    const [, pcode, tcode, iptype, careAs, ss, hmain, hcare, an, drg, rw, adjrw, st, sst, pt, amt, nameAndErr] = m;
    let patientName = nameAndErr;
    let checkCodes: string[] = [];
    const colonIdx = nameAndErr.indexOf(':');
    if (colonIdx >= 0) {
      patientName = nameAndErr.slice(0, colonIdx).trim();
      checkCodes = nameAndErr.slice(colonIdx + 1).split(',').map((s) => s.trim()).filter(Boolean);
    }
    claimLines.push({
      lineNo,
      pcode,
      status: tcode === 'A' ? 'passed' : 'failed',
      iptype, careAs, ss,
      hmain: hmain.trim(),
      hcare: hcare.trim(),
      an: an.trim(),
      drg: drg.trim(),
      rw: rw.trim() ? parseFloat(rw) : null,
      adjrw: adjrw.trim() || null,
      serviceType: st.trim() || null,
      serviceSubtype: sst.trim() || null,
      pt: pt.trim() || null,
      amount: parseFloat(amt) || 0,
      patientName,
      checkCodes,
      subDetail: null,
    });
  }
  return { ackNo, hospitalCode, batchNo, batchRef, ackAt, totalSubmitted, totalPassed, totalFailed, claimLines };
}

/** SIGNSUP — รายละเอียด Dx/Proc/BillItems ต่อ AN */
function parseSignsup(text: string): Map<string, AipnSubDetail> {
  const lines = text.split('\n');
  const out = new Map<string, AipnSubDetail>();
  let current: AipnSubDetail | null = null;

  const mainRe = /^\*\|(\S+)\s*,(\S+)\s*,\s*(.+?)\s*\((\d+)\s*\)\s*,\s*([AC])\s*\(([^)]*)\)$/;
  for (const raw of lines) {
    const l = raw.trim();
    const mainM = mainRe.exec(l);
    if (mainM) {
      const [, an, hn, name, pid, status, checkRaw] = mainM;
      current = {
        an: an.trim(), hn: hn.trim(), patientName: name.trim(), pid: pid.trim(),
        status: status === 'A' ? 'passed' : 'failed',
        checkCodes: checkRaw.split(',').map((s) => s.trim()).filter(Boolean),
        dx: [], proc: [], billItems: [],
      };
      out.set(current.an, current);
      continue;
    }
    if (!current) continue;
    let m: RegExpExecArray | null;
    if ((m = /^\+\|([^|]*)\|(.+)$/.exec(l))) {
      const entry: AipnSubLineEntry = {
        checkCodes: m[1].split(',').map((s) => s.trim()).filter((s) => s && s !== '---'),
        rawFields: m[2].split(',').map((s) => s.trim()),
        rawLine: l,
      };
      current.dx.push(entry);
    } else if ((m = /^#\|([^|]*)\|(.+)$/.exec(l))) {
      const entry: AipnSubLineEntry = {
        checkCodes: m[1].split(',').map((s) => s.trim()).filter((s) => s && s !== '---'),
        rawFields: m[2].split(',').map((s) => s.trim()),
        rawLine: l,
      };
      current.proc.push(entry);
    } else if ((m = /^=\|([^|]*)\|(.+)$/.exec(l))) {
      const fields = m[2].split(',').map((s) => s.trim());
      const item: AipnBillItem = {
        checkCodes: m[1].split(',').map((s) => s.trim()).filter((s) => s && s !== '---'),
        sequence: fields[0] ?? null,
        billGrCs: fields[1] ?? null,
        lcCode: fields[2] ?? null,
        csCode: fields[3] ?? null,
        stdCode: fields[4] ?? null,
        descript: fields[5] ?? null,
        qty: fields[6] ? parseFloat(fields[6]) : null,
        unitPrice: fields[7] ? parseFloat(fields[7]) : null,
        chargeAmt: fields[8] ? parseFloat(fields[8]) : null,
        claimUp: fields[9] ? parseFloat(fields[9]) : null,
        claimAmount: fields[10] ? parseFloat(fields[10]) : null,
        rawLine: l,
      };
      current.billItems.push(item);
    }
  }
  return out;
}

async function findRepEntry(zip: JSZip, needle: string): Promise<ArrayBuffer | null> {
  const entry = Object.values(zip.files).find(
    (f) => !f.dir && new RegExp(needle, 'i').test(f.name) && /\.rep$/i.test(f.name)
  );
  if (!entry) return null;
  return entry.async('arraybuffer');
}

/**
 * Parse ไฟล์ตอบรับ AIPN (.ZIP ที่มี SIGNREP_*.REP + SIGNSUP_*.REP)
 * — เอกสารตอบรับข้อมูลผู้ป่วยใน ประกันสังคม
 */
export async function parseAipnRepZip(
  buffer: ArrayBuffer,
  fileName: string,
  uploadedBy: string,
): Promise<AipnRepRecord> {
  const zip = await JSZip.loadAsync(buffer);

  const repBuf = await findRepEntry(zip, 'SIGNREP');
  if (!repBuf) {
    throw new Error('ไม่พบไฟล์ SIGNREP_*.REP ใน ZIP — ตรวจสอบว่าเป็นไฟล์ตอบรับ AIPN ที่ถูกต้อง');
  }
  const head = parseSignrep(decodeTIS620(repBuf));

  const supBuf = await findRepEntry(zip, 'SIGNSUP');
  const subDetailByAn = supBuf ? parseSignsup(decodeTIS620(supBuf)) : new Map<string, AipnSubDetail>();

  for (const line of head.claimLines) {
    line.subDetail = subDetailByAn.get(line.an) ?? null;
  }

  return {
    id: head.ackNo,
    ackNo: head.ackNo,
    docType: 'IPD_BILL',
    hospitalCode: head.hospitalCode,
    batchNo: head.batchNo,
    batchRef: head.batchRef,
    ackAt: head.ackAt,
    totalSubmitted: head.totalSubmitted,
    totalPassed: head.totalPassed,
    totalFailed: head.totalFailed,
    claimLines: head.claimLines,
    fileName,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
  };
}
