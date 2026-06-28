import { useMemo } from 'react';
import { Ambulance, Clock, UserX, Users, AlertTriangle } from 'lucide-react';
import KPICard from '../components/ui/KPICard';
import BarChartComponent from '../components/charts/BarChartComponent';
import LineChartComponent from '../components/charts/LineChartComponent';
import PieChartComponent from '../components/charts/PieChartComponent';
import ExportButton from '../components/ui/ExportButton';
import { useSQL, useSQLFirst } from '../hooks/useSQL';
import { useDateFilter } from '../hooks/useDateFilter';
import { useDialect } from '../hooks/useDialect';
import {
  buildERDoorToDoctorQuery,
  buildERLOSQuery,
  buildERLWBSQuery,
  buildERVisitCountQuery,
  buildERTriageQuery,
  buildERMonthlyTrendQuery,
} from '../queries/er';
import { formatNumber, formatPercent, formatMinutes } from '../lib/formatUtils';

interface DoorToDoctorRow { average_door_to_doctor_minutes: string }
interface LOSRow { average_length_of_stay_minutes: string }
interface LWBSRow { left_without_being_seen_count: string }
interface VisitRow { total_er_visits: string; admitted_count: string; discharged_count: string }
interface TriageRow { triage_level: string; count: string }
interface TrendRow { month: string; visit_count: string; avg_door_to_doctor: string; avg_los: string }

const TRIAGE_LABELS: Record<string, string> = {
  '1': 'ระดับ 1 (วิกฤต)',
  '2': 'ระดับ 2 (ฉุกเฉิน)',
  '3': 'ระดับ 3 (เร่งด่วน)',
  '4': 'ระดับ 4 (ไม่เร่งด่วน)',
  '5': 'ระดับ 5 (ทั่วไป)',
};

const TRIAGE_COLORS: Record<string, string> = {
  '1': '#ef4444', '2': '#f97316', '3': '#f59e0b',
  '4': '#22c55e', '5': '#3b82f6',
};

function formatMonthLabel(month: string): string {
  if (!month) return '';
  const [year, m] = month.split('-');
  const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const beYear = (parseInt(year) + 543).toString().slice(2);
  return `${monthNames[parseInt(m) - 1]} ${beYear}`;
}

export default function ERPage() {
  const { startDateSQL, endDateSQL } = useDateFilter();
  const dialect = useDialect();

  const { data: doorToDoctor, isLoading: d2dLoading, error: d2dError } =
    useSQLFirst<DoorToDoctorRow>(
      ['er', 'door2doc', startDateSQL, endDateSQL, dialect],
      buildERDoorToDoctorQuery(startDateSQL, endDateSQL, dialect)
    );

  const { data: losData, isLoading: losLoading } =
    useSQLFirst<LOSRow>(
      ['er', 'los', startDateSQL, endDateSQL, dialect],
      buildERLOSQuery(startDateSQL, endDateSQL, dialect)
    );

  const { data: lwbsData, isLoading: lwbsLoading } =
    useSQLFirst<LWBSRow>(
      ['er', 'lwbs', startDateSQL, endDateSQL, dialect],
      buildERLWBSQuery(startDateSQL, endDateSQL, dialect)
    );

  const { data: visitData, isLoading: visitLoading } =
    useSQLFirst<VisitRow>(
      ['er', 'visit', startDateSQL, endDateSQL, dialect],
      buildERVisitCountQuery(startDateSQL, endDateSQL, dialect)
    );

  const { data: triageData, isLoading: triageLoading } =
    useSQL<TriageRow>(
      ['er', 'triage', startDateSQL, endDateSQL, dialect],
      buildERTriageQuery(startDateSQL, endDateSQL, dialect)
    );

  const { data: trendData, isLoading: trendLoading } =
    useSQL<TrendRow>(
      ['er', 'trend', startDateSQL, endDateSQL, dialect],
      buildERMonthlyTrendQuery(startDateSQL, endDateSQL, dialect)
    );


  const totalVisits = Number(visitData?.total_er_visits ?? 0);
  const admittedCount = Number(visitData?.admitted_count ?? 0);
  const admitRate = totalVisits > 0 ? (admittedCount / totalVisits) * 100 : 0;

  const triagePieData = useMemo(
    () =>
      (triageData ?? []).map((r) => ({
        name: TRIAGE_LABELS[r.triage_level] || `ระดับ ${r.triage_level}`,
        value: Number(r.count),
        color: TRIAGE_COLORS[r.triage_level],
      })),
    [triageData]
  );

  const chartData = useMemo(
    () =>
      (trendData ?? []).map((r) => ({
        ...r,
        visit_count: Number(r.visit_count),
        avg_door_to_doctor: Number(r.avg_door_to_doctor),
        avg_los: Number(r.avg_los),
      })),
    [trendData]
  );

  const exportData = useMemo(
    () =>
      (trendData ?? []).map((r) => ({
        เดือน: formatMonthLabel(r.month),
        'จำนวนผู้ป่วย': r.visit_count,
        'Door-to-Doctor (นาที)': Number(r.avg_door_to_doctor).toFixed(1),
        'LOS เฉลี่ย (นาที)': Number(r.avg_los).toFixed(1),
      })) as Record<string, unknown>[],
    [trendData]
  );


  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">ห้องฉุกเฉิน (ER)</h2>
          <p className="text-sm text-gray-500 mt-0.5">ประสิทธิภาพการให้บริการห้องฉุกเฉิน</p>
        </div>
        <ExportButton data={exportData} filename={`er-${startDateSQL}-${endDateSQL}`} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          title="ผู้ป่วย ER ทั้งหมด"
          value={formatNumber(totalVisits)}
          icon={Ambulance}
          iconColor="text-red-600"
          iconBg="bg-red-50"
          subtitle="ราย"
          loading={visitLoading}
          error={d2dError}
        />
        <KPICard
          title="Door-to-Doctor"
          value={formatMinutes(doorToDoctor?.average_door_to_doctor_minutes)}
          icon={Clock}
          iconColor={
            Number(doorToDoctor?.average_door_to_doctor_minutes ?? 0) <= 10 ? 'text-green-600' :
            Number(doorToDoctor?.average_door_to_doctor_minutes ?? 0) <= 20 ? 'text-yellow-600' : 'text-red-600'
          }
          iconBg={
            Number(doorToDoctor?.average_door_to_doctor_minutes ?? 0) <= 10 ? 'bg-green-50' :
            Number(doorToDoctor?.average_door_to_doctor_minutes ?? 0) <= 20 ? 'bg-yellow-50' : 'bg-red-50'
          }
          subtitle="เวลาตั้งแต่ถึงจนพบแพทย์"
          loading={d2dLoading}
          error={d2dError}
        />
        <KPICard
          title="LOS เฉลี่ย"
          value={formatMinutes(losData?.average_length_of_stay_minutes)}
          icon={Clock}
          iconColor="text-primary-600"
          iconBg="bg-primary-50"
          subtitle="ระยะเวลาอยู่ใน ER"
          loading={losLoading}
        />
        <KPICard
          title="LWBS"
          value={formatNumber(lwbsData?.left_without_being_seen_count)}
          icon={UserX}
          iconColor="text-orange-600"
          iconBg="bg-orange-50"
          subtitle={totalVisits > 0 ? formatPercent((Number(lwbsData?.left_without_being_seen_count ?? 0) / totalVisits) * 100) + ' ของผู้ป่วย' : 'ออกก่อนพบแพทย์'}
          loading={lwbsLoading}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KPICard
          title="Admit ต่อ ER"
          value={`${formatNumber(admittedCount)} ราย`}
          icon={Users}
          iconColor="text-teal-600"
          iconBg="bg-teal-50"
          subtitle={`อัตรา Admit ${formatPercent(admitRate)}`}
          loading={visitLoading}
        />
        <KPICard
          title="Discharge จาก ER"
          value={formatNumber(visitData?.discharged_count)}
          icon={Users}
          iconColor="text-green-600"
          iconBg="bg-green-50"
          subtitle="ออกจาก ER"
          loading={visitLoading}
        />
        <KPICard
          title="กลุ่ม Triage"
          value={formatNumber(triageData?.length ?? 0)}
          icon={AlertTriangle}
          iconColor="text-yellow-600"
          iconBg="bg-yellow-50"
          subtitle="ระดับความรุนแรง"
          loading={triageLoading}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">จำนวนผู้ป่วย ER รายเดือน</h3>
            {trendLoading && <div className="w-4 h-4 border-2 border-red-200 border-t-red-600 rounded-full animate-spin" />}
          </div>
          <BarChartComponent
            data={chartData}
            xAxisKey="month"
            xAxisFormatter={formatMonthLabel}
            bars={[{ dataKey: 'visit_count', name: 'จำนวนผู้ป่วย', color: '#ef4444' }]}
            height={240}
            isLoading={trendLoading}
            error={d2dError}
          />
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">สัดส่วน Triage</h3>
          <PieChartComponent
            data={triagePieData}
            height={240}
            innerRadius={40}
            outerRadius={90}
            isLoading={triageLoading}
          />
        </div>
      </div>

      {/* Door-to-Doctor trend */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">แนวโน้ม Door-to-Doctor และ LOS รายเดือน (นาที)</h3>
        <LineChartComponent
          data={chartData}
          xAxisKey="month"
          xAxisFormatter={formatMonthLabel}
          lines={[
            { dataKey: 'avg_door_to_doctor', name: 'Door-to-Doctor (นาที)', color: '#f97316' },
            { dataKey: 'avg_los', name: 'LOS เฉลี่ย (นาที)', color: '#6366f1' },
          ]}
          height={280}
          isLoading={trendLoading}
          error={d2dError}
        />
      </div>
    </div>
  );
}
