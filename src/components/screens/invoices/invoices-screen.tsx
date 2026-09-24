'use client'

// شاشة الفواتير — أربعة تبويبات: مبيعات / مردود المبيعات / مشتريات / مردود المشتريات
// كل فاتورة تُرحَّل فوراً عند الحفظ: حركات مخزون + أرصدة الأقسام + سندات القبض/الدفع + حالة السداد

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Inbox,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShoppingBasket,
  SlidersHorizontal,
  Sparkles,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { KpiCard } from '@/components/common/kpi-card'
import { SectionCard } from '@/components/common/section-card'
import { TableActions } from '@/components/screens/common/table-actions'
import { useToast } from '@/hooks/use-toast'
import { useActionBus } from '@/lib/action-bus'
import { useIsArchive } from '@/lib/store'
import { AR_INVOICE_STATUS, AR_METHOD, fmtDate, fmtMoney, fmtNumber, fmtUSD } from '@/lib/format'
import { cn } from '@/lib/utils'
import { InvoiceFormDialog } from './invoice-form-dialog'
import { InvoiceViewDialog } from './invoice-view-dialog'
import type {
  InvoiceItem,
  InvoiceKind,
  InvoiceRow,
  InvoiceStats,
  LeafWarehouse,
  PartnerOption,
} from './types'

const PAGE_SIZE = 12
/** سقف صفحة الخادم عند جلب كل الفواتير للطباعة والتصدير (نمط شاشة القيود) */
const FETCH_ALL_PAGE_SIZE = 100

const TABS: { kind: InvoiceKind; label: string }[] = [
  { kind: 'SALE', label: 'مبيعات' },
  { kind: 'SALES_RETURN', label: 'مردود المبيعات' },
  { kind: 'PURCHASE', label: 'مشتريات' },
  { kind: 'PURCHASE_RETURN', label: 'مردود المشتريات' },
]

const EMPTY_STATS: InvoiceStats = { count: 0, total: 0, paid: 0, remaining: 0 }

const STATUS_BADGE: Record<string, string> = {
  PAID: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  PARTIAL: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  UNPAID: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
}

export function InvoicesScreen() {
  const { toast } = useToast()

  // وضع استعراض أرشيف فترة مقفلة — يخفي أزرار الكتابة (الشرط 4)
  const isArchive = useIsArchive()

  const [tab, setTab] = useState<InvoiceKind>('SALE')
  const [fStatus, setFStatus] = useState('ALL')
  const [fQ, setFQ] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [filters, setFilters] = useState<{ status: string; q: string; from: string; to: string }>({
    status: 'ALL',
    q: '',
    from: '',
    to: '',
  })
  const [page, setPage] = useState(1)

  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [stats, setStats] = useState<InvoiceStats>(EMPTY_STATS)
  const [nextNumber, setNextNumber] = useState('')
  const [loading, setLoading] = useState(true)
  /** صفوف الطباعة الكاملة — تُملأ قبل الطباعة بكل صفحات الخادم وتُفرَّغ بعدها (نمط شاشة القيود) */
  const [printRows, setPrintRows] = useState<InvoiceRow[] | null>(null)

  // بيانات النموذج المشتركة — تُحمَّل مرة واحدة
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [warehouses, setWarehouses] = useState<LeafWarehouse[]>([])
  const [partners, setPartners] = useState<PartnerOption[]>([])
  const [refsLoading, setRefsLoading] = useState(true)

  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [viewId, setViewId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<InvoiceRow | null>(null)
  const [acting, setActing] = useState(false)

  // Task 40 — استهلاك إشارة Alt+I: فتح فاتورة مبيعات جديدة فوراً (إشارة تُستهلك مرة واحدة)
  const invoiceSignal = useActionBus((s) => s.invoiceFormSignal)
  const consumeInvoiceSignal = useActionBus((s) => s.consumeInvoiceFormSignal)
  useEffect(() => {
    if (!invoiceSignal) return
    if (isArchive) {
      // وضع الأرشيف — تُستهلك الإشارة بلا فتح نموذج الكتابة
      consumeInvoiceSignal()
      return
    }
    if (formOpen) {
      // النموذج مفتوح بالفعل — نستهلك الإشارة بهدوء بلا مساس بالعمل الجاري
      consumeInvoiceSignal()
      return
    }
    setTab(invoiceSignal.tab)
    setEditId(null)
    setFormOpen(true)
    consumeInvoiceSignal()
  }, [invoiceSignal, consumeInvoiceSignal, formOpen, isArchive])

  // ===== جلب صفحة فواتير التبويب — عدّاد تسلسلي يمنع طغيان استجابة أقدم =====
  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const params = new URLSearchParams({ type: tab })
      if (filters.status !== 'ALL') params.set('status', filters.status)
      if (filters.q) params.set('q', filters.q)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      params.set('page', String(page))
      params.set('pageSize', String(PAGE_SIZE))

      const res = await fetch(`/api/invoices?${params.toString()}`)
      const data = await res.json().catch(() => null)
      if (seq !== loadSeq.current) return
      if (!res.ok || !data) {
        toast({
          title: 'تعذر جلب الفواتير',
          description: data?.error ?? 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        setInvoices([])
        setTotal(0)
        setTotalPages(1)
        setStats(EMPTY_STATS)
        return
      }
      setInvoices(data.invoices ?? [])
      setTotal(data.total ?? 0)
      setTotalPages(Math.max(1, data.totalPages ?? 1))
      setStats(data.stats ?? EMPTY_STATS)
      setNextNumber(data.nextNumber ?? '')
    } catch {
      if (seq === loadSeq.current) {
        toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
        setInvoices([])
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [tab, filters, page, toast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [tab, filters])

  /** الصفوف المعروضة — كل الصفوف أثناء الطباعة، وإلا صفحة الخادم الحالية */
  const displayRows = printRows ?? invoices

  // ===== جلب كل الفواتير المطابقة للفلاتر عبر كل صفحات الخادم (سقف 100/صفحة) — للطباعة والتصدير الكاملين =====
  const fetchAllInvoices = useCallback(async (): Promise<InvoiceRow[]> => {
    const all: InvoiceRow[] = []
    for (let p = 1; p < 100; p++) {
      const params = new URLSearchParams({ type: tab })
      if (filters.status !== 'ALL') params.set('status', filters.status)
      if (filters.q) params.set('q', filters.q)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      params.set('page', String(p))
      params.set('pageSize', String(FETCH_ALL_PAGE_SIZE))
      const res = await fetch(`/api/invoices?${params.toString()}`)
      const data = (await res.json().catch(() => null)) as
        | { invoices?: InvoiceRow[]; total?: number }
        | null
      if (!res.ok || !data) break
      const rows = data.invoices ?? []
      all.push(...rows)
      if (rows.length === 0 || all.length >= (data.total ?? 0)) break
    }
    return all
  }, [tab, filters])

  // ===== البيانات المرجعية للنموذج — مرة واحدة عند فتح الشاشة =====
  useEffect(() => {
    let alive = true
    setRefsLoading(true)
    Promise.all([
      fetch('/api/items').then((r) => (r.ok ? r.json() : Promise.reject(new Error('items')))),
      fetch('/api/warehouses').then((r) => (r.ok ? r.json() : Promise.reject(new Error('warehouses')))),
      fetch('/api/partners').then((r) => (r.ok ? r.json() : Promise.reject(new Error('partners')))),
    ])
      .then(([itemsData, warehousesData, partnersData]) => {
        if (!alive) return
        // المواد النشطة فقط — بصيغة منتقي الفواتير
        const mappedItems: InvoiceItem[] = (Array.isArray(itemsData) ? itemsData : [])
          .filter((it: { isActive?: boolean }) => it.isActive !== false)
          .map((it: {
            id: string
            code: string
            name: string
            barcode: string | null
            purchasePrice: number
            salePrice: number
            primaryImageUrl: string | null
            warehouseId: string | null
            warehouse?: { name?: string | null } | null
            isActive: boolean
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
            warehouseId: it.warehouseId,
            warehouseName: it.warehouse?.name ?? null,
            isActive: it.isActive,
            units: it.units ?? [],
            balances: it.balances ?? [],
          }))
        setItems(mappedItems)
        // الأقسام النهائية النشطة فقط — آخر مستوى في الشجرة
        setWarehouses(
          (Array.isArray(warehousesData) ? warehousesData : [])
            .filter((w: { childrenCount: number; isActive: boolean }) => w.childrenCount === 0 && w.isActive)
            .map((w: { id: string; code: string; name: string }) => ({ id: w.id, code: w.code, name: w.name })),
        )
        setPartners(
          (partnersData?.partners ?? []).map(
            (p: { id: string; code: string; name: string; type: string; phone: string | null; isActive: boolean }) => ({
              id: p.id,
              code: p.code,
              name: p.name,
              type: p.type,
              phone: p.phone,
              isActive: p.isActive,
            }),
          ),
        )
      })
      .catch(() => {
        if (alive) {
          toast({ title: 'تعذر تحميل بيانات النموذج', description: 'تحقق من الاتصال ثم أعد فتح الشاشة', variant: 'destructive' })
        }
      })
      .finally(() => {
        if (alive) setRefsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [toast])

  const applyFilters = useCallback(() => {
    setFilters({ status: fStatus, q: fQ.trim(), from: fFrom, to: fTo })
  }, [fStatus, fQ, fFrom, fTo])

  const clearFilters = useCallback(() => {
    setFStatus('ALL')
    setFQ('')
    setFFrom('')
    setFTo('')
    setFilters({ status: 'ALL', q: '', from: '', to: '' })
  }, [])

  const performDelete = useCallback(async () => {
    if (!confirmDelete || acting) return
    setActing(true)
    try {
      const res = await fetch(`/api/invoices/${confirmDelete.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({
          title: 'تعذر حذف الفاتورة',
          description: data?.error ?? 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        return
      }
      toast({
        title: 'تم حذف الفاتورة',
        description: `رقم ${confirmDelete.number} أصبح محجوزاً كـ ${data?.reservedNumber ?? `${confirmDelete.number}xx`} ولن يُستخدم مجدداً — الحذف موثق في سجل التدقيق`,
      })
      void load()
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setActing(false)
      setConfirmDelete(null)
    }
  }, [acting, confirmDelete, load, toast])

  /** مادة جديدة من النافذة السريعة — تُضاف لقائمة المواد المتاحة فوراً */
  const handleItemCreated = useCallback((item: InvoiceItem) => {
    setItems((prev) => [item, ...prev])
  }, [])

  const isPurchases = tab === 'PURCHASE' || tab === 'PURCHASE_RETURN'
  const paidLabel = isPurchases ? 'المسدد للموردين' : 'المقبوض من العملاء'

  return (
    <div className="space-y-4">
      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          title="عدد الفواتير"
          value={fmtNumber(stats.count)}
          hint="مستندات مُرحّلة فوراً"
          icon={FileText}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="إجمالي الفواتير"
          value={fmtMoney(stats.total)}
          hint={`≈ ${fmtUSD(stats.total)}`}
          icon={ArrowLeftRight}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title={paidLabel}
          value={fmtMoney(stats.paid)}
          hint={`≈ ${fmtUSD(stats.paid)}`}
          icon={SlidersHorizontal}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="المتبقي (ذمم)"
          value={fmtMoney(stats.remaining)}
          hint={`≈ ${fmtUSD(stats.remaining)}`}
          icon={FileText}
          tone={isPurchases ? 'rose' : 'amber'}
          loading={loading}
        />
      </div>

      {/* التبويبات + الفلاتر */}
      <SectionCard
        title="الفواتير والمردودات"
        description="اختر نوع المستند — الحفظ يُرحّل الفاتورة مباشرة إلى المخزون والسندات بلا مسودات"
        icon={FileText}
        action={
          !isArchive && (
            <Button
              size="sm"
              disabled={refsLoading}
              onClick={() => {
                setEditId(null)
                setFormOpen(true)
              }}
            >
              <Plus className="h-4 w-4" />
              {TABS.find((t) => t.kind === tab)?.label} — فاتورة جديدة
            </Button>
          )
        }
      >
        <Tabs value={tab} onValueChange={(v) => setTab(v as InvoiceKind)}>
          <TabsList className="grid h-auto w-full grid-cols-2 lg:grid-cols-4">
            {TABS.map((t) => (
              <TabsTrigger key={t.kind} value={t.kind} className="py-2 text-sm">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">من تاريخ</Label>
            <Input
              type="date"
              value={fFrom}
              onChange={(e) => setFFrom(e.target.value)}
              className="num h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">إلى تاريخ</Label>
            <Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} className="num h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">حالة السداد</Label>
            <Select value={fStatus} onValueChange={setFStatus}>
              <SelectTrigger className="h-9 w-full" aria-label="حالة السداد">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">الكل</SelectItem>
                <SelectItem value="PAID">مدفوعة</SelectItem>
                <SelectItem value="PARTIAL">مدفوعة جزئياً</SelectItem>
                <SelectItem value="UNPAID">غير مدفوعة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">بحث</Label>
            <Input
              value={fQ}
              onChange={(e) => setFQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFilters()
              }}
              placeholder="رقم الفاتورة أو اسم الطرف أو الملاحظات…"
              className="h-9"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" onClick={applyFilters}>
            <Search className="h-4 w-4" />
            تصفية
          </Button>
          <Button size="sm" variant="outline" onClick={clearFilters}>
            <X className="h-4 w-4" />
            مسح الفلاتر
          </Button>
        </div>
      </SectionCard>

      {/* جدول الفواتير */}
      <SectionCard
        title={`${TABS.find((t) => t.kind === tab)?.label} — القائمة`}
        description="انقر أيقونة العرض لتفاصيل الفاتورة وبنودها ودفعاتها"
        icon={FileText}
        action={
          <Badge variant="outline" className="num gap-1">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {fmtNumber(total)} نتيجة
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title={`${TABS.find((t) => t.kind === tab)?.label} — القائمة`}
            filename="invoices"
            headers={['الرقم', 'التاريخ', 'الطرف', 'كود الطرف', 'البنود', 'الإجمالي', 'المسدد', 'المتبقي', 'الحالة']}
            onBeforePrint={async () => {
              setPrintRows(await fetchAllInvoices())
            }}
            onAfterPrint={() => setPrintRows(null)}
            rowsLoader={async () =>
              (await fetchAllInvoices()).map((inv) => [
                inv.number,
                inv.date.slice(0, 10),
                inv.partner?.name ?? '',
                inv.partner?.code ?? '',
                inv.linesCount,
                inv.total,
                inv.paid,
                Math.max(0, inv.total - inv.paid),
                AR_INVOICE_STATUS[inv.status] ?? inv.status,
              ])
            }
          />
          <div className="overflow-hidden rounded-lg border">
          {loading && invoices.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جارٍ التحميل…
            </div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <Inbox className="h-10 w-10 text-muted-foreground/50" />
              <p className="font-medium">لا توجد فواتير مطابقة</p>
              <p className="text-xs text-muted-foreground">
                جرّب تعديل الفلاتر أو أنشئ فاتورة جديدة
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[980px]">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-28">الرقم</TableHead>
                    <TableHead className="w-24">التاريخ</TableHead>
                    <TableHead>الطرف</TableHead>
                    <TableHead className="w-14 text-center">بنود</TableHead>
                    <TableHead className="w-40">الإجمالي</TableHead>
                    <TableHead className="w-36">المسدد</TableHead>
                    <TableHead className="w-36">المتبقي</TableHead>
                    <TableHead className="w-28">الحالة</TableHead>
                    <TableHead className="no-print w-28">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayRows.map((inv) => {
                    const remaining = Math.max(0, inv.total - inv.paid)
                    return (
                      <TableRow key={inv.id} className="cursor-pointer" onClick={() => setViewId(inv.id)}>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <span className="num font-semibold text-primary">{inv.number}</span>
                            {/* وسوم إلكترونية دائمة: سلة عروض / استرداد نقاط ولاء */}
                            <div className="flex flex-wrap gap-1">
                              {inv.hasBundle && (
                                <Badge
                                  variant="outline"
                                  className="gap-1 border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-400"
                                  title={`سلال عروض: ${(inv.bundleNames ?? []).join('، ')}`}
                                >
                                  <ShoppingBasket className="h-3 w-3" />
                                  سلة عروض
                                </Badge>
                              )}
                              {(inv.loyaltyPointsRedeemed ?? 0) > 0 && (
                                <Badge
                                  variant="outline"
                                  className="gap-1 border-violet-500/40 bg-violet-500/10 px-1.5 py-0 text-[10px] text-violet-700 dark:text-violet-400"
                                  title={`استُردت ${fmtNumber(inv.loyaltyPointsRedeemed ?? 0)} نقطة ولاء كحسم داخل الفاتورة`}
                                >
                                  <Sparkles className="h-3 w-3" />
                                  استرداد نقاط ولاء
                                </Badge>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="num text-sm">{fmtDate(inv.date)}</span>
                        </TableCell>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-medium" title={inv.partner?.name ?? ''}>
                              {inv.partner?.name ?? '—'}
                            </p>
                            <div className="flex items-center gap-1.5">
                              {inv.partner?.code && (
                                <p className="num text-xs text-muted-foreground">{inv.partner.code}</p>
                              )}
                              {/* شارة مركز التكلفة — القيد التلقائي منسوب إليه */}
                              {inv.costCenter && (
                                <span
                                  className="truncate text-[10px] text-primary/80"
                                  title={`مركز التكلفة: ${inv.costCenter.name}`}
                                >
                                  · {inv.costCenter.name}
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="num text-center text-sm">{inv.linesCount}</TableCell>
                        <TableCell className="text-end">
                          <p className="num font-bold">{fmtMoney(inv.total)}</p>
                          {inv.discount > 0 && (
                            <p className="num text-[11px] text-muted-foreground">حسم {fmtNumber(inv.discount)}</p>
                          )}
                        </TableCell>
                        <TableCell className="num text-end text-emerald-600 dark:text-emerald-400">
                          {fmtMoney(inv.paid)}
                        </TableCell>
                        <TableCell className="num text-end font-semibold text-amber-600 dark:text-amber-400">
                          {fmtMoney(remaining)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_BADGE[inv.status] ?? ''}>
                            {AR_INVOICE_STATUS[inv.status] ?? inv.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="no-print" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={`عرض الفاتورة ${inv.number}`}
                              title="عرض"
                              onClick={() => setViewId(inv.id)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {!isArchive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={`تعديل الفاتورة ${inv.number}`}
                                title="تعديل"
                                onClick={() => {
                                  setEditId(inv.id)
                                  setFormOpen(true)
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {!isArchive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700"
                                aria-label={`حذف الفاتورة ${inv.number}`}
                                title="حذف"
                                onClick={() => setConfirmDelete(inv)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          </div>
        </div>

        {/* التقسيم الخادمي */}
        <div className="no-print flex flex-wrap items-center justify-between gap-2 pt-3">
          <p className="text-xs text-muted-foreground">
            صفحة <span className="num font-semibold">{printRows ? 1 : page}</span> من{' '}
            <span className="num font-semibold">{printRows ? 1 : totalPages}</span> — عدد النتائج:{' '}
            <span className="num font-semibold">{fmtNumber(printRows ? printRows.length : total)}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((pg) => Math.max(1, pg - 1))}
            >
              <ChevronRight className="h-4 w-4" />
              السابق
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={(page >= totalPages || loading) && !printRows}
              onClick={() => setPage((pg) => Math.min(totalPages, pg + 1))}
            >
              التالي
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* نموذج الإنشاء/التعديل */}
      <InvoiceFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        type={tab}
        editId={editId}
        items={items}
        warehouses={warehouses}
        partners={partners}
        nextNumber={nextNumber}
        onSaved={() => void load()}
        onItemCreated={handleItemCreated}
      />

      {/* بطاقة العرض */}
      <InvoiceViewDialog invoiceId={viewId} onClose={() => setViewId(null)} />

      {/* تأكيد الحذف */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الفاتورة {confirmDelete?.number}</AlertDialogTitle>
            <AlertDialogDescription>
              سيُعكس أثر الفاتورة على أرصدة الأقسام فوراً وتُحذف سنداتها المرتبطة، وسيُوثَّق الحذف في سجل التدقيق.
              رقم الفاتورة سيُحجز بلاحقة xx فلا يُعطى لأي فاتورة جديدة — حفاظاً على تسلسل الأرقام من التشابه.
              إذا كانت كمياتها قد استُهلكت من المخزون بعدها فسيُرفض الحذف برسالة توضح ذلك. هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>تراجع</AlertDialogCancel>
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
