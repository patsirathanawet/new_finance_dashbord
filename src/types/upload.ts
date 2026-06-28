export type FundType = 'CIPN_CSMBS' | 'NHSO' | 'SSI' | 'LI' | 'SELF';
export type REPChargeType = 'DRG' | 'FFS' | 'PD';
export type REPResult = 'A' | 'T' | 'C'; // A=ผ่าน, T=รอใบรับรอง, C=ต้องแก้ไข

export interface REPError {
  code: string;
  desc?: string;
}

export interface REPCase {
  pcode: number;          // 0=on time, 1+=late
  tcode: REPResult;
  an: string;
  chargeType: REPChargeType;
  drg?: string;
  rw?: number;
  adjrw?: number;
  ccuf?: number;
  amdrg?: number;
  patientName: string;
  errors: REPError[];
  section: 'CIPN' | 'CSMBS' | 'WAIT';
  sectionNo: number;
  agency: string;
}

export interface REPRecord {
  id: string;               // hospitalCode_batchNo (unique key)
  hospitalCode: string;
  hospitalName: string;
  batchNo: string;
  refNo: string;
  issueDate: string;
  totalSubmitted: number;
  totalPassed: number;
  totalFailed: number;
  totalAmount: number;
  passedAmount: number;     // ยอดที่ผ่าน — sum(ชดเชย) ของ row ที่ผ่าน
  failedAmount: number;     // ยอดที่ไม่ผ่าน — sum(เรียกเก็บ) ของ row ที่ไม่ผ่าน
  amountRoom: number;
  amountTreatment: number;
  cases: REPCase[];
  /** raw detail rows สำหรับ insert ลง rep_detail (keys = column ตาม schema) */
  detailRows?: Record<string, unknown>[];
  batchRefs: string[];
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
  fundType: FundType;
}

export type STMType = 'BMT' | 'GC' | 'ECT' | 'GCK' | 'GCP' | 'FRD' | 'GSKST' | 'OTHER';

export interface STMCase {
  seq: number;
  patientName: string;
  admitDate?: string;
  dischargeDate?: string;
  totalAmount: number;
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
  isPass?: boolean;
}

export interface STMRecord {
  id: string;               // hospitalCode_docNo (unique key)
  hospitalCode: string;
  hospitalName: string;
  docNo: string;
  period?: string;          // "202403"
  stmType: STMType;
  issueDate?: string;
  totalCases: number;
  totalAmount: number;
  passedCases?: number;
  failedCases?: number;
  cases: STMCase[];
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
  fundType: FundType;
}

/** เอกสารตอบรับ ข้อมูลเบิกค่ารักษาพยาบาลผู้ป่วยนอกสิทธิประกันสังคม (สปส.) — ไฟล์ SOCDBMN/SOCDDMN .BIL ใน .ZIP */
export interface SsopDrugItem {
  checkCodes: string[];
  hospDrgId: string | null;
  prdCat: string | null;
  dfsText: string | null;
  quantity: number | null;
  unitPrice: number | null;
  chargeAmt: number | null;
  reimbAmt: number | null;
  drgId: string | null;
  claimCont: string | null;
}

export interface SsopPrescription {
  repline: number;
  checkCodes: string[];
  invoiceNo: string;
  dispenseId: string;
  pid: string;
  itemCount: number;
  chargeAmount: number;
  claimAmount: number;
  paid: number;
  otherAmount: number;
  items: SsopDrugItem[];
}

export interface SsopRepClaimLine {
  lineNo: number;
  status: 'passed' | 'failed';
  station: string | null;
  hcode: string;
  hmain: string;
  authCode: string;
  dtTran: string | null;       // ISO datetime
  invNo: string;
  pid: string;
  bp: string | null;
  amount: number;
  claimAmt: number;
  checkCodes: string[];
  /** รายละเอียดใบสั่งยา/รายการยาที่ตรวจไม่ผ่าน จากไฟล์ DMN ที่จับคู่ด้วย invNo */
  drugDetail: SsopPrescription[];
}

export interface SsopRepRecord {
  id: string;               // ackNo (unique key — PK ของ ssop_rep_head)
  ackNo: string;
  docType: string;
  hospitalCode: string;
  mainHospitalCode: string;
  mainHospitalName: string | null;
  batchRef: string;
  station: string | null;
  ackAt: string | null;     // ISO datetime
  totalSubmitted: number;
  totalPassed: number;
  totalFailed: number;
  claimLines: SsopRepClaimLine[];
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
}

export type UploadFileType = 'REP' | 'STM';

export interface UploadHistoryItem {
  id: string;
  fileName: string;
  fileType: UploadFileType;
  hospitalCode: string;
  uploadedAt: string;
  uploadedBy: string;
  status: 'success' | 'error';
  errorMessage?: string;
}
