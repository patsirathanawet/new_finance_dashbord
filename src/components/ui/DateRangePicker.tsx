import { useState, useRef, useEffect } from 'react';
import { Calendar, Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useDateFilter } from '../../hooks/useDateFilter';
import type { DateFilterType } from '../../store/filterStore';
import { formatShortThaiDate } from '../../lib/dateUtils';

const FILTER_OPTIONS: { value: DateFilterType; label: string }[] = [
  { value: 'today', label: 'วันนี้' },
  { value: 'this_month', label: 'เดือนนี้' },
  { value: 'last_month', label: 'เดือนที่แล้ว' },
  { value: '30_days', label: '30 วัน' },
  { value: '90_days', label: '90 วัน' },
  { value: 'this_quarter', label: 'ไตรมาส' },
  { value: 'this_year', label: 'ปีนี้' },
];

const BE_OFFSET = 543;
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const THAI_DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

function toThaiInput(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const y = d.getFullYear() + BE_OFFSET;
  return `${day}/${m}/${y}`;
}

function parseThaiInput(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})(?:\/|-)(\d{1,2})(?:\/|-)(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year > 2400) year -= BE_OFFSET;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

function autoFormat(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Mini Thai calendar — BE year, Thai month names */
function ThaiMiniCalendar({
  value,
  onSelect,
  onClose,
}: {
  value: Date | null;
  onSelect: (d: Date) => void;
  onClose: () => void;
}) {
  const initial = value ?? new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const today = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div
      ref={rootRef}
      className="absolute top-full left-0 mt-1 z-[60] bg-white rounded-2xl shadow-soft border border-gray-200 p-3 w-72"
    >
      {/* Header — month/year navigation */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={prevMonth}
          className="p-1 rounded-lg text-gray-500 hover:bg-primary-50 hover:text-primary-700"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-1.5">
          <select
            value={viewMonth}
            onChange={(e) => setViewMonth(Number(e.target.value))}
            className="text-sm font-semibold text-gray-700 bg-transparent rounded-lg px-1 py-0.5 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-300"
          >
            {THAI_MONTHS.map((m, i) => (
              <option key={i} value={i}>{m}</option>
            ))}
          </select>
          <select
            value={viewYear}
            onChange={(e) => setViewYear(Number(e.target.value))}
            className="text-sm font-semibold text-gray-700 bg-transparent rounded-lg px-1 py-0.5 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-300"
          >
            {Array.from({ length: 21 }, (_, i) => initial.getFullYear() - 10 + i).map((y) => (
              <option key={y} value={y}>{y + BE_OFFSET}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={nextMonth}
          className="p-1 rounded-lg text-gray-500 hover:bg-primary-50 hover:text-primary-700"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {THAI_DAYS.map((d) => (
          <div key={d} className="text-center text-[11px] font-semibold text-gray-400 py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const cellDate = new Date(viewYear, viewMonth, day);
          const isSelected = value && isSameDay(cellDate, value);
          const isToday = isSameDay(cellDate, today);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(cellDate)}
              className={`text-xs py-1.5 rounded-lg font-medium transition-colors ${
                isSelected
                  ? 'bg-primary-600 text-white shadow-soft'
                  : isToday
                  ? 'bg-primary-100 text-primary-700 hover:bg-primary-200'
                  : 'text-gray-700 hover:bg-primary-50 hover:text-primary-700'
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DateRangePicker() {
  const { filterType, startDate, endDate, setFilter } = useDateFilter();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [tempStart, setTempStart] = useState(toThaiInput(startDate));
  const [tempEnd, setTempEnd] = useState(toThaiInput(endDate));
  const [calOpen, setCalOpen] = useState<'start' | 'end' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
        setCalOpen(null);
        setError(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [pickerOpen]);

  const openPicker = () => {
    setTempStart(toThaiInput(startDate));
    setTempEnd(toThaiInput(endDate));
    setError(null);
    setPickerOpen(true);
  };

  const applyCustom = () => {
    if (!tempStart || !tempEnd) {
      setError('กรุณาเลือกวันที่ทั้งสองช่อง');
      return;
    }
    const s = parseThaiInput(tempStart);
    const e = parseThaiInput(tempEnd);
    if (!s || !e) {
      setError('รูปแบบวันที่ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป (พ.ศ.)');
      return;
    }
    if (s > e) {
      setError('วันเริ่มต้นต้องมาก่อนวันสิ้นสุด');
      return;
    }
    setFilter('custom', s, e);
    setPickerOpen(false);
    setCalOpen(null);
    setError(null);
  };

  const isCustom = filterType === 'custom';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative" ref={pickerRef}>
        <button
          onClick={openPicker}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-medium transition-all ${
            isCustom
              ? 'bg-primary-600 text-white shadow-soft'
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-primary-50 hover:border-primary-300'
          }`}
          title="คลิกเพื่อเลือกช่วงวันที่เอง"
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>{formatShortThaiDate(startDate)} - {formatShortThaiDate(endDate)}</span>
        </button>

        {pickerOpen && (
          <div className="absolute top-full left-0 mt-2 z-50 bg-white rounded-2xl shadow-soft border border-gray-100 p-4 w-80">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-gray-900">เลือกช่วงวันที่</h4>
              <button
                onClick={() => { setPickerOpen(false); setCalOpen(null); setError(null); }}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Start date */}
              <div className="relative">
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  วันที่เริ่มต้น <span className="text-gray-400">(วว/ดด/ปปปป พ.ศ.)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={tempStart}
                    onChange={(e) => setTempStart(autoFormat(e.target.value))}
                    placeholder="14/05/2569"
                    maxLength={10}
                    className="w-full pl-3 pr-10 py-2 text-sm rounded-2xl bg-primary-50/50 focus:outline-none focus:ring-2 focus:ring-primary-300 font-mono tracking-wide"
                  />
                  <button
                    type="button"
                    onClick={() => setCalOpen(calOpen === 'start' ? null : 'start')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-500 hover:bg-primary-100 hover:text-primary-700"
                    title="เลือกจากปฏิทิน"
                  >
                    <Calendar className="w-4 h-4" />
                  </button>
                </div>
                {calOpen === 'start' && (
                  <ThaiMiniCalendar
                    value={parseThaiInput(tempStart)}
                    onSelect={(d) => { setTempStart(toThaiInput(d)); setCalOpen(null); }}
                    onClose={() => setCalOpen(null)}
                  />
                )}
              </div>

              {/* End date */}
              <div className="relative">
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  วันที่สิ้นสุด <span className="text-gray-400">(วว/ดด/ปปปป พ.ศ.)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={tempEnd}
                    onChange={(e) => setTempEnd(autoFormat(e.target.value))}
                    placeholder="14/05/2569"
                    maxLength={10}
                    className="w-full pl-3 pr-10 py-2 text-sm rounded-2xl bg-primary-50/50 focus:outline-none focus:ring-2 focus:ring-primary-300 font-mono tracking-wide"
                  />
                  <button
                    type="button"
                    onClick={() => setCalOpen(calOpen === 'end' ? null : 'end')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-500 hover:bg-primary-100 hover:text-primary-700"
                    title="เลือกจากปฏิทิน"
                  >
                    <Calendar className="w-4 h-4" />
                  </button>
                </div>
                {calOpen === 'end' && (
                  <ThaiMiniCalendar
                    value={parseThaiInput(tempEnd)}
                    onSelect={(d) => { setTempEnd(toThaiInput(d)); setCalOpen(null); }}
                    onClose={() => setCalOpen(null)}
                  />
                )}
              </div>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded-lg">{error}</p>
              )}

              <button
                onClick={applyCustom}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-2xl hover:bg-primary-700 transition-colors shadow-soft"
              >
                <Check className="w-4 h-4" />
                นำไปใช้
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`px-3 py-1.5 rounded-2xl text-xs font-medium transition-all duration-150 ${
              filterType === opt.value
                ? 'bg-primary-600 text-white shadow-soft'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-primary-50 hover:border-primary-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
