'use client'

// شاشة المستودعات — شجرة هرمية بأربعة مستويات على نمط البطاقات الملونة (الصورة المرجعية)
// تمييز الأب عن الأبناء: الشامل ذهبي ← مستودع عام برتقالي ← مستودع فرعي أخضر ← قسم أزرق
// كل بطاقة تتضمن أمين المستودع + عدادات المواد والفروع — بلا بطاقات أصناف (مرحلة المستودعات فقط)

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronsDownUp,
  ChevronsUpDown,
  IdCard,
  Landmark,
  MapPin,
  Network,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
  UserX,
  Warehouse,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionCard } from '@/components/common/section-card'
import { TableActions } from '@/components/screens/common/table-actions'
import { useToast } from '@/hooks/use-toast'
import { useIsArchive } from '@/lib/store'
import { cn } from '@/lib/utils'
import { fmtNumber } from '@/lib/format'
import {
  LEVEL_META,
  LEVEL_ICONS,
  LEVEL_STYLES,
  buildWarehouseIndex,
  type WarehouseDTO,
  type WarehouseLevel,
  type WarehouseNode,
} from './types'
import {
  WarehouseDeleteDialog,
  WarehouseFormDialog,
  WarehouseProfileDialog,
  type WarehouseFormMode,
} from './warehouse-dialogs'

// المفتاح اللوني — بنفس ترتيب وأسماء الصورة المرجعية
const LEGEND: { level: WarehouseLevel; label: string }[] = [
  { level: 1, label: 'المستودع الشامل' },
  { level: 2, label: 'مستودع عام' },
  { level: 3, label: 'مستودع فرعي' },
  { level: 4, label: 'قسم' },
]

export default function WarehousesScreen() {
  const { toast } = useToast()
  // وضع استعراض الأرشيف (الشرط 4) — إخفاء أزرار الإضافة/التعديل/الحذف
  const isArchive = useIsArchive()
  const [flat, setFlat] = useState<WarehouseDTO[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  // فلاتر
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState<'ALL' | WarehouseLevel>('ALL')
  const [showInactive, setShowInactive] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // نوافذ
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<WarehouseFormMode>('create')
  const [formTarget, setFormTarget] = useState<WarehouseNode | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WarehouseNode | null>(null)

  // ==================== التحميل ====================
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/warehouses')
        if (!res.ok) throw new Error('fetch failed')
        const data = await res.json()
        if (!cancelled) setFlat(Array.isArray(data) ? data : [])
      } catch {
        if (!cancelled) {
          setFlat([])
          toast({ title: 'تعذر جلب المستودعات', variant: 'destructive' })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshKey, toast])

  const index = useMemo(() => (flat ? buildWarehouseIndex(flat) : null), [flat])

  // ==================== الرؤية والفلترة ====================
  const searchQ = search.trim().toLowerCase()
  const expandAll = searchQ.length > 0 || levelFilter !== 'ALL'

  const visibleRoots = useMemo(() => {
    if (!index) return null
    const needsFilter = searchQ.length > 0 || levelFilter !== 'ALL' || !showInactive
    if (!needsFilter) return index.roots

    const match = (n: WarehouseNode): boolean => {
      if (levelFilter !== 'ALL' && n.level !== levelFilter) return false
      if (
        searchQ &&
        !n.code.toLowerCase().includes(searchQ) &&
        !n.name.toLowerCase().includes(searchQ) &&
        !(n.keeperName ?? '').toLowerCase().includes(searchQ)
      )
        return false
      if (!showInactive && !n.isActive) return false
      return true
    }
    const visible = new Set<string>()
    const visit = (n: WarehouseNode): boolean => {
      let any = match(n)
      for (const c of n.children) if (visit(c)) any = true
      if (any) visible.add(n.id)
      return any
    }
    for (const r of index.roots) visit(r)

    // شجرة مصغّرة تحفظ الأجداد
    const copies = new Map<string, WarehouseNode>()
    for (const n of index.nodes) {
      if (visible.has(n.id)) copies.set(n.id, { ...n, children: [] })
    }
    const roots: WarehouseNode[] = []
    for (const n of index.nodes) {
      const copy = copies.get(n.id)
      if (!copy) continue
      const parentCopy = n.parentId ? copies.get(n.parentId) : undefined
      if (parentCopy) parentCopy.children.push(copy)
      else roots.push(copy)
    }
    return roots
  }, [index, searchQ, levelFilter, showInactive])

  const rows = useMemo(() => {
    if (!visibleRoots) return []
    const out: WarehouseNode[] = []
    const walk = (list: WarehouseNode[]) => {
      for (const node of list) {
        out.push(node)
        if (node.children.length === 0) continue
        // المستويان الأول والثاني مفتوحان افتراضياً
        if (expandAll || node.level < 3 || expanded.has(node.id)) walk(node.children)
      }
    }
    walk(visibleRoots)
    return out
  }, [visibleRoots, expandAll, expanded])

  // ==================== عدادات المفتاح اللوني ====================
  const legendCounts = useMemo(() => {
    const counts = new Map<number, number>()
    let noKeeper = 0
    if (index) {
      for (const n of index.nodes) {
        counts.set(n.level, (counts.get(n.level) ?? 0) + 1)
        if (!n.keeperName?.trim()) noKeeper += 1
      }
    }
    return { counts, noKeeper }
  }, [index])

  const selectedNode = useMemo(
    () => index?.nodes.find((n) => n.id === selectedId) ?? null,
    [index, selectedId],
  )
  const profileNode = useMemo(
    () => index?.nodes.find((n) => n.id === profileId) ?? null,
    [index, profileId],
  )

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  function openForm(mode: WarehouseFormMode, target?: WarehouseNode) {
    setFormMode(mode)
    setFormTarget(target ?? null)
    setFormOpen(true)
  }

  const hasChildrenOrData = (n: WarehouseNode) =>
    n.childrenCount > 0 || n.balancesCount + n.movementsCount + n.stocktakingsCount > 0

  const allExpandable = rows.filter((n) => n.children.length > 0)
  const hasAnyFilter = searchQ.length > 0 || levelFilter !== 'ALL' || showInactive

  return (
    <div className="space-y-4">
      <SectionCard
        title="الشجرة الهرمية للمستودعات"
        description={
          index
            ? `${fmtNumber(index.nodes.length)} مستودعاً — المستودع الشامل ← مستودع عام ← مستودع فرعي ← قسم`
            : undefined
        }
        icon={Warehouse}
        action={
          !isArchive && (
            <Button size="sm" onClick={() => openForm('create')}>
              <Plus className="h-4 w-4" />
              مستودع جديد
            </Button>
          )
        }
      >
        {/* شريط المفتاح اللوني — أقراص مريحة متباعدة بلمسة واحدة */}
        <div className="no-print mb-4 flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-xl border bg-muted/30 px-4 py-3 text-xs">
          {LEGEND.map(({ level, label }) => {
            const active = levelFilter === level
            return (
              <button
                key={level}
                type="button"
                onClick={() => setLevelFilter(active ? 'ALL' : level)}
                aria-pressed={active}
                className={cn(
                  'flex min-h-8 items-center gap-2 rounded-full border px-3.5 py-1.5 transition-all',
                  active
                    ? 'border-transparent bg-accent font-bold text-foreground shadow-sm'
                    : 'border-border/70 bg-background/60 text-muted-foreground hover:border-accent/60 hover:bg-accent/40 hover:text-foreground',
                )}
              >
                <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', LEVEL_STYLES[level]?.dot)} />
                <span>{label}</span>
                <span className="num text-[10px] opacity-70">({fmtNumber(legendCounts.counts.get(level) ?? 0)})</span>
              </button>
            )
          })}
          <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
          <span className="min-h-8 items-center text-muted-foreground sm:flex">
            المادة تُسند لأي مستودع لا يوجد بداخله مستودعات أخرى
          </span>
          {legendCounts.noKeeper > 0 && (
            <span className="flex min-h-8 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3.5 py-1.5 text-amber-700 dark:text-amber-300">
              <UserX className="h-3 w-3 shrink-0" />
              بدون أمين: <span className="num font-bold">{fmtNumber(legendCounts.noKeeper)}</span>
            </span>
          )}
        </div>

        {/* شريط الأدوات */}
        <div className="no-print mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-52 flex-1 sm:max-w-xs">
            <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالكود أو الاسم أو الأمين…"
              className="ps-8"
              aria-label="بحث في المستودعات"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="wh-inactive" checked={showInactive} onCheckedChange={setShowInactive} />
            <Label htmlFor="wh-inactive" className="text-sm text-muted-foreground">
              إظهار غير النشطة
            </Label>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              title="توسيع الكل"
              aria-label="توسيع الشجرة بالكامل"
              disabled={allExpandable.length === 0}
              onClick={() => setExpanded(new Set(allExpandable.map((n) => n.id)))}
            >
              <ChevronsUpDown className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              title="طي الكل"
              aria-label="طي الشجرة بالكامل"
              disabled={allExpandable.length === 0}
              onClick={() => setExpanded(new Set())}
            >
              <ChevronsDownUp className="h-4 w-4" />
            </Button>
            {hasAnyFilter && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setSearch('')
                  setLevelFilter('ALL')
                  setShowInactive(false)
                }}
              >
                مسح الفلاتر
              </Button>
            )}
          </div>
        </div>

        {/* البطاقات — تُطبع كقائمة هرمية */}
        <div className="print-area">
          <TableActions
            title="الشجرة الهرمية للمستودعات — القائمة المفلطحة"
            filename="warehouses"
            headers={[
              'الكود',
              'الاسم',
              'المستوى',
              'وصف المستوى',
              'أمين المستودع',
              'هاتف الأمين',
              'الموقع',
              'عدد المواد',
              'عدد الفروع',
              'الحالة',
            ]}
            rowsLoader={() =>
              rows.map((n) => [
                n.code,
                n.name,
                n.level,
                LEVEL_META[n.level]?.short ?? `مستوى ${n.level}`,
                n.keeperName ?? '',
                n.keeperPhone ?? '',
                n.location ?? '',
                n.balancesCount,
                n.childrenCount,
                n.isActive ? 'نشط' : 'موقوف',
              ])
            }
          />
          <div className="max-h-[64vh] space-y-2 overflow-y-auto pe-1 pt-1" role="tree" aria-label="شجرة المستودعات">
          {loading &&
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[72px] w-full rounded-xl" />
            ))}

          {!loading &&
            rows.map((n) => {
              const hasChildren = n.children.length > 0
              const isOpen = expandAll || n.level < 3 || expanded.has(n.id)
              const selected = n.id === selectedId
              const style = LEVEL_STYLES[n.level]
              const RowIcon = LEVEL_ICONS[n.level] ?? Warehouse
              return (
                <div key={n.id} style={{ paddingInlineStart: `${(n.level - 1) * 1.25}rem` }}>
                  <div
                    role="treeitem"
                    aria-expanded={hasChildren ? isOpen : undefined}
                    aria-selected={selected}
                    onClick={() => setSelectedId(selected ? null : n.id)}
                    className={cn(
                      'group cursor-pointer rounded-xl border p-3 transition-all',
                      style?.card,
                      selected && cn('ring-2 ring-offset-2 ring-offset-background', style?.ring),
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {/* سهم التوسيع */}
                      <span className="w-5 shrink-0">
                        {hasChildren ? (
                          <button
                            type="button"
                            aria-label={isOpen ? 'طي الفرع' : 'توسيع الفرع'}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleExpand(n.id)
                            }}
                            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                          </button>
                        ) : (
                          <span className="inline-block h-4 w-4" />
                        )}
                      </span>

                      {/* أيقونة المستوى داخل دائرة ملونة */}
                      <span className={cn('shrink-0 rounded-xl p-2.5', style?.iconBox)} title={LEVEL_META[n.level]?.label}>
                        <RowIcon className="h-5 w-5" />
                      </span>

                      {/* الاسم + الشارة + الكود والأمين */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="break-words text-sm font-bold leading-snug">
                            {n.name}
                            {!n.isActive && <span className="ms-2 text-[10px] font-normal text-muted-foreground">(موقوف)</span>}
                          </span>
                          <Badge variant="outline" className={cn('shrink-0 text-[10px] font-semibold', style?.badge)}>
                            {LEVEL_META[n.level]?.short ?? `مستوى ${n.level}`}
                          </Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap items-start gap-x-2.5 gap-y-1 text-[11px] leading-relaxed text-muted-foreground">
                          <span className="num mt-0.5 font-semibold tracking-wide">{n.code}</span>
                          <span aria-hidden className="mt-0.5">•</span>
                          {n.keeperName ? (
                            <span className="flex items-start gap-1">
                              <UserRound className="mt-0.5 h-3 w-3 shrink-0" />
                              <span className="break-words">
                                أمين المستودع: <span className="font-medium text-foreground/80">{n.keeperName}</span>
                              </span>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                              <UserX className="h-3 w-3" />
                              بدون أمين
                            </span>
                          )}
                          {n.keeperPhone && (
                            <span className="num mt-0.5 hidden sm:inline" dir="ltr">
                              • {n.keeperPhone}
                            </span>
                          )}
                          {n.location && (
                            <span className="hidden items-start gap-1 md:flex">
                              <span aria-hidden className="mt-0.5">•</span>
                              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                              <span className="break-words">{n.location}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* العدادات + سهم التوسيع الدائري (كما بالصورة) */}
                      <div className="flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="num flex items-center gap-1" title="عدد المواد المسندة لهذا المستودع">
                          <Package className="h-3.5 w-3.5" />
                          {fmtNumber(n.balancesCount)}
                          <span className="hidden sm:inline">مادة</span>
                        </span>
                        {hasChildren && (
                          <span className="num flex items-center gap-1" title="عدد المستودعات الفرعية المباشرة">
                            <Network className="h-3.5 w-3.5" />
                            {fmtNumber(n.childrenCount)}
                            <span className="hidden sm:inline">فروع</span>
                          </span>
                        )}
                        {hasChildren && (
                          <button
                            type="button"
                            aria-label={isOpen ? 'طي' : 'توسيع'}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleExpand(n.id)
                            }}
                            className="rounded-full border bg-background/60 p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* إجراءات البطاقة المحددة */}
                    {selected && (
                      <div
                        className="no-print mt-3 flex flex-wrap items-center gap-x-3 gap-y-2.5 border-t pt-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => setProfileId(n.id)}>
                          <IdCard className="h-3.5 w-3.5" />
                          بطاقة تعريف
                        </Button>
                        {!isArchive && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 px-3 text-xs"
                            title={n.level >= 4 ? 'آخر مستوى — لا يمكن إضافة فرع تحته' : 'إضافة مستودع فرعي'}
                            disabled={n.level >= 4}
                            onClick={() => openForm('sub', n)}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            فرعي
                          </Button>
                        )}
                        {!isArchive && (
                          <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => openForm('edit', n)}>
                            <Pencil className="h-3.5 w-3.5" />
                            تعديل
                          </Button>
                        )}
                        {!isArchive && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 px-3 text-xs text-rose-600 hover:text-rose-700 disabled:opacity-40"
                            title={hasChildrenOrData(n) ? 'مرتبط بفروع أو بيانات مخزنية — لا يُحذف' : 'حذف المستودع'}
                            disabled={hasChildrenOrData(n)}
                            onClick={() => setDeleteTarget(n)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            حذف
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-8 px-3 text-xs" onClick={refresh}>
                          <RefreshCw className="h-3.5 w-3.5" />
                          تحديث
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

          {!loading && rows.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              <Warehouse className="mx-auto mb-2 h-8 w-8 opacity-40" />
              <p className="text-sm">لا توجد مستودعات مطابقة للبحث أو الفلترة</p>
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  setSearch('')
                  setLevelFilter('ALL')
                  setShowInactive(true)
                }}
              >
                مسح الفلاتر
              </Button>
            </div>
          )}
          </div>
        </div>
      </SectionCard>

      {/* النوافذ */}
      {flat && (
        <>
          <WarehouseFormDialog
            open={formOpen}
            onClose={() => setFormOpen(false)}
            onSaved={refresh}
            warehouses={flat}
            mode={formMode}
            target={formTarget}
          />
          <WarehouseProfileDialog node={profileNode} index={index} onClose={() => setProfileId(null)} />
          <WarehouseDeleteDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={refresh} />
        </>
      )}
    </div>
  )
}
