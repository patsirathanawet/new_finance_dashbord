import { useMemo } from 'react';
import { BedDouble, Users, Clock } from 'lucide-react';
import KPICard from '../components/ui/KPICard';
import BarChartComponent from '../components/charts/BarChartComponent';
import LineChartComponent from '../components/charts/LineChartComponent';
import ExportButton from '../components/ui/ExportButton';
import { useSQL, useSQLFirst, useTableExists } from '../hooks/useSQL';
import { useDateFilter } from '../hooks/useDateFilter';
import { useDialect } from '../hooks/useDialect';
import { buildTotalBedsQuery, buildOccupiedBedsQuery, buildCurrentIPDQuery, buildIPDMonthlyTrendQuery } from '../queries/bed';
import { buildIPDAdmissionQuery, buildIPDByFundQuery } from '../queries/ipd';
import { formatCurrency, formatNumber, formatPercent } from '../lib/formatUtils';

interface AdmissionRow { total_admissions: string; avg_los_days: string }
interface BedsRow { total_beds: string }
interface OccupiedRow { occupied_beds: string }
interface CurrentIPDRow { ward_name: string; current_patients: string; total_beds: string }
interface TrendRow { month: string; admission_count: string; avg_los: string }
interface FundRow { pttype: string; admission_count: string; total_amount: string; avg_los: string }

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

export default function IPDPage() {
  const { startDateSQL, endDateSQL } = useDateFilter();
  const dialect = useDialect();
  const hasAnStat = useTableExists('an_stat');
  const hasWard = useTableExists('ward');

  const { data: admissionData, isLoading: admLoading, error: admError } =
    useSQLFirst<AdmissionRow>(
      ['ipd', 'admission', startDateSQL, endDateSQL, dialect],
      buildIPDAdmissionQuery(startDateSQL, endDateSQL, dialect),
      { enabled: hasAnStat }
    );

  const { data: bedsData } = useSQLFirst<BedsRow>(['beds', 'total'], buildTotalBedsQuery(), { enabled: hasWard });
  const { data: occupiedData } = useSQLFirst<OccupiedRow>(['beds', 'occupied'], buildOccupiedBedsQuery(), { enabled: hasAnStat });

  const { data: currentIPD, isLoading: currentLoading } =
    useSQL<CurrentIPDRow>(['ipd', 'current'], buildCurrentIPDQuery(), { enabled: hasAnStat && hasWard });

  const { data: trendData, isLoading: trendLoading } =
    useSQL<TrendRow>(
      ['ipd', 'trend', startDateSQL, endDateSQL, dialect],
      buildIPDMonthlyTrendQuery(startDateSQL, endDateSQL, dialect),
      { enabled: hasAnStat }
    );

  const { data: fundData, isLoading: fundLoading } =
    useSQL<FundRow>(
      ['ipd', 'fund', startDateSQL, endDateSQL, dialect],
      buildIPDByFundQuery(startDateSQL, endDateSQL, dialect),
      { enabled: hasAnStat }
    );

  const totalBeds = Number(bedsData?.total_beds ?? 0);
  const occupiedBeds = Number(occupiedData?.occupied_beds ?? 0);
  const occupancyRate = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;

  const chartData = useMemo(
    () =>
      (trendData ?? []).map((r) => ({
        ...r,
        admission_count: Number(r.admission_count),
        avg_los: Number(r.avg_los),
      })),
    [trendData]
  );

  const wardData = useMemo(
    () =>
      (currentIPD ?? []).map((r) => ({
        ...r,
        current_patients: Number(r.current_patients),
        total_beds: Number(r.total_beds),
        occupancy: r.total_beds ? (Number(r.current_patients) / Number(r.total_beds)) * 100 : 0,
      })),
    [currentIPD]
  );

  const exportData = useMemo(
    () =>
      (fundData ?? []).map((r) => ({
        กองทุน: PTTYPE_LABELS[r.pttype] || r.pttype,
        'จำนวน Admit': r.admission_count,
        'มูลค่ารวม (บาท)': r.total_amount,
        'LOS เฉลี่ย (วัน)': Number(r.avg_los).toFixed(1),
      })) as Record<string, unknown>[],
    [fundData]
  );


  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">ผู้ป่วยใน (IPD)</h2>
          <p className="text-sm text-gray-500 mt-0.5">ข้อมูลการรับผู้ป่วยในและการครอบครองเตียง</p>
        </div>
        <ExportButton data={exportData} filename={`ipd-${startDateSQL}-${endDateSQL}`} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          title="Admit ในช่วงเวลา"
          value={formatNumber(admissionData?.total_admissions)}
          icon={Users}
          iconColor="text-teal-600"
          iconBg="bg-teal-50"
          subtitle="ราย"
          loading={admLoading}
          error={admError}
        />
        <KPICard
          title="LOS เฉลี่ย"
          value={`${Number(admissionData?.avg_los_days ?? 0).toFixed(1)} วัน`}
          icon={Clock}
          iconColor="text-primary-600"
          iconBg="bg-primary-50"
          subtitle="วันนอนเฉลี่ย"
          loading={admLoading}
          error={admError}
        />
        <KPICard
          title="เตียงที่ใช้อยู่"
          value={`${formatNumber(occupiedBeds)} / ${formatNumber(totalBeds)}`}
          icon={BedDouble}
          iconColor={occupancyRate >= 80 ? 'text-red-600' : 'text-green-600'}
          iconBg={occupancyRate >= 80 ? 'bg-red-50' : 'bg-green-50'}
          subtitle={`อัตราครอบครอง ${formatPercent(occupancyRate)}`}
        />
        <KPICard
          title="เตียงว่าง"
          value={formatNumber(totalBeds - occupiedBeds)}
          icon={BedDouble}
          iconColor="text-purple-600"
          iconBg="bg-purple-50"
          subtitle="เตียง"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">จำนวน Admit รายเดือน</h3>
            {trendLoading && <div className="w-4 h-4 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />}
          </div>
          <BarChartComponent
            data={chartData}
            xAxisKey="month"
            xAxisFormatter={formatMonthLabel}
            bars={[{ dataKey: 'admission_count', name: 'จำนวน Admit', color: '#14b8a6' }]}
            height={240}
            isLoading={trendLoading}
            error={admError}
          />
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">LOS เฉลี่ยรายเดือน (วัน)</h3>
          </div>
          <LineChartComponent
            data={chartData}
            xAxisKey="month"
            xAxisFormatter={formatMonthLabel}
            lines={[{ dataKey: 'avg_los', name: 'LOS เฉลี่ย (วัน)', color: '#6366f1' }]}
            height={240}
            isLoading={trendLoading}
            error={admError}
          />
        </div>
      </div>

      {/* Ward occupancy table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">การครอบครองเตียงตามหอผู้ป่วย (ปัจจุบัน)</h3>
        </div>
        {currentLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">กำลังโหลด...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">หอผู้ป่วย</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">ผู้ป่วยปัจจุบัน</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">เตียงทั้งหมด</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">อัตราครอบครอง</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {wardData.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-gray-400 text-sm">
                      ไม่มีข้อมูลหอผู้ป่วย
                    </td>
                  </tr>
                ) : wardData.map((ward, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{ward.ward_name || '-'}</td>
                    <td className="px-5 py-3 text-right font-medium text-gray-700">{formatNumber(ward.current_patients)}</td>
                    <td className="px-5 py-3 text-right text-gray-600">{formatNumber(ward.total_beds)}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${ward.occupancy >= 90 ? 'bg-red-500' : ward.occupancy >= 75 ? 'bg-yellow-500' : 'bg-green-500'}`}
                            style={{ width: `${Math.min(ward.occupancy, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-gray-700 w-10 text-right">
                          {formatPercent(ward.occupancy)}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
                        ward.occupancy >= 90 ? 'bg-red-100 text-red-700' :
                        ward.occupancy >= 75 ? 'bg-yellow-100 text-yellow-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                        {ward.occupancy >= 90 ? 'เต็ม' : ward.occupancy >= 75 ? 'ใกล้เต็ม' : 'ปกติ'}
                      </span>
                    </td>
                  </tr>
                ))}
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
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">จำนวน Admit</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">มูลค่ารวม</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">LOS เฉลี่ย</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {fundData.map((r) => (
                  <tr key={r.pttype} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{PTTYPE_LABELS[r.pttype] || r.pttype}</td>
                    <td className="px-5 py-3 text-right">{formatNumber(r.admission_count)}</td>
                    <td className="px-5 py-3 text-right font-medium">{formatCurrency(r.total_amount)}</td>
                    <td className="px-5 py-3 text-right text-gray-600">{Number(r.avg_los).toFixed(1)} วัน</td>
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
