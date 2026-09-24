'use client'

// شاشة بطاقات المواد والأصناف — الجدول الرئيسي:
// • عمود الصورة الأساسية يرافق المادة في الجدول (وترافقها بكل شاشات النظام لاحقاً — عدا الطباعة)
// • الترقيم التلقائي للبطاقات I-001 ثم +1
// • بحث بالاسم/الكود/الباركود + فلتر القسم النهائي + إظهار الموقوفة
// • نوافذ: نموذج البطاقة (5 تبويبات) + بطاقة تعريف + حذف + عارض صور بالزوم

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Barcode,
  ChevronLeft,
  ChevronRight,
  Eye,
  IdCard,
  ImageOff,
  Package,
  PackageSearch,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Warehouse,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SectionCard } from '@/components/common/section-card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TableActions } from '@/components/screens/common/table-actions'
import { useToast } from '@/hooks/use-toast'
import { useIsArchive, useNav } from '@/lib/store'
import { useActionBus } from '@/lib/action-bus'
import { cn } from '@/lib/utils'
import { fmtMoney, fmtNumber, fmtUSD } from '@/lib/format'
import { ImageViewer } from '@/components/common/image-viewer'
import type { WarehouseDTO } from '../warehouses/types'
import { leafWarehouseIds, type ItemDTO } from './types'
import { ItemFormDialog } from './item-form-dialog'
import { ItemProfileDialog } from './item-profile-dialog'
import { ItemDeleteDialog } from './item-delete-dialog'

/** حجم صفحة الخادم — خمسون مادة بالصفحة مع تمرير الجدول */
const PAGE_SIZE = 50
/** سقف صفحة الخادم عند جلب كل المواد للطباعة والتصدير (نمط شاشة القيود) */
const FETCH_ALL_PAGE_SIZE = 100

export default function ItemsScreen() {
  const { toast } = useToast()
  const navigate = useNav((s) => s.navigate)
  // وضع استعراض الأرشيف (الشرط 4) — إخفاء أزرار الإضافة/التعديل/الحذف
  const isArchive = useIsArchive()

  const [items, setItems] = useState<ItemDTO[] | null>(null)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [serverStats, setServerStats] = useState({ total: 0, active: 0, withImages: 0, leafAssigned: 0 })
  const [nextCode, setNextCode] = useState('I-001')
  const [locations, setLocations] = useState<string[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  /** صفوف الطباعة الكاملة — تُملأ قبل الطباعة بكل صفحات الخادم وتُفرَّغ بعدها (نمط شاشة القيود) */
  const [printRows, setPrintRows] = useState<ItemDTO[] | null>(null)

  // فلاتر — البحث النصي مؤجل (خادمي بتهدئة) والبقية فورية
  const [search, setSearch] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('all')
  const [showInactive, setShowInactive] = useState(true)
  const [page, setPage] = useState(1)

  // نوافذ
  const [formOpen, setFormOpen] = useState(false)
  const [editItem, setEditItem] = useState<ItemDTO | null>(null)
  const [profileItem, setProfileItem] = useState<ItemDTO | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ItemDTO | null>(null)
  const [viewerIdx, setViewerIdx] = useState<number | null>(null)

  // Task 40 — رابط عميق من البحث المركزي: فتح بطاقة المادة مباشرة (إشارة تُستهلك مرة واحدة)
  const itemSignal = useActionBus((s) => s.pendingItemSignal)
  const consumeItemSignal = useActionBus((s) => s.consumeItemProfileSignal)
  useEffect(() => {
    if (!itemSignal) return
    setProfileItem(itemSignal.item as unknown as ItemDTO)
    consumeItemSignal()
  }, [itemSignal, consumeItemSignal])

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
      if (warehouseFilter !== 'all') params.set('warehouseId', warehouseFilter)
      if (!showInactive) params.set('active', '1')
      params.set('page', String(page))
      params.set('pageSize', String(PAGE_SIZE))

      const res = await fetch(`/api/items?${params.toString()}`)
      if (!res.ok) throw new Error('items')
      const data = await res.json().catch(() => null)
      if (seq !== loadSeq.current) return
      if (data && Array.isArray(data.items)) {
        setItems(data.items)
        setTotal(data.total ?? 0)
        setTotalPages(Math.max(1, data.totalPages ?? 1))
        if (data.stats) setServerStats(data.stats)
        if (data.nextCode) setNextCode(data.nextCode)
        if (Array.isArray(data.locations)) setLocations(data.locations)
      } else {
        setItems([])
        setTotal(0)
        setTotalPages(1)
      }
    } catch {
      if (seq === loadSeq.current) {
        setItems([])
        setTotal(0)
        setTotalPages(1)
        toast({ title: 'تعذر جلب المواد', variant: 'destructive' })
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [appliedQ, warehouseFilter, showInactive, page, toast])

  useEffect(() => {
    void load()
  }, [load])

  // المستودعات — بتحميل مستقل (لإرشاد الإسناد وفلتر القسم) يُعاد عند التحديث فقط
  useEffect(() => {
    let alive = true
    fetch('/api/warehouses')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('warehouses'))))
      .then((whData) => {
        if (!alive) return
        setWarehouses(Array.isArray(whData) ? whData : [])
      })
      .catch(() => {
        if (alive) toast({ title: 'تعذر جلب المستودعات — قد تظهر المواد كغير مسندة', variant: 'destructive' })
      })
    return () => {
      alive = false
    }
  }, [refreshKey, toast])

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  const leaves = useMemo(() => leafWarehouseIds(warehouses), [warehouses])
  const leafList = useMemo(
    () => warehouses.filter((w) => leaves.has(w.id) && w.isActive),
    [warehouses, leaves],
  )

  // الصفوف المعروضة — كل الصفوف المطابقة أثناء الطباعة، وإلا صفحة الخادم الحالية
  const displayRows = printRows ?? (items ?? [])

  // ===== جلب كل المواد المطابقة للفلاتر عبر كل صفحات الخادم (سقف 100/صفحة) — للطباعة والتصدير الكاملين =====
  const fetchAllItems = useCallback(async (): Promise<ItemDTO[]> => {
    const all: ItemDTO[] = []
    for (let p = 1; p < 100; p++) {
      const params = new URLSearchParams()
      if (appliedQ) params.set('q', appliedQ)
      if (warehouseFilter !== 'all') params.set('warehouseId', warehouseFilter)
      if (!showInactive) params.set('active', '1')
      params.set('page', String(p))
      params.set('pageSize', String(FETCH_ALL_PAGE_SIZE))
      const res = await fetch(`/api/items?${params.toString()}`)
      const data = (await res.json().catch(() => null)) as { items?: ItemDTO[]; total?: number } | null
      if (!res.ok || !data) break
      const rows = data.items ?? []
      all.push(...rows)
      if (rows.length === 0 || all.length >= (data.total ?? 0)) break
    }
    return all
  }, [appliedQ, warehouseFilter, showInactive])

  const viewerItem = profileItem
  const viewerImages = viewerItem
    ? (viewerItem.images.length > 0
        ? viewerItem.images.map((i) => ({ url: i.url, title: i.fileName }))
        : [])
    : []


  return (
    <div className="space-y-4">
      {/* لافتة إرشادية: لا يمكن إضافة مواد بلا مستودعات (النموذج نفسه يعرض إرشاداً كذلك) */}
      {!loading && warehouses.length === 0 && (
        <div className="no-print flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            <span className="font-bold text-amber-600 dark:text-amber-400">لا توجد مستودعات بعد — </span>
            <span className="text-muted-foreground">
              إضافة بطاقة مادة تشترط مستودعاً وأقساماً تُسند إليها المادة مع الحد الأدنى/الأعلى للمخزون
            </span>
          </p>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => navigate('warehouses')}
          >
            <Warehouse className="ml-2 h-4 w-4" />
            الانتقال إلى المستودعات
          </Button>
        </div>
      )}

      <SectionCard
        title="بطاقات المواد والأصناف"
        description={
          items
            ? `${fmtNumber(serverStats.total)} مادة — الترقيم التلقائي (التالي: ${nextCode}) • ${fmtNumber(serverStats.withImages)} بصور • ${fmtNumber(serverStats.leafAssigned)} مسندة لأقسام`
            : undefined
        }
        icon={Package}
        action={
          !isArchive && (
            <Button
              size="sm"
              onClick={() => {
                setEditItem(null)
                setFormOpen(true)
              }}
            >
              <Plus className="h-4 w-4" />
              مادة جديدة
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
              placeholder="بحث بالاسم أو رقم البطاقة أو الباركود…"
              className="ps-8"
              aria-label="بحث في المواد"
            />
          </div>

          <div className="min-w-48">
            <SelectWarehouses
              list={leafList}
              value={warehouseFilter}
              onChange={(v) => {
                setWarehouseFilter(v)
                setPage(1)
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="items-inactive"
              checked={showInactive}
              onCheckedChange={(v) => {
                setShowInactive(v)
                setPage(1)
              }}
            />
            <Label htmlFor="items-inactive" className="text-sm text-muted-foreground">
              إظهار الموقوفة
            </Label>
          </div>

          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" />
            تحديث
          </Button>
        </div>

        {/* الجدول */}
        <div className="print-area">
          <TableActions
            title="بطاقات المواد والأصناف"
            filename="items"
            headers={[
              'رقم البطاقة',
              'اسم المادة',
              'الباركود',
              'الوحدات',
              'القسم',
              'كود القسم',
              'سعر الشراء',
              'سعر البيع',
              'الحالة',
            ]}
            onBeforePrint={async () => {
              setPrintRows(await fetchAllItems())
            }}
            onAfterPrint={() => setPrintRows(null)}
            rowsLoader={async () =>
              (await fetchAllItems()).map((it) => [
                it.code,
                it.name,
                it.barcode ?? '',
                it.units.map((u) => `${u.name}×${u.factor}`).join('، '),
                it.warehouse?.name ?? '',
                it.warehouse?.code ?? '',
                it.purchasePrice,
                it.salePrice,
                it.isActive ? 'نشطة' : 'موقوفة',
              ])
            }
          />
          <div className="max-h-[62vh] overflow-auto rounded-xl border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_hsl(var(--border))]">
              <TableRow>
                <TableHead className="w-16 text-center">الصورة</TableHead>
                <TableHead className="w-24">رقم البطاقة</TableHead>
                <TableHead>اسم المادة</TableHead>
                <TableHead className="w-40">الوحدات</TableHead>
                <TableHead className="min-w-44">القسم (المستودع)</TableHead>
                <TableHead className="text-left">سعر الشراء</TableHead>
                <TableHead className="text-left">سعر البيع</TableHead>
                <TableHead className="w-20 text-center">الحالة</TableHead>
                <TableHead className="no-print w-28 text-center">إجراءات</TableHead>
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

              {!loading && displayRows.map((it) => (
                  <TableRow key={it.id} className="group">
                    {/* الصورة الأساسية — ترافق المادة في كل الجداول */}
                    <TableCell className="text-center">
                      {it.primaryImageUrl ? (
                        <button
                          type="button"
                          onClick={() => {
                            setProfileItem(it)
                            setViewerIdx(0)
                          }}
                          className="inline-block overflow-hidden rounded-lg border transition-all hover:scale-105 hover:border-primary/60 hover:shadow-md"
                          title="معاينة الصورة الأساسية (زوم + تحريك)"
                          aria-label={`معاينة صورة ${it.name}`}
                        >
                          <img
                            src={it.primaryImageUrl}
                            alt={`الصورة الأساسية — ${it.name}`}
                            className="h-11 w-11 object-cover"
                            loading="lazy"
                          />
                        </button>
                      ) : (
                        <span
                          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-dashed text-muted-foreground/50"
                          title="لا توجد صورة أساسية"
                        >
                          <ImageOff className="h-4.5 w-4.5" />
                        </span>
                      )}
                    </TableCell>

                    <TableCell className="num font-mono text-xs font-bold text-primary">{it.code}</TableCell>

                    <TableCell>
                      <button
                        type="button"
                        className="text-start"
                        onClick={() => setProfileItem(it)}
                        title="عرض بطاقة التعريف"
                      >
                        <span className="block max-w-56 truncate text-sm font-bold group-hover:text-primary">
                          {it.name}
                        </span>
                        {it.barcode && (
                          <span className="num flex items-center gap-1 font-mono text-[10px] text-muted-foreground" dir="ltr">
                            <Barcode className="h-3 w-3" />
                            {it.barcode}
                          </span>
                        )}
                        {it.description && (
                          <span className="block max-w-56 truncate text-[11px] text-muted-foreground/70">
                            {it.description}
                          </span>
                        )}
                      </button>
                    </TableCell>

                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {it.units.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          it.units.slice(0, 3).map((u) => (
                            <Badge
                              key={u.id}
                              variant="outline"
                              className={cn(
                                'num text-[10px]',
                                u.isActive ? 'border-primary/30 text-primary' : 'text-muted-foreground',
                              )}
                              title={u.isActive ? 'مفعّل' : 'موقوف'}
                            >
                              {u.name} ×{fmtNumber(u.factor)}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>

                    <TableCell>
                      {it.warehouse ? (
                        <div className="flex items-center gap-1.5">
                          <PackageSearch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <span className="block max-w-40 truncate text-xs font-semibold">
                              {it.warehouse.name}
                            </span>
                            <span className="num text-[10px] text-muted-foreground">{it.warehouse.code}</span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">غير مسندة</span>
                      )}
                    </TableCell>

                    <TableCell className="text-left">
                      <span className="num text-xs">{fmtMoney(it.purchasePrice)}</span>
                      <span className="num block text-[10px] text-muted-foreground">≈ {fmtUSD(it.purchasePrice)}</span>
                    </TableCell>

                    <TableCell className="text-left">
                      <span className="num text-xs font-semibold">{fmtMoney(it.salePrice)}</span>
                      <span className="num block text-[10px] text-muted-foreground">≈ {fmtUSD(it.salePrice)}</span>
                    </TableCell>

                    <TableCell className="text-center">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px]',
                          it.isActive
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'text-muted-foreground',
                        )}
                      >
                        {it.isActive ? 'نشطة' : 'موقوفة'}
                      </Badge>
                    </TableCell>

                    <TableCell className="no-print">
                      <div className="flex items-center justify-center gap-0.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7.5 w-7.5"
                          onClick={() => setProfileItem(it)}
                          aria-label="بطاقة تعريف"
                          title="بطاقة تعريف"
                        >
                          <IdCard className="h-4 w-4" />
                        </Button>
                        {!isArchive && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7.5 w-7.5"
                            onClick={() => {
                              setEditItem(it)
                              setFormOpen(true)
                            }}
                            aria-label="تعديل"
                            title="تعديل"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {!isArchive && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7.5 w-7.5 text-rose-500 hover:text-rose-600"
                            onClick={() => setDeleteTarget(it)}
                            aria-label="حذف"
                            title="حذف"
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
                    <Package className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    <p className="text-sm text-muted-foreground">
                      {total === 0
                        ? 'لا توجد مواد بعد — أنشئ أول بطاقة مادة'
                        : 'لا توجد مواد مطابقة للبحث أو الفلترة'}
                    </p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
        </div>

        {/* التقسيم الخادمي — الصفحات بعد الفلترة والإحصاءات من كل السجلات */}
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

        <p className="no-print mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Eye className="h-3.5 w-3.5" />
          الصورة الأساسية ترافق المادة في كل الجداول وشاشات النظام (جدول المواد، بطاقات التعريف، الفواتير،
          الحركات…) — وتُستثنى من جداول الطباعة تلقائياً
        </p>
      </SectionCard>

      {/* النوافذ */}
      {/* تُعرض دائماً — والنموذج نفسه يرشد لإنشاء المستودعات عند غيابها (كانت مخفية كلياً قبلاً فلا يستجيب زر الإضافة) */}
      <ItemFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={refresh}
        warehouses={warehouses}
        editItem={editItem}
        nextCode={nextCode}
        locations={locations}
      />

      {profileItem && (
        <ItemProfileDialog
          item={items?.find((i) => i.id === profileItem.id) ?? profileItem}
          warehouses={warehouses}
          onClose={() => {
            setProfileItem(null)
            setViewerIdx(null)
          }}
          onEdit={(it) => {
            setProfileItem(null)
            setEditItem(it)
            setFormOpen(true)
          }}
        />
      )}

      <ItemDeleteDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={refresh} />

      {/* عارض الصور العام — من الجدول أو بطاقة التعريف */}
      <ImageViewer
        images={viewerImages}
        index={viewerIdx}
        onClose={() => setViewerIdx(null)}
        onIndexChange={setViewerIdx}
        contextTitle={viewerItem?.name}
      />
    </div>
  )
}

// ==================== فلتر القسم ====================
function SelectWarehouses({
  list,
  value,
  onChange,
}: {
  list: WarehouseDTO[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="فلتر القسم" className="h-9">
        <SelectValue placeholder="كل الأقسام" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">كل الأقسام النهائية</SelectItem>
        {list.map((w) => (
          <SelectItem key={w.id} value={w.id}>
            {w.name} <span className="num text-xs text-muted-foreground">({w.code})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
