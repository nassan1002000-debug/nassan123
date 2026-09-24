'use client'

// شاشة أوامر الجرد — إنشاء أوامر على الأقسام النهائية ومطابقة الجرد الفعلي:
// • ترقيم تلقائي ST-001 ثم +1 · مسودة قابلة للتعديل → ترحيل نهائي يعدّل الأرصدة
// • الترحيل يولّد حركات تسوية (زيادة/نقص) مرتبطة بالأمر ويقفل التعديل
// • الحذف للمسودات فقط — الأمر المُرحّل جزء من تاريخ الأرصدة

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Diff,
  Eye,
  PackageSearch,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SectionCard } from '@/components/common/section-card'
import { KpiCard } from '@/components/common/kpi-card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TableActions } from '@/components/screens/common/table-actions'
import { useToast } from '@/hooks/use-toast'
import { useIsArchive } from '@/lib/store'
import { cn } from '@/lib/utils'
import { fmtDate, fmtMoney, fmtNumber, fmtQty, fmtUSD } from '@/lib/format'
import type { ItemLite, WarehouseLite } from './types'
import { StocktakingFormDialog } from './stocktaking-form-dialog'

interface OrderRow {
  id: string
  number: string
  date: string
  status: 'DRAFT' | 'POSTED'
  notes: string | null
  warehouse: WarehouseLite
  linesCount: number
  increases: number
  decreases: number
  varianceValue: number
}

interface LineItem {
  id: string
  code: string
  name: string
  purchasePrice: number
  primaryImageUrl: string | null
}

interface OrderLine {
  id: string
  itemId: string
  systemQty: number
  countedQty: number
  difference: number
  /** التكلفة المعتمدة من الخادم (آخر سعر شراء ← الوسطي ← الحقل المخزن) */
  unitCost?: number
  item: LineItem
}

interface OrderDetail extends OrderRow {
  lines: OrderLine[]
}

/** حجم صفحة الخادم — عشرون أمراً بالصفحة */
const PAGE_SIZE = 20
/** سقف صفحة الخادم عند جلب كل الأوامر للطباعة والتصدير (نمط شاشة القيود) */
const FETCH_ALL_PAGE_SIZE = 100

/** إحصاءات كل الأوامر بلا فلاتر — من الخادم حتى تبقى الأرقام صحيحة مع الصفحات */
interface ServerStats {
  total: number
  drafts: number
  posted: number
  variance: number
}

const EMPTY_STATS: ServerStats = { total: 0, drafts: 0, posted: 0, variance: 0 }

export default function StocktakingScreen() {
  const { toast } = useToast()
  // وضع استعراض الأرشيف (الشرط 4) — إخفاء أزرار الإنشاء/الحذف/الترحيل
  const isArchive = useIsArchive()

  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [serverStats, setServerStats] = useState<ServerStats>(EMPTY_STATS)
  const [items, setItems] = useState<ItemLite[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  /** صفوف الطباعة الكاملة — تُملأ قبل الطباعة بكل صفحات الخادم وتُفرَّغ بعدها (نمط شاشة القيود) */
  const [printRows, setPrintRows] = useState<OrderRow[] | null>(null)

  // فلاتر — البحث النصي مؤجل (خادمي بتهدئة) والحالة فورية
  const [search, setSearch] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)

  // نوافذ
  const [formOpen, setFormOpen] = useState(false)
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [posting, setPosting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<OrderRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  // عدّاد تسلسلي لعروض التفاصيل — أحدث نقر فقط يُطبّق (يمنع سباق النقر المتكرر)
  const detailSeq = useRef(0)

  // ==================== التحميل ====================
  // تهدئة البحث النصي — الصفحات تُطبق بعد الفلترة خادمياً (نمط شاشة القيود)
  useEffect(() => {
    const t = setTimeout(() => {
      setAppliedQ(search.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (appliedQ) params.set('q', appliedQ)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo) params.set('to', dateTo)
      params.set('page', String(page))
      params.set('pageSize', String(PAGE_SIZE))

      const res = await fetch(`/api/stocktaking?${params.toString()}`)
      if (!res.ok) throw new Error('stocktaking')
      const data = await res.json().catch(() => null)
      if (seq !== loadSeq.current) return
      if (data && Array.isArray(data.orders)) {
        setOrders(data.orders)
        setTotal(data.total ?? 0)
        setTotalPages(Math.max(1, data.totalPages ?? 1))
        if (data.stats) setServerStats(data.stats)
      } else {
        setOrders([])
        setTotal(0)
        setTotalPages(1)
      }
    } catch {
      if (seq === loadSeq.current) {
        setOrders([])
        setTotal(0)
        setTotalPages(1)
        toast({ title: 'تعذر جلب أوامر الجرد', variant: 'destructive' })
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [appliedQ, statusFilter, dateFrom, dateTo, page, toast])

  useEffect(() => {
    void load()
  }, [load])

  // المراجع الخاصة بنافذة أمر الجرد الجديد — القائمة الكاملة للمواد (بلا صفحات) والمستودعات
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [itRes, whRes] = await Promise.all([fetch('/api/items'), fetch('/api/warehouses')])
      const [itData, whData] = await Promise.all([itRes.ok ? itRes.json() : [], whRes.ok ? whRes.json() : []])
      if (!alive) return
      setItems(Array.isArray(itData) ? itData : [])
      setWarehouses(Array.isArray(whData) ? whData : [])
    })()
    return () => {
      alive = false
    }
  }, [refreshKey])

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  const leaves = useMemo(() => {
    const hasChildren = new Set(warehouses.map((w) => w.parentId).filter(Boolean))
    return warehouses.filter((w) => !hasChildren.has(w.id) && w.isActive)
  }, [warehouses])

  // الصفوف المعروضة — كل الصفوف المطابقة أثناء الطباعة، وإلا صفحة الخادم الحالية
  const displayRows = printRows ?? (orders ?? [])

  // ===== جلب كل الأوامر المطابقة للفلاتر عبر كل صفحات الخادم (سقف 100/صفحة) — للطباعة والتصدير الكاملين =====
  const fetchAllOrders = useCallback(async (): Promise<OrderRow[]> => {
    const all: OrderRow[] = []
    for (let p = 1; p < 100; p++) {
      const params = new URLSearchParams()
      if (appliedQ) params.set('q', appliedQ)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo) params.set('to', dateTo)
      params.set('page', String(p))
      params.set('pageSize', String(FETCH_ALL_PAGE_SIZE))
      const res = await fetch(`/api/stocktaking?${params.toString()}`)
      const data = (await res.json().catch(() => null)) as { orders?: OrderRow[]; total?: number } | null
      if (!res.ok || !data) break
      const rows = data.orders ?? []
      all.push(...rows)
      if (rows.length === 0 || all.length >= (data.total ?? 0)) break
    }
    return all
  }, [appliedQ, statusFilter, dateFrom, dateTo])

  // ==================== العرض والترحيل ====================
  async function openDetail(order: OrderRow) {
    const seq = ++detailSeq.current
    setDetailLoading(true)
    setDetail({ ...order, lines: [] })
    try {
      const res = await fetch(`/api/stocktaking/${order.id}`)
      const data = await res.json().catch(() => null)
      if (seq !== detailSeq.current) return // وصلت استجابة أقدم من أحدث نقرة — تُهمَل
      if (!res.ok) throw new Error(data?.error || 'فشل جلب الأمر')
      setDetail(data)
    } catch (err) {
      if (seq !== detailSeq.current) return
      toast({ title: err instanceof Error ? err.message : 'فشل جلب الأمر', variant: 'destructive' })
      setDetail(null)
    } finally {
      if (seq === detailSeq.current) setDetailLoading(false)
    }
  }

  async function postOrder() {
    if (!detail) return
    setPosting(true)
    try {
      const res = await fetch(`/api/stocktaking/${detail.id}`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'فشل الترحيل')
      toast({
        title: `رُحّل أمر الجرد ${detail.number}`,
        description: `عدّلت الأرصدة — ${fmtNumber(data.adjustments)} حركة تسوية (زيادات ${fmtNumber(data.increases)} · نقصات ${fmtNumber(data.decreases)})`,
      })
      setDetail(null)
      refresh()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'فشل الترحيل', variant: 'destructive' })
    } finally {
      setPosting(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/stocktaking/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'فشل الحذف')
      toast({ title: `حُذف أمر الجرد ${deleteTarget.number}` })
      setDeleteTarget(null)
      refresh()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'فشل حذف الأمر', variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* KPIs — من إحصاءات الخادم الكلية (كل الأوامر لا الصفحة المعروضة) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="إجمالي الأوامر" value={fmtNumber(serverStats.total)} icon={ClipboardCheck} tone="gold" loading={loading} />
        <KpiCard title="مسودات" value={fmtNumber(serverStats.drafts)} hint="قابلة للتعديل والترحيل" icon={Diff} tone="amber" loading={loading} />
        <KpiCard title="أوامر مُرحّلة" value={fmtNumber(serverStats.posted)} hint="عدّلت الأرصدة نهائياً" icon={Send} tone="emerald" loading={loading} />
        <KpiCard
          title="صافي قيمة الفروقات"
          value={fmtMoney(serverStats.variance)}
          hint={`≈ ${fmtUSD(serverStats.variance)}`}
          icon={Diff}
          tone={serverStats.variance < 0 ? 'rose' : 'slate'}
          loading={loading}
        />
      </div>

      <SectionCard
        title="أوامر الجرد"
        description={
          orders
            ? `${fmtNumber(total)} أمر — الترقيم التلقائي ST-001 ثم +1 · الترحيل يولّد حركات تسوية بالأرصدة`
            : undefined
        }
        icon={ClipboardCheck}
        action={
          !isArchive && (
            <Button size="sm" onClick={() => setFormOpen(true)} disabled={leaves.length === 0}>
              <Plus className="h-4 w-4" />
              أمر جرد جديد
            </Button>
          )
        }
      >
        {/* شريط الأدوات */}
        <div className="no-print mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-52 flex-1 sm:max-w-xs">
            <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برقم الأمر أو القسم…"
              className="ps-8"
              aria-label="بحث في أوامر الجرد"
            />
          </div>
          <div className="w-36">
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label="فلتر الحالة" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="DRAFT">مسودة</SelectItem>
                <SelectItem value="POSTED">مُرحّلة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <div>
              <Label className="sr-only" htmlFor="st-from">من تاريخ</Label>
              <Input
                id="st-from"
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value)
                  setPage(1)
                }}
                className="h-9 w-36 text-xs"
                aria-label="من تاريخ"
              />
            </div>
            <span className="text-xs text-muted-foreground">→</span>
            <div>
              <Label className="sr-only" htmlFor="st-to">إلى تاريخ</Label>
              <Input
                id="st-to"
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value)
                  setPage(1)
                }}
                className="h-9 w-36 text-xs"
                aria-label="إلى تاريخ"
              />
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setSearch('')
              setAppliedQ('')
              setStatusFilter('all')
              setDateFrom('')
              setDateTo('')
              setPage(1)
            }}
          >
            <X className="h-3.5 w-3.5" />
            مسح الفلاتر
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" />
            تحديث
          </Button>
        </div>

        {/* الجدول */}
        <div className="print-area">
          <TableActions
            title="أوامر الجرد"
            filename="stocktaking"
            headers={[
              'الرقم',
              'التاريخ',
              'القسم',
              'كود القسم',
              'الحالة',
              'الأسطر',
              'زيادات',
              'نقصات',
              'قيمة الفرق',
              'ملاحظات',
            ]}
            onBeforePrint={async () => {
              setPrintRows(await fetchAllOrders())
            }}
            onAfterPrint={() => setPrintRows(null)}
            rowsLoader={async () =>
              (await fetchAllOrders()).map((o) => [
                o.number,
                o.date.slice(0, 10),
                o.warehouse.name,
                o.warehouse.code,
                o.status === 'DRAFT' ? 'مسودة' : 'مُرحّل',
                o.linesCount,
                o.increases,
                o.decreases,
                o.varianceValue,
                o.notes ?? '',
              ])
            }
          />
          <div className="max-h-[56vh] overflow-auto rounded-xl border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_hsl(var(--border))]">
              <TableRow>
                <TableHead className="w-24">الرقم</TableHead>
                <TableHead className="w-24">التاريخ</TableHead>
                <TableHead className="min-w-40">القسم</TableHead>
                <TableHead className="w-20 text-center">الحالة</TableHead>
                <TableHead className="w-20 text-center">الأسطر</TableHead>
                <TableHead className="w-32 text-center">الفروقات</TableHead>
                <TableHead className="text-left">قيمة الفرق</TableHead>
                <TableHead className="min-w-32">ملاحظات</TableHead>
                <TableHead className="no-print w-28 text-center">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9}>
                      <Skeleton className="h-11 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!loading && displayRows.map((o) => (
                  <TableRow key={o.id} className="group">
                    <TableCell className="num font-mono text-xs font-bold text-primary">{o.number}</TableCell>
                    <TableCell className="num text-xs">{fmtDate(o.date)}</TableCell>
                    <TableCell>
                      <span className="block max-w-44 truncate text-sm font-bold group-hover:text-primary">
                        {o.warehouse.name}
                      </span>
                      <span className="num text-[10px] text-muted-foreground">{o.warehouse.code}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px]',
                          o.status === 'DRAFT'
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                        )}
                      >
                        {o.status === 'DRAFT' ? 'مسودة' : 'مُرحّل'}
                      </Badge>
                    </TableCell>
                    <TableCell className="num text-center text-xs">{fmtNumber(o.linesCount)}</TableCell>
                    <TableCell className="text-center">
                      <span className="num block text-xs font-bold text-emerald-600 dark:text-emerald-400">
                        ↑ {fmtNumber(o.increases)}
                      </span>
                      <span className="num block text-xs font-bold text-rose-600 dark:text-rose-400">
                        ↓ {fmtNumber(o.decreases)}
                      </span>
                    </TableCell>
                    <TableCell className="text-left">
                      <span
                        className={cn(
                          'num text-xs font-semibold',
                          o.varianceValue < 0 && 'text-rose-600 dark:text-rose-400',
                        )}
                      >
                        {fmtMoney(o.varianceValue)}
                      </span>
                      <span className="num block text-[10px] text-muted-foreground">≈ {fmtUSD(o.varianceValue)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="block max-w-32 truncate text-xs text-muted-foreground" title={o.notes ?? ''}>
                        {o.notes ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell className="no-print">
                      <div className="flex items-center justify-center gap-0.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7.5 w-7.5"
                          onClick={() => openDetail(o)}
                          aria-label={`عرض ${o.number}`}
                          title="عرض الأسطر والترحيل"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {o.status === 'DRAFT' && !isArchive && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7.5 w-7.5 text-rose-500 hover:text-rose-600"
                            onClick={() => setDeleteTarget(o)}
                            aria-label={`حذف ${o.number}`}
                            title="حذف المسودة"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}

              {!loading && displayRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center">
                    <ClipboardCheck className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    <p className="text-sm text-muted-foreground">
                      {total === 0
                        ? 'لا توجد أوامر جرد بعد — أنشئ أول أمر على أحد الأقسام'
                        : 'لا توجد أوامر مطابقة للفلاتر'}
                    </p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
        </div>

        {/* التقسيم الخادمي — الصفحات بعد الفلترة والإحصاءات من كل الأوامر */}
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
              disabled={page >= totalPages || loading}
              onClick={() => setPage((pg) => Math.min(totalPages, pg + 1))}
            >
              التالي
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* نافذة أمر جديد */}
      <StocktakingFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={refresh}
        items={items}
        warehouses={leaves}
      />

      {/* نافذة العرض/الترحيل */}
      <Dialog open={detail !== null} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              أمر الجرد {detail?.number}
              {detail && (
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px]',
                    detail.status === 'DRAFT'
                      ? 'border-amber-500/40 text-amber-600 dark:text-amber-400'
                      : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
                  )}
                >
                  {detail.status === 'DRAFT' ? 'مسودة' : 'مُرحّل'}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {detail && (
                <>
                  {detail.warehouse.name} · <span className="num">{fmtDate(detail.date)}</span> ·{' '}
                  <span className="num">{fmtNumber(detail.lines.length)}</span> سطر
                  {detail.notes ? ` · ${detail.notes}` : ''}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[52vh] overflow-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted/70 backdrop-blur">
                <tr>
                  <th className="p-2 text-start text-xs font-bold">المادة</th>
                  <th className="w-24 p-2 text-center text-xs font-bold">كمية النظام</th>
                  <th className="w-24 p-2 text-center text-xs font-bold">المجرود</th>
                  <th className="w-20 p-2 text-center text-xs font-bold">الفرق</th>
                  <th className="w-32 p-2 text-left text-xs font-bold">قيمة الفرق</th>
                </tr>
              </thead>
              <tbody>
                {detailLoading && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center">
                      <Skeleton className="mx-auto h-24 w-full" />
                    </td>
                  </tr>
                )}
                {!detailLoading &&
                  detail?.lines.map((ln) => {
                    // نفس تكلفة الخادم (آخر سعر شراء ← الوسطي ← الحقل المخزن) — لا السعر الخام
                    const lineCost = ln.unitCost ?? ln.item.purchasePrice
                    return (
                    <tr key={ln.id} className={cn('border-t', ln.difference !== 0 && 'bg-primary/[0.04]')}>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          {ln.item.primaryImageUrl ? (
                            <img
                              src={ln.item.primaryImageUrl}
                              alt={ln.item.name}
                              className="h-8 w-8 rounded-md border object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-dashed text-muted-foreground/40">
                              <PackageSearch className="h-3.5 w-3.5" />
                            </span>
                          )}
                          <div className="min-w-0">
                            <p className="max-w-44 truncate text-xs font-bold">{ln.item.name}</p>
                            <p className="num text-[10px] text-muted-foreground">{ln.item.code}</p>
                          </div>
                        </div>
                      </td>
                      <td className="num p-2 text-center text-xs">{fmtQty(ln.systemQty)}</td>
                      <td className="num p-2 text-center text-xs font-bold">{fmtQty(ln.countedQty)}</td>
                      <td className="p-2 text-center">
                        <span
                          className={cn(
                            'num text-xs font-bold',
                            ln.difference > 0 && 'text-emerald-600 dark:text-emerald-400',
                            ln.difference < 0 && 'text-rose-600 dark:text-rose-400',
                          )}
                        >
                          {ln.difference !== 0 ? `${ln.difference > 0 ? '+' : ''}${fmtQty(ln.difference)}` : '—'}
                        </span>
                      </td>
                      <td className="p-2 text-left">
                        <span
                          className={cn(
                            'num text-xs',
                            ln.difference * lineCost < 0 && 'text-rose-600 dark:text-rose-400',
                          )}
                        >
                          {ln.difference !== 0 ? fmtMoney(ln.difference * lineCost) : '—'}
                        </span>
                      </td>
                    </tr>
                  )
                  })}
                {!detailLoading && detail && detail.lines.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-xs text-muted-foreground">
                      لا أسطر في هذا الأمر
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <DialogFooter className="gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => setDetail(null)}>
              إغلاق
            </Button>
            {detail?.status === 'DRAFT' && !isArchive && (
              <Button onClick={postOrder} disabled={posting}>
                <Send className="h-4 w-4" />
                {posting ? 'جارٍ الترحيل…' : 'ترحيل وتعديل الأرصدة'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد الحذف */}
      <Dialog open={deleteTarget !== null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>حذف مسودة الجرد؟</DialogTitle>
            <DialogDescription>
              «{deleteTarget?.number}» — {deleteTarget?.warehouse.name} — المسودات لا تؤثر على الأرصدة ويُحذف أمرها كلياً.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              إلغاء
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              <Trash2 className="h-4 w-4" />
              {deleting ? 'جارٍ الحذف…' : 'حذف نهائي'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
