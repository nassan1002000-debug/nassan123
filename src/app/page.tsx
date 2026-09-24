'use client'

import { useEffect, useState, type ComponentType } from 'react'
import { useSyncExternalStore } from 'react'
import { Loader2 } from 'lucide-react'
import { useApp, useNav, type ScreenId } from '@/lib/store'
import { setDecimalPlaces, setExchangeRate, type DecimalPlaces } from '@/lib/format'
import {
  installArchiveFetch,
  uninstallArchiveFetch,
  subscribeArchiveFetch,
  isArchiveFetchInstalled,
} from '@/lib/archive-fetch'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { AppTopbar } from '@/components/layout/app-topbar'
import { ArchiveBanner } from '@/components/layout/archive-banner'
import { ShortcutsLayer } from '@/components/layout/shortcuts-layer'
import { PlaceholderScreen } from '@/components/common/placeholder-screen'
import { LoginScreen } from '@/components/screens/auth/login-screen'
import { ForcedChangePassword } from '@/components/screens/auth/forced-change-password'
import DashboardScreen from '@/components/screens/dashboard-screen'
import TreasuryScreen from '@/components/screens/treasury-screen'
import AccountsScreen from '@/components/screens/accounts-screen'
import JournalScreen from '@/components/screens/journal-screen'
import ReceiptsScreen from '@/components/screens/receipts-screen'
import PaymentsScreen from '@/components/screens/payments-screen'
import ClearingsScreen from '@/components/screens/clearings/clearings-screen'
import WarehousesScreen from '@/components/screens/warehouses/warehouses-screen'
import ItemsScreen from '@/components/screens/items/items-screen'
import StockMovementsScreen from '@/components/screens/stock/stock-movements-screen'
import StocktakingScreen from '@/components/screens/stock/stocktaking-screen'
import StockDamageScreen from '@/components/screens/stock/stock-damage-screen'
import { PartnersScreen } from '@/components/screens/partners/partners-screen'
import { BundlesScreen } from '@/components/screens/bundles/bundles-screen'
import { LoyaltyScreen } from '@/components/screens/loyalty/loyalty-screen'
import { InvoicesScreen } from '@/components/screens/invoices/invoices-screen'
import { AuditLogScreen } from '@/components/screens/audit/audit-log-screen'
import CostCentersScreen from '@/components/screens/cost-centers/cost-centers-screen'
import ReportsScreen from '@/components/screens/reports/reports-screen'
import SettingsScreen from '@/components/screens/settings/settings-screen'
import UsersScreen from '@/components/screens/users/users-screen'
import EmployeesScreen from '@/components/screens/hr/employees-screen'
import SalariesScreen from '@/components/screens/hr/salaries-screen'
import AdvancesScreen from '@/components/screens/hr/advances-screen'
import LeavesScreen from '@/components/screens/hr/leaves-screen'
import AttendanceScreen from '@/components/screens/hr/attendance-screen'
import BonusesScreen from '@/components/screens/hr/bonuses-screen'

/**
 * سجل الشاشات المنفَّذة — المصدر الوحيد لربط معرف الشاشة بمكوّنها.
 * إضافة شاشة جديدة = سطر واحد هنا، والعرض/الاحتياط يُشتقان تلقائياً
 * بالإقصاء المتبادل (يستحيل معمارياً عرض شاشة حقيقية مع Placeholder).
 */
const SCREEN_COMPONENTS: Partial<Record<ScreenId, ComponentType>> = {
  dashboard: DashboardScreen,
  treasury: TreasuryScreen,
  accounts: AccountsScreen,
  journal: JournalScreen,
  receipts: ReceiptsScreen,
  payments: PaymentsScreen,
  clearings: ClearingsScreen,
  warehouses: WarehousesScreen,
  items: ItemsScreen,
  'stock-movements': StockMovementsScreen,
  stocktaking: StocktakingScreen,
  'stock-damage': StockDamageScreen,
  partners: PartnersScreen,
  invoices: InvoicesScreen,
  bundles: BundlesScreen,
  loyalty: LoyaltyScreen,
  'audit-log': AuditLogScreen,
  'cost-centers': CostCentersScreen,
  reports: ReportsScreen,
  settings: SettingsScreen,
  users: UsersScreen,
  employees: EmployeesScreen,
  salaries: SalariesScreen,
  advances: AdvancesScreen,
  leaves: LeavesScreen,
  attendance: AttendanceScreen,
  bonuses: BonusesScreen,
}

export default function Home() {
  const screen = useNav((s) => s.screen)
  const setUser = useApp((s) => s.setUser)
  const user = useApp((s) => s.user)
  const viewPeriod = useApp((s) => s.viewPeriod)
  const setViewPeriod = useApp((s) => s.setViewPeriod)

  // بوابة الدخول: فحص الجلسة عند الإقلاع — بلا جلسة تُعرض شاشة تسجيل الدخول بدل التطبيق
  const [auth, setAuth] = useState<'checking' | 'guest' | 'ready'>('checking')

  // وضع استعراض الأرشيف (الشرط 4: النسخة الكاملة للقراءة فقط):
  // غلاف fetch يُثبَّت قبل فتح أي شاشة بيانات — البوابة تُغلق ما لم يكن الغلاف
  // مركّباً (في الأرشيف) أو لا حاجة له أصلاً (في الحي) — فلا يلمس طلب أول بيانات
  // القاعدة الحية. حالة التثبيت مخزن خارجي (useSyncExternalStore) بلا setState داخل effect
  const inArchive = !!viewPeriod
  const archiveFetchReady = useSyncExternalStore(
    subscribeArchiveFetch,
    isArchiveFetchInstalled,
    () => false,
  )
  const archiveGateOpen = !inArchive || archiveFetchReady

  useEffect(() => {
    // مزامنة مع نظام خارجي فقط — لا حالة React هنا
    if (inArchive) installArchiveFetch()
    else uninstallArchiveFetch()
  }, [inArchive])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/auth/me')
        const data = (await res.json().catch(() => null)) as {
          user?: { id: string; username: string; name: string; role: string; mustChangePassword?: boolean }
          viewPeriod?: {
            id: string
            label: string
            closingDate: string
            openingDate: string
            openingEntryNumber: string
            closedBy: string
          } | null
        } | null
        if (!alive) return
        if (res.ok && data?.user) {
          setUser(data.user)
          setViewPeriod(data.viewPeriod ?? null)
          setAuth('ready')
        } else {
          setUser(null)
          setViewPeriod(null)
          setAuth('guest')
        }
      } catch {
        if (alive) setAuth('guest')
      }
    })()
    return () => {
      alive = false
    }
  }, [setUser, setViewPeriod])

  // جلب الإعدادات من القاعدة بعد الدخول فقط — سعر الصرف يُطبق حياً على كل الشاشات
  // (التهيئة المتزامنة من localStorage حدثت أصلاً في format.ts — هنا نزامن مع القاعدة)
  useEffect(() => {
    if (auth !== 'ready') return
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/settings')
        const data = await res.json().catch(() => null)
        if (!alive || !res.ok || !data) return
        const rate = Number.parseFloat(String(data.exchangeRate ?? ''))
        if (Number.isFinite(rate) && rate >= 1 && rate <= 1_000_000) setExchangeRate(rate)
        const dp = String(data.decimalPlaces ?? '')
        if (dp === '0' || dp === '1' || dp === '2') setDecimalPlaces(Number(dp) as DecimalPlaces)
      } catch {
        // الإعدادات المحلية (localStorage) تكفي حتى استعادة الاتصال
      }
    })()
    return () => {
      alive = false
    }
  }, [auth])

  // شاشة الفحص — تمنع وميض التطبيق قبل معرفة حالة الجلسة
  if (auth === 'checking') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground">جارٍ التحقق من الجلسة…</p>
      </div>
    )
  }

  // بلا جلسة صالحة — شاشة تسجيل الدخول بدل التطبيق كاملاً
  if (auth === 'guest' || !user) {
    return (
      <LoginScreen
        onSuccess={(u, vp) => {
          setUser(u)
          setViewPeriod(vp ?? null)
          setAuth('ready')
        }}
      />
    )
  }

  // P1-3: جلسة سارية لكن كلمة المرور افتراضية — حاجز التغيير الإلزامي قبل أي شاشة
  if (user.mustChangePassword) {
    return <ForcedChangePassword user={user} onDone={(u) => setUser(u)} />
  }

  // بوابة تركيب غلاف الأرشيف — لحظة واحدة قبل فتح الشاشات (ضمان قراءة أول طلب من الأرشيف)
  if (!archiveGateOpen) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground">جارٍ تجهيز أرشيف الفترة المقفلة…</p>
      </div>
    )
  }

  // الشاشة الفعالة: المكوّن المسجَّل أو الاحتياطية — الإقصاء المتبادل مضمون
  const ActiveScreen = SCREEN_COMPONENTS[screen] ?? PlaceholderScreen

  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col min-h-screen">
        {viewPeriod ? <ArchiveBanner /> : null}
        <AppTopbar />
        {/* Task 40 — طبقة الاختصارات المركزية: البحث الذكي + دليل الاختصارات + مستمع لوحة المفاتيح */}
        <ShortcutsLayer />
        <main className="flex-1 p-3 md:p-4">
          <ActiveScreen />
        </main>
        <footer className="no-print mt-auto border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-xs text-muted-foreground">
          نظام المحاسبة والمخزون — شركة الأمل التجارية 2026 ©
        </footer>
      </div>
    </div>
  )
}
