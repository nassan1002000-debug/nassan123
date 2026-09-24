'use client'

// شاشة تلف المخزون — توثيق حالات التلف/الهدر/الفقد بقيمتها التقديرية:
// • KPIs: عدد الحالات، الكميات المتلفة، إجمالي القيمة التقديرية
// • جدول بالصورة الأساسية + سبب ملوّن + قيمة مزدوجة (ل.س + ≈$)
// • فلاتر: بحث، قسم، سبب، مدى تاريخي · حذف يسترد الكمية للرصيد

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PackageX, PackageSearch, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
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
import { fmtDate, fmtMoney, fmtNumber, fmtQty, fmtUSD, AR_DAMAGE_REASON } from '@/lib/format'
import type { ItemLite, WarehouseLite } from './types'
import { DamageFormDialog } from './damage-form-dialog'

interface DamageRow {
  id: string
  date: string
  quantity: number
  unitCost: number
  value: number
  reason: string | null
  item: ItemLite
  warehouse: WarehouseLite
}

const REASON_BADGE: Record<string, string> = {
  تلف: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  'هدر/فساد': 'border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400',
  فقد: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  'انتهاء صلاحية': 'border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  'كسر/تحطيم': 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400',
  أخرى: 'text-muted-foreground',
}

export default function StockDamageScreen() {
  const { toast } = useToast()
  // وضع استعراض الأرشيف (الشرط 4) — إخفاء أزرار التسجيل/الحذف
  const isArchive = useIsArchive()

  const [records, setRecords] = useState<DamageRow[] | null>(null)
  const [items, setItems] = useState<ItemLite[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  // فلاتر
  const [search, setSearch] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('all')
  const [reasonFilter, setReasonFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // نوافذ
  const [formOpen, setFormOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DamageRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ==================== التحميل ====================
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const [dmRes, itRes, whRes] = await Promise.all([
          fetch('/api/stock-damage'),
          fetch('/api/items'),
          fetch('/api/warehouses'),
        ])
        const [dmData, itData, whData] = await Promise.all([
          dmRes.ok ? dmRes.json() : [],
          itRes.ok ? itRes.json() : [],
          whRes.ok ? whRes.json() : [],
        ])
        if (!cancelled) {
          setRecords(Array.isArray(dmData) ? dmData : [])
          setItems(Array.isArray(itData) ? itData : [])
          setWarehouses(Array.isArray(whData) ? whData : [])
        }
      } catch {
        if (!cancelled) {
          setRecords([])
          toast({ title: 'تعذر جلب حالات التلف', variant: 'destructive' })
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
    setWarehouseFilter('all')
    setReasonFilter('all')
    setDateFrom('')
    setDateTo('')
  }, [])

  const leaves = useMemo(() => {
    const hasChildren = new Set(warehouses.map((w) => w.parentId).filter(Boolean))
    return warehouses.filter((w) => !hasChildren.has(w.id) && w.isActive)
  }, [warehouses])

  // ==================== الفلترة ====================
  const filtered = useMemo(() => {
    if (!records) return []
    const q = search.trim().toLowerCase()
    return records.filter((r) => {
      if (warehouseFilter !== 'all' && r.warehouse.id !== warehouseFilter) return false
      if (reasonFilter !== 'all' && !(r.reason ?? '').startsWith(reasonFilter)) return false
      if (dateFrom && new Date(r.date) < new Date(`${dateFrom}T00:00:00`)) return false
      if (dateTo && new Date(r.date) > new Date(`${dateTo}T23:59:59`)) return false
      if (q) {
        const hay = [r.item.name, r.item.code, r.warehouse.name, r.reason ?? ''].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [records, search, warehouseFilter, reasonFilter, dateFrom, dateTo])

  // ==================== إحصاءات ====================
  const stats = useMemo(() => {
    const all = records ?? []
    return {
      count: all.length,
      qty: all.reduce((s, r) => s + r.quantity, 0),
      value: all.reduce((s, r) => s + r.value, 0),
      monthValue: all
        .filter((r) => {
          const d = new Date(r.date)
          const now = new Date()
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
        })
        .reduce((s, r) => s + r.value, 0),
    }
  }, [records])

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/stock-damage/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'فشل الحذف')
      toast({ title: 'حُذفت الحالة وعادت الكمية إلى رصيد القسم' })
      setDeleteTarget(null)
      refresh()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'فشل حذف الحالة', variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="حالات التلف" value={fmtNumber(stats.count)} hint="إجمالي الحالات المسجلة" icon={PackageX} tone="rose" loading={loading} />
        <KpiCard title="الكميات المتلفة" value={fmtQty(stats.qty)} hint="مجموع الكميات المخصومة" icon={PackageSearch} tone="amber" loading={loading} />
        <KpiCard
          title="قيمة التلف التقديرية"
          value={fmtMoney(stats.value)}
          hint={`≈ ${fmtUSD(stats.value)}`}
          icon={PackageX}
          tone="rose"
          loading={loading}
        />
        <KpiCard
          title="تلف هذا الشهر"
          value={fmtMoney(stats.monthValue)}
          hint={`≈ ${fmtUSD(stats.monthValue)}`}
          icon={PackageX}
          tone="slate"
          loading={loading}
        />
      </div>

      <SectionCard
        title="سجل تلف المخزون"
        description={
          records
            ? `${fmtNumber(filtered.length)} حالة معروضة — كل حالة تُخصم من رصيد القسم وتوثق بقيمتها التقديرية`
            : undefined
        }
        icon={PackageX}
        action={
          !isArchive && (
            <Button size="sm" onClick={() => setFormOpen(true)} disabled={items.length === 0 || leaves.length === 0}>
              <Plus className="h-4 w-4" />
              تسجيل تلف
            </Button>
          )
        }
      >
        {/* شريط الأدوات */}
        <div className="no-print mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-48 flex-1 sm:max-w-xs">
            <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالمادة أو القسم أو السبب…"
              className="ps-8"
              aria-label="بحث في حالات التلف"
            />
          </div>

          <div className="min-w-36">
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

          <div className="min-w-36">
            <Select value={reasonFilter} onValueChange={setReasonFilter}>
              <SelectTrigger aria-label="فلتر السبب" className="h-9">
                <SelectValue placeholder="كل الأسباب" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأسباب</SelectItem>
                {Object.values(AR_DAMAGE_REASON).map((label) => (
                  <SelectItem key={label} value={label}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <div>
              <Label className="sr-only" htmlFor="dm-from">من تاريخ</Label>
              <Input
                id="dm-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 w-36 text-xs"
                aria-label="من تاريخ"
              />
            </div>
            <span className="text-xs text-muted-foreground">→</span>
            <div>
              <Label className="sr-only" htmlFor="dm-to">إلى تاريخ</Label>
              <Input
                id="dm-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 w-36 text-xs"
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
            title="سجل تلف المخزون"
            filename="stock-damage"
            headers={[
              'التاريخ',
              'المادة',
              'كود المادة',
              'القسم',
              'كود القسم',
              'الكمية',
              'قيمة التلف',
              'السبب',
              'ملاحظات',
            ]}
            rowsLoader={() =>
              filtered.map((r) => [
                r.date.slice(0, 10),
                r.item.name,
                r.item.code,
                r.warehouse.name,
                r.warehouse.code,
                -r.quantity,
                r.value,
                (r.reason ?? '').split(' — ')[0],
                (r.reason ?? '').includes(' — ')
                  ? (r.reason ?? '').split(' — ').slice(1).join(' — ')
                  : '',
              ])
            }
          />
          <div className="max-h-[56vh] overflow-auto rounded-xl border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_hsl(var(--border))]">
              <TableRow>
                <TableHead className="w-24">التاريخ</TableHead>
                <TableHead className="min-w-44">المادة</TableHead>
                <TableHead className="min-w-36">القسم</TableHead>
                <TableHead className="w-20 text-center">الكمية</TableHead>
                <TableHead className="text-left">قيمة التلف</TableHead>
                <TableHead className="w-28 text-center">السبب</TableHead>
                <TableHead className="min-w-36">ملاحظات</TableHead>
                <TableHead className="no-print w-14 text-center">إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-11 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!loading &&
                filtered.map((r) => {
                  // السبب المخزّن قد يحوي ملاحظات بعد الشرطة — الشارة على الجزء الأول
                  const reasonLabel = (r.reason ?? '').split(' — ')[0]
                  const notes = (r.reason ?? '').includes(' — ') ? (r.reason ?? '').split(' — ').slice(1).join(' — ') : ''
                  return (
                    <TableRow key={r.id} className="group">
                      <TableCell className="num text-xs">{fmtDate(r.date)}</TableCell>

                      {/* المادة — بالصورة الأساسية */}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {r.item.primaryImageUrl ? (
                            <img
                              src={r.item.primaryImageUrl}
                              alt={`الصورة الأساسية — ${r.item.name}`}
                              className="h-9 w-9 shrink-0 rounded-md border object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground/40">
                              <PackageSearch className="h-4 w-4" />
                            </span>
                          )}
                          <div className="min-w-0">
                            <span className="block max-w-44 truncate text-sm font-bold group-hover:text-primary">
                              {r.item.name}
                            </span>
                            <span className="num text-[10px] text-muted-foreground">{r.item.code}</span>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        <span className="block max-w-40 truncate text-xs font-semibold">{r.warehouse.name}</span>
                        <span className="num text-[10px] text-muted-foreground">{r.warehouse.code}</span>
                      </TableCell>

                      <TableCell className="num text-center text-sm font-bold text-rose-600 dark:text-rose-400">
                        -{fmtQty(r.quantity)}
                      </TableCell>

                      <TableCell className="text-left">
                        <span className="num block text-xs font-semibold">{fmtMoney(r.value)}</span>
                        <span className="num block text-[10px] text-muted-foreground">≈ {fmtUSD(r.value)}</span>
                      </TableCell>

                      <TableCell className="text-center">
                        <Badge variant="outline" className={cn('text-[10px]', REASON_BADGE[reasonLabel] ?? 'text-muted-foreground')}>
                          {reasonLabel || '—'}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        <span className="block max-w-40 truncate text-xs text-muted-foreground" title={notes}>
                          {notes || '—'}
                        </span>
                      </TableCell>

                      <TableCell className="no-print text-center">
                        {!isArchive && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7.5 w-7.5 text-rose-500 hover:text-rose-600"
                            onClick={() => setDeleteTarget(r)}
                            aria-label={`حذف حالة تلف ${r.item.name}`}
                            title="حذف واسترداد الكمية للرصيد"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}

              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center">
                    <PackageX className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    <p className="text-sm text-muted-foreground">
                      {records?.length === 0
                        ? 'لا حالات تلف مسجلة — تسجيلها يوثق الخسائر بدقة'
                        : 'لا حالات مطابقة للفلاتر'}
                    </p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <PackageX className="h-3.5 w-3.5" />
          حالات التلف تظهر أيضاً في «حركات المخزون» بمصدر «تلف» — الحذف من هنا يسترد الكمية للرصيد تلقائياً
        </p>
      </SectionCard>

      {/* النوافذ */}
      <DamageFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={refresh}
        items={items}
        warehouses={leaves}
      />

      {/* تأكيد الحذف */}
      <Dialog open={deleteTarget !== null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>حذف حالة التلف؟</DialogTitle>
            <DialogDescription>
              «{deleteTarget ? `${deleteTarget.item.name} — ${fmtQty(deleteTarget.quantity)} من ${deleteTarget.warehouse.name}` : ''}»
              — ستُسترد الكمية إلى رصيد القسم فوراً.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              إلغاء
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              <Trash2 className="h-4 w-4" />
              {deleting ? 'جارٍ الحذف…' : 'حذف واسترداد'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
