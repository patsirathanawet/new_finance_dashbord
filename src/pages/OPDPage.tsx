import { useMemo } from 'react';
import { Users, UserCheck, Building2 } from 'lucide-react';
import KPICard from '../components/ui/KPICard';
import BarChartComponent from '../components/charts/BarChartComponent';
import AreaChartComponent from '../components/charts/AreaChartComponent';
import ExportButton from '../components/ui/ExportButton';
import { useSQL, useSQLFirst } from '../hooks/useSQL';
import { useDateFilter } from '../hooks/useDateFilter';
import { useDialect } from '../hooks/useDialect';
import {
  buildOPDVisitQuery,
  buildOPDByDepartmentQuery,
  buildOPDMonthlyTrendQuery,
  buildOPDByFundQuery,
} from '../queries/opd';
import { formatNumber } from '../lib/formatUtils';

interface OPDVisitRow { total_visits: string; unique_patients: string }
interface DeptRow { department_name: string; visit_count: string }
interface TrendRow { month: string; visit_count: string; unique_patients: string }
interface FundRow { pttype: string; visit_count: string; total_amount: string }

const PTTYPE_LABELS: Record<string, string> = {
  UC: 'สปสช.', UCS: 'สปสช.', WEL: 'สปสช.',
  OFC: 'ข้าราชการ', SSI: 'ประกันสังคม', LI: 'ประกันชีวิต', A: 'ชำระเอง',
};

function formatMonthLabel(month: string): string {
  if (!month) return '';
  const [year, m] = month.split('-');
  const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const beYear = (parseInt(year) + 543).toString().slice(2);
  return `${monthNames[parseInt(m) - 1]} ${beYear}`;
}

export default function OPDPage() {
  const { startDateSQL, endDateSQL } = useDateFilter();
  const dialect = useDialect();

  const { data: visitData, isLoading: visitLoading, error: visitError } =
    useSQLFirst<OPDVisitRow>(
      ['opd', 'visit', startDateSQL, endDateSQL, dialect],
      buildOPDVisitQuery(startDateSQL, endDateSQL, dialect)
    );

  const { data: deptData, isLoading: deptLoading } =
    useSQL<DeptRow>(
      ['opd', 'dept', startDateSQL, endDateSQL, dialect],
      buildOPDByDepartmentQuery(startDateSQL, endDateSQL, dialect)
    );

  const { data: trendData, isLoading: trendLoading } =
    useSQL<TrendRow>(
      ['opd', 'trend', startDateSQL, endDateSQL, dialect],
      buildOPDMonthlyTrendQuery(startDateSQL, endDateSQL, dialect)
    );

  const { data: fundData, isLoading: fundLoading } =
    useSQL<FundRow>(
      ['opd', 'fund', startDateSQL, endDateSQL, dialect],
      buildOPDByFundQuery(startDateSQL, endDateSQL, dialect)
    );

  const chartData = useMemo(
    () =>
      (trendData ?? []).map((r) => ({
        ...r,
        visit_count: Number(r.visit_count),
        unique_patients: Number(r.unique_patients),
      })),
    [trendData]
  );

  const deptChartData = useMemo(
    () =>
      (deptData ?? []).map((r) => ({
        ...r,
        visit_count: Number(r.visit_count),
      })),
    [deptData]
  );

  const exportData = useMemo(
    () =>
      (trendData ?? []).map((r) => ({
        เดือน: formatMonthLabel(r.month),
        'จำนวน Visit': r.visit_count,
        'ผู้ป่วยไม่ซ้ำ': r.unique_patients,
      })) as Record<string, unknown>[],
    [trendData]
  );


  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">ผู้ป่วยนอก (OPD)</h2>
          <p className="text-sm text-gray-500 mt-0.5">สถิติการให้บริการผู้ป่วยนอก</p>
        </div>
        <ExportButton data={exportData} filename={`opd-${startDateSQL}-${endDateSQL}`} />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KPICard
          title="Visit ทั้งหมด"
          value={formatNumber(visitData?.total_visits)}
          icon={Users}
          iconColor="text-primary-600"
          iconBg="bg-primary-50"
          subtitle="ครั้ง"
          loading={visitLoading}
          error={visitError}
        />
        <KPICard
          title="ผู้ป่วยไม่ซ้ำ"
          value={formatNumber(visitData?.unique_patients)}
          icon={UserCheck}
          iconColor="text-primary-600"
          iconBg="bg-primary-50"
          subtitle="คน"
          loading={visitLoading}
          error={visitError}
        />
        <KPICard
          title="แผนกที่มีข้อมูล"
          value={formatNumber(deptData?.length ?? 0)}
          icon={Building2}
          iconColor="text-purple-600"
          iconBg="bg-purple-50"
          subtitle="แผนก"
          loading={deptLoading}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">แนวโน้ม Visit รายเดือน</h3>
            {trendLoading && <div className="w-4 h-4 border-2 border-primary-200 border-t-cyan-600 rounded-full animate-spin" />}
          </div>
          <AreaChartComponent
            data={chartData}
            xAxisKey="month"
            xAxisFormatter={formatMonthLabel}
            areas={[
              { dataKey: 'visit_count', name: 'จำนวน Visit', color: '#06b6d4' },
              { dataKey: 'unique_patients', name: 'ผู้ป่วยไม่ซ้ำ', color: '#8b5cf6' },
            ]}
            height={240}
            isLoading={trendLoading}
            error={visitError}
          />
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">Top 8 แผนก</h3>
            {deptLoading && <div className="w-4 h-4 border-2 border-primary-200 border-t-blue-600 rounded-full animate-spin" />}
          </div>
          <BarChartComponent
            data={deptChartData.slice(0, 8)}
            xAxisKey="department_name"
            bars={[{ dataKey: 'visit_count', name: 'จำนวน Visit', color: '#06b6d4' }]}
            height={240}
            isLoading={deptLoading}
          />
        </div>
      </div>

      {/* Department table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">สรุปตามแผนก (Top 10)</h3>
        </div>
        {deptLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">กำลังโหลด...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">#</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">แผนก</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">จำนวน Visit</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">สัดส่วน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {!deptData || deptData.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-gray-400 text-sm">ไม่มีข้อมูลแผนก</td>
                  </tr>
                ) : deptData.map((r, idx) => {
                  const total = deptData.reduce((s, d) => s + Number(d.visit_count), 0);
                  const pct = total > 0 ? (Number(r.visit_count) / total) * 100 : 0;
                  return (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-5 py-3 text-gray-400 text-xs font-medium">{idx + 1}</td>
                      <td className="px-5 py-3 font-medium text-gray-900">{r.department_name || '-'}</td>
                      <td className="px-5 py-3 text-right font-medium text-gray-700">{formatNumber(r.visit_count)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary-500 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 w-10 text-right">{pct.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Fund breakdown */}
      {!fundLoading && fundData && fundData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">สรุปตามกองทุน</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">กองทุน</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">จำนวน Visit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {fundData.map((r) => (
                  <tr key={r.pttype} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{PTTYPE_LABELS[r.pttype] || r.pttype}</td>
                    <td className="px-5 py-3 text-right">{formatNumber(r.visit_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
