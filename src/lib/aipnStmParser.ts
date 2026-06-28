import JSZip from 'jszip';
import type { AipnStmBill, AipnStmRecord, AipnStmStatement } from '../types/upload';

function num(v: string | null | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v.trim() === '') return null;
  const n = parseFloat(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function text(el: Element | null | undefined): string {
  return el?.textContent?.trim() ?? '';
}

function textOrNull(el: Element | null | undefined): string | null {
  const t = text(el);
  return t === '' ? null : t;
}

/** Parse SIGNSTMM_*.xml / SIGNSTMS_*.xml — ใบแจ้งยอดเงินที่เบิกได้ของ AIPN ชุดหนึ่ง (M หรือ S) */
function parseStmXml(xmlText: string, stmType: 'M' | 'S'): AipnStmStatement {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const stmdat = doc.querySelector('STMLIST > stmdat');

  const stmNo = text(stmdat?.querySelector('stmno'));
  const periodEl = stmdat?.querySelector('period');
  const period = text(periodEl);
  const periodDesc = periodEl?.getAttribute('desc')?.trim() ?? '';
  const dateDue = text(stmdat?.querySelector('dateDue'));
  const cases = num(text(stmdat?.querySelector('cases')));
  const totalAdjrw = num(text(stmdat?.querySelector('adjrw')));

  const bills: AipnStmBill[] = [];
  doc.querySelectorAll('Bills > Bill').forEach((billEl) => {
    bills.push({
      hmain: text(billEl.querySelector('hmain')),
      billHcode: text(billEl.querySelector('hcode')),
      hproc: text(billEl.querySelector('hproc')),
      hn: text(billEl.querySelector('hn')),
      an: text(billEl.querySelector('an')),
      pid: text(billEl.querySelector('pid')),
      patientName: text(billEl.querySelector('name')),
      dateAdm: textOrNull(billEl.querySelector('dateadm')),
      dateDisch: textOrNull(billEl.querySelector('datedsc')),
      ft: text(billEl.querySelector('ft')),
      bf: text(billEl.querySelector('bf')),
      drg: text(billEl.querySelector('drg')),
      rw: numOrNull(text(billEl.querySelector('rw'))),
      adjrw: numOrNull(text(billEl.querySelector('adjrw'))),
      due: text(billEl.querySelector('due')),
      ptype: text(billEl.querySelector('ptype')),
      rwtype: text(billEl.querySelector('rwtype')),
      rptype: text(billEl.querySelector('rptype')),
      rid: text(billEl.querySelector('rid')),
      pstm: text(billEl.querySelector('pstm')),
      careas: text(billEl.querySelector('careas')),
      sc: text(billEl.querySelector('sc')),
      ed: text(billEl.querySelector('ed')),
      reimb: num(text(billEl.querySelector('Reimb'))),
      nreimb: num(text(billEl.querySelector('Nreimb'))),
      copay: num(text(billEl.querySelector('Copay'))),
      cp: text(billEl.querySelector('CP')),
      pp: text(billEl.querySelector('PP')),
      ods: textOrNull(billEl.querySelector('ODS')),
      spcmsg: textOrNull(billEl.querySelector('spcmsg')),
    });
  });

  return { stmNo, stmType, period, periodDesc, dateDue, cases, totalAdjrw, bills };
}

async function findXmlEntry(zip: JSZip, needle: string): Promise<string | null> {
  const entry = Object.values(zip.files).find(
    (f) => !f.dir && new RegExp(needle, 'i').test(f.name) && /\.xml$/i.test(f.name)
  );
  if (!entry) return null;
  const buf = await entry.async('arraybuffer');
  return new TextDecoder('utf-8').decode(buf);
}

/**
 * Parse ไฟล์ใบแจ้งยอดเงินที่เบิกได้ AIPN (.ZIP ที่มี SIGNSTMM_*.xml และ/หรือ SIGNSTMS_*.xml)
 * — เอกสาร STM ของผู้ป่วยใน ประกันสังคม
 */
export async function parseAipnStmZip(
  buffer: ArrayBuffer,
  fileName: string,
  uploadedBy: string,
): Promise<AipnStmRecord> {
  const zip = await JSZip.loadAsync(buffer);

  const [mXml, sXml] = await Promise.all([
    findXmlEntry(zip, 'SIGNSTMM'),
    findXmlEntry(zip, 'SIGNSTMS'),
  ]);

  if (!mXml && !sXml) {
    throw new Error('ไม่พบไฟล์ SIGNSTMM_*.xml หรือ SIGNSTMS_*.xml ใน ZIP — ตรวจสอบว่าเป็นไฟล์ STM ของ AIPN ที่ถูกต้อง');
  }

  const statements: AipnStmStatement[] = [];
  if (mXml) statements.push(parseStmXml(mXml, 'M'));
  if (sXml) statements.push(parseStmXml(sXml, 'S'));

  const first = statements[0];
  // hcode ของ stmdat ไม่ได้ querySelector มาตรงๆ ในฟังก์ชันย่อย — ดึงจาก hospitalCode ผ่าน filename เป็นหลัก (เชื่อถือได้กว่า เพราะ element ชื่อ hcode ซ้ำกับใน Bill)
  const hospitalCodeMatch = /^(\d{5})_/.exec(fileName);
  const hospitalCode = hospitalCodeMatch ? hospitalCodeMatch[1] : (first?.bills[0]?.hmain ?? 'UNKNOWN');

  return {
    id: `${hospitalCode}_${first?.period ?? ''}`,
    hospitalCode,
    period: first?.period ?? '',
    statements,
    fileName,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
  };
}
