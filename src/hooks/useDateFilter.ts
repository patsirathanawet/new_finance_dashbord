import { useFilterStore } from '../store/filterStore';
import { formatSQLDate } from '../lib/dateUtils';

export function useDateFilter() {
  const { filterType, startDate, endDate, setFilter } = useFilterStore();

  return {
    filterType,
    startDate,
    endDate,
    startDateSQL: formatSQLDate(startDate),
    endDateSQL: formatSQLDate(endDate),
    setFilter,
  };
}
