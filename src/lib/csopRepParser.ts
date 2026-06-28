import JSZip from 'jszip';
import { decodeTIS620 } from './repParser';
import type {
  CsopRepRecord, CsopRepClaimLine, CsopBillTran, CsopBillItem,
  SsopPrescription, SsopDrugItem,
} from '../types/upload';

function toIso(thDate: string, thTime?: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(thDate.trim());
  if (!m) return null;
  const year = String(parseInt(m[3], 10) - 543);
  return `${year}-${m[2]}-${m[1]}T${(thTime ?? '00:00:00').trim()}`;
}

/** ตัด underscore (placeholder padding ของไฟล์ต้นฉบับ) — คืน null ถ้าว่างทั้งหมด */
function clean(s: string): string | null {
  const v = s.replace(/_+$/g, '').replace(/_/g, '').trim();
  return v || null;
}

interface ParsedCocdbil {
  ackNo: string;
  hospitalCode: string;
  batchRef: string;
  ackAt: string | null;
  totalSubmitted: number;
  totalPassed: number;
  totalFailed: number;
  claimLines: CsopRepClaimLine[];
}

// *| Stat, Station, Line, AuthCode, DTTran, InvNo, BillNo, HN, MemberNo, ClaimAmt |CheckCode
// หมายเหตุ: BillNo บางรายการมี "," แทรกอยู่ข้างใน จึงรวม InvNo+BillNo เป็น blob เดียวแล้วแยกด้วย comma ตัวแรกเท่านั้น
const COCDBIL_LINE_RE =
  /^\*\|\s*([AC])\s+(\d+)\s*,\s*(\d+)\s*,\s*([^,]*),\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})\s*,\s*(.+),\s*([^,]+),\s*([^,]+),\s*([\d.]+)\s*\|\s*(.*)$/;

function parseCocdbil(text: string): ParsedCocdbil {
  const lines = text.split('\n');
  const get = (re: RegExp): string | null => {
    for (const l of lines) { const m = re.exec(l); if (m) return m[1].trim(); }
    return null;
  };

  const ackNo = get(/เลขที่ตอบรับ\s*=\s*(\S+)/) ?? 'UNKNOWN';
  const hospitalCode = get(/รหัส ร\.พ\.\s*=\s*(\S+)/) ?? 'UNKNOWN';
  const batchRef = get(/งวดส่งของ ร\.พ\.\s*=\s*(.+)/) ?? '';
  let ackAt: string | null = null;
  for (const l of lines) {
    const m = /วันที่ออกเลขตอบรับ\s*=\s*(\d{2}\/\d{2}\/\d{4})\s+เวลา:\s*(\d{2}:\d{2}:\d{2})/.exec(l);
    if (m) { ackAt = toIso(m[1], m[2]); break; }
  }
  const totalSubmitted = parseInt(get(/รายการที่ส่งไปทั้งสิ้น\s*=\s*(\d+)/) ?? '0', 10);
  const totalPassed = parseInt(get(/รายการที่ตรวจผ่านทั้งสิ้น\s*=\s*(\d+)/) ?? '0', 10);
  const totalFailed = parseInt(get(/รายการที่ตรวจไม่ผ่านทั้งสิ้น\s*=\s*(\d+)/) ?? '0', 10);

  const claimLines: CsopRepClaimLine[] = [];
  for (const raw of lines) {
    const m = COCDBIL_LINE_RE.exec(raw.trim());
    if (!m) continue;
    const [, status, station, lineNo, authCode, dtTran, invBillBlob, hn, memberNo, claimAmt, checkRaw] = m;
    const commaIdx = invBillBlob.indexOf(',');
    const invNo = commaIdx >= 0 ? invBillBlob.slice(0, commaIdx).trim() : invBillBlob.trim();
    const billNo = commaIdx >= 0 ? invBillBlob.slice(commaIdx + 1).trim() : null;
    const [d, t] = dtTran.split(/\s+/);
    claimLines.push({
      lineNo: parseInt(lineNo, 10),
      status: status === 'A' ? 'passed' : 'failed',
      station,
      authCode: clean(authCode),
      dtTran: toIso(d, t),
      invNo: clean(invNo),
      billNo: clean(billNo ?? ''),
      hn: clean(hn),
      memberNo: clean(memberNo),
      claimAmt: parseFloat(claimAmt) || 0,
      checkCodes: checkRaw.split(',').map((s) => s.trim()).filter(Boolean),
      billItemsDetail: [],
      drugDetail: [],
    });
  }
  return { ackNo, hospitalCode, batchRef, ackAt, totalSubmitted, totalPassed, totalFailed, claimLines };
}

/** CSOPBITM — รายละเอียด BillItems ที่ตรวจไม่ผ่าน (โครงสร้างย่อยไม่มีสเปกทางการในไฟล์ จึงเก็บ rawFields ไว้ด้วย) */
function parseCsopbitm(text: string): CsopBillTran[] {
  const lines = text.split('\n');
  const out: CsopBillTran[] = [];
  let current: CsopBillTran | null = null;

  const mainRe = /^\*\|(\d+)\.\|([^|]*)\|([^,]+),([^,]+),(.+?)\((\d+)\),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)$/;
  for (const raw of lines) {
    const l = raw.trim();
    const mainM = mainRe.exec(l);
    if (mainM) {
      const [, repline, checkRaw, invNo, hn, name, pid, amount, claimAmt, paid, otherPay] = mainM;
      current = {
        repline: parseInt(repline, 10),
        checkCodes: checkRaw.split(',').map((s) => s.trim()).filter((s) => s && s !== '---'),
        invoiceNo: invNo.trim(),
        hn: hn.trim(),
        patientName: name.trim(),
        pid: pid.trim(),
        amount: parseFloat(amount) || 0,
        claimAmt: parseFloat(claimAmt) || 0,
        paid: parseFloat(paid) || 0,
        otherPay: parseFloat(otherPay) || 0,
        items: [],
      };
      out.push(current);
      continue;
    }
    if (l.startsWith('=') && current) {
      const subM = /^=\s*\|([^|]*)\|(.+)$/.exec(l);
      if (subM) {
        const [, checkRaw, rest] = subM;
        const item: CsopBillItem = {
          checkCodes: checkRaw.split(',').map((s) => s.trim()).filter((s) => s && s !== '---'),
          rawFields: rest.split(',').map((s) => s.trim()),
          rawLine: l,
        };
        current.items.push(item);
      }
    }
  }
  return out;
}

/** CSOPREX — รายละเอียดยาที่ตรวจไม่ผ่าน (โครงสร้างเดียวกับ SSOP DMN เป๊ะ) */
function parseCsoprex(text: string): SsopPrescription[] {
  const lines = text.split('\n');
  const out: SsopPrescription[] = [];
  let current: SsopPrescription | null = null;

  for (const raw of lines) {
    const l = raw.trim();
    if (l.startsWith('*|')) {
      if (l.includes('repline') || l.includes('invoice no.')) continue; // format-spec line
      const parts = l.slice(2).split('|');
      if (parts.length < 9) continue;
      const checkCodes = parts[1].split(',').map((s) => s.trim()).filter((s) => s && s !== '---');
      current = {
        repline: parseInt(parts[0], 10) || 0,
        checkCodes,
        invoiceNo: parts[2].trim(),
        dispenseId: parts[3].trim(),
        pid: '',
        itemCount: parseInt(parts[4], 10) || 0,
        chargeAmount: parseFloat(parts[5]) || 0,
        claimAmount: parseFloat(parts[6]) || 0,
        paid: parseFloat(parts[7]) || 0,
        otherAmount: parseFloat(parts[8]) || 0,
        items: [],
      };
      out.push(current);
    } else if (l.startsWith('=') && current) {
      if (l.includes('Hospdrgid') || l.includes('DFSText') || l.includes('<[checkcode')) continue;
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
  return out;
}

async function findBilEntry(zip: JSZip, needle: string): Promise<ArrayBuffer | null> {
  const entry = Object.values(zip.files).find(
    (f) => !f.dir && new RegExp(needle, 'i').test(f.name) && /\.bil$/i.test(f.name)
  );
  if (!entry) return null;
  return entry.async('arraybuffer');
}

/**
 * Parse ไฟล์ตอบรับ CSOP (.ZIP ที่มี COCDBIL_*.BIL + CSOPBITM_*.BIL + CSOPREX_*.BIL)
 * — เอกสารตอบรับ ข้อมูลเบิกค่ารักษาพยาบาลผู้ป่วยนอกข้าราชการ (กรมบัญชีกลาง)
 */
export async function parseCsopRepZip(
  buffer: ArrayBuffer,
  fileName: string,
  uploadedBy: string,
): Promise<CsopRepRecord> {
  const zip = await JSZip.loadAsync(buffer);

  const bilBuf = await findBilEntry(zip, 'COCDBIL');
  if (!bilBuf) {
    throw new Error('ไม่พบไฟล์ COCDBIL_*.BIL ใน ZIP — ตรวจสอบว่าเป็นไฟล์ตอบรับ CSOP ที่ถูกต้อง');
  }
  const head = parseCocdbil(decodeTIS620(bilBuf));

  const bitmBuf = await findBilEntry(zip, 'CSOPBITM');
  const bitm = bitmBuf ? parseCsopbitm(decodeTIS620(bitmBuf)) : [];

  const rexBuf = await findBilEntry(zip, 'CSOPREX');
  const rex = rexBuf ? parseCsoprex(decodeTIS620(rexBuf)) : [];

  const bitmByInvNo = new Map<string, CsopBillTran[]>();
  for (const b of bitm) {
    const list = bitmByInvNo.get(b.invoiceNo) ?? [];
    list.push(b);
    bitmByInvNo.set(b.invoiceNo, list);
  }
  const rexByInvNo = new Map<string, SsopPrescription[]>();
  for (const p of rex) {
    const list = rexByInvNo.get(p.invoiceNo) ?? [];
    list.push(p);
    rexByInvNo.set(p.invoiceNo, list);
  }
  for (const line of head.claimLines) {
    if (!line.invNo) continue;
    line.billItemsDetail = bitmByInvNo.get(line.invNo) ?? [];
    line.drugDetail = rexByInvNo.get(line.invNo) ?? [];
  }

  return {
    id: head.ackNo,
    ackNo: head.ackNo,
    docType: 'OPD_BILL',
    hospitalCode: head.hospitalCode,
    batchRef: head.batchRef,
    station: head.claimLines[0]?.station ?? null,
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
