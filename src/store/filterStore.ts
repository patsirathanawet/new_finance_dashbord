import { create } from 'zustand';
import { startOfMonth, endOfMonth, startOfDay, endOfDay, subDays, subMonths, startOfQuarter, endOfQuarter, startOfYear, endOfYear } from 'date-fns';

export type DateFilterType = 'today' | 'this_month' | 'last_month' | '30_days' | '90_days' | 'this_quarter' | 'this_year' | 'custom';

export interface FilterState {
  filterType: DateFilterType;
  startDate: Date;
  endDate: Date;
  setFilter: (type: DateFilterType, start?: Date, end?: Date) => void;
}

function getDateRange(type: DateFilterType): { start: Date; end: Date } {
  const now = new Date();
  switch (type) {
    case 'today':
      return { start: startOfDay(now), end: endOfDay(now) };
    case 'this_month':
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'last_month': {
      const lastMonth = subMonths(now, 1);
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
    }
    case '30_days':
      return { start: startOfDay(subDays(now, 30)), end: endOfDay(now) };
    case '90_days':
      return { start: startOfDay(subDays(now, 90)), end: endOfDay(now) };
    case 'this_quarter':
      return { start: startOfQuarter(now), end: endOfQuarter(now) };
    case 'this_year':
      return { start: startOfYear(now), end: endOfYear(now) };
    default:
      return { start: startOfMonth(now), end: endOfMonth(now) };
  }
}

const defaultRange = getDateRange('this_month');

export const useFilterStore = create<FilterState>((set) => ({
  filterType: 'this_month',
  startDate: defaultRange.start,
  endDate: defaultRange.end,
  setFilter: (type, start, end) => {
    if (type === 'custom' && start && end) {
      set({ filterType: type, startDate: start, endDate: end });
    } else {
      const range = getDateRange(type);
      set({ filterType: type, startDate: range.start, endDate: range.end });
    }
  },
}));
