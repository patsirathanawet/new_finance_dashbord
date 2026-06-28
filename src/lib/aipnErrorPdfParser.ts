import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import type { EclaimErrorCode } from './backendApi';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const CODE_RE = /^[0-9][0-9A-Za-z]{2}$/;
const HEADER_SUBSTR_RE = /(วิธีตรวจ|วิธีแก้ไข|Edcode|คําอธิบายรหัส|รหัส Error Code|^\d{2}\/\d{2}\/\d{4}|^\s*\d{1,2}\s*$)/;
// ตัดเศษ footer ที่หลุดมาติดบรรทัด เช่น "1หน้า", "(หน้า)" — เลขหน้า+คำว่า "หน้า" ที่ไม่ใช่ส่วนของประโยคจริง
const FOOTER_FRAGMENT_RE = /(^|\s)\(?\d{0,3}\s*หน้า\)?(\s|$)/g;

function clean(s: string): string {
  return s.normalize('NFKC').replace(FOOTER_FRAGMENT_RE, ' ').trim();
}

function looksComplete(s: string, minLen: number): boolean {
  if (s.length < minLen) return false;
  if (/^(\*\*|www\.|,|\)|"|')/.test(s)) return false;
  if (s === 'การตรวจ') return false;
  return true;
}

/** รวมบรรทัดถอยหลังจากปลาย block จนกว่าจะ "ดูสมบูรณ์" — ใช้แยก description/resolution จากบรรทัดที่ PDF ตัดขึ้นบรรทัดใหม่กลางประโยค */
function buildField(block: string[], fromEnd: number, minLen: number, maxMerge: number): [string, number] {
  let i = block.length - 1 - fromEnd;
  if (i < 0) return ['', 0];
  let parts = [block[i]];
  let used = 1;
  while (used < maxMerge && i - 1 >= 0 && !looksComplete(parts.join(' '), minLen)) {
    i -= 1;
    parts = [block[i], ...parts];
    used += 1;
  }
  return [parts.join(' '), used];
}

/**
 * Parse ไฟล์ aipnedcode.pdf (เอกสาร "รหัส Error Code วิธีตรวจ วิธีแก้ไข" ของ AIPN จากสำนักงานประกันสังคม)
 * → ดึง {code, description, resolution} ทุกรายการ
 *
 * หมายเหตุ: ตาราง PDF นี้พาดข้ามหน้าและตัดบรรทัดกลางประโยคบ่อย ผลลัพธ์เป็น best-effort
 * (ส่วน description ตรงเกือบทั้งหมด ส่วน resolution บางรายการอาจมีบริบทเกินหรือขาดไปบ้าง)
 */
export async function parseAipnErrorPdf(buffer: ArrayBuffer): Promise<EclaimErrorCode[]> {
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  const allLines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let cur = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      cur += item.str;
      if (item.hasEOL) {
        const l = clean(cur);
        if (l !== '' && !HEADER_SUBSTR_RE.test(l)) allLines.push(l);
        cur = '';
      }
    }
    if (cur) {
      const l = clean(cur);
      if (l !== '' && !HEADER_SUBSTR_RE.test(l)) allLines.push(l);
    }
  }

  const codeIdxs: number[] = [];
  for (let i = 0; i < allLines.length; i++) {
    if (CODE_RE.test(allLines[i])) codeIdxs.push(i);
  }

  const records: EclaimErrorCode[] = [];
  for (let n = 0; n < codeIdxs.length; n++) {
    const idx = codeIdxs[n];
    const code = allLines[idx];
    const end = n + 1 < codeIdxs.length ? codeIdxs[n + 1] : allLines.length;
    const block = allLines.slice(idx + 1, end).filter(Boolean);
    const [description, usedDesc] = buildField(block, 0, 10, 3);
    const [resolution] = buildField(block, usedDesc, 15, 4);
    records.push({ code, description: description || null, resolution: resolution || null });
  }

  return records;
}
