import JSZip from 'jszip';
import { decodeTIS620 } from './repParser';
import type { SsopRepRecord, SsopRepClaimLine, SsopPrescription, SsopDrugItem } from '../types/upload';

/** แปลงวันที่ พ.ศ. (DD/MM/YYYY) + เวลา (HH:MM) เป็น ISO datetime (ค.ศ.) */
function toIsoDateTime(thDate: string, thTime?: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(thDate.trim());
  if (!m) return null;
  const day = m[1];
  const month = m[2];
  const year = String(parseInt(m[3], 10) - 543);
  const time = (thTime ?? '00:00').trim();
  return `${year}-${month}-${day}T${time}:00`;
}

function getFirstMatch(lines: string[], re: RegExp): string | null {
  for (const l of lines) {
    const m = re.exec(l);
    if (m) return m[1].trim();
  }
  return null;
}

interface ParsedBmn {
  ackNo: string;
  hospitalCode: string;
  mainHospitalCode: string;
  mainHospitalName: string | null;
  batchRef: string;
  station: string | null;
  ackAt: string | null;
  totalSubmitted: number;
  totalPassed: number;
  totalFailed: number;
  claimLines: SsopRepClaimLine[];
}

const CLAIM_LINE_RE =
  /^\*\|\s*([AC])\s+(\d+)\s*,\s*(\d+)\s*,\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})\s*,\s*([^,]+),\s*([^,]+),\s*([A-Za-z-])\s*,\s*([\d,.]+)\s*,\s*([\d,.]+)\s*\|\s*(.*)$/;

function parseBmn(text: string): ParsedBmn {
  const lines = text.split('\n');

  const ackNo = getFirstMatch(lines, /เลขที่ตอบรับ\s*=\s*(\S+)/) ?? 'UNKNOWN';
  const hospitalCode = getFirstMatch(lines, /รหัส ร\.พ\.\s*=\s*(\S+)/) ?? 'UNKNOWN';
  const batchRef = getFirstMatch(lines, /งวดส่งของ ร\.พ\.\s*=\s*(\S+)/) ?? '';
  const station = getFirstMatch(lines, /สถานี[:\s]*(\d+)/);
  const totalSubmitted = parseInt(getFirstMatch(lines, /รายการที่ส่งไป\s*=\s*(\d+)/) ?? '0', 10);
  const totalPassed = parseInt(getFirstMatch(lines, /รายการที่ตรวจผ่าน\s*=\s*(\d+)/) ?? '0', 10);
  const totalFailed = parseInt(getFirstMatch(lines, /รายการที่ตรวจไม่ผ่าน\s*=\s*(\d+)/) ?? '0', 10);

  let mainHospitalCode = '';
  let mainHospitalName: string | null = null;
  for (const l of lines) {
    const m = /สถานพยาบาลผู้รักษา\s*\s*=\s*(.+?)\s*\((\d+)\)/.exec(l);
    if (m) {
      mainHospitalName = m[1].trim();
      mainHospitalCode = m[2].trim();
      break;
    }
  }

  let ackAt: string | null = null;
  for (const l of lines) {
    const m = /วันที่ออกเลขตอบรับ\s*=\s*(\d{2}\/\d{2}\/\d{4})\s+(?:เวลา[:\s]*)?(\d{2}:\d{2})/.exec(l);
    if (m) {
      ackAt = toIsoDateTime(m[1], m[2]);
      break;
    }
  }

  const claimLines: SsopRepClaimLine[] = [];
  for (const raw of lines) {
    const m = CLAIM_LINE_RE.exec(raw.trim());
    if (!m) continue;
    const [, status, stationField, lineNo, hcode, hmain, authCode, dtTran, invNo, pid, bp, amount, claimAmt, checkCodesRaw] = m;
    const [dDate, dTime] = dtTran.split(/\s+/);
    claimLines.push({
      lineNo: parseInt(lineNo, 10),
      status: status === 'A' ? 'passed' : 'failed',
      station: stationField,
      hcode: hcode.trim(),
      hmain: hmain.trim(),
      authCode: authCode.trim(),
      dtTran: toIsoDateTime(dDate, dTime),
      invNo: invNo.trim(),
      pid: pid.trim(),
      bp: bp.trim(),
      amount: parseFloat(amount.replace(/,/g, '')) || 0,
      claimAmt: parseFloat(claimAmt.replace(/,/g, '')) || 0,
      checkCodes: checkCodesRaw.split(',').map((s) => s.trim()).filter(Boolean),
      drugDetail: [],
    });
  }

  return {
    ackNo, hospitalCode, mainHospitalCode, mainHospitalName, batchRef, station,
    ackAt, totalSubmitted, totalPassed, totalFailed, claimLines,
  };
}

/** ตรวจสอบว่าฟิลด์ๆ ใดเป็นตัวคงที่จาก spec (ไม่ใช่ข้อมูลจริง) — ป้องกัน parse บล็อก "คำบรรยาย" ท้ายไฟล์ */
function parseDmn(text: string): SsopPrescription[] {
  const lines = text.split('\n');
  const prescriptions: SsopPrescription[] = [];
  let current: SsopPrescription | null = null;

  for (const raw of lines) {
    const l = raw.trim();

    if (l.startsWith('*|')) {
      if (l.includes('repline') || l.includes('invoice no.')) continue; // format-spec line, not data
      const parts = l.slice(2).split('|');
      if (parts.length < 10) continue;
      const checkCodes = parts[1].split(',').map((s) => s.trim()).filter((s) => s && s !== '---');
      current = {
        repline: parseInt(parts[0], 10) || 0,
        checkCodes,
        invoiceNo: parts[2].trim(),
        dispenseId: parts[3].trim(),
        pid: parts[4].trim(),
        itemCount: parseInt(parts[5], 10) || 0,
        chargeAmount: parseFloat(parts[6]) || 0,
        claimAmount: parseFloat(parts[7]) || 0,
        paid: parseFloat(parts[8]) || 0,
        otherAmount: parseFloat(parts[9]) || 0,
        items: [],
      };
      prescriptions.push(current);
    } else if (l.startsWith('=|') && current) {
      if (l.includes('Hospdrgid') || l.includes('DFSText') || l.includes('<[checkcode')) continue; // format-spec line, not data
      const parts = l.slice(2).split('|');
      if (parts.length < 9) continue;
      const checkCodes = parts[0].split(',').map((s) => s.trim()).filter((s) => s && s !== '---');
      const item: SsopDrugItem = {
        checkCodes,
        hospDrgId: parts[1]?.trim() || null,
        prdCat: parts[2]?.trim() || null,
        dfsText: parts[3]?.trim() || null,
        quantity: parts[4] ? parseFloat(parts[4]) : null,
        unitPrice: parts[5] ? parseFloat(parts[5]) : null,
        chargeAmt: parts[6] ? parseFloat(parts[6]) : null,
        reimbAmt: parts[7] ? parseFloat(parts[7]) : null,
        drgId: parts[8]?.trim() || null,
        claimCont: parts[9]?.trim() || null,
      };
      current.items.push(item);
    }
  }

  return prescriptions;
}

/** หาไฟล์ใน zip ที่ชื่อมีคำว่า needle (case-insensitive) และลงท้าย .BIL */
async function findBilEntry(zip: JSZip, needle: string): Promise<ArrayBuffer | null> {
  const entry = Object.values(zip.files).find(
    (f) => !f.dir && new RegExp(needle, 'i').test(f.name) && /\.bil$/i.test(f.name)
  );
  if (!entry) return null;
  return entry.async('arraybuffer');
}

/**
 * Parse ไฟล์ตอบรับ สปส. (.ZIP ที่มี SOCDBMN_*.BIL + SOCDDMN_*.BIL คู่กัน)
 * อ้างอิงรูปแบบจากเอกสารตอบรับจริงของ สปส. (Version SSOP-6020)
 */
export async function parseSsopRepZip(
  buffer: ArrayBuffer,
  fileName: string,
  uploadedBy: string,
): Promise<SsopRepRecord> {
  const zip = await JSZip.loadAsync(buffer);

  const bmnBuf = await findBilEntry(zip, 'SOCDBMN');
  if (!bmnBuf) {
    throw new Error('ไม่พบไฟล์ SOCDBMN_*.BIL ใน ZIP — ตรวจสอบว่าเป็นไฟล์ตอบรับ สปส. ที่ถูกต้อง');
  }
  const bmnText = decodeTIS620(bmnBuf);
  const bmn = parseBmn(bmnText);

  const dmnBuf = await findBilEntry(zip, 'SOCDDMN');
  const dmnPrescriptions = dmnBuf ? parseDmn(decodeTIS620(dmnBuf)) : [];

  // จับคู่รายละเอียดยา (DMN) เข้ากับ claim line (BMN) ด้วย invNo
  const byInvNo = new Map<string, SsopPrescription[]>();
  for (const p of dmnPrescriptions) {
    const list = byInvNo.get(p.invoiceNo) ?? [];
    list.push(p);
    byInvNo.set(p.invoiceNo, list);
  }
  for (const line of bmn.claimLines) {
    line.drugDetail = byInvNo.get(line.invNo) ?? [];
  }

  return {
    id: bmn.ackNo,
    ackNo: bmn.ackNo,
    docType: 'OPD_BILL',
    hospitalCode: bmn.hospitalCode,
    mainHospitalCode: bmn.mainHospitalCode,
    mainHospitalName: bmn.mainHospitalName,
    batchRef: bmn.batchRef,
    station: bmn.station,
    ackAt: bmn.ackAt,
    totalSubmitted: bmn.totalSubmitted,
    totalPassed: bmn.totalPassed,
    totalFailed: bmn.totalFailed,
    claimLines: bmn.claimLines,
    fileName,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
  };
}
