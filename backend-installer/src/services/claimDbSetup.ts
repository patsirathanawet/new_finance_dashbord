/**
 * Create rep_head + rep_detail tables in TARGET database (claim DB).
 *
 *   rep_head   — สรุปต่องวด (PK = rep_no)
 *                ส่งทั้งหมด / ผ่าน / ไม่ผ่าน / ยอดเงินผ่าน / ยอดเงินไม่ผ่าน / ยอดรวม
 *   rep_detail — ทุก column จาก Detail sheet ของไฟล์ REP (59 fields)
 *
 * Idempotent — รันซ้ำได้ (ใช้ IF NOT EXISTS).
 */
import { runQuery, type DbType } from './hosxpPool.js';
import type { Pool as PgPool } from 'pg';
import type { Pool as MySqlPool } from 'mysql2/promise';

type CachedPool = { type: DbType; pool: PgPool | MySqlPool };

/* --------------------------- PostgreSQL DDL --------------------------- */

const PG_DDL_HEAD = `
CREATE TABLE IF NOT EXISTS rep_head (
  rep_no            VARCHAR(50) PRIMARY KEY,
  hospital_code     VARCHAR(10),
  invoice_doc       VARCHAR(200),
  issued_at         VARCHAR(50),
  total_submitted   INT NOT NULL DEFAULT 0,
  total_passed      INT NOT NULL DEFAULT 0,
  total_failed      INT NOT NULL DEFAULT 0,
  passed_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  failed_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rep_head_hospital ON rep_head(hospital_code);
`;

const PG_DDL_DETAIL = `
CREATE TABLE IF NOT EXISTS rep_detail (
  id                BIGSERIAL PRIMARY KEY,
  rep_no            VARCHAR(50) NOT NULL,    -- คอลัมน์ REP (PK ของ rep_head)
  seq_no            INT,                     -- ลำดับที่
  tran_id           VARCHAR(50),
  hn                VARCHAR(30),
  an                VARCHAR(30),
  pid               VARCHAR(30),
  patient_name      VARCHAR(200),            -- ชื่อ - สกุล
  patient_type      VARCHAR(10),             -- ประเภทผู้ป่วย (OP/IP)
  admit_date        VARCHAR(30),             -- วันเข้ารักษา
  discharge_date    VARCHAR(30),             -- วันจำหน่าย
  comp_amount       NUMERIC(15,2),           -- ชดเชยสุทธิ ค่ารักษา
  comp_pp           NUMERIC(15,2),           -- ชดเชยสุทธิ PP (รับจาก สปสช.)
  error_code        VARCHAR(200),            -- Error Code
  fund              VARCHAR(100),            -- กองทุน
  service_type      VARCHAR(50),             -- ประเภทบริการ
  referral          VARCHAR(20),             -- การรับส่งต่อ
  eligibility       VARCHAR(20),             -- การมีสิทธิ
  right_use         VARCHAR(20),             -- การใช้สิทธิ
  right_primary     VARCHAR(50),             -- สิทธิหลัก
  right_secondary   VARCHAR(50),             -- สิทธิรอง
  href              VARCHAR(20),             -- HREF
  hcode             VARCHAR(20),             -- HCODE
  prov1             VARCHAR(20),             -- PROV1
  agency_code       VARCHAR(50),             -- รหัสหน่วยงาน
  agency_name       VARCHAR(200),            -- ชื่อหน่วยงาน
  proj              VARCHAR(50),             -- PROJ
  pa                VARCHAR(50),             -- PA
  drg               VARCHAR(20),             -- DRG
  rw                NUMERIC(10,4),           -- RW
  charge_amount     NUMERIC(15,2),           -- เรียกเก็บ ค่ารักษา
  charge_pp         NUMERIC(15,2),           -- เรียกเก็บ PP
  claimable         NUMERIC(15,2),           -- เบิกได้
  non_claimable     NUMERIC(15,2),           -- เบิกไม่ได้
  self_pay          NUMERIC(15,2),           -- ชำระเอง
  pay_rate          VARCHAR(20),             -- อัตราจ่าย
  late_ps           VARCHAR(20),             -- ล่าช้า (PS)
  late_ps_pct       VARCHAR(20),             -- ล่าช้า (PS) เปอร์เซ็นต์
  ccuf              VARCHAR(20),             -- CCUF
  adj_rw            NUMERIC(10,4),           -- AdjRW
  prb               NUMERIC(15,2),           -- พรบ.
  case_ipcs         NUMERIC(15,2),           -- กรณี IPCS
  case_ipcs_ors     NUMERIC(15,2),           -- กรณี IPCS_ORS
  case_opcs         NUMERIC(15,2),           -- กรณี OPCS
  case_pacs         NUMERIC(15,2),           -- กรณี PACS
  case_instcs       NUMERIC(15,2),           -- กรณี INSTCS
  case_otcs         NUMERIC(15,2),           -- กรณี OTCS
  case_pp           NUMERIC(15,2),           -- กรณี PP
  case_drug         NUMERIC(15,2),           -- กรณี DRUG
  deny_ipcs         VARCHAR(20),             -- Deny IPCS
  deny_opcs         VARCHAR(20),             -- Deny OPCS
  deny_pacs         VARCHAR(20),             -- Deny PACS
  deny_instcs       VARCHAR(20),             -- Deny INSTCS
  deny_otcs         VARCHAR(20),             -- Deny OTCS
  ors               VARCHAR(20),             -- ORS
  va                VARCHAR(20),             -- VA
  audit_results     VARCHAR(500),            -- AUDIT RESULTS
  seq_no_full       VARCHAR(50),             -- SEQ NO
  invoice_no        VARCHAR(100),            -- INVOICE NO
  invoice_lt        VARCHAR(100),            -- INVOICE LT
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rep_detail_rep_no ON rep_detail(rep_no);
CREATE INDEX IF NOT EXISTS idx_rep_detail_an ON rep_detail(an);
CREATE INDEX IF NOT EXISTS idx_rep_detail_hn ON rep_detail(hn);
`;

const PG_DDL_ECLAIM_ERROR = `
CREATE TABLE IF NOT EXISTS eclaim_error (
  code         VARCHAR(20) PRIMARY KEY,
  description  TEXT,
  resolution   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

/* ------------------------------ MySQL DDL ----------------------------- */

const MYSQL_DDL_HEAD = `
CREATE TABLE IF NOT EXISTS rep_head (
  rep_no            VARCHAR(50) PRIMARY KEY,
  hospital_code     VARCHAR(10),
  invoice_doc       VARCHAR(200),
  issued_at         VARCHAR(50),
  total_submitted   INT NOT NULL DEFAULT 0,
  total_passed      INT NOT NULL DEFAULT 0,
  total_failed      INT NOT NULL DEFAULT 0,
  passed_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  failed_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_amount      DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_rep_head_hospital (hospital_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const MYSQL_DDL_DETAIL = `
CREATE TABLE IF NOT EXISTS rep_detail (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  rep_no            VARCHAR(50) NOT NULL,
  seq_no            INT,
  tran_id           VARCHAR(50),
  hn                VARCHAR(30),
  an                VARCHAR(30),
  pid               VARCHAR(30),
  patient_name      VARCHAR(200),
  patient_type      VARCHAR(10),
  admit_date        VARCHAR(30),
  discharge_date    VARCHAR(30),
  comp_amount       DECIMAL(15,2),
  comp_pp           DECIMAL(15,2),
  error_code        VARCHAR(200),
  fund              VARCHAR(100),
  service_type      VARCHAR(50),
  referral          VARCHAR(20),
  eligibility       VARCHAR(20),
  right_use         VARCHAR(20),
  right_primary     VARCHAR(50),
  right_secondary   VARCHAR(50),
  href              VARCHAR(20),
  hcode             VARCHAR(20),
  prov1             VARCHAR(20),
  agency_code       VARCHAR(50),
  agency_name       VARCHAR(200),
  proj              VARCHAR(50),
  pa                VARCHAR(50),
  drg               VARCHAR(20),
  rw                DECIMAL(10,4),
  charge_amount     DECIMAL(15,2),
  charge_pp         DECIMAL(15,2),
  claimable         DECIMAL(15,2),
  non_claimable     DECIMAL(15,2),
  self_pay          DECIMAL(15,2),
  pay_rate          VARCHAR(20),
  late_ps           VARCHAR(20),
  late_ps_pct       VARCHAR(20),
  ccuf              VARCHAR(20),
  adj_rw            DECIMAL(10,4),
  prb               DECIMAL(15,2),
  case_ipcs         DECIMAL(15,2),
  case_ipcs_ors     DECIMAL(15,2),
  case_opcs         DECIMAL(15,2),
  case_pacs         DECIMAL(15,2),
  case_instcs       DECIMAL(15,2),
  case_otcs         DECIMAL(15,2),
  case_pp           DECIMAL(15,2),
  case_drug         DECIMAL(15,2),
  deny_ipcs         VARCHAR(20),
  deny_opcs         VARCHAR(20),
  deny_pacs         VARCHAR(20),
  deny_instcs       VARCHAR(20),
  deny_otcs         VARCHAR(20),
  ors               VARCHAR(20),
  va                VARCHAR(20),
  audit_results     VARCHAR(500),
  seq_no_full       VARCHAR(50),
  invoice_no        VARCHAR(100),
  invoice_lt        VARCHAR(100),
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rep_detail_rep_no (rep_no),
  INDEX idx_rep_detail_an (an),
  INDEX idx_rep_detail_hn (hn)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const MYSQL_DDL_ECLAIM_ERROR = `
CREATE TABLE IF NOT EXISTS eclaim_error (
  code         VARCHAR(20) PRIMARY KEY,
  description  TEXT,
  resolution   TEXT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

/* ------------------------- SSOP REP DDL (PostgreSQL) ------------------------- */
/*
 * ssop_rep_head/detail — เอกสารตอบรับ ข้อมูลเบิกค่ารักษาพยาบาลผู้ป่วยนอกสิทธิประกันสังคม
 * (ไฟล์ SOCDBMN/SOCDDMN .BIL จาก สปส.) — รูปแบบเดียวกับ rep_head/rep_detail ของ สปสช.
 *
 *   ssop_rep_head   — สรุปต่อเลขที่ตอบรับ (PK = ack_no)
 *   ssop_rep_detail — รายการเบิกแต่ละบรรทัด (1 row ต่อ claim line จากไฟล์ BMN)
 *                     คอลัมน์ตรงกับ "รูปแบบรายการ" ที่ระบุไว้ในไฟล์ BMN เป๊ะ:
 *                     *| Stat, Station, Line No, Hcode, Hmain, AuthCode, DTTran, InvNo, Pid, BP, Amount, Claimamt | CheckCode
 *
 *                     drug_detail (JSON) เก็บรายละเอียดใบสั่งยา/รายการยาที่ตรวจไม่ผ่าน จากไฟล์ DMN
 *                     คู่กัน — รูปแบบ field ตามที่ระบุไว้ในไฟล์ DMN เอง (Version SSOP-6020):
 *                       บรรทัด "*|" (ใบสั่งยา/Dispensing):
 *                         repline | checkcode,...--- | invoice no. | Dispense Id | PID
 *                         | Item count | charge amount | claim amount | paid | other amount
 *                       บรรทัด "=|" (รายการยา/DispensedItem):
 *                         checkcode,...--- | Hospdrgid | PrdCat | DFSText | Quantity
 *                         | unitprice | chargeamt | reimbamt | drgid | claimcont
 *                     ตัวอย่าง drug_detail ที่ parser ควรเก็บ (array ของใบสั่งยา แต่ละใบมี items[]):
 *                       [{ repline, checkCodes, invoiceNo, dispenseId, pid, itemCount,
 *                          chargeAmount, claimAmount, paid, otherAmount,
 *                          items: [{ checkCodes, hospDrgId, prdCat, dfsText, quantity,
 *                                    unitPrice, chargeAmt, reimbAmt, drgId, claimCont }] }]
 */

const PG_DDL_SSOP_REP_HEAD = `
CREATE TABLE IF NOT EXISTS ssop_rep_head (
  ack_no             VARCHAR(50) PRIMARY KEY,
  doc_type           VARCHAR(20) NOT NULL DEFAULT 'OPD_BILL',
  hospital_code      VARCHAR(10),
  main_hospital_code VARCHAR(10),
  main_hospital_name VARCHAR(200),
  batch_ref          VARCHAR(100),
  station            VARCHAR(10),
  ack_at             TIMESTAMPTZ,
  total_submitted    INT NOT NULL DEFAULT 0,
  total_passed       INT NOT NULL DEFAULT 0,
  total_failed       INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ssop_rep_head_hospital ON ssop_rep_head(hospital_code);
`;

const PG_DDL_SSOP_REP_DETAIL = `
CREATE TABLE IF NOT EXISTS ssop_rep_detail (
  id           BIGSERIAL PRIMARY KEY,
  ack_no       VARCHAR(50) NOT NULL,    -- คอลัมน์ FK ของ ssop_rep_head
  line_no      INT,                     -- ลำดับที่
  status       VARCHAR(10),             -- passed / failed (จาก A / C)
  station      VARCHAR(10),
  hcode        VARCHAR(20),             -- สถานพยาบาลผู้รักษา
  hmain        VARCHAR(20),             -- รพ.หลัก (ผู้ส่งข้อมูล)
  auth_code    VARCHAR(50),
  dt_tran      TIMESTAMPTZ,
  inv_no       VARCHAR(100),
  pid          VARCHAR(30),
  bp           VARCHAR(5),              -- BenefitPackage: S/P/N/-
  amount       NUMERIC(15,2),
  claim_amt    NUMERIC(15,2),
  check_codes  VARCHAR(200),            -- เช่น R61,T61,W07
  drug_detail  JSONB,                   -- รายละเอียดใบสั่งยา/รายการยาที่ตรวจไม่ผ่าน
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ssop_rep_detail_ack_no ON ssop_rep_detail(ack_no);
CREATE INDEX IF NOT EXISTS idx_ssop_rep_detail_inv_no ON ssop_rep_detail(inv_no);
CREATE INDEX IF NOT EXISTS idx_ssop_rep_detail_pid ON ssop_rep_detail(pid);
`;

/* --------------------------- SSOP REP DDL (MySQL) --------------------------- */

const MYSQL_DDL_SSOP_REP_HEAD = `
CREATE TABLE IF NOT EXISTS ssop_rep_head (
  ack_no             VARCHAR(50) PRIMARY KEY,
  doc_type           VARCHAR(20) NOT NULL DEFAULT 'OPD_BILL',
  hospital_code      VARCHAR(10),
  main_hospital_code VARCHAR(10),
  main_hospital_name VARCHAR(200),
  batch_ref          VARCHAR(100),
  station            VARCHAR(10),
  ack_at             DATETIME,
  total_submitted    INT NOT NULL DEFAULT 0,
  total_passed       INT NOT NULL DEFAULT 0,
  total_failed       INT NOT NULL DEFAULT 0,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ssop_rep_head_hospital (hospital_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const MYSQL_DDL_SSOP_REP_DETAIL = `
CREATE TABLE IF NOT EXISTS ssop_rep_detail (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  ack_no       VARCHAR(50) NOT NULL,
  line_no      INT,
  status       VARCHAR(10),
  station      VARCHAR(10),
  hcode        VARCHAR(20),
  hmain        VARCHAR(20),
  auth_code    VARCHAR(50),
  dt_tran      DATETIME,
  inv_no       VARCHAR(100),
  pid          VARCHAR(30),
  bp           VARCHAR(5),
  amount       DECIMAL(15,2),
  claim_amt    DECIMAL(15,2),
  check_codes  VARCHAR(200),
  drug_detail  JSON,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ssop_rep_detail_ack_no (ack_no),
  INDEX idx_ssop_rep_detail_inv_no (inv_no),
  INDEX idx_ssop_rep_detail_pid (pid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export interface ClaimTablesResult {
  ok: boolean;
  created: string[];
  error?: string;
}

export const CLAIM_TABLES = ['rep_head', 'rep_detail', 'eclaim_error'] as const;
export type ClaimTableName = (typeof CLAIM_TABLES)[number];

/** Split SQL script เป็น statements โดยใช้ `;` คั่น — ข้าม blank lines + comment-only */
function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.split('\n').every((line) => line.trim() === '' || line.trim().startsWith('--')));
}

/** สร้าง rep_head + rep_detail + eclaim_error ในฐานข้อมูลปลายทาง — idempotent
 *  Note: รัน statement ทีละตัว (pg driver คืนค่าผิด shape ถ้า multi-statement)
 */
export async function createClaimTables(cached: CachedPool): Promise<ClaimTablesResult> {
  const created: string[] = [];
  try {
    const [headDdl, detailDdl, errorDdl] = cached.type === 'postgresql'
      ? [PG_DDL_HEAD, PG_DDL_DETAIL, PG_DDL_ECLAIM_ERROR]
      : [MYSQL_DDL_HEAD, MYSQL_DDL_DETAIL, MYSQL_DDL_ECLAIM_ERROR];

    for (const stmt of splitStatements(headDdl)) {
      await runQuery(cached, stmt);
    }
    created.push('rep_head');

    for (const stmt of splitStatements(detailDdl)) {
      await runQuery(cached, stmt);
    }
    created.push('rep_detail');

    for (const stmt of splitStatements(errorDdl)) {
      await runQuery(cached, stmt);
    }
    created.push('eclaim_error');

    return { ok: true, created };
  } catch (err) {
    return {
      ok: false,
      created,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** ตรวจว่า rep_head + rep_detail + eclaim_error มีอยู่ใน target DB หรือไม่ */
export async function checkClaimTables(cached: CachedPool): Promise<Record<ClaimTableName, boolean>> {
  const result: Record<ClaimTableName, boolean> = { rep_head: false, rep_detail: false, eclaim_error: false };
  for (const t of CLAIM_TABLES) {
    try {
      const sql = cached.type === 'postgresql'
        ? `SELECT 1 FROM information_schema.tables WHERE table_name = '${t}' LIMIT 1`
        : `SELECT 1 FROM information_schema.tables WHERE table_name = '${t}' AND table_schema = DATABASE() LIMIT 1`;
      const r = await runQuery(cached, sql);
      result[t] = r.rows.length > 0;
    } catch { /* ignore */ }
  }
  return result;
}

export const SSOP_REP_TABLES = ['ssop_rep_head', 'ssop_rep_detail'] as const;
export type SsopRepTableName = (typeof SSOP_REP_TABLES)[number];

/** สร้าง ssop_rep_head + ssop_rep_detail ในฐานข้อมูลปลายทาง — idempotent */
export async function createSsopRepTables(cached: CachedPool): Promise<ClaimTablesResult> {
  const created: string[] = [];
  try {
    const [headDdl, detailDdl] = cached.type === 'postgresql'
      ? [PG_DDL_SSOP_REP_HEAD, PG_DDL_SSOP_REP_DETAIL]
      : [MYSQL_DDL_SSOP_REP_HEAD, MYSQL_DDL_SSOP_REP_DETAIL];

    for (const stmt of splitStatements(headDdl)) {
      await runQuery(cached, stmt);
    }
    created.push('ssop_rep_head');

    for (const stmt of splitStatements(detailDdl)) {
      await runQuery(cached, stmt);
    }
    created.push('ssop_rep_detail');

    return { ok: true, created };
  } catch (err) {
    return {
      ok: false,
      created,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** ตรวจว่า ssop_rep_head + ssop_rep_detail มีอยู่ใน target DB หรือไม่ */
export async function checkSsopRepTables(cached: CachedPool): Promise<Record<SsopRepTableName, boolean>> {
  const result: Record<SsopRepTableName, boolean> = { ssop_rep_head: false, ssop_rep_detail: false };
  for (const t of SSOP_REP_TABLES) {
    try {
      const sql = cached.type === 'postgresql'
        ? `SELECT 1 FROM information_schema.tables WHERE table_name = '${t}' LIMIT 1`
        : `SELECT 1 FROM information_schema.tables WHERE table_name = '${t}' AND table_schema = DATABASE() LIMIT 1`;
      const r = await runQuery(cached, sql);
      result[t] = r.rows.length > 0;
    } catch { /* ignore */ }
  }
  return result;
}

/* ========================================================================
 * CSOP — เอกสารตอบรับ ข้อมูลเบิกค่ารักษาพยาบาลผู้ป่วยนอกข้าราชการ (กรมบัญชีกลาง)
 * แทนที่ rep_head/rep_detail/eclaim_error เดิม ด้วยโครงสร้างใหม่ตามไฟล์จริง
 * (COCDBIL = head + claim line, CSOPBITM = รายละเอียด BillItems ที่ไม่ผ่าน,
 *  CSOPREX = รายละเอียดยาที่ไม่ผ่าน — รูปแบบเดียวกับ ssop_rep_detail.drug_detail)
 *
 *   csop_rep_head        — สรุปต่อเลขที่ตอบรับ (PK = ack_no)
 *   csop_rep_head_detail — รายการเบิกแต่ละบรรทัด (1 row ต่อ claim line จากไฟล์ COCDBIL)
 *                          คอลัมน์ตรงกับ "รูปแบบรายการ" ในไฟล์ COCDBIL เป๊ะ:
 *                          *| Stat, Station, Line, AuthCode, DTTran, InvNo, BillNo, HN, MemberNo, ClaimAmt |CheckCode
 *                          bill_items_detail (JSON) จาก CSOPBITM — โครงสร้างย่อยไม่มีสเปกทางการระบุไว้ในไฟล์
 *                          (อ้างถึง "เอกสารข้อกำหนดฯ CSOP รุ่น 0.93" ภายนอก) จึงเก็บแบบ raw fields ไว้ก่อน
 *                          drug_detail (JSON) จาก CSOPREX — สเปกเดียวกับ ssop_rep_detail.drug_detail
 *   csop_error           — รหัส error ของ CSOP (โครงสร้างเหมือน eclaim_error เดิมทุกอย่าง)
 * ========================================================================= */

const PG_DDL_CSOP_REP_HEAD = `
CREATE TABLE IF NOT EXISTS csop_rep_head (
  ack_no           VARCHAR(50) PRIMARY KEY,
  doc_type         VARCHAR(20) NOT NULL DEFAULT 'OPD_BILL',
  hospital_code    VARCHAR(10),
  batch_ref        TEXT,
  station          VARCHAR(10),
  ack_at           TIMESTAMPTZ,
  total_submitted  INT NOT NULL DEFAULT 0,
  total_passed     INT NOT NULL DEFAULT 0,
  total_failed     INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_csop_rep_head_hospital ON csop_rep_head(hospital_code);
`;

const PG_DDL_CSOP_REP_HEAD_DETAIL = `
CREATE TABLE IF NOT EXISTS csop_rep_head_detail (
  id                BIGSERIAL PRIMARY KEY,
  ack_no            VARCHAR(50) NOT NULL,
  line_no           INT,
  status            VARCHAR(10),             -- passed / failed (จาก A / C)
  station           VARCHAR(10),
  auth_code         VARCHAR(50),
  dt_tran           TIMESTAMPTZ,
  inv_no            VARCHAR(50),
  bill_no           VARCHAR(100),            -- อาจมีหลายค่าคั่นด้วย , ในรายการเดียว (ตามไฟล์จริง)
  hn                VARCHAR(50),
  member_no         VARCHAR(50),
  claim_amt         NUMERIC(15,2),
  check_codes       VARCHAR(200),
  bill_items_detail JSONB,                   -- จาก CSOPBITM (เฉพาะรายการไม่ผ่าน)
  drug_detail       JSONB,                   -- จาก CSOPREX (เฉพาะรายการไม่ผ่าน)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_csop_rep_head_detail_ack_no ON csop_rep_head_detail(ack_no);
CREATE INDEX IF NOT EXISTS idx_csop_rep_head_detail_inv_no ON csop_rep_head_detail(inv_no);
CREATE INDEX IF NOT EXISTS idx_csop_rep_head_detail_hn ON csop_rep_head_detail(hn);
`;

const PG_DDL_CSOP_ERROR = `
CREATE TABLE IF NOT EXISTS csop_error (
  code         VARCHAR(20) PRIMARY KEY,
  description  TEXT,
  resolution   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const MYSQL_DDL_CSOP_REP_HEAD = `
CREATE TABLE IF NOT EXISTS csop_rep_head (
  ack_no           VARCHAR(50) PRIMARY KEY,
  doc_type         VARCHAR(20) NOT NULL DEFAULT 'OPD_BILL',
  hospital_code    VARCHAR(10),
  batch_ref        TEXT,
  station          VARCHAR(10),
  ack_at           DATETIME,
  total_submitted  INT NOT NULL DEFAULT 0,
  total_passed     INT NOT NULL DEFAULT 0,
  total_failed     INT NOT NULL DEFAULT 0,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_csop_rep_head_hospital (hospital_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const MYSQL_DDL_CSOP_REP_HEAD_DETAIL = `
CREATE TABLE IF NOT EXISTS csop_rep_head_detail (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  ack_no            VARCHAR(50) NOT NULL,
  line_no           INT,
  status            VARCHAR(10),
  station           VARCHAR(10),
  auth_code         VARCHAR(50),
  dt_tran           DATETIME,
  inv_no            VARCHAR(50),
  bill_no           VARCHAR(100),
  hn                VARCHAR(50),
  member_no         VARCHAR(50),
  claim_amt         DECIMAL(15,2),
  check_codes       VARCHAR(200),
  bill_items_detail JSON,
  drug_detail       JSON,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_csop_rep_head_detail_ack_no (ack_no),
  INDEX idx_csop_rep_head_detail_inv_no (inv_no),
  INDEX idx_csop_rep_head_detail_hn (hn)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const MYSQL_DDL_CSOP_ERROR = `
CREATE TABLE IF NOT EXISTS csop_error (
  code         VARCHAR(20) PRIMARY KEY,
  description  TEXT,
  resolution   TEXT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const CSOP_TABLES = ['csop_rep_head', 'csop_rep_head_detail', 'csop_error'] as const;
export type CsopTableName = (typeof CSOP_TABLES)[number];

/** สร้าง csop_rep_head + csop_rep_head_detail + csop_error ในฐานข้อมูลปลายทาง — idempotent */
export async function createCsopTables(cached: CachedPool): Promise<ClaimTablesResult> {
  const created: string[] = [];
  try {
    const [headDdl, detailDdl, errorDdl] = cached.type === 'postgresql'
      ? [PG_DDL_CSOP_REP_HEAD, PG_DDL_CSOP_REP_HEAD_DETAIL, PG_DDL_CSOP_ERROR]
      : [MYSQL_DDL_CSOP_REP_HEAD, MYSQL_DDL_CSOP_REP_HEAD_DETAIL, MYSQL_DDL_CSOP_ERROR];

    for (const stmt of splitStatements(headDdl)) {
      await runQuery(cached, stmt);
    }
    created.push('csop_rep_head');

    for (const stmt of splitStatements(detailDdl)) {
      await runQuery(cached, stmt);
    }
    created.push('csop_rep_head_detail');

    for (const stmt of splitStatements(errorDdl)) {
      await runQuery(cached, stmt);
    }
    created.push('csop_error');

    return { ok: true, created };
  } catch (err) {
    return {
      ok: false,
      created,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** ตรวจว่า csop_rep_head + csop_rep_head_detail + csop_error มีอยู่ใน target DB หรือไม่ */
export async function checkCsopTables(cached: CachedPool): Promise<Record<CsopTableName, boolean>> {
  const result: Record<CsopTableName, boolean> = { csop_rep_head: false, csop_rep_head_detail: false, csop_error: false };
  for (const t of CSOP_TABLES) {
    try {
      const sql = cached.type === 'postgresql'
        ? `SELECT 1 FROM information_schema.tables WHERE table_name = '${t}' LIMIT 1`
        : `SELECT 1 FROM information_schema.tables WHERE table_name = '${t}' AND table_schema = DATABASE() LIMIT 1`;
      const r = await runQuery(cached, sql);
      result[t] = r.rows.length > 0;
    } catch { /* ignore */ }
  }
  return result;
}

/* ========================================================================
 * AIPN — เอกสารตอบรับข้อมูลผู้ป่วยใน ประกันสังคม
 * (SIGNREP = head + claim line, SIGNSUP = รายละเอียด Dx/Proc/BillItems)
 *
 *   aipn_rep_head        — สรุปต่อเลขที่ตอบรับ (PK = ack_no)
 *   aipn_rep_head_detail — รายการเบิกแต่ละราย (1 row ต่อ claim line จากไฟล์ SIGNREP)
 *                          คอลัมน์ตรงกับ "รูปแบบรายการ" ในไฟล์ SIGNREP เป๊ะ:
 *                          *| pcode tcode iptype CareAs, SS, HMain, HCare, AN, DRG, rw, adjrw, ST, SST, PT, Amt, name[:err...]
 *                          sub_detail (JSON) จาก SIGNSUP — เก็บ dx[]/proc[]/billItems[] ของ AN เดียวกัน
 * ========================================================================= */

const PG_DDL_AIPN_REP_HEAD = `
CREATE TABLE IF NOT EXISTS aipn_rep_head (
  ack_no           VARCHAR(50) PRIMARY KEY,
  doc_type         VARCHAR(20) NOT NULL DEFAULT 'IPD_BILL',
  hospital_code    VARCHAR(10),
  batch_no         VARCHAR(20),
  batch_ref        VARCHAR(100),
  ack_at           TIMESTAMPTZ,
  total_submitted  INT NOT NULL DEFAULT 0,
  total_passed     INT NOT NULL DEFAULT 0,
  total_failed     INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aipn_rep_head_hospital ON aipn_rep_head(hospital_code);
`;

const PG_DDL_AIPN_REP_HEAD_DETAIL = `
CREATE TABLE IF NOT EXISTS aipn_rep_head_detail (
  id              BIGSERIAL PRIMARY KEY,
  ack_no          VARCHAR(50) NOT NULL,
  line_no         INT,
  status          VARCHAR(10),       -- passed / failed (จาก A / C)
  pcode           VARCHAR(5),
  iptype          VARCHAR(5),
  care_as         VARCHAR(5),
  ss              VARCHAR(5),
  hmain           VARCHAR(10),
  hcare           VARCHAR(10),
  an              VARCHAR(30),
  drg             VARCHAR(20),
  rw              NUMERIC(10,4),
  adjrw           VARCHAR(30),       -- เก็บ raw เพราะมี format พิเศษ "rw X ccuf" ได้ (กรณี SSO Cancer Care)
  service_type    VARCHAR(20),       -- ST
  service_subtype VARCHAR(20),       -- SST
  pt              VARCHAR(5),
  amount          NUMERIC(15,2),
  patient_name    VARCHAR(200),
  check_codes     VARCHAR(200),
  sub_detail      JSONB,             -- จาก SIGNSUP: dx[]/proc[]/billItems[] ของ AN เดียวกัน
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aipn_rep_head_detail_ack_no ON aipn_rep_head_detail(ack_no);
CREATE INDEX IF NOT EXISTS idx_aipn_rep_head_detail_an ON aipn_rep_head_detail(an);
`;

const MYSQL_DDL_AIPN_REP_HEAD = `
CREATE TABLE IF NOT EXISTS aipn_rep_head (
  ack_no           VARCHAR(50) PRIMARY KEY,
  doc_type         VARCHAR(20) NOT NULL DEFAULT 'IPD_BILL',
  hospital_code    VARCHAR(10),
  batch_no         VARCHAR(20),
  batch_ref        VARCHAR(100),
  ack_at           DATETIME,
  total_submitted  INT NOT NULL DEFAULT 0,
  total_passed     INT NOT NULL DEFAULT 0,
  total_failed     INT NOT NULL DEFAULT 0,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_aipn_rep_head_hospital (hospital_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const MYSQL_DDL_AIPN_REP_HEAD_DETAIL = `
CREATE TABLE IF NOT EXISTS aipn_rep_head_detail (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  ack_no          VARCHAR(50) NOT NULL,
  line_no         INT,
  status          VARCHAR(10),
  pcode           VARCHAR(5),
  iptype          VARCHAR(5),
  care_as         VARCHAR(5),
  ss              VARCHAR(5),
  hmain           VARCHAR(10),
  hcare           VARCHAR(10),
  an              VARCHAR(30),
  drg             VARCHAR(20),
  rw              DECIMAL(10,4),
  adjrw           VARCHAR(30),
  service_type    VARCHAR(20),
  service_subtype VARCHAR(20),
  pt              VARCHAR(5),
  amount          DECIMAL(15,2),
  patient_name    VARCHAR(200),
  check_codes     VARCHAR(200),
  sub_detail      JSON,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_aipn_rep_head_detail_ack_no (ack_no),
  INDEX idx_aipn_rep_head_detail_an (an)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const AIPN_TABLES = ['aipn_rep_head', 'aipn_rep_head_detail'] as const;
export type AipnTableName = (typeof AIPN_TABLES)[number];

/** สร้าง aipn_rep_head + aipn_rep_head_detail ในฐานข้อมูลปลายทาง — idempotent */
export async function createAipnTables(cached: CachedPool): Promise<ClaimTablesResult> {
  const created: string[] = [];
  try {
    const [headDdl, detailDdl] = cached.type === 'postgresql'
      ? [PG_DDL_AIPN_REP_HEAD, PG_DDL_AIPN_REP_HEAD_DETAIL]
      : [MYSQL_DDL_AIPN_REP_HEAD, MYSQL_DDL_AIPN_REP_HEAD_DETAIL];

    for (const stmt of splitStatements(headDdl)) {
      await runQuery(cached, stmt);
    }
    created.push('aipn_rep_head');

    for (const stmt of splitStatements(detailDdl)) {
      await runQuery(cached, stmt);
    }
    created.push('aipn_rep_head_detail');

    return { ok: true, created };
  } catch (err) {
    return {
      ok: false,
      created,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** ตรวจว่า aipn_rep_head + aipn_rep_head_detail มีอยู่ใน target DB หรือไม่ */
export async function checkAipnTables(cached: CachedPool): Promise<Record<AipnTableName, boolean>> {
  const result: Record<AipnTableName, boolean> = { aipn_rep_head: false, aipn_rep_head_detail: false };
  for (const t of AIPN_TABLES) {
    try {
      const sql = cached.type === 'postgresql'
        ? `SELECT 1 FROM information_schema.tables WHERE table_name = '${t}' LIMIT 1`
        : `SELECT 1 FROM information_schema.tables WHERE table_name = '${t}' AND table_schema = DATABASE() LIMIT 1`;
      const r = await runQuery(cached, sql);
      result[t] = r.rows.length > 0;
    } catch { /* ignore */ }
  }
  return result;
}
