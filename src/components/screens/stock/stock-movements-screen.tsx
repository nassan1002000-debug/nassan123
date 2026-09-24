'use client'

// شاشة استعلام حركات المخزون — قراءة فقط:
// • كل حركة مخزنية مصدرها مستند (جرد/تلف/فاتورة) تُنشأ تلقائياً من شاشتها — لا إدخال يدوي هنا
// • بطاقات KPI (الإجمالي/إدخالات/إخراجات/تحويلات) مع كميات اليوم
// • جدول بالصورة الأساسية للمادة + نوع ملوّن + (من → إلى) للتحويلات + القيمة المزدوجة
// • فلاتر: بحث، نوع، قسم، مدى تاريخي

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  PackageSearch,
  RefreshCw,
  Repeat2,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { cn } from '@/lib/utils'
import { fmtDate, fmtMoney, fmtNumber, fmtQty, fmtUSD, AR_MOVE_TYPE, AR_REF_TYPE } from '@/lib/format'
import type { WarehouseLite } from './types'
import { MOVE_TYPE_META } from './types'

interface MovementRow {
  id: string
  date: string
  type: 'IN' | 'OUT' | 'TRANSFER'
  quantity: number
  unitCost: number
  value: number
  reason: string | null
  refType: string | null
  item: {
    id: string
    code: string
    name: string
    barcode: string | null
    primaryImageUrl: string | null
  }
  warehouse: WarehouseLite
  counterpart: { id: string; name: string } | null
}

export default function StockMovementsScreen() {
  const { toast } = useToast()

  const [movements, setMovements] = useState<MovementRow[] | null>(null)
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  // فلاتر
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [warehouseFilter, setWarehouseFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // ==================== التحميل ====================
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const [mvRes, whRes] = await Promise.all([fetch('/api/stock-movements'), fetch('/api/warehouses')])
        const [mvData, whData] = await Promise.all([mvRes.ok ? mvRes.json() : [], whRes.ok ? whRes.json() : []])
        if (!cancelled) {
          setMovements(Array.isArray(mvData) ? mvData : [])
          setWarehouses(Array.isArray(whData) ? whData : [])
        }
      } catch {
        if (!cancelled) {
          setMovements([])
          toast({ title: 'تعذر جلب حركات المخزون', variant: 'destructive' })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshKey, toast])

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  const clearFilters = useCallback(() => {
    setSearch('')
    setTypeFilter('all')
    setWarehouseFilter('all')
    setDateFrom('')
    setDateTo('')
  }, [])

  // الأقسام النهائية النشطة فقط
  const leaves = useMemo(() => {
    const hasChildren = new Set(warehouses.map((w) => w.parentId).filter(Boolean))
    return warehouses.filter((w) => !hasChildren.has(w.id) && w.isActive)
  }, [warehouses])

  // ==================== الفلترة ====================
  const filtered = useMemo(() => {
    if (!movements) return []
    const q = search.trim().toLowerCase()
    return movements.filter((m) => {
      if (typeFilter !== 'all' && m.type !== typeFilter) return false
      if (warehouseFilter !== 'all' && m.warehouse.id !== warehouseFilter && m.counterpart?.id !== warehouseFilter)
        return false
      if (dateFrom && new Date(m.date) < new Date(`${dateFrom}T00:00:00`)) return false
      if (dateTo && new Date(m.date) > new Date(`${dateTo}T23:59:59`)) return false
      if (q) {
        const hay = [m.item.name, m.item.code, m.item.barcode ?? '', m.warehouse.name, m.reason ?? '']
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [movements, search, typeFilter, warehouseFilter, dateFrom, dateTo])

  // ==================== إحصاءات ====================
  const stats = useMemo(() => {
    const all = movements ?? []
    const today = new Date().toDateString()
    const sum = (arr: MovementRow[]) => arr.reduce((s, m) => s + m.quantity, 0)
    return {
      total: all.length,
      ins: all.filter((m) => m.type === 'IN'),
      outs: all.filter((m) => m.type === 'OUT'),
      transfers: all.filter((m) => m.type === 'TRANSFER'),
      inToday: sum(all.filter((m) => m.type === 'IN' && new Date(m.date).toDateString() === today)),
      outToday: sum(all.filter((m) => m.type === 'OUT' && new Date(m.date).toDateString() === today)),
    }
  }, [movements])

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          title="إجمالي الحركات"
          value={fmtNumber(stats.total)}
          hint="آخر 500 حركة"
          icon={Repeat2}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="الإدخالات"
          value={fmtNumber(stats.ins.length)}
          hint={`كميات اليوم: ${fmtQty(stats.inToday)}`}
          icon={ArrowDownToLine}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="الإخراجات"
          value={fmtNumber(stats.outs.length)}
          hint={`كميات اليوم: ${fmtQty(stats.outToday)}`}
          icon={ArrowUpFromLine}
          tone="rose"
          loading={loading}
        />
        <KpiCard
          title="التحويلات بين الأقسام"
          value={fmtNumber(stats.transfers.length)}
          hint="صفّا (من → إلى) لكل تحويل"
          icon={ArrowLeftRight}
          tone="amber"
          loading={loading}
        />
      </div>

      <SectionCard
        title="استعلام حركات المخزون"
        description={
          movements
            ? `${fmtNumber(filtered.length)} حركة معروضة من ${fmtNumber(movements.length)} — سجل للقراءة فقط`
            : undefined
        }
        icon={Repeat2}
        action={
          <Badge variant="outline" className="gap-1.5 border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden lg:inline">استعلام فقط — الحركة من مستند مصدرها</span>
            <span className="lg:hidden">استعلام فقط</span>
          </Badge>
        }
      >
        {/* شريط الأدوات — مصفوفة أفقية مرتبة: بحث ← النوع ← القسم ← المدى التاريخي ← تحديث */}
        <div className="no-print mb-4 flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 px-3 py-2.5">
          <div className="relative min-w-52 flex-1 sm:max-w-xs">
            <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالمادة أو القسم أو البيان…"
              className="ps-8"
              aria-label="بحث في الحركات"
            />
          </div>

          <div className="w-36">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger aria-label="فلتر النوع" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأنواع</SelectItem>
                <SelectItem value="IN">إدخال</SelectItem>
                <SelectItem value="OUT">إخراج</SelectItem>
                <SelectItem value="TRANSFER">تحويل</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-44 sm:max-w-60">
            <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
              <SelectTrigger aria-label="فلتر القسم" className="h-9">
                <SelectValue placeholder="كل الأقسام" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأقسام</SelectItem>
                {leaves.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* المدى التاريخي — مجموعة واحدة موحدة كقرص واحد مُعنون */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border bg-background/60 px-2.5 py-1">
            <div className="flex shrink-0 items-center gap-1">
              <Label className="text-[10px] font-medium text-muted-foreground" htmlFor="mv-from">
                من
              </Label>
              <Input
                id="mv-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 w-36 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-1"
                aria-label="من تاريخ"
              />
            </div>
            <span className="hidden text-xs text-muted-foreground sm:inline" aria-hidden>
              ←
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <Label className="text-[10px] font-medium text-muted-foreground" htmlFor="mv-to">
                إلى
              </Label>
              <Input
                id="mv-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 w-36 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-1"
                aria-label="إلى تاريخ"
              />
            </div>
          </div>

          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
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
            title="استعلام حركات المخزون"
            filename="stock-movements"
            headers={[
              'التاريخ',
              'النوع',
              'المادة',
              'كود المادة',
              'القسم',
              'القسم المقابل',
              'الكمية',
              'تكلفة الوحدة',
              'القيمة',
              'السبب',
              'المصدر',
            ]}
            rowsLoader={() =>
              filtered.map((m) => [
                m.date.slice(0, 10),
                AR_MOVE_TYPE[m.type] ?? m.type,
                m.item.name,
                m.item.code,
                m.warehouse.name,
                m.counterpart?.name ?? '',
                m.quantity,
                m.unitCost,
                m.value,
                m.reason ?? '',
                AR_REF_TYPE[m.refType ?? ''] ?? '',
              ])
            }
          />
          <div className="max-h-[56vh] overflow-auto rounded-xl border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_hsl(var(--border))]">
              <TableRow>
                <TableHead className="w-24">التاريخ</TableHead>
                <TableHead className="w-20 text-center">النوع</TableHead>
                <TableHead className="min-w-48">المادة</TableHead>
                <TableHead className="min-w-40">القسم</TableHead>
                <TableHead className="text-center">الكمية</TableHead>
                <TableHead className="text-left">تكلفة الوحدة</TableHead>
                <TableHead className="text-left">القيمة</TableHead>
                <TableHead className="w-72 max-w-72 text-start print:w-40! print:min-w-0! print:max-w-40!">السبب / البيان</TableHead>
                <TableHead className="w-20 text-center">المصدر</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9}>
                      <Skeleton className="h-11 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!loading &&
                filtered.map((m) => {
                  const meta = MOVE_TYPE_META[m.type]
                  return (
                    <TableRow key={m.id} className="group">
                      <TableCell className="num text-xs">{fmtDate(m.date)}</TableCell>

                      <TableCell className="text-center">
                        <Badge variant="outline" className={cn('text-[10px]', meta.badge)}>
                          {AR_MOVE_TYPE[m.type]}
                        </Badge>
                      </TableCell>

                      {/* المادة — بالصورة الأساسية */}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {m.item.primaryImageUrl ? (
                            <img
                              src={m.item.primaryImageUrl}
                              alt={`الصورة الأساسية — ${m.item.name}`}
                              className="h-9 w-9 shrink-0 rounded-md border object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground/40">
                              <PackageSearch className="h-4 w-4" />
                            </span>
                          )}
                          <div className="min-w-0">
                            <span className="block break-words text-sm font-bold leading-snug group-hover:text-primary">
                              {m.item.name}
                            </span>
                            <span className="num text-[10px] text-muted-foreground">{m.item.code}</span>
                          </div>
                        </div>
                      </TableCell>

                      {/* القسم — للتحويل يظهر (من → إلى) */}
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1 text-xs">
                          <span className="font-semibold">{m.warehouse.name}</span>
                          {m.counterpart && (
                            <>
                              <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />
                              <span className="text-muted-foreground">{m.counterpart.name}</span>
                            </>
                          )}
                        </div>
                        <span className="num text-[10px] text-muted-foreground">{m.warehouse.code}</span>
                      </TableCell>

                      <TableCell className="num text-center text-sm font-bold">{fmtQty(m.quantity)}</TableCell>

                      <TableCell className="num text-left text-xs">{fmtMoney(m.unitCost)}</TableCell>

                      <TableCell className="text-left">
                        <span className="num block text-xs font-semibold">{fmtMoney(m.value)}</span>
                        <span className="num block text-[10px] text-muted-foreground">≈ {fmtUSD(m.value)}</span>
                      </TableCell>

                      <TableCell className="w-72 max-w-72 whitespace-normal align-top wrap-anywhere print:w-40! print:min-w-0! print:max-w-40!">
                        <span className="block wrap-anywhere text-xs leading-relaxed text-muted-foreground print:text-[9px] print:leading-snug">
                          {m.reason ?? '—'}
                        </span>
                      </TableCell>

                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px]',
                            m.refType === 'MANUAL' && 'text-muted-foreground',
                            m.refType === 'TRANSFER' && 'border-sky-500/40 text-sky-600 dark:text-sky-400',
                            m.refType === 'DAMAGE' && 'border-rose-500/40 text-rose-600 dark:text-rose-400',
                            m.refType === 'STOCKTAKING' && 'border-amber-500/40 text-amber-600 dark:text-amber-400',
                            m.refType === 'INVOICE' && 'border-primary/40 text-primary',
                          )}
                        >
                          {AR_REF_TYPE[m.refType ?? ''] ?? '—'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}

              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center">
                    <Repeat2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    <p className="text-sm text-muted-foreground">
                      {movements?.length === 0
                        ? 'لا توجد حركات بعد — تُنشأ تلقائياً من أوامر الجرد والتلف والفواتير'
                        : 'لا توجد حركات مطابقة للفلاتر'}
                    </p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          هذه شاشة استعلام للقراءة فقط — كل حركة مصدرها مستند يُنشئها من شاشته (أمر الجرد يرحّل الفروقات، تلف
          المخزون يسجل حالاته، والفواتير تحرك المخزون)؛ التعديل أو الحذف يتم من مستند المصدر نفسه حفاظاً على سلامة
          الأرصدة
        </p>
      </SectionCard>
    </div>
  )
}
