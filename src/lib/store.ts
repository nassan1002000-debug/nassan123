'use client'

import { create } from 'zustand'

export type ScreenId =
  | 'dashboard'
  | 'accounts'
  | 'journal'
  | 'cost-centers'
  | 'treasury'
  | 'receipts'
  | 'payments'
  | 'clearings'
  | 'warehouses'
  | 'items'
  | 'stock-movements'
  | 'stocktaking'
  | 'stock-damage'
  | 'invoices'
  | 'bundles'
  | 'loyalty'
  | 'partners'
  | 'employees'
  | 'salaries'
  | 'advances'
  | 'leaves'
  | 'attendance'
  | 'bonuses'
  | 'users'
  | 'audit-log'
  | 'reports'
  | 'settings'

export interface ScreenMeta {
  id: ScreenId
  title: string
  description: string
}

export const SCREENS: Record<ScreenId, ScreenMeta> = {
  dashboard: { id: 'dashboard', title: 'لوحة التحكم', description: 'نظرة شاملة على الأداء المالي والمخزني' },
  accounts: { id: 'accounts', title: 'دليل الحسابات', description: 'الشجرة المحاسبية الهرمية' },
  journal: { id: 'journal', title: 'القيود اليومية', description: 'قيود اليومية المزدوجة' },
  'cost-centers': { id: 'cost-centers', title: 'مراكز التكلفة', description: 'توزيع التكاليف على المراكز' },
  treasury: { id: 'treasury', title: 'الصندوق', description: 'السيولة والسندات النقدية' },
  receipts: { id: 'receipts', title: 'سندات القبض', description: 'المقبوضات النقدية والبنكية' },
  payments: { id: 'payments', title: 'سندات الدفع', description: 'المدفوعات النقدية والبنكية' },
  clearings: { id: 'clearings', title: 'سندات المقاصة', description: 'موازنة الذمم المتقابلة لمن يجمع أكثر من صفة — عميل ↔ مورد ↔ موظف بلا حركة نقدية' },
  warehouses: { id: 'warehouses', title: 'المستودعات', description: 'الشجرة الهرمية للمستودعات وأمناؤها' },
  items: { id: 'items', title: 'بطاقات المواد', description: 'تعريف المواد بالصور والوحدات والإسناد المخزني' },
  'stock-movements': { id: 'stock-movements', title: 'استعلام حركة المخزون', description: 'سجل الحركات — تُنشأ تلقائياً من الجرد والتلف والفواتير' },
  stocktaking: { id: 'stocktaking', title: 'أمر الجرد', description: 'الجرد الفعلي ومطابقته وترحيل الفروقات' },
  'stock-damage': { id: 'stock-damage', title: 'تلف المخزون', description: 'حالات التلف والهدر والفقد بقيمتها' },
  invoices: { id: 'invoices', title: 'الفواتير', description: 'مبيعات ومشتريات ومردوداتها — ترحيل فوري بلا مسودات' },
  bundles: { id: 'bundles', title: 'سلال العروض', description: 'منظومة العروض الترويجية — سلال الهدية والحسم النسبي والأسعار المخفضة' },
  loyalty: { id: 'loyalty', title: 'نقاط الولاء', description: 'منظومة النقاط الديناميكية — احتساب آلي بمضاعفات صارمة واسترداد وصرف نقدي' },
  partners: { id: 'partners', title: 'العملاء والموردون', description: 'ملفات الأطراف والأرصدة والفواتير والسندات' },
  employees: { id: 'employees', title: 'ملفات الموظفين', description: 'بيانات الموظفين الأساسية' },
  salaries: { id: 'salaries', title: 'الرواتب', description: 'كشوف الرواتب الشهرية' },
  advances: { id: 'advances', title: 'السلف', description: 'سلف الموظفين' },
  leaves: { id: 'leaves', title: 'الإجازات', description: 'طلبات الإجازات' },
  attendance: { id: 'attendance', title: 'سجل الدوام', description: 'الحضور والانصراف' },
  bonuses: { id: 'bonuses', title: 'المكافآت والحسم', description: 'المكافآت والخصومات' },
  users: { id: 'users', title: 'المستخدمون والصلاحيات', description: 'إدارة المستخدمين' },
  'audit-log': { id: 'audit-log', title: 'سجل التدقيق', description: 'كل حركة داخل البرنامج موثقة — إضافة وتعديل وحذف الفواتير يراها المدير' },
  reports: { id: 'reports', title: 'التقارير', description: 'التقارير المالية والإدارية' },
  settings: { id: 'settings', title: 'الإعدادات', description: 'إعدادات النظام العامة' },
}

interface NavState {
  screen: ScreenId
  /** حالة طي الشريط الجانبي (سطح المكتب) */
  sidebarCollapsed: boolean
  navigate: (screen: ScreenId) => void
  toggleSidebar: () => void
}

export const useNav = create<NavState>((set) => ({
  screen: 'dashboard',
  sidebarCollapsed: false,
  navigate: (screen) => set({ screen }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}))

// ==================== حالة المستخدم الجاري (تسجيل الدخول) ====================

export interface SessionUser {
  id: string
  username: string
  name: string
  role: string // ADMIN | ACCOUNTANT | VIEWER
  /** P1-3: كلمة مرور افتراضية — يُجبر على تغييرها قبل استخدام النظام */
  mustChangePassword?: boolean
}

interface AuthState {
  user: SessionUser | null
  setUser: (user: SessionUser | null) => void
  /** وضع استعراض فترة سابقة (قراءة فقط) — يُملأ من /api/auth/me أو عند الدخول للاستعراض */
  viewPeriod: ViewPeriodInfo | null
  setViewPeriod: (p: ViewPeriodInfo | null) => void
}

export interface ViewPeriodInfo {
  id: string
  label: string
  closingDate: string
  openingDate: string
  openingEntryNumber: string | null
  closedBy: string
}

export const useApp = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  viewPeriod: null,
  setViewPeriod: (viewPeriod) => set({ viewPeriod }),
}))

/** هل نستعرض الآن فترة مقفلة؟ — الشاشات تستخدمه لإخفاء أزرار الإضافة/التعديل/الحذف (الشرط 4) */
export const useIsArchive = (): boolean => useApp((s) => s.viewPeriod !== null)
