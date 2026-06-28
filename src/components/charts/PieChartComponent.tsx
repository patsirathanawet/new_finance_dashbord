import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { PieLabelRenderProps } from 'recharts';
import { formatCompactNumber } from '../../lib/formatUtils';

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#84cc16', '#f97316',
];

interface PieChartProps {
  data: { name: string; value: number; color?: string }[];
  height?: number;
  title?: string;
  formatter?: (value: number) => string;
  showLegend?: boolean;
  innerRadius?: number;
  outerRadius?: number;
  isLoading?: boolean;
  error?: Error | null;
}

const RADIAN = Math.PI / 180;
const renderCustomLabel = (props: PieLabelRenderProps) => {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props;
  if (
    cx === undefined || cy === undefined ||
    midAngle === undefined || innerRadius === undefined ||
    outerRadius === undefined || percent === undefined
  ) return null;
  if (Number(percent) < 0.05) return null;

  const radius = Number(innerRadius) + (Number(outerRadius) - Number(innerRadius)) * 0.5;
  const x = Number(cx) + radius * Math.cos(-Number(midAngle) * RADIAN);
  const y = Number(cy) + radius * Math.sin(-Number(midAngle) * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={600}
    >
      {`${(Number(percent) * 100).toFixed(0)}%`}
    </text>
  );
};

export default function PieChartComponent({
  data,
  height = 280,
  title,
  formatter = (v) => formatCompactNumber(v),
  showLegend = true,
  innerRadius = 0,
  outerRadius = 100,
  isLoading,
  error,
}: PieChartProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center animate-pulse bg-gray-50 rounded-lg" style={{ height }}>
        <span className="text-gray-400 text-sm">กำลังโหลด...</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center bg-red-50 rounded-lg" style={{ height }}>
        <span className="text-red-500 text-sm">{error.message || 'โหลดข้อมูลไม่สำเร็จ'}</span>
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        ไม่มีข้อมูลในช่วงเวลาที่เลือก
      </div>
    );
  }

  return (
    <div>
      {title && (
        <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={renderCustomLabel}
            outerRadius={outerRadius}
            innerRadius={innerRadius}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.color || COLORS[index % COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => [formatter(Number(value)), 'จำนวน']}
            contentStyle={{
              backgroundColor: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              fontSize: '12px',
            }}
          />
          {showLegend && (
            <Legend
              wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
              content={() => (
                <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 pt-2 text-xs">
                  {data.map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-1.5">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: entry.color || COLORS[index % COLORS.length] }}
                      />
                      <span className="text-gray-600">{entry.name}</span>
                    </div>
                  ))}
                </div>
              )}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
