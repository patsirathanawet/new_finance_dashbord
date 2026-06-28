/**
 * 16 แฟ้ม — โครงสร้างข้อมูลมาตรฐานเบิกจ่ายกรมบัญชีกลาง
 * ไฟล์ที่ส่งออกจากระบบ HIS เป็น pipe-delimited text ภายใน ZIP
 */

/* ------------------------------------------------------------------ */
/*  Per-file row types                                                */
/* ------------------------------------------------------------------ */

export interface InsRow {
  hcode: string; hn: string; inscl: string; subtype: string;
  cid: string; datein: string; dateexp: string;
  hospmain: string; hospsub: string;
}

export interface PatRow {
  hcode: string; hn: string; changwat: string; amphur: string;
  dob: string; sex: string; marriage: string; occupa: string;
  nation: string; person_id: string; namepat: string;
  title: string; fname: string; lname: string; idtype: string;
}

export interface OpdRow {
  hcode: string; dateopd: string; clinic: string; seq: string;
  uuc: string; detail: string;
}

export interface OrfRow {
  hcode: string; dateopd: string; clinic: string; seq: string;
  refertype: string; referdate: string;
}

export interface OdxRow {
  hcode: string; dateopd: string; clinic: string; seq: string;
  diagtype: string; diagcode: string;
}

export interface OopRow {
  hcode: string; dateopd: string; clinic: string; seq: string;
  oper: string; dropid: string; person_id: string;
  an: string; servprice: string;
}

export interface IpdRow {
  hcode: string; an: string; dateadm: string; timeadm: string;
  datedsc: string; timedsc: string; dischs: string; discht: string;
  wartefrom: string; warteto: string;
  seq: string; subtype: string;
}

export interface IrfRow {
  hcode: string; an: string; refer: string; refertype: string;
}

export interface IdxRow {
  hcode: string; an: string; diagtype: string; diagcode: string;
}

export interface IopRow {
  hcode: string; an: string; oper: string; optype: string;
  dropid: string; datein: string; timein: string;
  dateout: string; timeout: string;
}

export interface ChtRow {
  hcode: string; an: string; date: string;
  total: string; paid: string; pttype: string; person_id: string;
  seq: string;
}

export interface ChaRow {
  hcode: string; an: string; date: string;
  chrgitem: string; amount: string; person_id: string; seq: string;
}

export interface AerRow {
  hcode: string; an: string; dateopd: string;
  authae: string; aeession: string; aession: string;
  aedate: string; aetime: string; aetype: string;
  refer_no: string; refmaession: string; iession: string;
  ucession: string; emession: string; seq: string;
}

export interface AdpRow {
  hcode: string; an: string; dateopd: string; type: string;
  code: string; qty: string; rate: string; seq: string;
  cagcode: string; dose: string; ca_type: string;
  serialno: string; totcopay: string;
  use_status: string; total: string;
}

export interface DrgRow {
  hcode: string; an: string; diagcode: string; drgcode: string;
  rw: string; adjrw: string; error: string; warning: string;
  actlos: string; grouper_version: string;
  cw: string;
}

export interface LvdRow {
  hcode: string; an: string; dateout: string; datein: string;
  qtyday: string;
}

export interface DruRow {
  hcode: string; hn: string; an: string; clinic: string;
  person_id: string; date: string; drugid: string; drugname: string;
  qty: string; unit_price: string; total: string;
  drugplan: string; unit: string; dosage: string; seq: string;
}

/* ------------------------------------------------------------------ */
/*  File map                                                          */
/* ------------------------------------------------------------------ */

export const CLAIM16_FILES = [
  'INS', 'PAT', 'OPD', 'ORF', 'ODX', 'OOP',
  'IPD', 'IRF', 'IDX', 'IOP',
  'CHT', 'CHA', 'AER', 'ADP', 'DRG', 'LVD', 'DRU',
] as const;

export type Claim16FileName = typeof CLAIM16_FILES[number];

export const CLAIM16_LABELS: Record<Claim16FileName, string> = {
  INS: 'สิทธิการรักษา',
  PAT: 'ข้อมูลผู้ป่วย',
  OPD: 'ผู้ป่วยนอก',
  ORF: 'ส่งต่อ OPD',
  ODX: 'วินิจฉัย OPD',
  OOP: 'หัตถการ OPD',
  IPD: 'ผู้ป่วยใน',
  IRF: 'ส่งต่อ IPD',
  IDX: 'วินิจฉัย IPD',
  IOP: 'หัตถการ IPD',
  CHT: 'ค่าใช้จ่าย',
  CHA: 'รายการ Charge',
  AER: 'อุบัติเหตุ/ฉุกเฉิน',
  ADP: 'ค่ายา/เวชภัณฑ์',
  DRG: 'กลุ่มวินิจฉัยโรค',
  LVD: 'วันลากลับบ้าน',
  DRU: 'ข้อมูลยา',
};

/* ------------------------------------------------------------------ */
/*  Validation                                                        */
/* ------------------------------------------------------------------ */

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  file: Claim16FileName;
  row: number;
  field: string;
  severity: ValidationSeverity;
  message: string;
  value?: string;
  /** error code จาก search_c (เช่น "104", "121", "W001") — ดึงจาก [CODE] ใน message ตอน build */
  code?: string;
}

/* ------------------------------------------------------------------ */
/*  Parsed result                                                     */
/* ------------------------------------------------------------------ */

export interface Claim16FileData {
  name: Claim16FileName;
  rows: Record<string, string>[];
  rowCount: number;
}

export interface Claim16Summary {
  opdVisits: number;         // จำนวน visit OPD
  ipdAdmissions: number;     // จำนวน admission IPD
  totalVisits: number;       // OPD + IPD
  totalAmount: number;       // ยอดเงินรวม (จาก CHT.total)
  totalPaid: number;         // ยอดเงินที่จ่าย (จาก CHT.paid)
  importedAt?: string;       // วันที่นำเข้า
}

export interface Claim16Record {
  id: string;
  fileName: string;          // ชื่อโฟลเดอร์/ไฟล์
  hospitalCode: string;
  uploadedAt: string;
  uploadedBy: string;
  files: Claim16FileData[];
  totalRows: number;
  validationIssues: ValidationIssue[];
  isValidated: boolean;
  summary?: Claim16Summary;  // สรุปยอดหลังนำเข้า
}
