export function formatCurrency(value: number | string | null | undefined): string {
  const num = Number(value);
  if (isNaN(num)) return '฿0';
  return `฿${num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(value: number | string | null | undefined): string {
  const num = Number(value);
  if (isNaN(num)) return '0';
  return num.toLocaleString('th-TH');
}

export function formatPercent(value: number | string | null | undefined, decimals = 1): string {
  const num = Number(value);
  if (isNaN(num)) return '0%';
  return `${num.toFixed(decimals)}%`;
}

export function formatMinutes(value: number | string | null | undefined): string {
  const num = Number(value);
  if (isNaN(num)) return '0 นาที';
  const hours = Math.floor(num / 60);
  const minutes = Math.round(num % 60);
  if (hours > 0) {
    return `${hours} ชม. ${minutes} นาที`;
  }
  return `${minutes} นาที`;
}

export function calculateApprovalRate(approvedAmount: number, totalAmount: number): number {
  if (!totalAmount) return 0;
  return (approvedAmount / totalAmount) * 100;
}

export function formatCompactNumber(value: number | string | null | undefined): string {
  const num = Number(value);
  if (isNaN(num)) return '0';
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1)}B`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toString();
}
