import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { formatCompactNumber } from '../../lib/formatUtils';

interface LineChartProps {
  data: Record<string, unknown>[];
  lines: {
    dataKey: string;
    name: string;
    color: string;
    formatter?: (value: number) => string;
  }[];
  xAxisKey: string;
  xAxisFormatter?: (value: string) => string;
  height?: number;
  title?: string;
  yAxisFormatter?: (value: number) => string;
  isLoading?: boolean;
  error?: Error | null;
}

export default function LineChartComponent({
  data,
  lines,
  xAxisKey,
  xAxisFormatter,
  height = 280,
  title,
  yAxisFormatter = (v) => formatCompactNumber(v),
  isLoading,
  error,
}: LineChartProps) {
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
        <LineChart
          data={data}
          margin={{ top: 5, right: 20, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey={xAxisKey}
            tickFormatter={xAxisFormatter}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={{ stroke: '#e5e7eb' }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={yAxisFormatter}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            width={70}
          />
          <Tooltip
            formatter={(value, name) => {
              const line = lines.find((l) => l.name === name);
              const formatted = line?.formatter
                ? line.formatter(Number(value))
                : formatCompactNumber(Number(value));
              return [formatted, name];
            }}
            labelFormatter={xAxisFormatter as ((label: unknown) => string) | undefined}
            contentStyle={{
              backgroundColor: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              fontSize: '12px',
            }}
          />
          <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '16px' }} />
          {lines.map((line) => (
            <Line
              key={line.dataKey}
              type="monotone"
              dataKey={line.dataKey}
              name={line.name}
              stroke={line.color}
              strokeWidth={2}
              dot={{ fill: line.color, r: 3 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
