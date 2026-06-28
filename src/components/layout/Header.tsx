import { Menu, LogOut, Wifi, WifiOff, RefreshCw, Building2, Home } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import DateRangePicker from '../ui/DateRangePicker';
import { useSessionStore } from '../../store/sessionStore';
import { useBmsSession } from '../../hooks/useBmsSession';
import { useSQLFirst } from '../../hooks/useSQL';

interface HeaderProps {
  onMenuToggle: () => void;
  pageTitle?: string;
}

interface OpdConfigRow {
  hospital_info: string;
}

/** ดึงรหัส + ชื่อ รพ. จากตาราง opdconfig — แสดงเป็น chip บน header */
function HospitalInfo() {
  const { data, isLoading, error } = useSQLFirst<OpdConfigRow>(
    ['header', 'opdconfig'],
    `SELECT CONCAT(hospitalcode, ' : ', hospitalname) AS hospital_info FROM opdconfig`,
  );

  if (isLoading || error || !data?.hospital_info) return null;

  return (
    <div className="hidden lg:flex items-center gap-2.5 px-5 py-2.5 rounded-2xl bg-primary-50 text-primary-700 font-semibold max-w-[600px]" style={{ fontSize: 20 }}>
      <Building2 className="w-5 h-5 flex-shrink-0" />
      <span className="truncate" title={data.hospital_info}>{data.hospital_info}</span>
    </div>
  );
}

export default function Header({ onMenuToggle, pageTitle }: HeaderProps) {
  const { isConnected, databaseName, userName } = useSessionStore();
  const { logout } = useBmsSession();
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries();
  };

  return (
    <header className="bg-white rounded-3xl shadow-soft px-5 py-3">
      <div className="flex items-center gap-3">
        {/* Menu toggle (mobile) */}
        <button
          onClick={onMenuToggle}
          className="lg:hidden p-2 rounded-2xl bg-primary-50 hover:bg-primary-100 transition-colors"
        >
          <Menu className="w-5 h-5 text-primary-700" />
        </button>

        {/* Page title — pill style */}
        {pageTitle && (
          <div className="bg-primary-600 text-white px-5 py-2.5 rounded-2xl shadow-soft">
            <h1 className="text-sm font-semibold whitespace-nowrap">{pageTitle}</h1>
          </div>
        )}

        {/* Date range picker — pill (กลาง) */}
        <div className="hidden md:block">
          <DateRangePicker />
        </div>

        {/* Hospital info (จาก opdconfig) */}
        <div className="flex-1 flex justify-center">
          <HospitalInfo />
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2 ml-auto md:ml-0">
          {/* Connection chip */}
          <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
            isConnected
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-700'
          }`}>
            {isConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            <span className="truncate max-w-[120px]">
              {isConnected ? (databaseName || 'เชื่อมต่อแล้ว') : 'ไม่ได้เชื่อมต่อ'}
            </span>
          </div>

          <button
            onClick={handleRefresh}
            title="รีเฟรชข้อมูล"
            className="p-2 rounded-full bg-primary-50 hover:bg-primary-100 transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-primary-700" />
          </button>

          <a
            href="/index_first.html"
            title="กลับหน้าหลัก"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-50 hover:bg-primary-100 transition-colors text-primary-700 text-xs font-semibold"
          >
            <Home className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">หน้าหลัก</span>
          </a>

          <button
            onClick={logout}
            title="ออกจากระบบ"
            className="p-2 rounded-full bg-primary-50 hover:bg-red-100 transition-colors"
          >
            <LogOut className="w-4 h-4 text-primary-700" />
          </button>

          {/* User avatar */}
          {userName && (
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center text-white text-sm font-semibold shadow-soft" title={userName}>
              {userName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      </div>

      {/* Mobile date filter */}
      <div className="md:hidden mt-3">
        <DateRangePicker />
      </div>
    </header>
  );
}
