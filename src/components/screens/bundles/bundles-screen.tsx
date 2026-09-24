'use client'

// شاشة سلال العروض — منظومة العروض الترويجية بأنواعها الثلاثة:
// GIFT (سلة مع هدية) · PERCENT (حسم نسبة من السلة) · PRICE (سعر مخفض لكل مادة)
// 4 بطاقات إحصائية + شبكة بطاقات السلال + نموذج إنشاء/تعديل + حذف بتأكيد
// الأثر المحاسبي (خادمي): حسم السلال يُرحّل تلقائياً إلى حساب «الحسم الممنوح» (4110)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  BadgePercent,
  BarChart3,
  CalendarRange,
  Filter,
  Gift,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShoppingBasket,
  Tags,
  Trash2,
  X,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { KpiCard } from '@/components/common/kpi-card'
import { SectionCard } from '@/components/common/section-card'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TableActions } from '@/components/screens/common/table-actions'
import { useToast } from '@/hooks/use-toast'
import { useIsArchive } from '@/lib/store'
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, fmtQty, fmtUSD } from '@/lib/format'
import { cn } from '@/lib/utils'
import { BundleFormDialog } from './bundle-form-dialog'
import { BUNDLE_TYPE_BADGE, bundleLifecycle, type BundleRow, type BundleType } from './types'
import type { ItemLite } from '@/components/screens/stock/types'

/** تسميات أنواع السلال العربية — لفلتر جدول الحركة التفصيلي والتصدير */
const TYPE_LABEL: Record<BundleType, string> = {
  GIFT: 'هدية',
  PERCENT: 'حسم نسبة',
  PRICE: 'سعر مخفض',
}

/** صف حركة سلة واحدة ضمن فاتورة واحدة — من /api/bundles/breakdown (transactions) */
interface BundleTransactionRow {
  id: string
  bundleId: string
  bundleName: string
  bundleType: BundleType | null
  invoiceId: string
  date: string
  customerCode: string
  customerName: string
  sales: number
  discount: number
}

/** صف تفصيل مبيعات سلة — من /api/bundles/breakdown */
interface BundleBreakdownRow {
  bundleId: string
  bundleName: string
  saleCount: number
  sales: number
  discount: number
  customers: { code: string; name: string; count: number }[]
  lastSaleDate: string | null
}

interface BundleBreakdownData {
  rows: BundleBreakdownRow[]
  totals: { saleCount: number; sales: number; discount: number }
  transactions: BundleTransactionRow[]
}

/** خريطة الأنواع الثلاثة إلى أيقوناتها — للشارة والبطاقات */
const TYPE_ICON: Record<BundleType, typeof Gift> = {
  GIFT: Gift,
  PERCENT: BadgePercent,
  PRICE: Tags,
}

/** شارة الحالة الزمنية — لم تبدأ بعد / انتهت (معلومات الفترة عندما تكون السلة مفعّلة) */
function PeriodBadge({ bundle }: { bundle: BundleRow }) {
  const state = bundleLifecycle(bundle)
  if (state === 'UPCOMING') {
    return (
      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400">
        لم تبدأ بعد
      </Badge>
    )
  }
  if (state === 'ENDED') {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        انتهت
      </Badge>
    )
  }
  return null
}

/** قائمة مواد السلة النصية — «جبنة ×2، زيت ×1، …» مع شارة الهدية الذهبية وأسعار النوع PRICE */
function BundleItemsList({ bundle }: { bundle: BundleRow }) {
  return (
    <div className="rounded-lg bg-muted/40 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {bundle.items.map((bi) => (
          <span
            key={bi.id}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs"
          >
            <span className="font-medium">{bi.item.name}</span>
            <span className="num text-muted-foreground">×{fmtQty(bi.quantity)}</span>
            {bundle.type === 'PRICE' && bi.bundlePrice > 0 ? (
              <span className="num text-[11px]">
                <span className="text-muted-foreground line-through">{fmtNumber(bi.item.salePrice)}</span>{' '}
                <span className="font-bold text-rose-600 dark:text-rose-400">{fmtNumber(bi.bundlePrice)}</span>
                <span className="text-muted-foreground"> ل.س</span>
              </span>
            ) : null}
            {bi.isGift ? (
              <Badge className="border border-primary/40 bg-primary/10 px-1.5 py-0 text-[10px] text-primary">
                <Gift className="h-3 w-3" />
                هدية
              </Badge>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  )
}

export function BundlesScreen() {
  const { toast } = useToast()
  // وضع استعراض الأرشيف (الشرط 4) — إخفاء أزرار الإنشاء/التعديل/الحذف/مفتاح التفعيل
  const isArchive = useIsArchive()

  const [bundles, setBundles] = useState<BundleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // تفصيل مبيعات السلال — اسم السلة وعدد مرات بيعها والعملاء الذين اشتروها
  const [breakdown, setBreakdown] = useState<BundleBreakdownData | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(true)

  // فلاتر جدول حركة مبيعات السلال (تاريخ/عميل/نوع السلة) — العميل بكوده من قائمة منسدلة
  const [txFrom, setTxFrom] = useState('')
  const [txTo, setTxTo] = useState('')
  const [txCustomer, setTxCustomer] = useState('ALL')
  const [txType, setTxType] = useState<'ALL' | BundleType>('ALL')

  // مواد منتقي النموذج — من GET /api/items (النشطة فقط) بمجرد فتح الشاشة
  const [items, setItems] = useState<ItemLite[]>([])
  const [itemsLoading, setItemsLoading] = useState(true)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<BundleRow | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<BundleRow | null>(null)
  const [acting, setActing] = useState(false)
  // مفتاح التفعيل اليدوي — معرف السلة قيد التبديل حالياً (Task 36)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // ===== جلب السلال — عدّاد تسلسلي يمنع استجابة أقدم من طغيان الأحدث =====
  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/bundles')
      const data = (await res.json().catch(() => null)) as { bundles?: BundleRow[] } | null
      if (seq !== loadSeq.current) return
      if (!res.ok || !data) {
        setError(true)
        setBundles([])
        return
      }
      setBundles(Array.isArray(data.bundles) ? data.bundles : [])
    } catch {
      if (seq === loadSeq.current) {
        setError(true)
        setBundles([])
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [])

  // ===== جلب تفصيل مبيعات السلال — مستقل عن قوالب السلال (المصدر بنود الفواتير) =====
  useEffect(() => {
    let alive = true
    setBreakdownLoading(true)
    fetch('/api/bundles/breakdown')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('breakdown'))))
      .then((data: BundleBreakdownData) => {
        if (alive) setBreakdown(data)
      })
      .catch(() => {
        if (alive) setBreakdown(null)
      })
      .finally(() => {
        if (alive) setBreakdownLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // ===== المواد المرجعية للنموذج — مرة واحدة عند فتح الشاشة =====
  useEffect(() => {
    let alive = true
    setItemsLoading(true)
    fetch('/api/items')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('items'))))
      .then((data: unknown) => {
        if (!alive) return
        const list = Array.isArray(data) ? data : []
        const mapped: ItemLite[] = list
          .filter((it: { isActive?: boolean }) => it.isActive !== false)
          .map(
            (it: {
              id: string
              code: string
              name: string
              barcode: string | null
              purchasePrice: number
              salePrice: number
              primaryImageUrl: string | null
              units: { name: string; factor: number }[]
              balances: { warehouseId: string; quantity: number }[]
            }) => ({
              id: it.id,
              code: it.code,
              name: it.name,
              barcode: it.barcode,
              purchasePrice: it.purchasePrice,
              salePrice: it.salePrice,
              primaryImageUrl: it.primaryImageUrl,
              units: it.units ?? [],
              balances: it.balances ?? [],
            }),
          )
        setItems(mapped)
      })
      .catch(() => {
        if (alive) setItems([])
      })
      .finally(() => {
        if (alive) setItemsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  // ===== الحذف =====
  const performDelete = useCallback(async () => {
    if (!confirmDelete || acting) return
    setActing(true)
    try {
      const res = await fetch(`/api/bundles/${confirmDelete.id}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !data?.ok) {
        toast({
          title: 'تعذر حذف السلة',
          description: data?.error ?? 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        return
      }
      toast({ title: 'تم حذف السلة', description: `«${confirmDelete.name}» — الفواتير السابقة تحمل لقطاتها` })
      void load()
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setActing(false)
      setConfirmDelete(null)
    }
  }, [acting, confirmDelete, load, toast])

  // ===== الإحصاءات =====
  const activeNow = bundles.filter((b) => b.active).length
  const totalSales = bundles.reduce((s, b) => s + b.totalSales, 0)
  const totalDiscount = bundles.reduce((s, b) => s + b.totalDiscount, 0)

  // ===== مفتاح التفعيل اليدوي — إيقاف/تشغيل بغض النظر عن تواريخ الفترة (Task 36) =====
  // تحديث متفائل فوري مع تراجع آمن عند فشل الطلب — والخادم هو المرجع بعده
  const toggleEnabled = useCallback(
    async (b: BundleRow) => {
      if (togglingId) return
      setTogglingId(b.id)
      const next = !b.enabled
      const apply = (enabled: boolean, active: boolean) =>
        setBundles((prev) => prev.map((x) => (x.id === b.id ? { ...x, enabled, active } : x)))
      apply(next, next && b.active)
      try {
        const res = await fetch(`/api/bundles/${b.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        })
        const data = (await res.json().catch(() => null)) as { bundle?: BundleRow; error?: string } | null
        if (!res.ok || !data?.bundle) {
          apply(b.enabled, b.active)
          toast({
            title: 'تعذر تغيير حالة السلة',
            description: data?.error ?? 'حدث خطأ غير متوقع',
            variant: 'destructive',
          })
          return
        }
        apply(data.bundle.enabled, data.bundle.active)
        toast({
          title: next ? `تم تفعيل السلة «${b.name}»` : `تم إيقاف السلة «${b.name}» يدوياً`,
          description: next
            ? 'ظهرت في فواتير المبيعات وفق فترة نشاطها'
            : 'اخفت من فواتير المبيعات بغض النظر عن فترتها',
        })
      } catch {
        apply(b.enabled, b.active)
        toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
      } finally {
        setTogglingId(null)
      }
    },
    [togglingId, toast],
  )

  // قائمة العملاء المتاحة للفلترة — مشتقة من العملاء الفعليين الذين اشتروا سلالاً (بلا طلب شبكة إضافي)
  const customerOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of breakdown?.transactions ?? []) map.set(t.customerCode, t.customerName)
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ar'))
  }, [breakdown])

  // ===== جدول حركة مبيعات السلال — فلترة محلية (تاريخ/عميل/نوع) على حركات فعلية =====
  const filteredTransactions = useMemo(() => {
    const all = breakdown?.transactions ?? []
    return all.filter((t) => {
      if (txFrom && t.date.slice(0, 10) < txFrom) return false
      if (txTo && t.date.slice(0, 10) > txTo) return false
      if (txType !== 'ALL' && t.bundleType !== txType) return false
      if (txCustomer !== 'ALL' && t.customerCode !== txCustomer) return false
      return true
    })
  }, [breakdown, txFrom, txTo, txCustomer, txType])

  const transactionExportRows = useCallback(
    () =>
      filteredTransactions.map((t) => [
        t.date.slice(0, 10),
        t.bundleName,
        t.bundleType ? TYPE_LABEL[t.bundleType] : '—',
        `${t.customerName} (${t.customerCode})`,
        t.sales,
        t.discount,
      ]),
    [filteredTransactions],
  )

  return (
    <div className="space-y-4">
      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          title="عدد السلال"
          value={fmtNumber(bundles.length)}
          hint="قوالب العروض المسجلة"
          icon={ShoppingBasket}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="النشطة الآن"
          value={fmtNumber(activeNow)}
          hint="ضمن فترتها وغير موقوفة يدوياً"
          icon={BadgePercent}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="إجمالي المبيعات عبر السلال"
          value={fmtMoney(totalSales)}
          hint={`≈ ${fmtUSD(totalSales)}`}
          icon={Tags}
          tone="amber"
          loading={loading}
        />
        <KpiCard
          title="إجمالي الحسومات"
          value={fmtMoney(totalDiscount)}
          hint={`≈ ${fmtUSD(totalDiscount)}`}
          icon={Gift}
          tone="rose"
          loading={loading}
        />
      </div>

      {/* شبكة السلال */}
      <SectionCard
        title="سلال العروض الترويجية"
        description="تُطبق على فواتير المبيعات ضمن فترة نشاطها — الحسم يُرحّل تلقائياً إلى حساب الحسم الممنوح"
        icon={ShoppingBasket}
        action={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="num hidden gap-1 sm:inline-flex">
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {fmtNumber(bundles.length)} سلة
            </Badge>
            {!isArchive && (
              <Button
                className="h-11 sm:h-9"
                disabled={itemsLoading}
                onClick={() => {
                  setEditing(null)
                  setFormOpen(true)
                }}
              >
                <Plus className="h-4 w-4" />
                سلة جديدة
              </Button>
            )}
          </div>
        }
      >
        {/* حالة الخطأ — مع إعادة محاولة */}
        {error ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 py-12 text-center">
            <AlertTriangle className="h-8 w-8 text-rose-500" aria-hidden />
            <p className="font-bold">تعذر جلب سلال العروض</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              حدث خطأ أثناء الاتصال بالخادم — تحقق من الاتصال ثم أعد المحاولة
            </p>
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
              إعادة المحاولة
            </Button>
          </div>
        ) : loading && bundles.length === 0 ? (
          <div
            role="status"
            aria-label="جارٍ تحميل سلال العروض"
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            {/* حالة التحميل — هياكل عظمية بنفس شبكة البطاقات */}
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-3 rounded-xl border bg-card p-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        ) : bundles.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-14 text-center">
            {/* حالة الفراغ — دعوة لإنشاء أول سلة */}
            <div className="rounded-full bg-primary/10 p-5">
              <ShoppingBasket className="h-10 w-10 text-primary/70" aria-hidden />
            </div>
            <p className="font-bold">لا توجد سلال عروض بعد</p>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              أنشئ أول سلة ترويجية — سلة مواد مع هدية، أو حسم نسبة مئوية، أو أسعار مخفضة لكل مادة —
              وسيلزم الحسم تلقائياً على فواتير المبيعات عند اكتمال عناصر السلة ضمن فترة نشاطها
            </p>
            {!isArchive && (
              <Button
                className="h-11 sm:h-9"
                disabled={itemsLoading}
                onClick={() => {
                  setEditing(null)
                  setFormOpen(true)
                }}
              >
                <Plus className="h-4 w-4" />
                إنشاء سلة عروض
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {bundles.map((b) => {
              const Icon = TYPE_ICON[b.type] ?? ShoppingBasket
              return (
                <div
                  key={b.id}
                  className={cn(
                    'flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors duration-200 hover:border-primary/40',
                    b.active && 'border-emerald-500/25',
                  )}
                >
                  {/* الاسم + النوع + الحالة */}
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="min-w-0 truncate text-sm font-bold leading-tight" title={b.name}>
                        {b.name}
                      </h4>
                      <div className="rounded-lg bg-muted p-1.5 shrink-0">
                        <Icon className={cn('h-3.5 w-3.5', b.type === 'GIFT' && 'text-amber-500', b.type === 'PERCENT' && 'text-emerald-500', b.type === 'PRICE' && 'text-rose-500')} />
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={BUNDLE_TYPE_BADGE[b.type]}>
                        {b.typeLabel}
                      </Badge>
                      {/* مفتاح الحالة التفاعلي — بدل شارة «نشطة الآن» الساكنة: تفعيل/إيقاف يدوي
                          بغض النظر عن تواريخ الفترة — PATCH فوري بتحديث متفائل (Task 36) */}
                      <div
                        className={cn(
                          'flex items-center gap-2 rounded-md border px-2 py-1',
                          b.enabled
                            ? 'border-emerald-500/40 bg-emerald-500/10'
                            : 'border-rose-500/40 bg-rose-500/10',
                        )}
                      >
                        {!isArchive && (
                          <Switch
                            checked={b.enabled}
                            disabled={togglingId === b.id}
                            onCheckedChange={() => void toggleEnabled(b)}
                            aria-label={
                              b.enabled ? `إيقاف السلة ${b.name} يدوياً` : `تفعيل السلة ${b.name} يدوياً`
                            }
                            className="scale-[0.8]"
                          />
                        )}
                        {b.enabled ? (
                          <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                            {bundleLifecycle(b) === 'ACTIVE' && (
                              <span className="relative flex h-2 w-2" aria-hidden="true">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                              </span>
                            )}
                            {bundleLifecycle(b) === 'ACTIVE' ? 'نشطة الآن' : 'مفعّلة'}
                          </span>
                        ) : (
                          <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
                            موقوفة يدوياً
                          </span>
                        )}
                      </div>
                      {b.enabled && <PeriodBadge bundle={b} />}
                    </div>
                  </div>

                  {/* الفترة الزمنية */}
                  <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                    <CalendarRange className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      من <span className="num font-medium text-foreground/80">{fmtDateTime(b.startsAt)}</span>
                      {' '}إلى{' '}
                      <span className="num font-medium text-foreground/80">{fmtDateTime(b.endsAt)}</span>
                    </span>
                  </p>

                  {/* سطر نسبة الحسم — للنوع PERCENT */}
                  {b.type === 'PERCENT' && (
                    <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      حسم <span className="num">{fmtNumber(b.discountPercent)}%</span> على قيمة السلة
                    </p>
                  )}

                  {/* المواد المدمجة */}
                  <BundleItemsList bundle={b} />

                  {/* إحصاءات السلة الصغيرة */}
                  <div className="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t pt-2.5 text-[11px] text-muted-foreground">
                    <span>
                      مبيعات: <span className="num font-semibold text-foreground/80">{fmtMoney(b.totalSales)}</span>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      بيعت <span className="num font-semibold">{fmtNumber(b.saleCount)}</span> مرة
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      حسومات: <span className="num font-semibold text-rose-600 dark:text-rose-400">{fmtMoney(b.totalDiscount)}</span>
                    </span>
                  </div>

                  {/* الإجراءات */}
                  <div className="flex items-center justify-end gap-2 border-t pt-2.5">
                    {!isArchive && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 sm:h-8"
                        onClick={() => {
                          setEditing(b)
                          setFormOpen(true)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                        تعديل
                      </Button>
                    )}
                    {!isArchive && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 sm:h-8 dark:text-rose-400"
                        onClick={() => setConfirmDelete(b)}
                      >
                        <Trash2 className="h-4 w-4" />
                        حذف
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* تفصيل مبيعات السلال — الإحصائيات والاستبيان: السلة ومرات بيعها وعملاؤها */}
      <SectionCard
        title="تفصيل مبيعات السلال"
        description="كل سلة: كم مرة بُيعت، قيمة بنودها، حسوماتها، وأسماء العملاء الذين اشتروها — محسوبة من بنود الفواتير الفعلية"
        icon={BarChart3}
      >
        {breakdownLoading ? (
          <div className="space-y-2" role="status" aria-label="جارٍ تحميل تفصيل المبيعات">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !breakdown || breakdown.rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-10 text-center">
            <BarChart3 className="h-7 w-7 text-muted-foreground/50" aria-hidden />
            <p className="text-sm font-bold">لم تُبع أي سلة بعد</p>
            <p className="max-w-md text-xs text-muted-foreground">
              عند بيع فاتورة مبيعات تحتوي بنود سلة عروض سيظهر هنا تفصيلها: عدد مرات البيع وقيمتها وعملاؤها
            </p>
          </div>
        ) : (
          <div className="print-area">
            <TableActions
              title="تفصيل مبيعات السلال"
              filename="bundle-breakdown"
              headers={['اسم السلة', 'مرات البيع', 'قيمة بنود السلة', 'الحسومات', 'العملاء الذين اشتروها', 'آخر بيع']}
              rowsLoader={() =>
                breakdown.rows.map((r) => [
                  r.bundleName,
                  r.saleCount,
                  r.sales,
                  r.discount,
                  r.customers.map((c) => `${c.name} ×${c.count}`).join('، '),
                  r.lastSaleDate ? r.lastSaleDate.slice(0, 10) : '—',
                ])
              }
            />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-44">اسم السلة</TableHead>
                  <TableHead className="w-28 text-center">مرات البيع</TableHead>
                  <TableHead className="w-40 text-end">قيمة بنود السلة</TableHead>
                  <TableHead className="w-36 text-end">الحسومات</TableHead>
                  <TableHead className="min-w-64">العملاء الذين اشتروها</TableHead>
                  <TableHead className="w-28">آخر بيع</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdown.rows.map((r) => (
                  <TableRow key={r.bundleId}>
                    <TableCell>
                      <span className="flex items-center gap-1.5 font-bold">
                        <ShoppingBasket className="h-3.5 w-3.5 text-amber-500" aria-hidden />
                        <span className="truncate" title={r.bundleName}>
                          {r.bundleName}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="num text-center font-bold">{fmtNumber(r.saleCount)}</TableCell>
                    <TableCell className="text-end">
                      <p className="num font-semibold">{fmtMoney(r.sales)}</p>
                      <p className="num text-[10px] text-muted-foreground">≈ {fmtUSD(r.sales)}</p>
                    </TableCell>
                    <TableCell className="num text-end text-rose-600 dark:text-rose-400">
                      {r.discount > 0 ? fmtMoney(r.discount) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.customers.map((c) => (
                          <Badge
                            key={c.code}
                            variant="outline"
                            className="gap-1 border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-700 dark:text-emerald-400"
                            title={`${c.name} — اشترى السلة ${fmtNumber(c.count)} مرة`}
                          >
                            {c.name}
                            <span className="num">×{fmtNumber(c.count)}</span>
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="num whitespace-nowrap text-xs">
                      {r.lastSaleDate ? fmtDate(r.lastSaleDate) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-bold">الإجمالي ({fmtNumber(breakdown.rows.length)} سلة)</TableCell>
                  <TableCell className="num text-center font-bold">{fmtNumber(breakdown.totals.saleCount)}</TableCell>
                  <TableCell className="num text-end font-bold">{fmtMoney(breakdown.totals.sales)}</TableCell>
                  <TableCell className="num text-end font-bold text-rose-600 dark:text-rose-400">
                    {fmtMoney(breakdown.totals.discount)}
                  </TableCell>
                  <TableCell colSpan={2} className="text-xs text-muted-foreground">
                    عدد مرات البيع = عدد فواتير المبيعات التي نزلت منها بنود السلة
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          </div>
        )}
      </SectionCard>

      {/* حركة مبيعات السلال — سجل كل «مرة بيع» بشكل مستقل مع فلاتر وطباعة/تصدير إكسل */}
      <SectionCard
        title="حركة مبيعات السلال"
        description="سجل تفصيلي بكل مرة بيعت فيها سلة — قابل للفلترة بالتاريخ والعميل ونوع السلة"
        icon={Filter}
      >
        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="bx-from">من تاريخ</Label>
            <Input id="bx-from" type="date" value={txFrom} onChange={(e) => setTxFrom(e.target.value)} className="num h-9" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bx-to">إلى تاريخ</Label>
            <Input id="bx-to" type="date" value={txTo} onChange={(e) => setTxTo(e.target.value)} className="num h-9" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bx-customer">العميل</Label>
            <Select value={txCustomer} onValueChange={setTxCustomer}>
              <SelectTrigger id="bx-customer" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">كل العملاء</SelectItem>
                {customerOptions.map(([code, name]) => (
                  <SelectItem key={code} value={code}>
                    {name} <span className="num text-muted-foreground">({code})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>نوع السلة</Label>
            <Select value={txType} onValueChange={(v) => setTxType(v as 'ALL' | BundleType)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">الكل</SelectItem>
                <SelectItem value="GIFT">{TYPE_LABEL.GIFT}</SelectItem>
                <SelectItem value="PERCENT">{TYPE_LABEL.PERCENT}</SelectItem>
                <SelectItem value="PRICE">{TYPE_LABEL.PRICE}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mb-3 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setTxFrom('')
              setTxTo('')
              setTxCustomer('ALL')
              setTxType('ALL')
            }}
          >
            <X className="h-4 w-4" />
            مسح الفلاتر
          </Button>
        </div>

        {breakdownLoading ? (
          <div className="space-y-2" role="status" aria-label="جارٍ تحميل حركة المبيعات">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-10 text-center">
            <Filter className="h-7 w-7 text-muted-foreground/50" aria-hidden />
            <p className="text-sm font-bold">لا حركة مطابقة للفلاتر</p>
            <p className="max-w-md text-xs text-muted-foreground">جرّب تعديل التاريخ أو العميل أو نوع السلة</p>
          </div>
        ) : (
          <div className="print-area">
            <TableActions
              title="حركة مبيعات السلال"
              filename="bundle-transactions"
              headers={['التاريخ', 'السلة', 'النوع', 'العميل', 'القيمة', 'الحسم']}
              rowsLoader={transactionExportRows}
            />
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">التاريخ</TableHead>
                    <TableHead className="min-w-44">السلة</TableHead>
                    <TableHead className="w-32">النوع</TableHead>
                    <TableHead className="min-w-40">العميل</TableHead>
                    <TableHead className="w-36 text-end">القيمة</TableHead>
                    <TableHead className="w-32 text-end">الحسم</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="num whitespace-nowrap text-xs">{fmtDate(t.date)}</TableCell>
                      <TableCell className="font-medium">{t.bundleName}</TableCell>
                      <TableCell>
                        {t.bundleType ? (
                          <Badge variant="outline" className={cn('text-[10px]', BUNDLE_TYPE_BADGE[t.bundleType])}>
                            {TYPE_LABEL[t.bundleType]}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{t.customerName}</span>{' '}
                        <span className="num text-xs text-muted-foreground">({t.customerCode})</span>
                      </TableCell>
                      <TableCell className="num text-end font-semibold">{fmtMoney(t.sales)}</TableCell>
                      <TableCell className="num text-end text-rose-600 dark:text-rose-400">
                        {t.discount > 0 ? fmtMoney(t.discount) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </SectionCard>

      {/* نموذج الإنشاء/التعديل */}
      <BundleFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
        items={items}
        onSaved={() => void load()}
      />

      {/* تأكيد الحذف */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف سلة العروض</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف قالب السلة «{confirmDelete?.name}» نهائياً مع بنوده — الفواتير السابقة التي استخدمتها
              تبقى سليمة باسم السلة في بنودها وحركات مخزونها. هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>تراجع</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={(e) => {
                e.preventDefault()
                void performDelete()
              }}
            >
              {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'حذف نهائياً'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
