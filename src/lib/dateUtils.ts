import { format } from 'date-fns';
import { th } from 'date-fns/locale';

const BUDDHIST_ERA_OFFSET = 543;

export function formatThaiDate(date: Date): string {
  const beYear = date.getFullYear() + BUDDHIST_ERA_OFFSET;
  const month = format(date, 'MMMM', { locale: th });
  const day = format(date, 'd');
  return `${day} ${month} พ.ศ. ${beYear}`;
}

export function formatThaiMonthYear(date: Date): string {
  const beYear = date.getFullYear() + BUDDHIST_ERA_OFFSET;
  const month = format(date, 'MMMM', { locale: th });
  return `${month} ${beYear}`;
}

export function formatShortThaiDate(date: Date): string {
  const beYear = (date.getFullYear() + BUDDHIST_ERA_OFFSET).toString().slice(2);
  return format(date, `dd/MM/${beYear}`);
}

export function formatSQLDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function formatDisplayDate(date: Date): string {
  return formatThaiDate(date);
}

export const FILTER_LABELS: Record<string, string> = {
  today: 'วันนี้',
  this_month: 'เดือนนี้',
  last_month: 'เดือนที่แล้ว',
  '30_days': '30 วัน',
  '90_days': '90 วัน',
  this_quarter: 'ไตรมาสนี้',
  this_year: 'ปีนี้',
  custom: 'กำหนดเอง',
};
