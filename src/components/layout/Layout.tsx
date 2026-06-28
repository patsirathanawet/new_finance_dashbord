import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

const PAGE_TITLES: Record<string, string> = {
  '/': 'สรุปภาพรวม',
  '/nhso': 'สปสช. (NHSO)',
  '/government': 'ข้าราชการ / กรมบัญชีกลาง',
  '/social': 'ประกันสังคม',
  '/insurance': 'ประกันชีวิต / ประกันสุขภาพ',
  '/self-pay': 'ชำระเอง',
  '/ipd': 'ผู้ป่วยใน (IPD)',
  '/er': 'ห้องฉุกเฉิน (ER)',
  '/opd': 'ผู้ป่วยนอก (OPD)',
};

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const pageTitle = PAGE_TITLES[location.pathname] || 'BMS Dashboard';

  return (
    <div className="flex h-screen overflow-hidden p-4 gap-4">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden gap-4">
        <Header
          onMenuToggle={() => setSidebarOpen(true)}
          pageTitle={pageTitle}
        />
        <main className="flex-1 overflow-y-auto bg-white rounded-3xl shadow-soft p-5 lg:p-6 scrollbar-thin">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
