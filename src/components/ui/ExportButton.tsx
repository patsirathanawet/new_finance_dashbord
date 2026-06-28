import { useState } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import { exportToCSV } from '../../lib/exportUtils';

interface ExportButtonProps {
  data: Record<string, unknown>[];
  filename: string;
  label?: string;
  disabled?: boolean;
}

export default function ExportButton({
  data,
  filename,
  label = 'ส่งออก',
  disabled = false,
}: ExportButtonProps) {
  const [open, setOpen] = useState(false);

  const handleExportCSV = () => {
    exportToCSV(data, filename);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled || !data || data.length === 0}
        className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download className="w-4 h-4" />
        {label}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px]">
            <button
              onClick={handleExportCSV}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <span>📊</span>
              ส่งออก CSV
            </button>
          </div>
        </>
      )}
    </div>
  );
}
