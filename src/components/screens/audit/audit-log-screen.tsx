'use client'

// شاشة سجل التدقيق — كل حركة داخل البرنامج موثقة يراها المدير
// تبدأ بالفواتير (إضافة/تعديل/حذف) والحذف يوثق برقمه المحجوز xx — قابلة للتوسع لبقية الكيانات

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  History,
  Inbox,
  Loader2,
  Pencil,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { TableActions } from '@/components/screens/common/table-actions'
import { useToast } from '@/hooks/use-toast'
import { fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

interface AuditEntry {
  id: string
  action: string
  entity: string
  entityId: string | null
  entityNumber: string | null
  title: string
  summary: string
  details: Record<string, unknown> | null
  amount: number | null
  createdAt: string
}

interface AuditStats {
  total: number
  today: number
  creates: number
  updates: number
  deletes: number
}

const EMPTY_STATS: AuditStats = { total: 0, today: 0, creates: 0, updates: 0, deletes: 0 }

const ACTION_BADGE: Record<string, string> = {
  CREATE: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  UPDATE: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  DELETE: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  POST: 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  CANCEL: 'border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400',
  SYSTEM: 'border-muted-foreground/30 bg-muted text-muted-foreground',
}

const AR_ACTION: Record<string, string> = {
  CREATE: 'إضافة',
  UPDATE: 'تعديل',
  DELETE: 'حذف',
  POST: 'ترحيل',
  CANCEL: 'إلغاء',
  SYSTEM: 'النظام',
}

const ENTITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'INVOICE', label: 'الفواتير' },
  { value: 'PAYMENT', label: 'السندات' },
  { value: 'JOURNAL', label: 'القيود' },
  { value: 'ITEM', label: 'المواد' },
  { value: 'PARTNER', label: 'الأطراف' },
  { value: 'COST_CENTER', label: 'مراكز التكلفة' },
  { value: 'EMPLOYEE', label: 'الموظفون' },
  { value: 'SALARY', label: 'الرواتب' },
  { value: 'ADVANCE', label: 'السلف' },
  { value: 'LEAVE', label: 'الإجازات' },
  { value: 'ATTENDANCE', label: 'الدوام' },
  { value: 'BONUS', label: 'المكافآت والحسم' },
  { value: 'USER', label: 'المستخدمون' },
  { value: 'SETTING', label: 'الإعدادات' },
  { value: 'SYSTEM', label: 'النظام' },
  { value: 'STOCKTAKING', label: 'أوامر الجرد' },
  { value: 'DAMAGE', label: 'تلف المخزون' },
]

/** تسطيح تفاصيل JSON (قد تحتوي كائنات قبل/بعد) إلى صفوف (مفتاح عربي ← قيمة) */
function flattenDetails(obj: Record<string, unknown>, prefix = ''): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = []
  for (const [k, v] of Object.entries(obj)) {
    const label = prefix ? `${prefix} — ${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      rows.push(...flattenDetails(v as Record<string, unknown>, label))
    } else {
      rows.push({ key: label, value: Array.isArray(v) ? v.join('، ') : String(v) })
    }
  }
  return rows
}

export function AuditLogScreen() {
  const { toast } = useToast()

  const [fAction, setFAction] = useState('ALL')
  const [fEntity, setFEntity] = useState('ALL')
  const [fQ, setFQ] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [filters, setFilters] = useState<{ action: string; entity: string; q: string; from: string; to: string }>({
    action: 'ALL',
    entity: 'ALL',
    q: '',
    from: '',
    to: '',
  })

  const [entries, setEntries] = useState<AuditEntry[]>([])
  /** صفوف الطباعة الكاملة — تُملأ قبل الطباعة بكل صفحات الخادم وتُفرَّغ بعدها */
  const [printRows, setPrintRows] = useState<AuditEntry[] | null>(null)
  const [stats, setStats] = useState<AuditStats>(EMPTY_STATS)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  // عدّاد تسلسلي لمنع سباقات الاستجابات المتأخرة (مُدار داخل load)
  const [detailsEntry, setDetailsEntry] = useState<AuditEntry | null>(null)

  // ===== جلب السجل — عدّاد تسلسلي يمنع طغيان استجابة أقدم =====
  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' })
      if (filters.action !== 'ALL') params.set('action', filters.action)
      if (filters.entity !== 'ALL') params.set('entity', filters.entity)
      if (filters.q) params.set('q', filters.q)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)

      const res = await fetch(`/api/audit-log?${params.toString()}`)
      const data = await res.json().catch(() => null)
      if (seq !== loadSeq.current) return
      if (!res.ok || !data) {
        toast({
          title: 'تعذر جلب سجل التدقيق',
          description: data?.error ?? 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        setEntries([])
        return
      }
      setEntries(Array.isArray(data.entries) ? data.entries : [])
      setStats(data.stats ?? EMPTY_STATS)
      setPage(data.page ?? 1)
      setTotalPages(data.totalPages ?? 1)
      setTotal(data.total ?? 0)
    } catch {
      if (seq === loadSeq.current) {
        toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
        setEntries([])
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [filters, page, toast])

  useEffect(() => {
    void load()
  }, [load])

  // ===== جلب كل سجلات التدقيق المطابقة للفلاتر عبر كل صفحات الخادم (سقف 100/صفحة) — للطباعة والتصدير الكاملين =====
  const fetchAllEntries = useCallback(async (): Promise<AuditEntry[]> => {
    const all: AuditEntry[] = []
    for (let p = 1; p < 100; p++) {
      const params = new URLSearchParams({ page: String(p), pageSize: '100' })
      if (filters.action !== 'ALL') params.set('action', filters.action)
      if (filters.entity !== 'ALL') params.set('entity', filters.entity)
      if (filters.q) params.set('q', filters.q)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      const res = await fetch(`/api/audit-log?${params.toString()}`)
      const data = (await res.json().catch(() => null)) as { entries?: AuditEntry[]; total?: number } | null
      if (!res.ok || !data) break
      const rows = Array.isArray(data.entries) ? data.entries : []
      all.push(...rows)
      if (rows.length === 0 || all.length >= (data.total ?? 0)) break
    }
    return all
  }, [filters])

  const applyFilters = useCallback(() => {
    setPage(1)
    setFilters({ action: fAction, entity: fEntity, q: fQ.trim(), from: fFrom, to: fTo })
  }, [fAction, fEntity, fQ, fFrom, fTo])

  const clearFilters = useCallback(() => {
    setFAction('ALL')
    setFEntity('ALL')
    setFQ('')
    setFFrom('')
    setFTo('')
    setPage(1)
    setFilters({ action: 'ALL', entity: 'ALL', q: '', from: '', to: '' })
  }, [])

  const detailsRows = detailsEntry?.details ? flattenDetails(detailsEntry.details) : []

  return (
    <div className="space-y-4">
      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          title="إجمالي الحركات الموثقة"
          value={fmtNumber(stats.total)}
          hint="كل حركات النظام المسجلة"
          icon={History}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="حركات اليوم"
          value={fmtNumber(stats.today)}
          hint="منذ بداية اليوم"
          icon={CalendarClock}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="إضافات وتعديلات"
          value={fmtNumber(stats.creates + stats.updates)}
          hint={`${fmtNumber(stats.creates)} إضافة و${fmtNumber(stats.updates)} تعديل`}
          icon={Pencil}
          tone="amber"
          loading={loading}
        />
        <KpiCard
          title="عمليات الحذف"
          value={fmtNumber(stats.deletes)}
          hint="موثقة بأرقامها المحجوزة"
          icon={Trash2}
          tone="rose"
          loading={loading}
        />
      </div>

      <SectionCard
        title="سجل التدقيق"
        description="كل إضافة وتعديل وحذف يُوثَّق هنا لحظياً — المدير يرى كل حركة بأرقامها وقيمها"
        icon={FileText}
      >
        {/* الفلاتر */}
        <div className="no-print mb-4 flex flex-wrap items-end gap-2">
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-3 lg:flex lg:items-end">
            <div className="space-y-1">
              <Label className="text-xs">الإجراء</Label>
              <Select value={fAction} onValueChange={setFAction}>
                <SelectTrigger className="h-9 w-full lg:w-28" aria-label="فلترة بالإجراء">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">الكل</SelectItem>
                  <SelectItem value="CREATE">إضافة</SelectItem>
                  <SelectItem value="UPDATE">تعديل</SelectItem>
                  <SelectItem value="DELETE">حذف</SelectItem>
                  <SelectItem value="POST">ترحيل</SelectItem>
                  <SelectItem value="CANCEL">إلغاء</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">الكيان</Label>
              <Select value={fEntity} onValueChange={setFEntity}>
                <SelectTrigger className="h-9 w-full lg:w-32" aria-label="فلترة بالكيان">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">الكل</SelectItem>
                  {ENTITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">بحث</Label>
              <div className="relative">
                <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={fQ}
                  onChange={(e) => setFQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                  placeholder="رقم مستند، كلمة…"
                  className="h-9 ps-8"
                  aria-label="بحث في السجل"
                />
              </div>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">من</Label>
              <Input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} className="h-9 w-[140px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">إلى</Label>
              <Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} className="h-9 w-[140px]" />
            </div>
            <Button size="sm" className="h-9" onClick={applyFilters}>
              <SlidersHorizontal className="h-4 w-4" />
              تطبيق
            </Button>
            {(fAction !== 'ALL' || fEntity !== 'ALL' || fQ || fFrom || fTo) && (
              <Button size="sm" variant="ghost" className="h-9" onClick={clearFilters}>
                <X className="h-4 w-4" />
                مسح
              </Button>
            )}
          </div>
        </div>

        {/* الجدول */}
        <div className="print-area">
          <TableActions
            title="سجل التدقيق — حركات النظام الموثقة"
            filename="audit-log"
            headers={['التاريخ والوقت', 'الإجراء', 'المستند', 'الرقم', 'الوصف', 'القيمة (ل.س)']}
            onBeforePrint={async () => {
              setPrintRows(await fetchAllEntries())
            }}
            onAfterPrint={() => setPrintRows(null)}
            rowsLoader={async () =>
              (await fetchAllEntries()).map((e) => [
                e.createdAt.slice(0, 19).replace('T', ' '),
                AR_ACTION[e.action] ?? e.action,
                e.title,
                e.entityNumber ?? '',
                e.summary,
                e.amount ?? '',
              ])
            }
          />
          <div className="max-h-[560px] overflow-auto rounded-lg border">
          <Table className="min-w-[860px]">
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead className="w-[150px]">التاريخ والوقت</TableHead>
                <TableHead className="w-[80px]">الإجراء</TableHead>
                <TableHead className="min-w-[170px]">المستند</TableHead>
                <TableHead className="w-[130px]">الرقم</TableHead>
                <TableHead className="min-w-[300px]">الوصف</TableHead>
                <TableHead className="w-[120px]">القيمة (ل.س)</TableHead>
                <TableHead className="no-print w-16">تفاصيل</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                      <Inbox className="h-8 w-8" />
                      <p className="text-sm">لا حركات مطابقة — عدّل الفلاتر أو انتظر أول عملية</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                (printRows ?? entries).map((e) => (
                  <TableRow key={e.id} className={cn(e.action === 'DELETE' && 'bg-rose-500/[0.04]')}>
                    <TableCell className="num whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDateTime(e.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={ACTION_BADGE[e.action] ?? ''}>
                        {AR_ACTION[e.action] ?? e.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-semibold">{e.title}</TableCell>
                    <TableCell className="num text-xs text-muted-foreground">{e.entityNumber ?? '—'}</TableCell>
                    <TableCell className="max-w-[420px] text-xs leading-relaxed text-muted-foreground">
                      <span title={e.summary}>{e.summary}</span>
                    </TableCell>
                    <TableCell className="num text-end text-sm font-semibold">
                      {e.amount !== null && e.amount !== undefined ? fmtMoney(e.amount) : '—'}
                    </TableCell>
                    <TableCell className="no-print text-center">
                      {e.details ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`تفاصيل ${e.title}`}
                          title="عرض التفاصيل الكاملة"
                          onClick={() => setDetailsEntry(e)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
        </div>

        {/* التقسيم */}
        <div className="no-print flex flex-wrap items-center justify-between gap-2 pt-3">
          <p className="text-xs text-muted-foreground">
            صفحة <span className="num font-semibold">{page}</span> من{' '}
            <span className="num font-semibold">{totalPages}</span> — عدد الحركات المطابقة:{' '}
            <span className="num font-semibold">{fmtNumber(total)}</span>
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

      {/* نافذة التفاصيل */}
      <Dialog open={!!detailsEntry} onOpenChange={(v) => !v && setDetailsEntry(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-0 sm:max-w-[560px]">
          <div className="border-b px-5 py-4">
            <DialogHeader className="text-start">
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {detailsEntry?.title}
                {detailsEntry && (
                  <Badge variant="outline" className={ACTION_BADGE[detailsEntry.action] ?? ''}>
                    {AR_ACTION[detailsEntry.action] ?? detailsEntry.action}
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription>
                {detailsEntry ? `وُثّقت في ${fmtDateTime(detailsEntry.createdAt)}` : ''}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="overflow-y-auto px-5 py-4">
            {detailsEntry?.summary && (
              <p className="mb-4 rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed">{detailsEntry.summary}</p>
            )}
            {detailsRows.length > 0 ? (
              <dl className="overflow-hidden rounded-lg border">
                {detailsRows.map((row, i) => (
                  <div
                    key={`${row.key}-${i}`}
                    className={cn(
                      'flex items-start justify-between gap-4 px-3 py-2 text-sm',
                      i % 2 === 1 && 'bg-muted/30',
                    )}
                  >
                    <dt className="shrink-0 text-muted-foreground">{row.key}</dt>
                    <dd className="num text-end font-medium">{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">لا تفاصيل إضافية لهذه الحركة</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
