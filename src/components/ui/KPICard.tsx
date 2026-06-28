import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  trend?: number;
  trendLabel?: string;
  loading?: boolean;
  error?: Error | null;
  className?: string;
  onClick?: () => void;
}

export default function KPICard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = 'text-primary-600',
  iconBg = 'bg-primary-50',
  trend,
  trendLabel,
  loading = false,
  error,
  className = '',
  onClick,
}: KPICardProps) {
  if (loading) {
    return (
      <div className={`bg-white rounded-xl p-5 shadow-sm border border-gray-100 animate-pulse ${className}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="h-4 bg-gray-200 rounded w-28"></div>
          <div className="w-10 h-10 bg-gray-200 rounded-lg"></div>
        </div>
        <div className="h-8 bg-gray-200 rounded w-36 mb-2"></div>
        <div className="h-3 bg-gray-200 rounded w-20"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-white rounded-xl p-5 shadow-sm border border-red-100 ${className}`}>
        <p className="text-sm font-medium text-gray-500 mb-2">{title}</p>
        <p className="text-xs text-red-500 leading-snug">{error.message || 'โหลดข้อมูลไม่สำเร็จ'}</p>
      </div>
    );
  }

  const trendIsPositive = trend !== undefined && trend > 0;
  const trendIsNegative = trend !== undefined && trend < 0;
  const trendIsNeutral = trend !== undefined && trend === 0;

  return (
    <div
      className={`bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-all duration-200 ${onClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm font-medium text-gray-500 leading-tight">{title}</p>
        {Icon && (
          <div className={`p-2 rounded-lg ${iconBg} flex-shrink-0`}>
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
        )}
      </div>

      <div className="mb-2">
        <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {trend !== undefined && (
          <span
            className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
              trendIsPositive
                ? 'text-green-700 bg-green-100'
                : trendIsNegative
                ? 'text-red-700 bg-red-100'
                : 'text-gray-600 bg-gray-100'
            }`}
          >
            {trendIsPositive && <TrendingUp className="w-3 h-3" />}
            {trendIsNegative && <TrendingDown className="w-3 h-3" />}
            {trendIsNeutral && <Minus className="w-3 h-3" />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
        {subtitle && (
          <span className="text-xs text-gray-400">{subtitle}</span>
        )}
        {trendLabel && (
          <span className="text-xs text-gray-400">{trendLabel}</span>
        )}
      </div>
    </div>
  );
}
