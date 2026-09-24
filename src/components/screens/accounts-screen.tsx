'use client'

// شاشة دليل الحسابات — شجرة هرمية تفاعلية + فلترة وبحث + 7 إجراءات مدمجة في سطر الحساب

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  ChevronLeft,
  ChevronDown,
  CircleDollarSign,
  FileText,
  GitMerge,
  Landmark,
  ListTree,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionCard } from '@/components/common/section-card'
import { KpiCard } from '@/components/common/kpi-card'
import { TableActions } from '@/components/screens/common/table-actions'
import { useToast } from '@/hooks/use-toast'
import { useIsArchive } from '@/lib/store'
import { cn } from '@/lib/utils'
import { fmtMoney, fmtUSD, fmtNumber, AR_ACCOUNT_TYPE, AR_NATURE } from '@/lib/format'
import {
  buildAccountIndex,
  buildVisibleTree,
  directionLabel,
  isOppositeDirection,
  type AccountDTO,
  type AccountType,
  type BalanceDirection,
  type TreeNode,
} from './accounts/types'
import type { AccountLink } from './accounts/types'
import {
  AccountDeleteDialog,
  AccountFormDialog,
  AccountReportDialog,
  type FormMode,
  type ReportMode,
} from './accounts/account-dialogs'
import {
  UnifiedPartyDialog,
  type UnifiedPartyTarget,
} from '@/components/screens/common/unified-party-dialog'
import type { UnifiedPersonSummary } from '@/lib/unified-party-types'

const TYPE_CARDS: {
  type: AccountType
  label: string
  icon: typeof Landmark
  tone: 'gold' | 'rose' | 'emerald' | 'slate' | 'amber'
}[] = [
  { type: 'ASSET', label: 'أصول', icon: Landmark, tone: 'gold' },
  { type: 'LIABILITY', label: 'التزامات', icon: Scale, tone: 'rose' },
  { type: 'EQUITY', label: 'حقوق ملكية', icon: ShieldCheck, tone: 'emerald' },
  { type: 'REVENUE', label: 'إيرادات', icon: TrendingUp, tone: 'emerald' },
  { type: 'EXPENSE', label: 'مصروفات', icon: TrendingDown, tone: 'rose' },
]

// فلاتر سريعة لإظهار حسابات الأطراف المرتبطة (تُنشأ وتتزامن تلقائياً مع شاشاتها)
const LINK_FILTERS: { kind: AccountLink['kind']; label: string; activeCls: string }[] = [
  { kind: 'CUSTOMER', label: 'العملاء', activeCls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/40' },
  { kind: 'SUPPLIER', label: 'الموردون', activeCls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/40' },
  { kind: 'EMPLOYEE', label: 'الموظفون', activeCls: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 ring-1 ring-sky-500/40' },
  { kind: 'PARTNER', label: 'الشركاء', activeCls: 'bg-violet-500/15 text-violet-700 dark:text-violet-400 ring-1 ring-violet-500/40' },
]

// شارة الملف المرتبط (عميل/مورد/موظف/شريك) على سطر الحساب في الشجرة
function LinkBadge({ link }: { link: AccountLink }) {
  const cfg =
    link.kind === 'CUSTOMER'
      ? { label: 'عميل', cls: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400' }
      : link.kind === 'SUPPLIER'
        ? { label: 'مورد', cls: 'border-amber-500/40 text-amber-700 dark:text-amber-400' }
        : link.kind === 'PARTNER'
          ? { label: 'شريك', cls: 'border-violet-500/40 text-violet-700 dark:text-violet-400' }
          : { label: 'موظف', cls: 'border-sky-500/40 text-sky-700 dark:text-sky-400' }
  return (
    <Badge
      variant="outline"
      title={`مرتبط بملف ${cfg.label} ${link.code} في شاشته — مزامنة ثنائية`}
      className={cn('mx-2 inline-flex h-auto px-1.5 py-0 text-[10px] font-normal', cfg.cls)}
    >
      {cfg.label} {link.code}
    </Badge>
  )
}

/** شارات كل ملفات الحساب — تعدد الأدوار: موظف + عميل + مورد على الحساب نفسه */
function LinkBadges({ node }: { node: Pick<TreeNode, 'link' | 'links'> }) {
  const links = node.links && node.links.length > 0 ? node.links : node.link ? [node.link] : []
  if (links.length === 0) return null
  return (
    <>
      {links.map((l) => (
        <LinkBadge key={`${l.kind}-${l.id}`} link={l} />
      ))}
    </>
  )
}

/** شارة «طرف موحد» — الشخص يجمع أدواراً متعددة وحسابات متفرقة في الشجرة — انقرها لكشفه المجمع */
function UnifiedBadge({
  person,
  onOpen,
}: {
  person: { name: string; roles: string[] }
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      title={`الطرف الموحد: ${person.name} — ${person.roles.join(' + ')} — انقر لكشف مستنداته المجمع`}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      className="mx-1 inline-flex h-auto items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-1.5 py-0 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/10"
    >
      <GitMerge className="h-3 w-3" />
      طرف موحد
    </button>
  )
}

export default function AccountsScreen() {
  const { toast } = useToast()

  // وضع استعراض أرشيف فترة مقفلة — يخفي أزرار الكتابة (الشرط 4)
  const isArchive = useIsArchive()

  const [flat, setFlat] = useState<AccountDTO[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  // فلاتر
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'ALL' | AccountType>('ALL')
  const [linkFilter, setLinkFilter] = useState<'ALL' | AccountLink['kind']>('ALL')
  const [showInactive, setShowInactive] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // نوافذ
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<FormMode>('create')
  const [formTarget, setFormTarget] = useState<AccountDTO | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AccountDTO | null>(null)
  const [report, setReport] = useState<{ account: AccountDTO; mode: ReportMode } | null>(null)
  const [unifiedTarget, setUnifiedTarget] = useState<UnifiedPartyTarget | null>(null)

  // فهرس الأطراف الموحدة — الأشخاص ذوو الأدوار المتعددة (شريك + عميل + مورد + موظف)
  const [unifiedPersons, setUnifiedPersons] = useState<UnifiedPersonSummary[]>([])

  // ==================== التحميل ====================
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        // الحسابات + فهرس الأطراف الموحدة معاً — فشل الفهرس لا يعطل الشجرة (فقط تختفي الشارات)
        const [res, resParty] = await Promise.all([fetch('/api/accounts'), fetch('/api/unified-party')])
        if (!res.ok) throw new Error('fetch failed')
        const data = await res.json()
        if (!cancelled) setFlat(Array.isArray(data) ? data : [])
        if (resParty.ok && !cancelled) {
          const partyData = (await resParty.json().catch(() => null)) as { persons?: UnifiedPersonSummary[] } | null
          setUnifiedPersons(Array.isArray(partyData?.persons) ? partyData.persons : [])
        } else if (!cancelled) {
          setUnifiedPersons([])
        }
      } catch {
        if (!cancelled) {
          setFlat([])
          toast({ title: 'تعذر جلب دليل الحسابات', variant: 'destructive' })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshKey, toast])

  const index = useMemo(() => (flat ? buildAccountIndex(flat) : null), [flat])

  // خريطة الحساب → الشخص الموحد صاحبه (لشارة «طرف موحد» وزر الكشف المجمع)
  const personByAccount = useMemo(() => {
    const m = new Map<string, UnifiedPersonSummary>()
    for (const p of unifiedPersons) {
      for (const id of p.accountIds) {
        const existing = m.get(id)
        if (!existing || p.roles.length > existing.roles.length) m.set(id, p)
      }
    }
    return m
  }, [unifiedPersons])

  // توسيع تلقائي لمسارات حسابات الأطراف (عملاء/موردون/موظفون) لتظهر أسماؤهم داخل الشجرة فور فتحها دون أي نقر
  useEffect(() => {
    if (!flat) return
    const byId = new Map(flat.map((a) => [a.id, a]))
    const paths = new Set<string>()
    for (const a of flat) {
      const linked = (a.links && a.links.length > 0) || !!a.link
      if (!linked) continue
      let cur = a.parentId ? byId.get(a.parentId) : null
      while (cur) {
        paths.add(cur.id)
        cur = cur.parentId ? byId.get(cur.parentId) : null
      }
    }
    if (paths.size > 0) setExpanded((prev) => new Set([...prev, ...paths]))
  }, [flat])

  // عدد حسابات الأطراف المرتبطة حسب النوع (لأزرار الفلترة السريعة) — تعدد الأدوار: الحساب يُعد لكل أدواره
  const linkCounts = useMemo(() => {
    const c: Record<AccountLink['kind'], number> = { CUSTOMER: 0, SUPPLIER: 0, EMPLOYEE: 0, PARTNER: 0 }
    for (const a of flat ?? []) {
      const links = a.links && a.links.length > 0 ? a.links : a.link ? [a.link] : []
      for (const l of links) c[l.kind] += 1
    }
    return c
  }, [flat])

  // ==================== منطق الرؤية والفلترة ====================
  const searchQ = search.trim().toLowerCase()
  const expandAll = searchQ.length > 0 || typeFilter !== 'ALL' || linkFilter !== 'ALL'

  const visibleRoots = useMemo<TreeNode[] | null>(() => {
    if (!index) return null
    const needsFilter = searchQ.length > 0 || typeFilter !== 'ALL' || linkFilter !== 'ALL' || !showInactive
    if (!needsFilter) return index.roots

    const match = (n: TreeNode): boolean => {
      if (typeFilter !== 'ALL' && n.type !== typeFilter) return false
      if (linkFilter !== 'ALL') {
        const links = n.links && n.links.length > 0 ? n.links : n.link ? [n.link] : []
        if (!links.some((l) => l.kind === linkFilter)) return false
      }
      if (searchQ && !n.code.toLowerCase().includes(searchQ) && !n.name.toLowerCase().includes(searchQ))
        return false
      if (!showInactive && !n.isActive) return false
      return true
    }
    const visible = new Set<string>()
    const visit = (n: TreeNode): boolean => {
      let any = match(n)
      for (const c of n.children) if (visit(c)) any = true
      if (any) visible.add(n.id)
      return any
    }
    for (const r of index.roots) visit(r)
    return buildVisibleTree(index.nodes, visible)
  }, [index, searchQ, typeFilter, linkFilter, showInactive])

  const rows = useMemo(() => {
    if (!visibleRoots) return []
    const out: TreeNode[] = []
    const walk = (list: TreeNode[]) => {
      for (const node of list) {
        out.push(node)
        if (node.children.length === 0) continue
        if (expandAll || node.level === 0 || expanded.has(node.id)) walk(node.children)
      }
    }
    walk(visibleRoots)
    return out
  }, [visibleRoots, expandAll, expanded])

  // ==================== إحصاءات البطاقات ====================
  const typeStats = useMemo(() => {
    const stats = new Map<AccountType, { count: number; balance: number }>()
    for (const t of TYPE_CARDS) stats.set(t.type, { count: 0, balance: 0 })
    if (!index) return stats
    for (const n of index.nodes) {
      const s = stats.get(n.type)
      if (s) s.count += 1
    }
    for (const r of index.roots) {
      const s = stats.get(r.type)
      if (s) s.balance += r.balanceRaw
    }
    return stats
  }, [index])

  const selectedNode = useMemo(
    () => index?.nodes.find((n) => n.id === selectedId) ?? null,
    [index, selectedId],
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

  function openForm(mode: FormMode, target?: AccountDTO) {
    setFormMode(mode)
    setFormTarget(target ?? null)
    setFormOpen(true)
  }

  function openReport(node: AccountDTO, mode: ReportMode) {
    setReport({ account: node, mode })
  }

  // إجراءات السطر المحدد (7)
  const actions = selectedNode && (
    <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      {!isArchive && (
        <Button variant="ghost" size="icon" className="h-7 w-7" title="إضافة حساب فرعي" onClick={() => openForm('sub', selectedNode)}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-7 w-7" title="دفتر الأستاذ" onClick={() => openReport(selectedNode, 'ledger')}>
        <BookOpen className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" title="كشف حساب (ملخص)" onClick={() => openReport(selectedNode, 'summary')}>
        <FileText className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" title="كشف تفصيلي" onClick={() => openReport(selectedNode, 'detail')}>
        <ListTree className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-primary hover:text-primary"
        title="كشف مستندات الطرف الموحد — كل حركات الشخص مجتمعة بغض النظر عن مكان حساباته في الشجرة"
        onClick={() => setUnifiedTarget({ accountId: selectedNode.id, name: selectedNode.name })}
      >
        <GitMerge className="h-3.5 w-3.5" />
      </Button>
      {!isArchive && (
        <Button variant="ghost" size="icon" className="h-7 w-7" title="تعديل الحساب" onClick={() => openForm('edit', selectedNode)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {!isArchive && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-rose-600 hover:text-rose-700 disabled:opacity-30"
          title={selectedNode.isSystem ? 'حساب نظامي — لا يُحذف' : selectedNode.children.length > 0 ? 'له حسابات فرعية — لا يُحذف' : 'حذف الحساب'}
          disabled={selectedNode.isSystem || selectedNode.children.length > 0}
          onClick={() => setDeleteTarget(selectedNode)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-7 w-7" title="تحديث البيانات" onClick={refresh}>
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* بطاقات الأنواع الخمسة */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        {TYPE_CARDS.map(({ type, label, icon, tone }) => {
          const s = typeStats.get(type) ?? { count: 0, balance: 0 }
          const active = typeFilter === type
          return (
            <button
              key={type}
              type="button"
              onClick={() => setTypeFilter(active ? 'ALL' : type)}
              className={cn('text-start rounded-xl transition-all', active && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}
              aria-pressed={active}
            >
              <KpiCard
                title={`${label} (${fmtNumber(s.count)})`}
                value={fmtMoney(Math.abs(s.balance))}
                hint={`≈ ${fmtUSD(Math.abs(s.balance))}`}
                icon={icon}
                tone={tone}
                loading={loading}
                className="w-full"
              />
            </button>
          )
        })}
      </div>

      {/* الشجرة */}
      <SectionCard
        title="الشجرة المحاسبية"
        description={
          index
            ? `${fmtNumber(index.nodes.length)} حساباً — منها ${fmtNumber(linkCounts.CUSTOMER + linkCounts.SUPPLIER + linkCounts.EMPLOYEE + linkCounts.PARTNER)} حساب أطراف مرتبط${unifiedPersons.length > 0 ? ` — ${fmtNumber(unifiedPersons.length)} طرف موحد بأدوار متعددة` : ''} — انقر الحساب لعرض الإجراءات`
            : undefined
        }
        icon={BookOpen}
        action={
          !isArchive && (
            <Button size="sm" onClick={() => openForm('create')}>
              <Plus className="h-4 w-4" />
              حساب جديد
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
              placeholder="بحث بالكود أو الاسم…"
              className="ps-8"
              aria-label="بحث في الحسابات"
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as 'ALL' | AccountType)}>
            <SelectTrigger className="w-40" aria-label="فلترة بالنوع">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">كل الأنواع</SelectItem>
              {TYPE_CARDS.map(({ type, label }) => (
                <SelectItem key={type} value={type}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5" role="group" aria-label="فلترة حسابات الأطراف">
            {LINK_FILTERS.map(({ kind, label, activeCls }) => {
              const active = linkFilter === kind
              return (
                <Button
                  key={kind}
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn('h-8 px-3', active && activeCls)}
                  aria-pressed={active}
                  onClick={() => setLinkFilter(active ? 'ALL' : kind)}
                >
                  {label} ({fmtNumber(linkCounts[kind])})
                </Button>
              )
            })}
          </div>
          <div className="flex items-center gap-2">
            <Switch id="show-inactive" checked={showInactive} onCheckedChange={setShowInactive} />
            <Label htmlFor="show-inactive" className="text-sm text-muted-foreground">
              إظهار غير النشطة
            </Label>
          </div>
        </div>

        <div className="print-area">
          <TableActions
            title="دليل الحسابات — القائمة المفلطحة"
            filename="chart-of-accounts"
            headers={[
              'الكود',
              'اسم الحساب',
              'المستوى',
              'النوع',
              'الطبيعة',
              'الرصيد',
              'اتجاه الرصيد',
              'الحالة',
            ]}
            rowsLoader={() =>
              rows.map((n) => {
                const dir: BalanceDirection =
                  Math.abs(n.balanceRaw) < 0.005
                    ? 'ZERO'
                    : n.balanceRaw > 0
                      ? n.nature === 'DEBIT'
                        ? 'DEBIT'
                        : 'CREDIT'
                      : n.nature === 'DEBIT'
                        ? 'CREDIT'
                        : 'DEBIT'
                return [
                  n.code,
                  n.name,
                  n.level + 1,
                  AR_ACCOUNT_TYPE[n.type] ?? n.type,
                  AR_NATURE[n.nature] ?? n.nature,
                  Math.round(Math.abs(n.balanceRaw) * 100) / 100,
                  directionLabel(dir),
                  n.isActive ? 'نشط' : 'غير نشط',
                ]
              })
            }
          />

          {/* رأس الجدول — أعمدة موزعة بتوازن: الشيفرة والنوع والرصيد ثابتة مريحة، والاسم يتمدد بكل المساحة المتبقية — الأعمدة الثانوية تظهر تدريجياً مع اتساع الشاشة */}
          <div className="hidden items-center gap-2 border-b px-3 pb-2.5 text-xs font-medium text-muted-foreground md:flex md:gap-3 md:px-4">
            <span className="w-6 shrink-0" />
            <span className="w-16 shrink-0">الكود</span>
            <span className="min-w-0 flex-1">اسم الحساب</span>
            <span className="hidden w-28 shrink-0 text-center xl:block">النوع</span>
            <span className="w-32 shrink-0 text-end md:w-48">الرصيد</span>
            <span className="no-print hidden w-[13.5rem] shrink-0 text-end lg:block">إجراءات</span>
          </div>

        {/* الصفوف */}
        <div className="max-h-[62vh] overflow-y-auto pt-1" role="tree" aria-label="شجرة الحسابات">
          {loading &&
            Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="mb-2 h-9 w-full" />)}

          {!loading && rows.map((n) => {
            const hasChildren = n.children.length > 0
            const isOpen = expandAll || n.level === 0 || expanded.has(n.id)
            const selected = n.id === selectedId
            const dir: BalanceDirection =
              Math.abs(n.balanceRaw) < 0.005 ? 'ZERO' : n.balanceRaw > 0 ? (n.nature === 'DEBIT' ? 'DEBIT' : 'CREDIT') : n.nature === 'DEBIT' ? 'CREDIT' : 'DEBIT'
            const opposite = isOppositeDirection(n.nature, dir)
            return (
              <div
                key={n.id}
                role="treeitem"
                aria-expanded={hasChildren ? isOpen : undefined}
                aria-selected={selected}
                onClick={() => setSelectedId(selected ? null : n.id)}
                className={cn(
                  'group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-colors md:gap-3 md:px-4',
                  selected ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-accent/40',
                )}
                style={{ paddingInlineStart: `clamp(0.5rem, calc(0.5rem + ${n.level} * 2.2vw), ${0.75 + n.level * 1.1}rem)` }}
              >
                <span className="w-6 shrink-0">
                  {hasChildren ? (
                    <button
                      type="button"
                      aria-label={isOpen ? 'طي' : 'توسيع'}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleExpand(n.id)
                      }}
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                    </button>
                  ) : (
                    <span className="inline-block h-4 w-4" />
                  )}
                </span>
                <Badge variant="outline" className="hidden w-16 shrink-0 justify-center text-xs num md:inline-flex">
                  {n.code}
                </Badge>
                <span className={cn('min-w-0 flex-1 text-sm leading-snug break-words', selected && 'font-semibold')}>
                  {n.name}
                  <LinkBadges node={n} />
                  {personByAccount.has(n.id) && (
                    <UnifiedBadge
                      person={{
                        name: personByAccount.get(n.id)!.name,
                        roles: personByAccount.get(n.id)!.roles.map((r) => r.label),
                      }}
                      onOpen={() => setUnifiedTarget({ accountId: n.id, name: n.name })}
                    />
                  )}
                  {!n.isActive && (
                    <span className="ms-2 text-[10px] text-muted-foreground">(غير نشط)</span>
                  )}
                </span>
                <span className="hidden w-28 shrink-0 text-center text-xs text-muted-foreground xl:block">
                  {AR_ACCOUNT_TYPE[n.type]}
                </span>
                <span className="w-32 shrink-0 text-end md:w-48">
                  <span className={cn('num text-sm', opposite && 'text-rose-600 dark:text-rose-400')}>
                    {fmtMoney(Math.abs(n.balanceRaw))}
                  </span>
                  <span className="ms-1.5 hidden text-[10px] text-muted-foreground sm:inline">
                    {dir === 'ZERO' ? '' : AR_NATURE[dir]}
                  </span>
                </span>
                <span className="no-print hidden w-[13.5rem] shrink-0 justify-end lg:flex">
                  {selected ? (
                    actions
                  ) : (
                    <CircleDollarSign
                      className={cn(
                        'h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-30',
                        n.isSystem ? 'text-muted-foreground' : 'text-primary',
                      )}
                    />
                  )}
                </span>
              </div>
            )
          })}

          {!loading && rows.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              <Search className="mx-auto mb-2 h-8 w-8 opacity-40" />
              <p className="text-sm">لا توجد حسابات مطابقة للبحث أو الفلترة</p>
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  setSearch('')
                  setTypeFilter('ALL')
                  setLinkFilter('ALL')
                  setShowInactive(true)
                }}
              >
                مسح الفلاتر
              </Button>
            </div>
          )}
        </div>

        {/* تلميح منهج الأرصدة: دفتر الفرع للأطراف + حسابات التحكم للحركات السابقة */}
        <p className="no-print mt-2 border-t pt-2 text-[11px] leading-5 text-muted-foreground">
          💡 رصيد حسابات الأطراف (بشارة عميل/مورد/موظف) وكشف حسابها محسوبان من مستنداتها الفعلية:
          فواتيرها ومردوداتها وسنداتها وسلفها — أما الحركات الإجمالية السابقة قبل التفعيل فتبقى
          معروضة على حساب التحكم (1130 / 2110 / 1150)
        </p>
        </div>
      </SectionCard>

      {/* النوافذ */}
      {flat && (
        <>
          <AccountFormDialog
            open={formOpen}
            onClose={() => setFormOpen(false)}
            onSaved={refresh}
            accounts={flat}
            mode={formMode}
            target={formTarget}
          />
          <AccountDeleteDialog
            target={deleteTarget}
            onClose={() => setDeleteTarget(null)}
            onDeleted={refresh}
          />
          <AccountReportDialog
            account={report?.account ?? null}
            mode={report?.mode ?? 'ledger'}
            onClose={() => setReport(null)}
          />
          <UnifiedPartyDialog target={unifiedTarget} onClose={() => setUnifiedTarget(null)} />
        </>
      )}
    </div>
  )
}
