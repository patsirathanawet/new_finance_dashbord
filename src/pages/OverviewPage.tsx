import { useMemo } from 'react';
import { Users, DollarSign, TrendingUp, Activity } from 'lucide-react';
import KPICard from '../components/ui/KPICard';
import BarChartComponent from '../components/charts/BarChartComponent';
import PieChartComponent from '../components/charts/PieChartComponent';
import ExportButton from '../components/ui/ExportButton';
import { useSQL, useSQLFirst, useTableExists } from '../hooks/useSQL';
import { useDateFilter } from '../hooks/useDateFilter';
import { useDialect } from '../hooks/useDialect';
import { buildOverviewQuery, buildMonthlyTrendQuery } from '../queries/finance';
import { buildTotalBedsQuery, buildOccupiedBedsQuery } from '../queries/bed';
import { formatCurrency, formatNumber, formatPercent } from '../lib/formatUtils';

interface OverviewRow { pttype: string; pttype_name: string | null; visit_count: string; total_amount: string }
interface BedsRow { total_beds: string }
interface OccupiedRow { occupied_beds: string }
interface TrendRow { month: string; visit_count: string; total_amount: string }

const PTTYPE_LABELS: Record<string, string> = {
  UC: 'สปสช. (UC)',
  UCS: 'สปสช. (UCS)',
  WEL: 'สปสช. (WEL)',
  OFC: 'ข้าราชการ',
  SSI: 'ประกันสังคม',
  LI: 'ประกันชีวิต',
  A: 'ชำระเอง',
};

const PTTYPE_COLORS: Record<string, string> = {
  UC: '#10b981', UCS: '#34d399', WEL: '#6ee7b7',
  OFC: '#3b82f6', SSI: '#8b5cf6', LI: '#ec4899', A: '#f59e0b',
};

/** แสดงในรูป "OFC : ข้าราชการ" — ดึง name จาก pttype table ก่อน, fallback ไปที่ PTTYPE_LABELS */
function formatPttypeWithName(row: { pttype: string; pttype_name: string | null }): string {
  if (row.pttype_name) return `${row.pttype} : ${row.pttype_name}`;
  const label = PTTYPE_LABELS[row.pttype];
  return label ? `${row.pttype} : ${label}` : row.pttype;
}

function formatMonthLabel(month: string): string {
  if (!month) return '';
  const [year, m] = month.split('-');
  const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const beYear = (parseInt(year) + 543).toString().slice(2);
  return `${monthNames[parseInt(m) - 1]} ${beYear}`;
}

// รวม hipdata_code มาตรฐานทุกตัวที่อาจพบใน pttype
// UC/UCS/WEL = สปสช. | OFC/LGO = ข้าราชการ | SSI/SSS = ประกันสังคม
// LI = ประกันชีวิต | A = ชำระเอง | CHS/BKK/BMT/OTH = สิทธิอื่นๆ
const ALL_FUNDS = 'UC,UCS,WEL,OFC,LGO,SSI,SSS,LI,A,CHS,BKK,BMT,OTH';

export default function OverviewPage() {
  const { startDateSQL, endDateSQL } = useDateFilter();
  const dialect = useDialect();
  const hasWard = useTableExists('ward');
  const hasAnStat = useTableExists('an_stat');

  const overviewQ = buildOverviewQuery(startDateSQL, endDateSQL, dialect);
  const trendQ = buildMonthlyTrendQuery(ALL_FUNDS, startDateSQL, endDateSQL, dialect);
  const bedsQ = buildTotalBedsQuery();
  const occupiedQ = buildOccupiedBedsQuery();

  const { data: overviewData, isLoading: overviewLoading, error: overviewError } =
    useSQL<OverviewRow>(['overview', 'fund', startDateSQL, endDateSQL], overviewQ);

  const { data: trendData, isLoading: trendLoading } =
    useSQL<TrendRow>(['overview', 'trend', startDateSQL, endDateSQL], trendQ);

  const { data: bedsData } =
    useSQLFirst<BedsRow>(['beds', 'total'], bedsQ, { enabled: hasWard });

  const { data: occupiedData } =
    useSQLFirst<OccupiedRow>(['beds', 'occupied'], occupiedQ, { enabled: hasAnStat });

  const totalVisits = useMemo(
    () => (overviewData ?? []).reduce((s, r) => s + Number(r.visit_count), 0),
    [overviewData]
  );
  const totalAmount = useMemo(
    () => (overviewData ?? []).reduce((s, r) => s + Number(r.total_amount), 0),
    [overviewData]
  );

  const totalBeds = Number(bedsData?.total_beds ?? 0);
  const occupiedBeds = Number(occupiedData?.occupied_beds ?? 0);
  const occupancyRate = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;

  const pieData = useMemo(
    () =>
      (overviewData ?? [])
        .map((r) => ({
          name: formatPttypeWithName(r),    // ชื่สิทธิการรักษาเต็ม e.g. "OFC : ข้าราชการ"
          value: Number(r.total_amount),
          color: PTTYPE_COLORS[r.pttype],
        }))
        .sort((a, b) => b.value - a.value),   // เรียงมาก→น้อย ตามยอดเงิน
    [overviewData]
  );

  const chartData = useMemo(
    () =>
      (trendData ?? []).map((row) => ({
        ...row,
        total_amount: Number(row.total_amount),
        visit_count: Number(row.visit_count),
      })),
    [trendData]
  );

  const exportData = useMemo(
    () =>
      (overviewData ?? []).map((r) => ({
        กองทุน: formatPttypeWithName(r),
        'จำนวน Visit': r.visit_count,
        'มูลค่ารวม (บาท)': r.total_amount,
      })) as Record<string, unknown>[],
    [overviewData]
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">สรุปภาพรวม</h2>
          <p className="text-sm text-gray-500 mt-0.5">ข้อมูลการเงินรวมทุกกองทุน</p>
        </div>
        <ExportButton data={exportData} filename={`overview-${startDateSQL}-${endDateSQL}`} />
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          title="Visit ทั้งหมด"
          value={formatNumber(totalVisits)}
          icon={Users}
          iconColor="text-primary-600"
          iconBg="bg-primary-50"
          subtitle="รายการ"
          loading={overviewLoading}
          error={overviewError}
        />
        <KPICard
          title="รายได้ทั้งหมด"
          value={formatCurrency(totalAmount)}
          icon={DollarSign}
          iconColor="text-green-600"
          iconBg="bg-green-50"
          subtitle="บาท"
          loading={overviewLoading}
          error={overviewError}
        />
        <KPICard
          title="เตียงทั้งหมด"
          value={`${formatNumber(occupiedBeds)} / ${formatNumber(totalBeds)}`}
          icon={Activity}
          iconColor="text-purple-600"
          iconBg="bg-purple-50"
          subtitle={`อัตราครอบครอง ${formatPercent(occupancyRate)}`}
        />
        <KPICard
          title="กองทุนที่มีข้อมูล"
          value={formatNumber((overviewData ?? []).length)}
          icon={TrendingUp}
          iconColor="text-orange-600"
          iconBg="bg-orange-50"
          subtitle="กองทุน"
          loading={overviewLoading}
          error={overviewError}
        />
      </div>

      {/* Trend chart */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">แนวโน้มรายเดือน (รวมทุกกองทุน)</h3>
          {trendLoading && (
            <div className="w-4 h-4 border-2 border-primary-200 border-t-blue-600 rounded-full animate-spin" />
          )}
        </div>
        <BarChartComponent
          data={chartData}
          xAxisKey="month"
          xAxisFormatter={formatMonthLabel}
          bars={[
            {
              dataKey: 'total_amount',
              name: 'มูลค่ารวม (฿)',
              color: '#3b82f6',
              formatter: (v) => formatCurrency(v),
            },
          ]}
          yAxisFormatter={(v) => formatCurrency(v).replace('฿', '')}
          height={240}
          isLoading={trendLoading}
          error={overviewError}
        />
      </div>

      {/* Fund breakdown pie — Full width */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">สัดส่วนรายได้ตามสิทธิการรักษา</h3>
        <PieChartComponent
          data={pieData}
          formatter={(v) => formatCurrency(v)}
          height={380}
          innerRadius={50}
          outerRadius={120}
          showLegend={false}
          isLoading={overviewLoading}
          error={overviewError}
        />
      </div>

      {/* Fund breakdown table — HIDDEN */}
      {/* 
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">สรุปตามกองทุน</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">กองทุน</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">จำนวน Visit</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">มูลค่ารวม</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">สัดส่วน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(overviewData ?? []).map((row) => (
                <tr key={row.pttype} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: PTTYPE_COLORS[row.pttype] || '#94a3b8' }}
                      />
                      <span className="font-medium text-gray-900">{formatPttypeWithName(row)}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-gray-700">
                    {formatNumber(row.visit_count)}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold text-gray-900">
                    {formatCurrency(row.total_amount)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className="text-xs font-medium text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full">
                      {formatPercent(totalAmount > 0 ? (Number(row.total_amount) / totalAmount) * 100 : 0)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-primary-50 border-t-2 border-primary-200">
              <tr>
                <td className="px-5 py-3 font-bold text-gray-900">รวมทั้งหมด</td>
                <td className="px-5 py-3 text-right font-bold text-gray-900">{formatNumber(totalVisits)}</td>
                <td className="px-5 py-3 text-right font-bold text-primary-700">{formatCurrency(totalAmount)}</td>
                <td className="px-5 py-3 text-right font-bold text-gray-900">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      */}
    </div>
  );
}
