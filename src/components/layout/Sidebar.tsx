import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ShieldCheck,
  Building,
  GraduationCap,
  Zap,
  Landmark,
  Table,
  FileText,
  Database,
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

// เมนูที่เปิดใช้งานปัจจุบัน — เปิดเพิ่มได้โดย uncomment ที่ HIDDEN_ITEMS ด้านล่าง
const FINANCE_ITEMS: NavItem[] = [
  { path: '/', label: 'สรุปภาพรวม', icon: LayoutDashboard },
];

const ECLAIM_ITEMS: NavItem[] = [
  { path: '/claims',            label: 'เอกสารเคลม REP/STM',      icon: FileText },
  { path: '/eclaim/ofc-direct', label: 'สิทธิเบิกจ่ายตรง [OFC]',   icon: ShieldCheck },
  { path: '/eclaim/ofc-local',  label: 'สิทธิอปท [LGO]',           icon: Landmark },
  { path: '/eclaim/sss',        label: 'สิทธิประกันสังคม [SSS]',    icon: Building },
  { path: '/eclaim/bkk',        label: 'สิทธิกทม. [BKK]',           icon: Building },
  { path: '/eclaim/pvt',        label: 'สิทธิครูเอกชน [PVT]',       icon: GraduationCap },
  { path: '/eclaim/srt',        label: 'สิทธิการไฟฟ้า [SRT]',       icon: Zap },
];

// เมนูคลินิกทั้งกลุ่ม — ซ่อนทั้งหมวด (เปิดทีหลังเมื่อพร้อมใช้)
const CLINICAL_ITEMS: NavItem[] = [];

// เมนูตั้งค่า (admin only)
const SETTINGS_ITEMS: NavItem[] = [
  { path: '/settings/db-config', label: 'จัดการตาราง', icon: Table },
  { path: '/settings/claim-db', label: 'DB เอกสารตอบกลับ', icon: Database },
];

/**
 * เมนูที่ซ่อนอยู่ — ตอนต้องการใช้:
 *   ย้ายรายการมาที่ FINANCE_ITEMS หรือ CLINICAL_ITEMS ด้านบน + uncomment import icon ที่ใช้
 *
 * import { HeartPulse, Heart, CreditCard, BedDouble, Ambulance, Users } from 'lucide-react';
 *
 * Finance:
 *   { path: '/nhso',      label: 'สปสช.',        icon: HeartPulse }
 *   { path: '/insurance', label: 'ประกันชีวิต', icon: Heart      }
 *   { path: '/self-pay',  label: 'ชำระเอง',      icon: CreditCard }
 *
 * Clinical:
 *   { path: '/ipd', label: 'ผู้ป่วยใน',  icon: BedDouble }
 *   { path: '/er',  label: 'ห้องฉุกเฉิน', icon: Ambulance }
 *   { path: '/opd', label: 'ผู้ป่วยนอก',  icon: Users     }
 */

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

function SidebarNavItem({ item, onClick }: { item: NavItem; onClick?: () => void }) {
  const IconComponent = item.icon;
  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-2.5 rounded-2xl text-sm font-medium transition-all ${
          isActive
            ? 'bg-primary-600 text-white shadow-soft'
            : 'text-gray-600 hover:bg-primary-50 hover:text-primary-700'
        }`
      }
    >
      <IconComponent className="flex-shrink-0 w-[18px] h-[18px]" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

/** Collapsible section header — กดเพื่อย่อ/ขยาย */
function SidebarSection({
  title, items, defaultOpen = true, onItemClick,
}: {
  title: string;
  items: NavItem[];
  defaultOpen?: boolean;
  onItemClick?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider hover:text-primary-700 transition-colors"
      >
        <span>{title}</span>
        {open
          ? <ChevronDown className="w-3 h-3" />
          : <ChevronRight className="w-3 h-3" />}
      </button>
      {open && (
        <div className="space-y-1 mt-0.5">
          {items.map((item) => (
            <SidebarNavItem key={item.path} item={item} onClick={onItemClick} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * BMS logo — ใช้รูปจริงจาก public/bms-logo.png (308x59 px)
 * แสดง icon ขนาด **ต้นฉบับ 1:1** ไม่ zoom — ตัดเฉพาะข้อความ "Bangkok..." ฝั่งขวาออก
 *  - image แสดงเต็มขนาด natural 308x59 px
 *  - crop window 80x59 px (ส่วน icon ซ้ายสุด)
 *  - card รอบมี padding + gradient background + rounded corner
 */
function BmsLogo() {
  const assetBase = import.meta.env.BASE_URL || '/';
  return (
    <div className="flex justify-center">
      <video
        src={`${assetBase}logo-extracted2.mp4`}
        poster={`${assetBase}bms-logo.png`}
        autoPlay
        loop
        muted
        playsInline
        disablePictureInPicture
        className="block select-none drop-shadow-md pointer-events-none"
        style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: '50%' }}
      >
        {/* Fallback for browsers that don't support video */}
        <img
          src={`${assetBase}bms-logo.png`}
          alt="Bangkok Medical Software"
          style={{ width: 100, height: 100 }}
        />
      </video>
    </div>
  );
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const isAdmin = useSessionStore((s) => s.isAdmin);
  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar — ทำเป็น card ลอย */}
      <aside
        className={`fixed top-4 left-4 bottom-4 w-60 bg-white rounded-3xl shadow-soft z-40 flex flex-col transition-transform duration-300 lg:translate-x-0 lg:static lg:top-0 lg:left-0 lg:bottom-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-[110%]'
        }`}
      >
        {/* Brand area — logo + caption */}
        <div className="px-5 pt-6 pb-5 relative">
          <button
            onClick={onClose}
            className="lg:hidden absolute top-3 right-3 p-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>

          <BmsLogo />

          <div className="text-center mt-3">
            <h1 className="text-base font-bold bg-gradient-to-r from-primary-600 to-primary-800 bg-clip-text text-transparent tracking-wide leading-tight">
              Bangkok Medical
              <br />
              Software
            </h1>
            <p className="text-[11px] text-gray-400 mt-1">BMS Finance Dashboard</p>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-5 h-px bg-gradient-to-r from-transparent via-primary-100 to-transparent" />

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-3 scrollbar-thin">
          <SidebarSection title="การเงิน / Finance" items={FINANCE_ITEMS} onItemClick={onClose} />
          <SidebarSection title="ECLAIM" items={ECLAIM_ITEMS} onItemClick={onClose} />
          {CLINICAL_ITEMS.length > 0 && (
            <SidebarSection title="คลินิก / Clinical" items={CLINICAL_ITEMS} onItemClick={onClose} />
          )}
          {isAdmin && (
            <SidebarSection title="ตั้งค่า / Settings" items={SETTINGS_ITEMS} onItemClick={onClose} />
          )}
        </nav>

        {/* Footer */}
        <div className="px-4 pb-4">
          <div className="bg-primary-50 rounded-2xl p-3 text-center">
            <div className="text-2xl mb-0.5">👨‍⚕️</div>
            <p className="text-[10px] text-gray-400">v1.0.0</p>
          </div>
        </div>
      </aside>
    </>
  );
}
