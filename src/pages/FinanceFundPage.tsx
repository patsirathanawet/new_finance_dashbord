import { useMemo } from 'react';
import {
  Users, DollarSign, FileCheck, FileX, TrendingUp, Send, ExternalLink,
} from 'lucide-react';
import KPICard from '../components/ui/KPICard';
import BarChartComponent from '../components/charts/BarChartComponent';
import { LoadingSkeleton } from '../components/ui/LoadingSpinner';
import ExportButton from '../components/ui/ExportButton';
import { useSQL, useSQLFirst, useTableExists } from '../hooks/useSQL';
import { useDateFilter } from '../hooks/useDateFilter';
import { useDialect } from '../hooks/useDialect';
import {
  buildVisitQuery,
  buildClaimsQuery,
  buildApprovedQuery,
  buildDeniedQuery,
  buildMonthlyTrendQuery,
} from '../queries/finance';
import { formatCurrency, formatNumber, formatPercent, calculateApprovalRate } from '../lib/formatUtils';

interface VisitRow { total_count: string; total_amount: string }
interface ClaimsRow { claim_count: string; claim_amount: string }
interface ApprovedRow { approve_count: string; approve_amount: string }
interface DeniedRow { deny_count: string; deny_amount: string }
interface TrendRow { month: string; visit_count: string; total_amount: string }

interface FinanceFundPageProps {
  title: string;
  pttype: string;
  nhsoLink?: boolean;
  fundDescription?: string;
}

function formatMonthLabel(month: string): string {
  if (!month) return '';
  const [year, m] = month.split('-');
  const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const beYear = (parseInt(year) + 543).toString().slice(2);
  return `${monthNames[parseInt(m) - 1]} ${beYear}`;
}

export default function FinanceFundPage({
  title,
  pttype,
  nhsoLink = false,
  fundDescription,
}: FinanceFundPageProps) {
  const { startDateSQL, endDateSQL } = useDateFilter();
  const dialect = useDialect();
  const hasOvstBilling = useTableExists('ovst_billing');
  const hasReimbursement = useTableExists('reimbursement');

  const visitQ = buildVisitQuery(pttype, startDateSQL, endDateSQL, dialect);
  const claimsQ = buildClaimsQuery(pttype, startDateSQL, endDateSQL, dialect);
  const approvedQ = buildApprovedQuery(pttype, startDateSQL, endDateSQL, dialect);
  const deniedQ = buildDeniedQuery(pttype, startDateSQL, endDateSQL, dialect);
  const trendQ = buildMonthlyTrendQuery(pttype, startDateSQL, endDateSQL, dialect);

  const { data: visitData, isLoading: visitLoading, error: visitError } =
    useSQLFirst<VisitRow>(['finance', 'visit', pttype, startDateSQL, endDateSQL], visitQ);

  // claims query ต้องการตาราง ovst_billing — ถ้าไม่มีให้ข้าม
  const { data: claimsData, isLoading: claimsLoading, error: claimsError } =
    useSQLFirst<ClaimsRow>(
      ['finance', 'claims', pttype, startDateSQL, endDateSQL],
      claimsQ,
      { enabled: hasOvstBilling }
    );

  // approved/denied queries ต้องการตาราง reimbursement — ถ้าไม่มีให้ข้าม
  const { data: approvedData, isLoading: approvedLoading } =
    useSQLFirst<ApprovedRow>(
      ['finance', 'approved', pttype, startDateSQL, endDateSQL],
      approvedQ,
      { enabled: hasReimbursement }
    );

  const { data: deniedData, isLoading: deniedLoading } =
    useSQLFirst<DeniedRow>(
      ['finance', 'denied', pttype, startDateSQL, endDateSQL],
      deniedQ,
      { enabled: hasReimbursement }
    );

  const { data: trendData, isLoading: trendLoading } =
    useSQL<TrendRow>(['finance', 'trend', pttype, startDateSQL, endDateSQL], trendQ);

  const isLoading = visitLoading || (hasOvstBilling && claimsLoading) || (hasReimbursement && approvedLoading) || (hasReimbursement && deniedLoading);

  const totalAmount = Number(visitData?.total_amount ?? 0);
  const approveAmount = Number(approvedData?.approve_amount ?? 0);
  const denyAmount = Number(deniedData?.deny_amount ?? 0);
  const approvalRate = calculateApprovalRate(approveAmount, Number(claimsData?.claim_amount ?? 0));

  const chartData = useMemo(
    () =>
      (trendData ?? []).map((row) => ({
        ...row,
        total_amount: Number(row.total_amount),
        visit_count: Number(row.visit_count),
      })),
    [trendData]
  );

  const exportData = useMemo(() => {
    return (trendData ?? []).map((row) => ({
      เดือน: formatMonthLabel(row.month),
      'จำนวน Visit': row.visit_count,
      'มูลค่ารวม (บาท)': row.total_amount,
    })) as Record<string, unknown>[];
  }, [trendData]);

  if (isLoading && !visitData) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        <LoadingSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          {fundDescription && (
            <p className="text-sm text-gray-500 mt-0.5">{fundDescription}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {nhsoLink && (
            <a
              href="https://nhso-fund.bmscloud.in.th"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              ระบบ NHSO
            </a>
          )}
          <ExportButton
            data={exportData}
            filename={`${title}-report-${startDateSQL}-${endDateSQL}`}
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <KPICard
          title="จำนวน Visit"
          value={formatNumber(visitData?.total_count)}
          icon={Users}
          iconColor="text-primary-600"
          iconBg="bg-primary-50"
          subtitle="รายการ"
          loading={visitLoading}
          error={visitError}
        />
        <KPICard
          title="มูลค่ารวม"
          value={formatCurrency(totalAmount)}
          icon={DollarSign}
          iconColor="text-primary-600"
          iconBg="bg-primary-50"
          subtitle="บาท"
          loading={visitLoading}
          error={visitError}
        />
        <KPICard
          title="มูลค่าส่งเคลม"
          value={formatCurrency(claimsData?.claim_amount)}
          icon={Send}
          iconColor="text-yellow-600"
          iconBg="bg-yellow-50"
          subtitle={`${formatNumber(claimsData?.claim_count)} รายการ`}
          loading={hasOvstBilling ? claimsLoading : false}
          error={hasOvstBilling ? claimsError : null}
        />
        <KPICard
          title="มูลค่าอนุมัติ"
          value={formatCurrency(approveAmount)}
          icon={FileCheck}
          iconColor="text-green-600"
          iconBg="bg-green-50"
          subtitle={`${formatNumber(approvedData?.approve_count)} รายการ`}
          loading={hasReimbursement ? approvedLoading : false}
        />
        <KPICard
          title="มูลค่าปฏิเสธ"
          value={formatCurrency(denyAmount)}
          icon={FileX}
          iconColor="text-red-600"
          iconBg="bg-red-50"
          subtitle={`${formatNumber(deniedData?.deny_count)} รายการ`}
          loading={hasReimbursement ? deniedLoading : false}
        />
        <KPICard
          title="อัตราอนุมัติ"
          value={formatPercent(approvalRate)}
          icon={TrendingUp}
          iconColor={approvalRate >= 80 ? 'text-green-600' : approvalRate >= 60 ? 'text-yellow-600' : 'text-red-600'}
          iconBg={approvalRate >= 80 ? 'bg-green-50' : approvalRate >= 60 ? 'bg-yellow-50' : 'bg-red-50'}
          subtitle="ของมูลค่าเคลม"
        />
      </div>

      {/* Monthly Trend Chart */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">แนวโน้มรายเดือน</h3>
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
            {
              dataKey: 'visit_count',
              name: 'จำนวน Visit',
              color: '#10b981',
            },
          ]}
          yAxisFormatter={(v) => formatCurrency(v).replace('฿', '')}
          isLoading={trendLoading}
          error={visitError}
        />
      </div>

      {/* Summary Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">สรุปข้อมูลกองทุน</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" id="fund-summary-table">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">รายการ</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">จำนวน</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">มูลค่า</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              <tr className="hover:bg-gray-50">
                <td className="px-5 py-3 text-gray-700">จำนวน Visit ทั้งหมด</td>
                <td className="px-5 py-3 text-right font-medium text-gray-900">{formatNumber(visitData?.total_count)}</td>
                <td className="px-5 py-3 text-right font-medium text-gray-900">{formatCurrency(totalAmount)}</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-5 py-3 text-gray-700">ส่งเคลมแล้ว</td>
                <td className="px-5 py-3 text-right font-medium text-gray-900">{formatNumber(claimsData?.claim_count)}</td>
                <td className="px-5 py-3 text-right font-medium text-yellow-700">{formatCurrency(claimsData?.claim_amount)}</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-5 py-3 text-gray-700">อนุมัติ</td>
                <td className="px-5 py-3 text-right font-medium text-gray-900">{formatNumber(approvedData?.approve_count)}</td>
                <td className="px-5 py-3 text-right font-medium text-green-700">{formatCurrency(approveAmount)}</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-5 py-3 text-gray-700">ปฏิเสธ</td>
                <td className="px-5 py-3 text-right font-medium text-gray-900">{formatNumber(deniedData?.deny_count)}</td>
                <td className="px-5 py-3 text-right font-medium text-red-700">{formatCurrency(denyAmount)}</td>
              </tr>
              <tr className="bg-primary-50">
                <td className="px-5 py-3 font-semibold text-gray-900">อัตราอนุมัติ</td>
                <td className="px-5 py-3 text-right" colSpan={2}>
                  <span className={`font-bold text-lg ${approvalRate >= 80 ? 'text-green-700' : approvalRate >= 60 ? 'text-yellow-700' : 'text-red-700'}`}>
                    {formatPercent(approvalRate)}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
