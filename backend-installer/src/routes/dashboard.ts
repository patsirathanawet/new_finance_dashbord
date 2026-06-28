import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

/** แปลง YYYYMMDD หรือ YYYY-MM-DD → "YYYY-MM" (เดือน) */
function parseMonth(d: string | undefined | null): string | null {
  if (!d) return null;
  const cleaned = String(d).replace(/-/g, '');
  if (cleaned.length < 6) return null;
  const y = cleaned.slice(0, 4);
  const m = cleaned.slice(4, 6);
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m)) return null;
  const ym = parseInt(m, 10);
  if (ym < 1 || ym > 12) return null;
  return `${y}-${m}`;
}

interface MonthStat {
  opdVisits: number;
  ipdAdmissions: number;
  totalAmount: number;
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /**
   * GET /api/dashboard/summary
   * สรุปยอด 16 แฟ้มต่อ รพ. — ใช้ view v_claim16_summary_by_hospital
   * Non-admin → เห็นเฉพาะของ รพ. ตัวเอง
   */
  app.get('/dashboard/summary', async (request) => {
    const auth = request.auth!;

    type Row = {
      hospital_id: string;
      hospital_code: string;
      hospital_name: string;
      record_count: bigint;
      total_opd_visits: bigint;
      total_ipd_admissions: bigint;
      total_visits: bigint;
      total_amount: string;
      total_paid: string;
      last_imported_at: Date | null;
    };

    const rows = auth.role === 'admin'
      ? await prisma.$queryRaw<Row[]>`SELECT * FROM v_claim16_summary_by_hospital ORDER BY hospital_code`
      : await prisma.$queryRaw<Row[]>`SELECT * FROM v_claim16_summary_by_hospital WHERE hospital_code = ${auth.hospitalCode}`;

    // Convert BigInt → number, NUMERIC → number for JSON
    return rows.map((r: Row) => ({
      hospitalId: r.hospital_id,
      hospitalCode: r.hospital_code,
      hospitalName: r.hospital_name,
      recordCount: Number(r.record_count),
      totalOpdVisits: Number(r.total_opd_visits),
      totalIpdAdmissions: Number(r.total_ipd_admissions),
      totalVisits: Number(r.total_visits),
      totalAmount: parseFloat(r.total_amount),
      totalPaid: parseFloat(r.total_paid),
      lastImportedAt: r.last_imported_at,
    }));
  });

  /**
   * GET /api/dashboard/claim16-monthly
   * รวมยอด visit/มูลค่า แยกตามเดือน จาก rawData ของ claim16_records ที่ imported แล้ว
   *  - OPD visits จาก OPD.dateopd
   *  - IPD admissions จาก IPD.dateadm
   *  - มูลค่ารวม จาก CHT.total (group by CHT.date)
   */
  app.get('/dashboard/claim16-monthly', async (request) => {
    const auth = request.auth!;

    const where = {
      deletedAt: null,
      importedAt: { not: null },
      ...(auth.role === 'admin' ? {} : { hospitalCode: auth.hospitalCode }),
    };

    const records = await prisma.claim16Record.findMany({
      where,
      select: { rawData: true },
    });

    const months = new Map<string, MonthStat>();
    const ensure = (m: string): MonthStat => {
      let s = months.get(m);
      if (!s) {
        s = { opdVisits: 0, ipdAdmissions: 0, totalAmount: 0 };
        months.set(m, s);
      }
      return s;
    };

    for (const rec of records) {
      const files = (rec.rawData as { files?: Array<{ name: string; rows: Array<Record<string, string>> }> })?.files ?? [];

      const opd = files.find((f) => f.name === 'OPD');
      if (opd) {
        for (const row of opd.rows) {
          const m = parseMonth(row.dateopd);
          if (m) ensure(m).opdVisits++;
        }
      }

      const ipd = files.find((f) => f.name === 'IPD');
      if (ipd) {
        for (const row of ipd.rows) {
          const m = parseMonth(row.dateadm);
          if (m) ensure(m).ipdAdmissions++;
        }
      }

      const cht = files.find((f) => f.name === 'CHT');
      if (cht) {
        for (const row of cht.rows) {
          const m = parseMonth(row.date);
          if (m) ensure(m).totalAmount += parseFloat(row.total) || 0;
        }
      }
    }

    const sorted = Array.from(months.entries()).sort(([a], [b]) => a.localeCompare(b));

    const monthsArr = sorted.map(([month, s]) => ({
      month,
      opdVisits: s.opdVisits,
      ipdAdmissions: s.ipdAdmissions,
      totalVisits: s.opdVisits + s.ipdAdmissions,
      totalAmount: Math.round(s.totalAmount * 100) / 100,
    }));

    const total = monthsArr.reduce(
      (acc, m) => ({
        opdVisits: acc.opdVisits + m.opdVisits,
        ipdAdmissions: acc.ipdAdmissions + m.ipdAdmissions,
        totalVisits: acc.totalVisits + m.totalVisits,
        totalAmount: Math.round((acc.totalAmount + m.totalAmount) * 100) / 100,
      }),
      { opdVisits: 0, ipdAdmissions: 0, totalVisits: 0, totalAmount: 0 },
    );

    return { months: monthsArr, total, recordCount: records.length };
  });
}
