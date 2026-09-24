'use client'

// البحث المركزي الذكي في الهيدر العلوي (Task 40 — مُوسَّع Task 46)
//  • زر بحث أنيق في الشريط العلوي يفتح نافذة البحث (أو Ctrl+K من أي مكان)
//  • بحث فوري بأربع قنوات: كل الشاشات الـ 26 (تنقل مباشر) — التقارير الـ 16 (فتح مباشر داخل مركز التقارير) — بطاقات المواد — العملاء والموردون
//  • اختيار نتيجة مادة/طرف/تقرير ينقل للمستخدم ويفتح هدفه مباشرة (رابط عميق)

import * as React from 'react'
import {
  Search,
  FileText,
  Package,
  Users,
  ArrowLeft,
  Loader2,
  Landmark,
  CornerDownLeft,
  BarChart3,
  LayoutDashboard,
} from 'lucide-react'
import { SCREENS, useNav, type ScreenId } from '@/lib/store'
import { useActionBus } from '@/lib/action-bus'
import { REPORT_CARDS, type ReportKey } from '@/components/screens/reports/report-shared'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** أيقونات مميزة لبعض الشاشات في نتائج التنقل — والبقية أيقونة موحدة */
const SCREEN_ICONS: Partial<Record<ScreenId, React.ComponentType<{ className?: string }>>> = {
  dashboard: LayoutDashboard,
  invoices: FileText,
  receipts: FileText,
  payments: FileText,
  treasury: Landmark,
  items: Package,
  partners: Users,
  reports: BarChart3,
}

/** كل شاشات النظام الـ 26 — كافة بنود القائمة الجانبية بلا استثناء (Task 46) */
const ALL_SCREENS: ScreenId[] = Object.keys(SCREENS) as ScreenId[]

interface SearchItemRow {
  id: string
  code: string
  name: string
  unit?: string | null
  salePrice?: number
  barcode?: string | null
  isActive?: boolean
}

interface SearchPartnerRow {
  id: string
  code: string
  name: string
  type: string // CUSTOMER | SUPPLIER
  phone?: string | null
  isActive?: boolean
}

export function GlobalSearchButton() {
  const setSearchOpen = useActionBus((s) => s.setSearchOpen)

  return (
    <button
      type="button"
      onClick={() => setSearchOpen(true)}
      aria-label="فتح البحث المركزي السريع (Ctrl+K)"
      title="بحث سريع في كل النظام — Ctrl+K"
      className={cn(
        'group flex h-9 shrink-0 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground',
        'transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        // الجوال: زر أيقونة فقط — ويتوسع من sm فصاعداً
        'w-9 justify-center px-0 sm:w-56 sm:justify-start sm:px-3 lg:w-72',
      )}
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden />
      <span className="hidden min-w-0 flex-1 truncate text-start sm:inline">
        ابحث عن مادة أو عميل أو مورد…
      </span>
      <span className="hidden items-center gap-1 sm:flex">
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  )
}

export function GlobalSearchDialog() {
  const searchOpen = useActionBus((s) => s.searchOpen)
  const setSearchOpen = useActionBus((s) => s.setSearchOpen)
  const navigate = useNav((s) => s.navigate)
  const requestItemProfile = useActionBus((s) => s.requestItemProfile)
  const requestPartnerProfile = useActionBus((s) => s.requestPartnerProfile)
  const requestReport = useActionBus((s) => s.requestReport)

  // الاستعلام الفوري مع مهلة قصيرة لتفادي ضرب الخادم بكل ضغطة مفتاح
  const [query, setQuery] = React.useState('')
  const [items, setItems] = React.useState<SearchItemRow[]>([])
  const [partners, setPartners] = React.useState<SearchPartnerRow[]>([])
  const [loading, setLoading] = React.useState(false)

  // تفريغ الحالة عند الإغلاق حتى يفتح البحث نظيفاً في كل مرة
  React.useEffect(() => {
    if (!searchOpen) {
      setQuery('')
      setItems([])
      setPartners([])
    }
  }, [searchOpen])

  React.useEffect(() => {
    if (!searchOpen) return
    const q = query.trim()
    if (q.length < 2) {
      setItems([])
      setPartners([])
      setLoading(false)
      return
    }
    setLoading(true)
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const [itemsRes, partnersRes] = await Promise.all([
            fetch(`/api/items?page=1&pageSize=8&q=${encodeURIComponent(q)}`, { signal: ctrl.signal }),
            fetch(`/api/partners?q=${encodeURIComponent(q)}`, { signal: ctrl.signal }),
          ])
          const itemsData = (await itemsRes.json().catch(() => null)) as { items?: SearchItemRow[] } | null
          const partnersData = (await partnersRes.json().catch(() => null)) as
            | { partners?: SearchPartnerRow[] }
            | SearchPartnerRow[]
            | null
          setItems(Array.isArray(itemsData?.items) ? itemsData.items.slice(0, 8) : [])
          const pRaw = Array.isArray(partnersData) ? partnersData : partnersData?.partners
          setPartners(Array.isArray(pRaw) ? pRaw.slice(0, 8) : [])
        } catch (err) {
          if ((err as { name?: string })?.name !== 'AbortError') {
            setItems([])
            setPartners([])
          }
        } finally {
          setLoading(false)
        }
      })()
    }, 250)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query, searchOpen])

  const close = React.useCallback(() => setSearchOpen(false), [setSearchOpen])

  const q = query.trim().toLowerCase()

  // Task 46 — قناتا الشاشات والتقارير: تغطية كاملة (26 شاشة + 16 تقريراً) ببحث عنوان + وصف
  const screenHits = React.useMemo(() => {
    if (!q) return []
    return ALL_SCREENS.filter((id) => {
      const meta = SCREENS[id]
      return meta.title.toLowerCase().includes(q) || meta.description.toLowerCase().includes(q)
    }).slice(0, 8)
  }, [q])

  const reportHits = React.useMemo(() => {
    if (!q) return []
    return REPORT_CARDS.filter(
      (c) => c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
    ).slice(0, 8)
  }, [q])

  const goScreen = (id: ScreenId) => {
    navigate(id)
    close()
  }

  // Task 46 — رابط عميق للتقارير: تنقل إلى مركز التقارير + إشارة تُستهلك مرة واحدة تفتح التقرير مباشرة
  const openReport = (key: ReportKey) => {
    navigate('reports')
    requestReport(key)
    close()
  }

  const openItem = (item: SearchItemRow) => {
    // الرابط العميق: تنقل لشاشة المواد ثم فتح بطاقة المادة المطلوبة
    navigate('items')
    requestItemProfile(item as unknown as Record<string, unknown>)
    close()
  }

  const openPartner = (p: SearchPartnerRow) => {
    navigate('partners')
    requestPartnerProfile(p.id)
    close()
  }

  const hasDataHits = items.length > 0 || partners.length > 0
  const showScreens = screenHits.length > 0
  const showReports = reportHits.length > 0

  return (
    <CommandDialog
      open={searchOpen}
      onOpenChange={setSearchOpen}
      title="البحث المركزي السريع"
      description="ابحث عن شاشة أو مادة أو عميل أو مورد وافتحها مباشرة"
      className="sm:max-w-xl"
    >
      <CommandInput
        placeholder="اكتب اسم مادة أو عميل أو مورد أو شاشة…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="min-h-56">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            جارٍ البحث…
          </div>
        )}
        {!loading && q.length >= 2 && !showScreens && !showReports && !hasDataHits && (
          <CommandEmpty>لا توجد نتائج مطابقة</CommandEmpty>
        )}

        {showScreens && (
          <>
            <CommandGroup heading={`الشاشات — ${screenHits.length} من 26`}>
              {screenHits.map((id) => {
                const meta = SCREENS[id]
                const Icon = SCREEN_ICONS[id] ?? Landmark
                return (
                  <CommandItem key={id} value={`screen-${id}-${meta.title}`} onSelect={() => goScreen(id)}>
                    <Icon className="h-4 w-4 text-primary" aria-hidden />
                    <span className="flex-1">{meta.title}</span>
                    <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  </CommandItem>
                )
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {showReports && (
          <>
            <CommandGroup heading={`التقارير — ${reportHits.length} من 16`}>
              {reportHits.map((card) => {
                const Icon = card.icon
                return (
                  <CommandItem
                    key={card.key}
                    value={`report-${card.key}-${card.title}`}
                    onSelect={() => openReport(card.key)}
                  >
                    <Icon className="h-4 w-4 text-primary" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{card.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{card.description}</span>
                    </div>
                    <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  </CommandItem>
                )
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {items.length > 0 && (
          <>
            <CommandGroup heading={`بطاقات المواد — ${items.length}`}>
              {items.map((it) => (
                <CommandItem key={it.id} value={`item-${it.id}-${it.code}-${it.name}`} onSelect={() => openItem(it)}>
                  <Package className="h-4 w-4 text-primary" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="num text-xs text-muted-foreground">{it.code}</span>
                      <span className="truncate font-medium">{it.name}</span>
                      {it.isActive === false && <span className="text-[10px] text-rose-600">(موقوفة)</span>}
                    </div>
                    {(it.unit || it.barcode) && (
                      <span className="text-[11px] text-muted-foreground">
                        {it.unit ? `الوحدة: ${it.unit}` : ''}
                        {it.unit && it.barcode ? ' — ' : ''}
                        {it.barcode ? `باركود: ${it.barcode}` : ''}
                      </span>
                    )}
                  </div>
                  <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {partners.length > 0 && (
          <>
            <CommandGroup heading={`العملاء والموردون — ${partners.length}`}>
              {partners.map((p) => (
                <CommandItem key={p.id} value={`partner-${p.id}-${p.code}-${p.name}`} onSelect={() => openPartner(p)}>
                  <Users className="h-4 w-4 text-primary" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="num text-xs text-muted-foreground">{p.code}</span>
                      <span className="truncate font-medium">{p.name}</span>
                      <span
                        className={cn(
                          'rounded-full border px-1.5 text-[10px]',
                          p.type === 'CUSTOMER'
                            ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400'
                            : 'border-amber-500/40 text-amber-700 dark:text-amber-400',
                        )}
                      >
                        {p.type === 'CUSTOMER' ? 'عميل' : 'مورد'}
                      </span>
                      {p.isActive === false && <span className="text-[10px] text-rose-600">(موقوف)</span>}
                    </div>
                    {p.phone && <span className="num text-[11px] text-muted-foreground">{p.phone}</span>}
                  </div>
                  <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {q.length < 2 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            اكتب حرفين على الأقل — يبحث في كل الشاشات (26) والتقارير (16) والمواد والعملاء والموردين
          </div>
        )}
      </CommandList>

      {/* إغلاق صريح — الحماية الصارمة تمنع الإغلاق بـ Escape أو النقر خارجاً */}
      <div className="flex items-center justify-between border-t px-3 py-2">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <CornerDownLeft className="h-3.5 w-3.5" aria-hidden />
          Enter لفتح المحدد
        </span>
        <Button variant="outline" size="sm" className="h-7 px-3 text-xs" onClick={close}>
          إغلاق
        </Button>
      </div>
    </CommandDialog>
  )
}
