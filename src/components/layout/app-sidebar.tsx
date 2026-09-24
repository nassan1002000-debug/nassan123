'use client'

import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useNav, SCREENS, type ScreenId } from '@/lib/store'
import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard,
  BookOpen,
  ScrollText,
  Target,
  Landmark,
  ArrowDownCircle,
  ArrowUpCircle,
  Scale,
  Warehouse,
  Package,
  Repeat,
  ClipboardCheck,
  PackageX,
  FileText,
  ShoppingBasket,
  Star,
  Users,
  UserSquare,
  Banknote,
  HandCoins,
  CalendarDays,
  Clock,
  Gift,
  ShieldCheck,
  History,
  PieChart,
  Settings,
  Calculator,
  PanelRightClose,
  PanelRightOpen,
  ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface NavItem {
  id: ScreenId
  icon: LucideIcon
}

interface NavGroup {
  /** الرقم الصريح للمجموعة (1..7) كما اعتمده المالك */
  num: number
  label: string
  items: NavItem[]
}

/**
 * المجموعات الرئيسية السبع الصريحة — نظام الطي والانسدال
 * (1. المحاسبة | 2. الصندوق والنقدية | 3. المخزون | 4. التجارية | 5. الموارد البشرية | 6. الإدارة | 7. الإعدادات)
 * — «لوحة التحكم» بند رئيسي مستقل يتربع أعلى القائمة (خارج المجموعات) —
 * — شاشة «المستخدمون والصلاحيات» بند داخلي معزول تحت مجموعة الإعدادات.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    num: 1,
    label: 'المحاسبة',
    items: [
      { id: 'accounts', icon: BookOpen },
      { id: 'journal', icon: ScrollText },
      { id: 'cost-centers', icon: Target },
    ],
  },
  {
    num: 2,
    label: 'الصندوق والنقدية',
    items: [
      { id: 'treasury', icon: Landmark },
      { id: 'receipts', icon: ArrowDownCircle },
      { id: 'payments', icon: ArrowUpCircle },
      { id: 'clearings', icon: Scale },
    ],
  },
  {
    num: 3,
    label: 'المخزون',
    items: [
      { id: 'warehouses', icon: Warehouse },
      { id: 'items', icon: Package },
      { id: 'stock-movements', icon: Repeat },
      { id: 'stocktaking', icon: ClipboardCheck },
      { id: 'stock-damage', icon: PackageX },
    ],
  },
  {
    num: 4,
    label: 'التجارية',
    items: [
      { id: 'invoices', icon: FileText },
      { id: 'bundles', icon: ShoppingBasket },
      { id: 'loyalty', icon: Star },
      { id: 'partners', icon: Users },
    ],
  },
  {
    num: 5,
    label: 'الموارد البشرية',
    items: [
      { id: 'employees', icon: UserSquare },
      { id: 'salaries', icon: Banknote },
      { id: 'advances', icon: HandCoins },
      { id: 'leaves', icon: CalendarDays },
      { id: 'attendance', icon: Clock },
      { id: 'bonuses', icon: Gift },
    ],
  },
  {
    num: 6,
    label: 'الإدارة',
    items: [
      { id: 'reports', icon: PieChart },
      { id: 'audit-log', icon: History },
    ],
  },
  {
    num: 7,
    label: 'الإعدادات',
    items: [
      { id: 'settings', icon: Settings },
      // بند داخلي معزول — المستخدمون والصلاحيات
      { id: 'users', icon: ShieldCheck },
    ],
  },
]

/** خريطة سريعة: كل شاشة داخل المجموعات ← رقم مجموعتها (لوحة التحكم المستقلة بلا مجموعة) */
const GROUP_OF_SCREEN: Partial<Record<ScreenId, number>> = (() => {
  const map: Partial<Record<ScreenId, number>> = {}
  for (const g of NAV_GROUPS) for (const item of g.items) map[item.id] = g.num
  return map
})()

/* ==================== نمط الأزرار المجسمة (3D Glossy — Dark Neon) ====================
 * زر مجسم دائري بارز: تدرج رمادي ملكي عميق + إضاءة علوية داخلية + ظل سفلي جازم
 * + هالة نيون خفيفة بلون هوية النظام (--primary: زمردي نهاراً / ذهبي ليلاً)
 * موحّد على: البند المستقل + رؤوس المجموعات السبع + البنود الداخلية الـ 26 بلا استثناء —
 * الهوفر يتنفس ويغوص (translate) والضغط يغوص أكثر (scale) — والشريط داكن في الوضعين فيتناغم مع كليهما.
 */
const GLOSSY_TRANSITION = 'transition-all duration-200 ease-out active:scale-[0.98] active:translate-y-0'
const GLOSSY_IDLE =
  'text-muted-foreground hover:bg-gradient-to-b hover:from-zinc-600/40 hover:to-zinc-800/70 hover:text-zinc-100 hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10),0_4px_12px_-4px_rgba(0,0,0,0.55)] hover:translate-y-px'
const GLOSSY_ACTIVE =
  'bg-gradient-to-b from-zinc-600/70 via-zinc-800 to-zinc-900 text-zinc-50 font-semibold shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),inset_0_-1px_0_0_rgba(0,0,0,0.45),0_6px_16px_-6px_rgba(0,0,0,0.65),0_0_18px_-6px_color-mix(in_oklab,var(--primary)_55%,transparent)] ring-1 ring-white/10'
/** البند الداخلي النشط (المُتصفَّح الآن): أبرز عنصر في القائمة كلها بلا منازع —
 * نفس الجسامة المجسمة + هالة نيون مزدوجة أقوى (حلقة قريبة حادة + هالة واسعة ناعمة) ونص أبيض عريض
 * — تفوق بروزاً رأس المجموعة المفتوحة ولوحة التحكم حتى يقرأ التسلسل الهرمي «أنت هنا». */
const GLOSSY_ACTIVE_ITEM =
  'bg-gradient-to-b from-zinc-600/80 via-zinc-800 to-zinc-900 text-white font-bold ring-1 ring-white/15 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22),inset_0_-1px_0_0_rgba(0,0,0,0.50),0_6px_18px_-6px_rgba(0,0,0,0.75),0_0_22px_-4px_color-mix(in_oklab,var(--primary)_85%,transparent),0_0_38px_-8px_color-mix(in_oklab,var(--primary)_55%,transparent)]'

function NavItems({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void
  collapsed?: boolean
}) {
  const { screen, navigate } = useNav()

  // حالة الانسدال: كل تدفق يدوي (فتح/إغلاق) يُسجَّل مع «شاشة السياق» لحظة تسجيله —
  // فتجاوز الإغلاق يُحترم ما دام المالك على نفس الشاشة، وأي تنقل لاحق إلى بند داخل
  // مجموعة مغلقة (من القائمة أو البحث المركزي أو اختصارات لوحة المفاتيح) يفتحها
  // تلقائياً بالاشتقاق البحت — فلا يبقى البند النشط مدفوناً داخل مجموعة مغلقة أبداً.
  const [overrides, setOverrides] = useState<Record<number, { open: boolean; at: ScreenId }>>({})
  const activeGroupNum = GROUP_OF_SCREEN[screen]

  const isGroupOpen = (num: number) => {
    const ov = overrides[num]
    if (ov) {
      // إغلاق قديم سُجّل من شاشة أخرى: يُهمَل وتستأنف المجموعة سلوكها الافتراضي (اتباع النشط)
      if (!ov.open && ov.at !== screen) return num === activeGroupNum
      return ov.open
    }
    return num === activeGroupNum
  }

  // نظام «أكورديون منفرد»: فتح أي مجموعة يطوي كل المجموعات الأخرى المفتوحة تلقائياً
  // لمنع ازدحام القائمة — الإغلاق اليدوي لا يمس بقية المجموعات.
  const toggleGroup = (num: number) => {
    const willOpen = !isGroupOpen(num)
    setOverrides((prev) => {
      if (willOpen) {
        const next: Record<number, { open: boolean; at: ScreenId }> = {}
        for (const g of NAV_GROUPS) {
          next[g.num] = { open: g.num === num, at: screen }
        }
        return next
      }
      return { ...prev, [num]: { open: false, at: screen } }
    })
  }

  const goto = (id: ScreenId) => {
    navigate(id)
    onNavigate?.()
  }

  // ==================== البند الرئيسي المستقل: لوحة التحكم ====================
  const dashboardActive = screen === 'dashboard'
  const dashboardButton = (
    <button
      type="button"
      onClick={() => goto('dashboard')}
      aria-current={dashboardActive ? 'page' : undefined}
      aria-label={collapsed ? SCREENS.dashboard.title : undefined}
      className={cn(
        GLOSSY_TRANSITION,
        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[15px]',
        collapsed && 'justify-center px-0',
        dashboardActive ? GLOSSY_ACTIVE : GLOSSY_IDLE,
      )}
    >
      <LayoutDashboard
        className={cn(
          'h-[18px] w-[18px] shrink-0 transition-colors',
          dashboardActive ? 'text-primary drop-shadow-[0_0_6px_color-mix(in_oklab,var(--primary)_70%,transparent)]' : 'text-muted-foreground group-hover:text-zinc-100',
        )}
      />
      {!collapsed && <span className="truncate">لوحة التحكم</span>}
      {!collapsed && dashboardActive && (
        <span
          className="mr-auto h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]"
          aria-hidden="true"
        />
      )}
    </button>
  )

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        className={cn('flex-1 overflow-y-auto space-y-3 px-3 py-2', collapsed && 'px-2')}
        aria-label="التنقل الرئيسي"
      >
        {/* لوحة التحكم — بند مستقل يتربع أعلى القائمة بالكامل */}
        <div>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>{dashboardButton}</TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                {SCREENS.dashboard.title}
              </TooltipContent>
            </Tooltip>
          ) : (
            dashboardButton
          )}
        </div>

        {NAV_GROUPS.map((group) => {
          // في وضع الأيقونات المطوي كل المجموعات مفتوحة إجبارياً — الانسدال للوضع الموسع فقط
          const open = collapsed || isGroupOpen(group.num)
          return (
            <div key={group.num}>
              {/* في وضع الأيقونات المطوي: فاصل بصري فقط — كل الأيقونات ظاهرة دائماً */}
              {collapsed ? (
                <div className="mx-2 mb-1.5 border-t border-sidebar-border/60" aria-hidden="true" />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.num)}
                  aria-expanded={open}
                  aria-controls={`nav-group-${group.num}`}
                  className={cn(
                    GLOSSY_TRANSITION,
                    'flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5 text-[13px] font-semibold uppercase tracking-wide',
                    // المجموعة المفتوحة (المضغوطة) زر مجسم نشط كامل — والمغلقة تحصل على هوفر مجسم يتنفس
                    open ? GLOSSY_ACTIVE : GLOSSY_IDLE,
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-[10px] font-bold',
                      open
                        ? 'bg-white/10 text-zinc-50 ring-1 ring-white/15'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {group.num}
                  </span>
                  <span className="truncate">{group.label}</span>
                  <ChevronDown
                    className={cn(
                      'mr-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200',
                      !open && 'rotate-90',
                    )}
                    aria-hidden="true"
                  />
                </button>
              )}
              {/* الانسدال الناعم — شبكة 0fr↔1fr بانتقال حقيقي على تدفق الصفحة:
                  المجموعات تحتها تنزاح للأسفل بسلاسة تلقائياً، ولا يوجد أي تموضع
                  مطلق أو تراكب — الظلال المجسمة تعيش داخل هوامش التنفس (px-1 pt-1.5 pb-3)
                  فلا «تركب» فوق البنود، والمحتوى المطوي inert فلا يُركَّز بالخطأ. */}
              <div
                className={cn(
                  'grid transition-[grid-template-rows] duration-300 ease-out',
                  open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                )}
              >
                <div
                  id={`nav-group-${group.num}`}
                  className="min-h-0 overflow-hidden"
                  inert={!open}
                >
                  <ul
                    className={cn(
                      'space-y-1.5 px-1 pb-3 pt-1.5 transition-opacity duration-200',
                      open ? 'opacity-100' : 'opacity-0',
                      collapsed && 'px-0',
                    )}
                  >
                  {group.items.map(({ id, icon: Icon }) => {
                    const active = screen === id
                    const button = (
                      <button
                        type="button"
                        onClick={() => goto(id)}
                        aria-current={active ? 'page' : undefined}
                        aria-label={collapsed ? SCREENS[id].title : undefined}
                        className={cn(
                          GLOSSY_TRANSITION,
                          'group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[15px]',
                          collapsed && 'justify-center px-0',
                          // البند الذي تتصفحه الآن = الأبرز بصرياً في القائمة كلها (هالة مزدوجة + عريض أبيض)
                          active ? GLOSSY_ACTIVE_ITEM : GLOSSY_IDLE,
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-4 w-4 shrink-0 transition-colors',
                            active
                              ? 'text-primary drop-shadow-[0_0_8px_color-mix(in_oklab,var(--primary)_75%,transparent)]'
                              : 'text-muted-foreground group-hover:text-zinc-100',
                          )}
                        />
                        {!collapsed && <span className="truncate">{SCREENS[id].title}</span>}
                        {!collapsed && active && (
                          <span
                            className="mr-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    )
                    return (
                      <li key={id}>
                        {collapsed ? (
                          <Tooltip>
                            <TooltipTrigger asChild>{button}</TooltipTrigger>
                            <TooltipContent side="left" className="text-xs">
                              {SCREENS[id].title}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          button
                        )}
                      </li>
                    )
                  })}
                  </ul>
                </div>
              </div>
            </div>
          )
        })}
      </nav>
    </TooltipProvider>
  )
}

function BrandHeader({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b py-4',
        collapsed ? 'justify-center px-2' : 'px-4',
      )}
    >
      <div className="rounded-xl bg-primary p-2 text-primary-foreground shadow-[0_0_14px_-4px_color-mix(in_oklab,var(--primary)_60%,transparent)] shrink-0">
        <Calculator className="h-5 w-5" />
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <h1 className="text-[15px] font-bold leading-tight truncate">نظام المحاسبة والمخزون</h1>
          <p className="text-[11px] text-muted-foreground truncate">شركة الأمل التجارية 2026</p>
        </div>
      )}
    </div>
  )
}

export function AppSidebar() {
  const collapsed = useNav((s) => s.sidebarCollapsed)
  const toggleSidebar = useNav((s) => s.toggleSidebar)
  const screen = useNav((s) => s.screen)

  // عنوان سياق الشاشة الحالية في وضع الطي — لوحة التحكم مستقلة فتُعامل كـ«الرئيسية»
  const currentContext = useMemo(() => {
    const g = NAV_GROUPS.find((grp) => grp.items.some((it) => it.id === screen))
    return g ? `${g.num}. ${g.label}` : 'الرئيسية'
  }, [screen])

  // مزامنة عرض الشريط الجانبي مع CSS var ليتمركز الـ Dialog داخل منطقة المحتوى
  // (النوافذ تُحوَّل إلى body عبر Portal فلا ترث متغيرات شجرة التخطيط)
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--sidebar-w-desktop',
      collapsed ? '68px' : '240px',
    )
    return () => {
      document.documentElement.style.removeProperty('--sidebar-w-desktop')
    }
  }, [collapsed])

  return (
    <aside
      className={cn(
        'no-print sticky top-0 hidden h-screen shrink-0 flex-col border-l bg-sidebar text-sidebar-foreground transition-[width] duration-300 ease-in-out lg:flex',
        collapsed ? 'w-[68px]' : 'w-60',
      )}
    >
      <BrandHeader collapsed={collapsed} />
      {collapsed && (
        <p className="px-2 pb-1 pt-2 text-center text-[9px] font-semibold text-muted-foreground/60" title={currentContext}>
          {currentContext}
        </p>
      )}
      <NavItems collapsed={collapsed} />
      <div
        className={cn(
          'flex items-center border-t px-3 py-3',
          collapsed ? 'justify-center' : 'justify-between gap-2',
        )}
      >
        {!collapsed && (
          <p className="text-[11px] text-muted-foreground">
            الإصدار: <span className="num">1.0</span> — <span className="num">7</span> مجموعات · <span className="num">26</span> شاشة
          </p>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            aria-label={collapsed ? 'توسيع الشريط الجانبي' : 'طي الشريط الجانبي'}
            aria-expanded={!collapsed}
            title={collapsed ? 'توسيع الشريط الجانبي' : 'طي الشريط الجانبي'}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            {collapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </aside>
  )
}

export { NavItems, BrandHeader }
