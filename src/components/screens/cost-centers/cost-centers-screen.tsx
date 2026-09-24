'use client'

// شاشة مراكز التكلفة — إدارة كاملة (إضافة/تعديل/تفعيل/حذف محمي) + تقرير حركات كل مركز
// مع طباعة وتصدير إكسل لكل الصفوف المفلترة (لا الصفحة المعروضة)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Inbox,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Power,
  ScrollText,
  Search,
  Target,
  Trash2,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
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
import { useIsArchive } from '@/lib/store'
import { fmtDate, fmtMoney, fmtNumber, fmtUSD } from '@/lib/format'
import { cn } from '@/lib/utils'
import { printCostCenterReport } from './print-cost-center'
import { UnifiedReportDialog } from './unified-report-dialog'

interface CostCenterRow {
  id: string
  code: string
  name: string
  isActive: boolean
  createdAt: string
  linesCount: number
  entriesCount: number
  totalDebit: number
  totalCredit: number
}

interface CenterMovement {
  entryId: string
  entryNumber: string
  entryDate: string
  entryDescription: string
  accountCode: string
  accountName: string
  description: string | null
  debit: number
  credit: number
}

interface CenterReport {
  costCenter: { id: string; code: string; name: string; isActive: boolean }
  movements: CenterMovement[]
  totals: { totalDebit: number; totalCredit: number; net: number; count: number }
}

const PAGE_SIZE = 10

export default function CostCentersScreen() {
  const { toast } = useToast()
  // وضع استعراض الأرشيف (الشرط 4) — إخفاء أزرار الإضافة/التعديل/التفعيل/الحذف
  const isArchive = useIsArchive()

  const [centers, setCenters] = useState<CostCenterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL')
  const [page, setPage] = useState(1)
  const [printRows, setPrintRows] = useState<CostCenterRow[] | null>(null)

  // ===== نافذة النموذج (إضافة/تعديل) =====
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [fCode, setFCode] = useState('')
  const [fName, setFName] = useState('')
  const [fActive, setFActive] = useState(true)
  const [saving, setSaving] = useState(false)

  // ===== التقرير الموحد =====
  const [unifiedOpen, setUnifiedOpen] = useState(false)

  // ===== حذف =====
  const [deleteTarget, setDeleteTarget] = useState<CostCenterRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ===== تقرير المركز =====
  const [reportOpen, setReportOpen] = useState(false)
  const [report, setReport] = useState<CenterReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [rFrom, setRFrom] = useState('')
  const [rTo, setRTo] = useState('')
  const reportCenterRef = useRef<{ id: string; code: string; name: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/cost-centers?all=1')
      const data = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(data)) {
        throw new Error((data as { error?: string } | null)?.error ?? 'تعذر جلب مراكز التكلفة')
      }
      setCenters(data as CostCenterRow[])
    } catch (err) {
      toast({
        title: 'تعذر جلب مراكز التكلفة',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  // ===== الفلترة محلياً — القائمة صغيرة فالكل في الذاكرة =====
  const filtered = useMemo(() => {
    const term = q.trim()
    return centers.filter((c) => {
      if (statusFilter === 'ACTIVE' && !c.isActive) return false
      if (statusFilter === 'INACTIVE' && c.isActive) return false
      if (term && !c.name.includes(term) && !c.code.toLowerCase().includes(term.toLowerCase()))
        return false
      return true
    })
  }, [centers, q, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  )

  // الصفوف المعروضة — كل الصفوف المفلترة عند الطباعة وإلا صفحة التقسيم الحالية
  const displayRows = printRows ?? pageRows

  const stats = useMemo(() => {
    const active = centers.filter((c) => c.isActive).length
    const debit = centers.reduce((s, c) => s + c.totalDebit, 0)
    const credit = centers.reduce((s, c) => s + c.totalCredit, 0)
    return { total: centers.length, active, debit, credit }
  }, [centers])

  // ===== الإجراءات =====
  const openNew = useCallback(async () => {
    setEditId(null)
    setFName('')
    setFActive(true)
    setFCode('')
    try {
      const res = await fetch('/api/cost-centers?suggest=1')
      const data = (await res.json().catch(() => null)) as { code?: string } | null
      if (res.ok && data?.code) setFCode(data.code)
    } catch {
      // الكود سيُولَّد خلفياً تلقائياً عند الحفظ
    }
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((c: CostCenterRow) => {
    setEditId(c.id)
    setFCode(c.code)
    setFName(c.name)
    setFActive(c.isActive)
    setFormOpen(true)
  }, [])

  const save = useCallback(async () => {
    if (!fName.trim()) {
      toast({ title: 'الاسم مطلوب', description: 'أدخل اسم مركز التكلفة', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const url = editId ? `/api/cost-centers/${editId}` : '/api/cost-centers'
      const res = await fetch(url, {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: fCode.trim() || undefined, name: fName.trim(), isActive: fActive }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر الحفظ')
      toast({ title: data?.message ?? 'تم الحفظ' })
      setFormOpen(false)
      await load()
    } catch (err) {
      toast({
        title: 'تعذر الحفظ',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }, [editId, fCode, fName, fActive, load, toast])

  const toggleActive = useCallback(
    async (c: CostCenterRow) => {
      try {
        const res = await fetch(`/api/cost-centers/${c.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !c.isActive }),
        })
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) throw new Error(data?.error ?? 'تعذر تغيير الحالة')
        toast({ title: c.isActive ? `تم إيقاف المركز ${c.code}` : `تم تفعيل المركز ${c.code}` })
        await load()
      } catch (err) {
        toast({
          title: 'تعذر تغيير الحالة',
          description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
      }
    },
    [load, toast],
  )

  const doDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/cost-centers/${deleteTarget.id}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر الحذف')
      toast({ title: data?.message ?? 'تم الحذف' })
      setDeleteTarget(null)
      await load()
    } catch (err) {
      toast({
        title: 'تعذر الحذف',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, load, toast])

  const openReport = useCallback(
    async (c: CostCenterRow, from = rFrom, to = rTo) => {
      reportCenterRef.current = { id: c.id, code: c.code, name: c.name }
      setReportOpen(true)
      setReportLoading(true)
      try {
        const params = new URLSearchParams()
        if (from) params.set('from', from)
        if (to) params.set('to', to)
        const res = await fetch(`/api/cost-centers/${c.id}?${params.toString()}`)
        const data = await res.json().catch(() => null)
        if (!res.ok || !data) throw new Error((data as { error?: string } | null)?.error ?? 'تعذر جلب التقرير')
        setReport(data as CenterReport)
      } catch (err) {
        toast({
          title: 'تعذر جلب التقرير',
          description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        setReport(null)
      } finally {
        setReportLoading(false)
      }
    },
    [rFrom, rTo, toast],
  )

  const applyReportRange = useCallback(() => {
    const center = reportCenterRef.current
    if (!center) return
    void openReport({ ...center, isActive: true, createdAt: '', linesCount: 0, entriesCount: 0, totalDebit: 0, totalCredit: 0 })
  }, [openReport])

  const handlePrintReport = useCallback(() => {
    if (!report || !reportCenterRef.current) return
    const ok = printCostCenterReport({
      code: report.costCenter.code,
      name: report.costCenter.name,
      movements: report.movements.map((m) => ({
        entryNumber: m.entryNumber,
        entryDate: m.entryDate,
        accountCode: m.accountCode,
        accountName: m.accountName,
        description: m.description,
        debit: m.debit,
        credit: m.credit,
      })),
      totalDebit: report.totals.totalDebit,
      totalCredit: report.totals.totalCredit,
      net: report.totals.net,
      from: rFrom,
      to: rTo,
    })
    if (!ok) {
      toast({
        title: 'تعذر فتح نافذة الطباعة',
        description: 'المتصفح يحجب النوافذ المنبثقة — اسمح بها لهذا الموقع',
        variant: 'destructive',
      })
    }
  }, [report, rFrom, rTo, toast])

  const exportRows = useCallback(
    (): (string | number)[][] =>
      filtered.map((c) => [
        c.code,
        c.name,
        c.isActive ? 'نشط' : 'موقوف',
        c.entriesCount,
        c.linesCount,
        c.totalDebit,
        c.totalCredit,
      ]),
    [filtered],
  )

  return (
    <div className="space-y-4">
      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="مراكز التكلفة" value={fmtNumber(stats.total)} hint={`${fmtNumber(stats.active)} نشط`} icon={Target} tone="gold" loading={loading} />
        <KpiCard title="المراكز النشطة" value={fmtNumber(stats.active)} hint={`من أصل ${fmtNumber(stats.total)}`} icon={Power} tone="emerald" loading={loading} />
        <KpiCard title="إجمالي المدين الموزّع" value={fmtMoney(stats.debit)} hint={`≈ ${fmtUSD(stats.debit)}`} icon={BarChart3} tone="amber" loading={loading} />
        <KpiCard title="إجمالي الدائن الموزّع" value={fmtMoney(stats.credit)} hint={`≈ ${fmtUSD(stats.credit)}`} icon={BarChart3} tone="slate" loading={loading} />
      </div>

      {/* الفلاتر */}
      <SectionCard title="بحث وفلترة" icon={Search}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="cc-q">بحث</Label>
            <Input
              id="cc-q"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
              placeholder="الكود أو الاسم…"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label>الحالة</Label>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as 'ALL' | 'ACTIVE' | 'INACTIVE')
                setPage(1)
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">الكل</SelectItem>
                <SelectItem value="ACTIVE">النشطة</SelectItem>
                <SelectItem value="INACTIVE">الموقوفة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end sm:col-span-2 lg:justify-end">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setUnifiedOpen(true)}>
                <Layers className="h-4 w-4" />
                التقرير الموحد
              </Button>
              {!isArchive && (
                <Button onClick={openNew}>
                  <Plus className="h-4 w-4" />
                  مركز تكلفة جديد
                </Button>
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* جدول المراكز */}
      <SectionCard
        title="قائمة مراكز التكلفة"
        description="توزيع التكاليف والإيرادات على المراكز — تظهر القيم من القيود المُرحّلة وغير الملغاة"
        icon={ScrollText}
        action={
          <Badge variant="outline" className="num gap-1">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {fmtNumber(filtered.length)} نتيجة
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title="قائمة مراكز التكلفة"
            filename="cost-centers"
            headers={['الكود', 'الاسم', 'الحالة', 'القيود', 'الأسطر', 'إجمالي المدين', 'إجمالي الدائن']}
            rowsLoader={exportRows}
            onBeforePrint={async () => {
              setPrintRows(filtered)
            }}
            onAfterPrint={() => setPrintRows(null)}
          />
          <div className="overflow-hidden rounded-lg border">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-24">الكود</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead className="w-24">الحالة</TableHead>
                  <TableHead className="w-20 text-center">القيود</TableHead>
                  <TableHead className="w-20 text-center">الأسطر</TableHead>
                  <TableHead className="w-36">إجمالي المدين</TableHead>
                  <TableHead className="w-36">إجمالي الدائن</TableHead>
                  <TableHead className="no-print w-44">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-14 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span className="text-sm">جارٍ التحميل…</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : displayRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-14 text-center">
                      <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        <div className="rounded-full bg-muted p-4">
                          <Inbox className="h-8 w-8" />
                        </div>
                        <div>
                          <p className="font-medium">لا توجد مراكز تكلفة</p>
                          <p className="mt-1 text-xs">أنشئ أول مركز تكلفة لتبدأ توزيع التكاليف</p>
                        </div>
                        {!isArchive && (
                          <Button size="sm" variant="outline" onClick={openNew}>
                            <Plus className="h-4 w-4" />
                            مركز تكلفة جديد
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayRows.map((c) => (
                    <TableRow key={c.id} className={cn(!c.isActive && 'opacity-60')}>
                      <TableCell className="num font-bold">{c.code}</TableCell>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={c.isActive
                          ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                          : 'border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-400'}>
                          {c.isActive ? 'نشط' : 'موقوف'}
                        </Badge>
                      </TableCell>
                      <TableCell className="num text-center">{fmtNumber(c.entriesCount)}</TableCell>
                      <TableCell className="num text-center">{fmtNumber(c.linesCount)}</TableCell>
                      <TableCell className="num whitespace-nowrap text-end">{c.totalDebit ? fmtMoney(c.totalDebit) : '—'}</TableCell>
                      <TableCell className="num whitespace-nowrap text-end">{c.totalCredit ? fmtMoney(c.totalCredit) : '—'}</TableCell>
                      <TableCell className="no-print">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                            title="تقرير الحركات"
                            aria-label={`تقرير حركات المركز ${c.code}`}
                            onClick={() => void openReport(c)}
                          >
                            <BarChart3 className="h-4 w-4" />
                          </Button>
                          {!isArchive && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-primary"
                              title="تعديل"
                              aria-label={`تعديل المركز ${c.code}`}
                              onClick={() => openEdit(c)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {!isArchive && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn('h-8 w-8 text-muted-foreground hover:text-primary', c.isActive && 'text-emerald-600 dark:text-emerald-400')}
                              title={c.isActive ? 'إيقاف' : 'تفعيل'}
                              aria-label={`${c.isActive ? 'إيقاف' : 'تفعيل'} المركز ${c.code}`}
                              onClick={() => void toggleActive(c)}
                            >
                              <Power className="h-4 w-4" />
                            </Button>
                          )}
                          {!isArchive && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                              title="حذف"
                              aria-label={`حذف المركز ${c.code}`}
                              onClick={() => setDeleteTarget(c)}
                              disabled={c.linesCount > 0}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* التقسيم الصفحي */}
          {totalPages > 1 && !printRows && (
            <div className="no-print mt-3 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground num">
                صفحة {fmtNumber(safePage)} من {fmtNumber(totalPages)} — {fmtNumber(filtered.length)} مركز
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                  السابق
                </Button>
                <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
                  التالي
                </Button>
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      {/* نافذة النموذج */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? 'تعديل مركز تكلفة' : 'مركز تكلفة جديد'}</DialogTitle>
            <DialogDescription>
              {editId ? 'عدّل بيانات المركز ثم احفظ' : 'الكود مقترح تلقائياً — يمكنك تعديله أو تركه كما هو'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="cc-code">الكود</Label>
              <Input
                id="cc-code"
                value={fCode}
                onChange={(e) => setFCode(e.target.value)}
                placeholder="CC-001"
                className="num h-9"
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-name">اسم المركز *</Label>
              <Input
                id="cc-name"
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="مثال: قسم المبيعات — فرع دمشق"
                className="h-9"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">مركز نشط</p>
                <p className="text-xs text-muted-foreground">المراكز النشطة فقط تظهر في قوائم اختيار القيود</p>
              </div>
              <Switch checked={fActive} onCheckedChange={setFActive} aria-label="تفعيل المركز" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              إلغاء
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد الحذف */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف مركز التكلفة</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف المركز «{deleteTarget?.name}» ({deleteTarget?.code})؟ لا يمكن التراجع عن الحذف.
              المراكز المرتبطة بقيود لا يمكن حذفها — أوقفها بدلاً من ذلك.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                void doDelete()
              }}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              حذف نهائي
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* نافذة التقرير الموحد لمراكز التكلفة */}
      <UnifiedReportDialog open={unifiedOpen} onOpenChange={setUnifiedOpen} />

      {/* نافذة تقرير المركز */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              تقرير حركات مركز التكلفة {reportCenterRef.current ? `— ${reportCenterRef.current.code}` : ''}
            </DialogTitle>
            <DialogDescription>
              الحركات من القيود المُرحّلة (POSTED) — حدد الفترة ثم اعرض أو اطبع
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-end gap-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="cc-r-from">من تاريخ</Label>
              <Input id="cc-r-from" type="date" value={rFrom} onChange={(e) => setRFrom(e.target.value)} className="num h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-r-to">إلى تاريخ</Label>
              <Input id="cc-r-to" type="date" value={rTo} onChange={(e) => setRTo(e.target.value)} className="num h-9" />
            </div>
            <Button size="sm" variant="outline" onClick={applyReportRange} disabled={reportLoading}>
              {reportLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              عرض
            </Button>
            <Button size="sm" variant="outline" onClick={handlePrintReport} disabled={reportLoading || !report} className="text-primary">
              <ScrollText className="h-4 w-4" />
              طباعة التقرير
            </Button>
          </div>

          {reportLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : report ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border p-2.5">
                  <p className="text-xs text-muted-foreground">عدد الحركات</p>
                  <p className="num text-base font-bold">{fmtNumber(report.totals.count)}</p>
                </div>
                <div className="rounded-lg border p-2.5">
                  <p className="text-xs text-muted-foreground">إجمالي المدين</p>
                  <p className="num text-base font-bold">{fmtMoney(report.totals.totalDebit)}</p>
                </div>
                <div className="rounded-lg border p-2.5">
                  <p className="text-xs text-muted-foreground">إجمالي الدائن</p>
                  <p className="num text-base font-bold">{fmtMoney(report.totals.totalCredit)}</p>
                </div>
                <div className="rounded-lg border p-2.5">
                  <p className="text-xs text-muted-foreground">الصافي</p>
                  <p className="num text-base font-bold">{fmtMoney(report.totals.net)}</p>
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto rounded-lg border">
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="w-28">رقم القيد</TableHead>
                      <TableHead className="w-24">التاريخ</TableHead>
                      <TableHead>الحساب</TableHead>
                      <TableHead>البيان</TableHead>
                      <TableHead className="w-32">مدين</TableHead>
                      <TableHead className="w-32">دائن</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.movements.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                          لا توجد حركات مُرحّلة على هذا المركز ضمن الفترة
                        </TableCell>
                      </TableRow>
                    ) : (
                      report.movements.map((m, i) => (
                        <TableRow key={`${m.entryId}-${i}`}>
                          <TableCell className="num font-bold">{m.entryNumber}</TableCell>
                          <TableCell className="num whitespace-nowrap">{fmtDate(m.entryDate)}</TableCell>
                          <TableCell>
                            <span className="num text-xs text-muted-foreground">{m.accountCode}</span>{' '}
                            {m.accountName}
                          </TableCell>
                          <TableCell className="max-w-56 truncate" title={m.description ?? m.entryDescription}>
                            {m.description ?? m.entryDescription}
                          </TableCell>
                          <TableCell className="num whitespace-nowrap text-end">{m.debit ? fmtMoney(m.debit) : '—'}</TableCell>
                          <TableCell className="num whitespace-nowrap text-end">{m.credit ? fmtMoney(m.credit) : '—'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">اختر الفترة واضغط «عرض»</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
