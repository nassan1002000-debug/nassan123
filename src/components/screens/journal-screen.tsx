'use client'

// شاشة القيود اليومية — KPIs + فلاتر + جدول قابل للتوسيع + إجراءات كاملة (عرض/تعديل/ترحيل/إلغاء/طباعة/حذف)

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  FileEdit,
  Inbox,
  Loader2,
  Pencil,
  Plus,
  Printer,
  ScrollText,
  Search,
  SlidersHorizontal,
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
import { KpiCard } from '@/components/common/kpi-card'
import { SectionCard } from '@/components/common/section-card'
import { StatusBadge } from '@/components/common/status-badge'
import { TableActions } from '@/components/screens/common/table-actions'
import { useToast } from '@/hooks/use-toast'
import { useIsArchive } from '@/lib/store'
import { AR_ENTRY_STATUS, AR_SOURCE, fmtDate, fmtMoney, fmtNumber, fmtUSD } from '@/lib/format'
import { cn } from '@/lib/utils'
import { JournalFormDialog } from './journal/journal-form-dialog'
import { JournalViewDialog } from './journal/journal-view-dialog'
import { printJournalEntry } from './journal/print-entry'
import type { JournalEntryRow } from './journal/types'

const PAGE_SIZE = 15

interface Filters {
  from: string
  to: string
  status: string
  source: string
  q: string
}

const EMPTY_FILTERS: Filters = { from: '', to: '', status: 'ALL', source: 'ALL', q: '' }

type ConfirmAction = { type: 'post' | 'cancel' | 'delete'; entry: JournalEntryRow }

interface ServerTotals {
  debit: number
  credit: number
  drafts: number
}

export default function JournalScreen() {
  const { toast } = useToast()

  // وضع استعراض أرشيف فترة مقفلة — يخفي أزرار الكتابة (الشرط 4)
  const isArchive = useIsArchive()

  // قيم الفلاتر (لم تُطبَّق بعد)
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [fStatus, setFStatus] = useState('ALL')
  const [fSource, setFSource] = useState('ALL')
  const [fQ, setFQ] = useState('')
  // الفلاتر المطبَّقة فعلياً على الطلب
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)

  const [entries, setEntries] = useState<JournalEntryRow[]>([])
  const [total, setTotal] = useState(0)
  /** صفوف الطباعة الكاملة — تُملأ قبل الطباعة بكل صفحات الخادم وتُفرَّغ بعدها */
  const [printRows, setPrintRows] = useState<JournalEntryRow[] | null>(null)
  const [nextNumber, setNextNumber] = useState('JE-0001')
  const [totals, setTotals] = useState<ServerTotals>({ debit: 0, credit: 0, drafts: 0 })
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [viewOpen, setViewOpen] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)
  const [acting, setActing] = useState(false)

  // ===== جلب القيود — عدّاد تسلسلي يمنع استجابة أقدم من طغيان الأحدث =====
  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      if (filters.status !== 'ALL') params.set('status', filters.status)
      if (filters.source !== 'ALL') params.set('source', filters.source)
      if (filters.q) params.set('q', filters.q)
      params.set('page', String(page))
      params.set('pageSize', String(PAGE_SIZE))

      const res = await fetch(`/api/journal?${params.toString()}`)
      const data = await res.json().catch(() => null)
      if (seq !== loadSeq.current) return
      if (!res.ok || !data) {
        throw new Error((data as { error?: string } | null)?.error ?? 'تعذر جلب القيود')
      }
      setEntries(data.entries ?? [])
      setTotal(data.total ?? 0)
      if (data.nextNumber) setNextNumber(data.nextNumber)
      if (data.totals) {
        setTotals({ debit: data.totals.debit ?? 0, credit: data.totals.credit ?? 0, drafts: data.totals.drafts ?? 0 })
      }
    } catch (err) {
      if (seq === loadSeq.current) {
        toast({
          title: 'تعذر جلب القيود',
          description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [filters, page, toast])

  useEffect(() => {
    void load()
  }, [load])

  // ===== جلب كل القيود المطابقة للفلاتر عبر كل صفحات الخادم (سقف 100/صفحة) — للطباعة والتصدير الكاملين =====
  const fetchAllEntries = useCallback(async (): Promise<JournalEntryRow[]> => {
    const all: JournalEntryRow[] = []
    for (let p = 1; p < 100; p++) {
      const params = new URLSearchParams()
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      if (filters.status !== 'ALL') params.set('status', filters.status)
      if (filters.source !== 'ALL') params.set('source', filters.source)
      if (filters.q) params.set('q', filters.q)
      params.set('page', String(p))
      params.set('pageSize', '100')
      const res = await fetch(`/api/journal?${params.toString()}`)
      const data = (await res.json().catch(() => null)) as
        | { entries?: JournalEntryRow[]; total?: number }
        | null
      if (!res.ok || !data) break
      const rows = data.entries ?? []
      all.push(...rows)
      if (rows.length === 0 || all.length >= (data.total ?? 0)) break
    }
    return all
  }, [filters])

  // ===== الفلاتر =====
  const applyFilters = useCallback(() => {
    setFilters({ from: fFrom, to: fTo, status: fStatus, source: fSource, q: fQ.trim() })
    setPage(1)
  }, [fFrom, fTo, fStatus, fSource, fQ])

  const clearFilters = useCallback(() => {
    setFFrom('')
    setFTo('')
    setFStatus('ALL')
    setFSource('ALL')
    setFQ('')
    setFilters(EMPTY_FILTERS)
    setPage(1)
  }, [])

  // ===== الإجراءات =====
  const openNew = useCallback(() => {
    setEditId(null)
    setFormOpen(true)
  }, [])

  /** الصفوف المعروضة — كل الصفوف عند الطباعة، وإلا صفحة التقسيم الحالية */
  const displayRows = printRows ?? entries

  const openEdit = useCallback((entry: JournalEntryRow) => {
    setEditId(entry.id)
    setFormOpen(true)
  }, [])

  const openView = useCallback((entry: JournalEntryRow) => {
    setViewId(entry.id)
    setViewOpen(true)
  }, [])

  const handlePrint = useCallback(
    (entry: JournalEntryRow) => {
      const ok = printJournalEntry({
        number: entry.number,
        date: entry.date,
        description: entry.description,
        source: entry.source,
        status: entry.status,
        totalDebit: entry.totalDebit,
        totalCredit: entry.totalCredit,
        lines: entry.lines.map((l) => ({
          account: { code: l.account.code, name: l.account.name },
          description: l.description,
          costCenterName: l.costCenterName,
          debit: l.debit,
          credit: l.credit,
        })),
      })
      if (!ok) {
        toast({
          title: 'تعذر فتح نافذة الطباعة',
          description: 'يرجى السماح بالنوافذ المنبثقة لهذا الموقع ثم إعادة المحاولة',
          variant: 'destructive',
        })
      }
    },
    [toast],
  )

  const performConfirm = useCallback(async () => {
    if (!confirm || acting) return
    const { type, entry } = confirm
    setActing(true)
    try {
      const url = type === 'delete' ? `/api/journal/${entry.id}` : `/api/journal/${entry.id}/${type}`
      const res = await fetch(url, { method: type === 'delete' ? 'DELETE' : 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({
          title: 'تعذر تنفيذ الإجراء',
          description: (data as { error?: string } | null)?.error ?? 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        return
      }
      const titles: Record<typeof type, string> = {
        post: 'تم ترحيل القيد بنجاح',
        cancel: 'تم إلغاء القيد',
        delete: 'تم حذف القيد',
      }
      toast({ title: titles[type], description: `رقم القيد: ${entry.number}` })
      void load()
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setActing(false)
      setConfirm(null)
    }
  }, [acting, confirm, load, toast])

  // ===== مؤشرات KPI (من نتائج الفلترة الحالية — الإجماليات للمُرحّلة فقط من الخادم) =====

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const confirmMeta = useMemo(() => {
    if (!confirm) return null
    switch (confirm.type) {
      case 'post':
        return {
          title: `ترحيل القيد ${confirm.entry.number}`,
          desc: 'سيتم ترحيل القيد نهائياً وتحديث أرصدة الحسابات، ولن يمكن تعديله أو حذفه بعد الترحيل. هل تريد المتابعة؟',
          label: 'ترحيل',
          destructive: false,
        }
      case 'cancel':
        return {
          title: `إلغاء القيد ${confirm.entry.number}`,
          desc: 'سيتم تعليم القيد كملغى ولن يؤثر على أرصدة الحسابات. هل تريد المتابعة؟',
          label: 'إلغاء القيد',
          destructive: true,
        }
      case 'delete':
        return {
          title: `حذف القيد ${confirm.entry.number}`,
          desc: 'سيتم حذف القيد وجميع بنوده نهائياً، ولا يمكن التراجع عن هذا الإجراء. هل تريد المتابعة؟',
          label: 'حذف نهائياً',
          destructive: true,
        }
    }
  }, [confirm])

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  return (
    <div className="space-y-4">
      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          title="عدد القيود"
          value={fmtNumber(total)}
          hint="نتائج الفلترة الحالية"
          icon={ScrollText}
          tone="slate"
          loading={loading}
        />
        <KpiCard
          title="إجمالي المدين"
          value={fmtMoney(totals.debit)}
          hint={`≈ ${fmtUSD(totals.debit)}`}
          icon={ArrowDownCircle}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="إجمالي الدائن"
          value={fmtMoney(totals.credit)}
          hint={`≈ ${fmtUSD(totals.credit)}`}
          icon={ArrowUpCircle}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="قيود المسودة"
          value={fmtNumber(totals.drafts)}
          hint="بحاجة إلى ترحيل"
          icon={FileEdit}
          tone="amber"
          loading={loading}
        />
      </div>

      {/* شريط الفلاتر */}
      <SectionCard
        title="الفلاتر"
        description="تصفية القيود حسب الفترة الزمنية والحالة والمصدر"
        icon={SlidersHorizontal}
        action={
          !isArchive && (
            <Button size="sm" onClick={openNew}>
              <Plus className="h-4 w-4" />
              قيد جديد
            </Button>
          )
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
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
            <Label className="text-xs text-muted-foreground">الحالة</Label>
            <Select value={fStatus} onValueChange={setFStatus}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">الكل</SelectItem>
                {Object.entries(AR_ENTRY_STATUS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">المصدر</Label>
            <Select value={fSource} onValueChange={setFSource}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">الكل</SelectItem>
                {Object.entries(AR_SOURCE).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">بحث</Label>
            <Input
              value={fQ}
              onChange={(e) => setFQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFilters()
              }}
              placeholder="رقم القيد أو نص البيان…"
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

      {/* جدول القيود */}
      <SectionCard
        title="قائمة القيود"
        description="انقر على أي قيد لعرض بنوده التفصيلية"
        icon={ScrollText}
        action={
          <Badge variant="outline" className="num gap-1">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {fmtNumber(total)} نتيجة
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title="قائمة القيود اليومية"
            filename="journal"
            headers={['رقم القيد', 'التاريخ', 'البيان', 'المصدر', 'البنود', 'المدين', 'الدائن', 'الحالة']}
            onBeforePrint={async () => {
              setPrintRows(await fetchAllEntries())
            }}
            onAfterPrint={() => setPrintRows(null)}
            rowsLoader={async () =>
              (await fetchAllEntries()).map((e) => [
                e.number,
                e.date.slice(0, 10),
                e.description,
                AR_SOURCE[e.source] ?? e.source,
                e.linesCount,
                e.totalDebit,
                e.totalCredit,
                AR_ENTRY_STATUS[e.status] ?? e.status,
              ])
            }
          />
          <div className="overflow-hidden rounded-lg border">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-44">رقم القيد</TableHead>
                <TableHead className="w-28">التاريخ</TableHead>
                <TableHead>البيان</TableHead>
                <TableHead className="w-28">المصدر</TableHead>
                <TableHead className="w-16 text-center">البنود</TableHead>
                <TableHead className="w-40">المدين</TableHead>
                <TableHead className="w-40">الدائن</TableHead>
                <TableHead className="w-24">الحالة</TableHead>
                <TableHead className="no-print w-52">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-14 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span className="text-sm">جاري تحميل القيود…</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : displayRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-14 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <div className="rounded-full bg-muted p-4">
                        <Inbox className="h-8 w-8" />
                      </div>
                      <div>
                        <p className="font-medium">لا توجد قيود مطابقة</p>
                        <p className="mt-1 text-xs">جرّب تعديل الفلاتر أو أنشئ قيداً جديداً</p>
                      </div>
                      {!isArchive && (
                        <Button size="sm" variant="outline" onClick={openNew}>
                          <Plus className="h-4 w-4" />
                          قيد جديد
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                displayRows.map((e) => {
                  const expanded = expandedId === e.id
                  return (
                    <Fragment key={e.id}>
                      <TableRow
                        className={cn('cursor-pointer', expanded && 'bg-muted/40')}
                        onClick={() => toggleExpand(e.id)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0 text-muted-foreground"
                              title={expanded ? 'إخفاء البنود' : 'عرض البنود'}
                              onClick={(ev) => {
                                ev.stopPropagation()
                                toggleExpand(e.id)
                              }}
                            >
                              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                            <span className="num font-bold">{e.number}</span>
                          </div>
                        </TableCell>
                        <TableCell className="num whitespace-nowrap text-muted-foreground">
                          {fmtDate(e.date)}
                        </TableCell>
                        <TableCell className="max-w-[240px]">
                          <span className="block truncate text-sm" title={e.description}>
                            {e.description}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{AR_SOURCE[e.source] ?? e.source}</Badge>
                        </TableCell>
                        <TableCell className="num text-center">{e.linesCount}</TableCell>
                        <TableCell className="num whitespace-nowrap text-end">{fmtMoney(e.totalDebit)}</TableCell>
                        <TableCell className="num whitespace-nowrap text-end">{fmtMoney(e.totalCredit)}</TableCell>
                        <TableCell>
                          <StatusBadge status={e.status} label={AR_ENTRY_STATUS[e.status] ?? e.status} />
                        </TableCell>
                        <TableCell className="no-print" onClick={(ev) => ev.stopPropagation()}>
                          <div className="flex items-center justify-end gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="عرض القيد"
                              onClick={() => openView(e)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {e.status === 'DRAFT' && !isArchive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="تعديل القيد"
                                onClick={() => openEdit(e)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {e.status === 'DRAFT' && !isArchive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400"
                                title="ترحيل القيد"
                                onClick={() => setConfirm({ type: 'post', entry: e })}
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                            )}
                            {e.status !== 'CANCELLED' && !isArchive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
                                title="إلغاء القيد"
                                onClick={() => setConfirm({ type: 'cancel', entry: e })}
                              >
                                <Ban className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="طباعة القيد"
                              onClick={() => handlePrint(e)}
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                            {e.status === 'DRAFT' && !isArchive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
                                title="حذف القيد"
                                onClick={() => setConfirm({ type: 'delete', entry: e })}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={9} className="p-0">
                            <div className="overflow-x-auto bg-muted/50 px-5 py-3">
                              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                                بنود القيد <span className="num">{e.number}</span>
                              </p>
                              <table className="w-full min-w-[620px] text-xs">
                                <thead>
                                  <tr className="border-b text-muted-foreground">
                                    <th className="w-8 py-1.5 text-center font-medium">م</th>
                                    <th className="py-1.5 text-center font-medium">الحساب</th>
                                    <th className="py-1.5 text-center font-medium">البيان</th>
                                    <th className="py-1.5 text-center font-medium">مركز التكلفة</th>
                                    <th className="py-1.5 text-center font-medium">مدين</th>
                                    <th className="py-1.5 text-center font-medium">دائن</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {e.lines.map((l, i) => (
                                    <tr key={`${e.id}-${l.accountId}-${i}`} className="border-b last:border-0">
                                      <td className="num py-1.5 text-center text-muted-foreground">{i + 1}</td>
                                      <td className="py-1.5">
                                        <span className="num text-muted-foreground">{l.account.code}</span>
                                        {' — '}
                                        {l.account.name}
                                      </td>
                                      <td className="max-w-[220px] py-1.5 text-muted-foreground">
                                        <span className="block truncate" title={l.description ?? ''}>
                                          {l.description ?? '—'}
                                        </span>
                                      </td>
                                      <td className="py-1.5">{l.costCenterName ?? '—'}</td>
                                      <td className="num py-1.5 text-end">
                                        {l.debit ? fmtMoney(l.debit) : '—'}
                                      </td>
                                      <td className="num py-1.5 text-end">
                                        {l.credit ? fmtMoney(l.credit) : '—'}
                                      </td>
                                    </tr>
                                  ))}
                                  <tr className="border-t-2 font-semibold">
                                    <td colSpan={4} className="py-1.5 text-center">
                                      الإجمالي
                                    </td>
                                    <td className="num py-1.5 text-end">{fmtMoney(e.totalDebit)}</td>
                                    <td className="num py-1.5 text-end">{fmtMoney(e.totalCredit)}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
        </div>

        {/* التقسيم */}
        <div className="no-print flex flex-wrap items-center justify-between gap-2 pt-3">
          <p className="text-xs text-muted-foreground">
            صفحة <span className="num font-semibold">{page}</span> من{' '}
            <span className="num font-semibold">{totalPages}</span> — عدد النتائج:{' '}
            <span className="num font-semibold">{fmtNumber(total)}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronRight className="h-4 w-4" />
              السابق
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              التالي
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* نموذج الإنشاء/التعديل */}
      <JournalFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editId={editId}
        nextNumber={nextNumber}
        onSaved={load}
      />

      {/* نافذة العرض */}
      <JournalViewDialog open={viewOpen} onOpenChange={setViewOpen} entryId={viewId} />

      {/* تأكيد الإجراءات (ترحيل/إلغاء/حذف) */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader className="text-start">
            <AlertDialogTitle>{confirmMeta?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmMeta?.desc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2 sm:justify-start">
            <AlertDialogCancel disabled={acting}>رجوع</AlertDialogCancel>
            <AlertDialogAction
              disabled={acting}
              className={cn(
                confirmMeta?.destructive &&
                  'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500',
              )}
              onClick={(ev) => {
                ev.preventDefault()
                void performConfirm()
              }}
            >
              {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : confirmMeta?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
