/**
 * Fund metadata สำหรับหน้า ECLAIM ทั้ง 6 funds
 *  - slug: URL param `/eclaim/:slug`
 *  - code: ส่งเป็น fundCode ไป backend (filter invoice_doc)
 *  - icon: lucide-react component
 *  - colorBg/colorText: Tailwind class (hardcoded เพื่อกัน purge)
 */
import type { LucideIcon } from 'lucide-react';
import { ShieldCheck, Landmark, Building, GraduationCap, Zap } from 'lucide-react';

export interface FundMeta {
  slug: string;
  code: string;
  name: string;
  description: string;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
}

export const ECLAIM_FUNDS: Record<string, FundMeta> = {
  'ofc-direct': {
    slug: 'ofc-direct',
    code: 'OFC',
    name: 'สิทธิเบิกจ่ายตรง',
    description: 'กรมบัญชีกลาง — สวัสดิการข้าราชการ (CSMBS)',
    icon: ShieldCheck,
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-600',
  },
  'ofc-local': {
    slug: 'ofc-local',
    code: 'LGO',
    name: 'สิทธิอปท',
    description: 'องค์กรปกครองส่วนท้องถิ่น (Local Government)',
    icon: Landmark,
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
  'sss': {
    slug: 'sss',
    code: 'SSS',
    name: 'สิทธิประกันสังคม',
    description: 'กองทุนประกันสังคม',
    icon: Building,
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-600',
  },
  'bkk': {
    slug: 'bkk',
    code: 'BKK',
    name: 'สิทธิกรุงเทพมหานคร',
    description: 'สวัสดิการพนักงาน กทม.',
    icon: Building,
    iconBg: 'bg-rose-100',
    iconColor: 'text-rose-600',
  },
  'pvt': {
    slug: 'pvt',
    code: 'PVT',
    name: 'สิทธิครูเอกชน',
    description: 'กองทุนสงเคราะห์ครูใหญ่ในโรงเรียนเอกชน',
    icon: GraduationCap,
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600',
  },
  'srt': {
    slug: 'srt',
    code: 'SRT',
    name: 'สิทธิการไฟฟ้า',
    description: 'การไฟฟ้าฝ่ายผลิต / นครหลวง / ส่วนภูมิภาค',
    icon: Zap,
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
};

export function getFundMeta(slug: string | undefined): FundMeta | null {
  if (!slug) return null;
  return ECLAIM_FUNDS[slug] ?? null;
}
