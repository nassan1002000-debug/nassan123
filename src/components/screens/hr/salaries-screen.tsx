'use client'

// شاشة الرواتب — كشف شهري لكل الموظفين (توليد/تعديل معلق/صرف نقدي أو بنكي/حذف معلق)
// الصرف ينشئ قيداً محاسبياً تلقائياً (entryNumber) — KPIs من الخادم + تقسيم صفحي عميل + طباعة/إكسل

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Banknote,
  CalendarDays,
  CalendarPlus,
  CircleDollarSign,
  Clock,
  Inbox,
  ListChecks,
  Loader2,
  Pencil,
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
import { NumInput } from '@/components/ui/number-input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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
import { AR_METHOD, fmtDate, fmtMoney, fmtNumber, fmtUSD, todayYMD } from '@/lib/format'
import { useIsArchive } from '@/lib/store'
import { cn } from '@/lib/utils'
import { AR_SALARY_STATUS } from './hr-shared'
import type { PayMethod, SalariesResponse, SalariesStats, SalaryRow } from './hr-shared'

const PAGE_SIZE = 10

/** خيار مركز التكلفة للقائمة المنسدلة — من GET /api/cost-centers (الوضع المختصر: النشطة فقط) */
interface CostCenterOption {
  id: string
  code: string
  name: string
}

const EMPTY_STATS: SalariesStats = {
  count: 0,
  totalBase: 0,
  totalBonuses: 0,
  totalDeductions: 0,
  totalNet: 0,
  paidCount: 0,
  paidTotal: 0,
  pendingCount: 0,
  pendingTotal: 0,
}

export default function SalariesScreen() {
  const { toast } = useToast()
  // وضع استعراض أرشيف فترة مقفلة — يخفي أزرار الكتابة (التوليد/الصرف/التعديل/الحذف)
  const isArchive = useIsArchive()

  const [month, setMonth] = useState(() => todayYMD().slice(0, 7))
  const [salaries, setSalaries] = useState<SalaryRow[]>([])
  const [stats, setStats] = useState<SalariesStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [printRows, setPrintRows] = useState<SalaryRow[] | null>(null)

  // ===== توليد كشف الشهر =====
  const [genOpen, setGenOpen] = useState(false)
  const [generating, setGenerating] = useState(false)

  // ===== صرف قسط =====
  const [payTarget, setPayTarget] = useState<SalaryRow | null>(null)
  const [payMethod, setPayMethod] = useState<PayMethod>('CASH')
  const [payCCId, setPayCCId] = useState('')
  const [payCCOptions, setPayCCOptions] = useState<CostCenterOption[]>([])
  const [payCCLoading, setPayCCLoading] = useState(false)
  const [paying, setPaying] = useState(false)

  // ===== تعديل قسط معلق =====
  const [editTarget, setEditTarget] = useState<SalaryRow | null>(null)
  const [eBonuses, setEBonuses] = useState('0')
  const [eDeductions, setEDeductions] = useState('0')
  const [saving, setSaving] = useState(false)

  // ===== حذف قسط معلق =====
  const [deleteTarget, setDeleteTarget] = useState<SalaryRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/salaries?month=${encodeURIComponent(month)}`)
      const data = await res.json().catch(() => null)
      if (!res.ok || !data || !Array.isArray((data as SalariesResponse).salaries)) {
        throw new Error((data as { error?: string } | null)?.error ?? 'تعذر جلب كشف الرواتب')
      }
      const payload = data as SalariesResponse
      setSalaries(payload.salaries)
      setStats(payload.stats)
    } catch (err) {
      toast({
        title: 'تعذر جلب كشف الرواتب',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [month, toast])

  useEffect(() => {
    void load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(salaries.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => salaries.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [salaries, safePage],
  )

  // الصفوف المعروضة — كل صفوف الشهر عند الطباعة وإلا صفحة التقسيم الحالية
  const displayRows = printRows ?? pageRows

  // ===== الإجراءات =====
  const generate = useCallback(async () => {
    setGenerating(true)
    try {
      const res = await fetch('/api/salaries/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; created?: number; skipped?: number; error?: string; message?: string }
        | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر توليد الكشف')
      toast({
        title: data?.message ?? 'تم توليد كشف الرواتب',
        description: `أُنشئ ${fmtNumber(data?.created ?? 0)} — تُخطِّي ${fmtNumber(data?.skipped ?? 0)} موظفاً لهم كشف مسبق`,
      })
      setGenOpen(false)
      await load()
    } catch (err) {
      toast({
        title: 'تعذر توليد الكشف',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setGenerating(false)
    }
  }, [month, load, toast])

  // خيارات مراكز التكلفة النشطة للقائمة المنسدلة في نافذة الصرف
  const loadPayCCOptions = useCallback(async () => {
    setPayCCLoading(true)
    try {
      const res = await fetch('/api/cost-centers')
      const data = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(data)) {
        throw new Error((data as { error?: string } | null)?.error ?? 'تعذر جلب مراكز التكلفة')
      }
      setPayCCOptions(data as CostCenterOption[])
    } catch {
      // مركز التكلفة اختياري — الفشل لا يمنع الصرف، تبقى القائمة فارغة
      setPayCCOptions([])
    } finally {
      setPayCCLoading(false)
    }
  }, [])

  const openPay = useCallback(
    (s: SalaryRow) => {
      setPayMethod('CASH')
      setPayCCId('')
      setPayCCOptions([])
      setPayTarget(s)
      void loadPayCCOptions()
    },
    [loadPayCCOptions],
  )

  const pay = useCallback(async () => {
    if (!payTarget) return
    setPaying(true)
    try {
      const res = await fetch(`/api/salaries/${payTarget.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: payMethod, costCenterId: payCCId || undefined }),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; message?: string; entryNumber?: string | null }
        | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر صرف الراتب')
      toast({
        title: data?.message ?? 'تم صرف الراتب',
        description: data?.entryNumber ? `أُنشئ القيد ${data.entryNumber} في دفتر اليومية` : undefined,
      })
      setPayTarget(null)
      await load()
    } catch (err) {
      toast({
        title: 'تعذر صرف الراتب',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setPaying(false)
    }
  }, [payTarget, payMethod, payCCId, load, toast])

  const openEdit = useCallback((s: SalaryRow) => {
    setEditTarget(s)
    setEBonuses(String(s.bonuses))
    setEDeductions(String(s.deductions))
  }, [])

  // الصافي الحي أثناء تعديل المكافآت والخصومات
  const editNet = editTarget ? editTarget.base + (Number(eBonuses) || 0) - (Number(eDeductions) || 0) : 0

  const saveEdit = useCallback(async () => {
    if (!editTarget) return
    const bonuses = Number(eBonuses)
    const deductions = Number(eDeductions)
    if (!Number.isFinite(bonuses) || bonuses < 0 || !Number.isFinite(deductions) || deductions < 0) {
      toast({ title: 'قيم غير صالحة', description: 'أدخل مكافآت وخصومات صحيحة (صفر أو أكثر)', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/salaries/${editTarget.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bonuses, deductions }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر حفظ التعديلات')
      toast({ title: data?.message ?? 'تم حفظ التعديلات' })
      setEditTarget(null)
      await load()
    } catch (err) {
      toast({
        title: 'تعذر حفظ التعديلات',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }, [editTarget, eBonuses, eDeductions, load, toast])

  const doDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/salaries/${deleteTarget.id}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر الحذف')
      toast({ title: data?.message ?? 'تم حذف القسط' })
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

  const exportRows = useCallback(
    (): (string | number)[][] =>
      salaries.map((s) => [
        s.employee.name,
        s.employee.code,
        s.base,
        s.bonuses,
        s.deductions,
        s.net,
        AR_SALARY_STATUS[s.status] ?? s.status,
        s.paidAt ? s.paidAt.slice(0, 10) : '—',
      ]),
    [salaries],
  )

  return (
    <div className="space-y-4">
      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          title="صافي الكشف"
          value={fmtMoney(stats.totalNet)}
          hint={`≈ ${fmtUSD(stats.totalNet)}`}
          icon={Banknote}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="المصروف"
          value={fmtMoney(stats.paidTotal)}
          hint={`${fmtNumber(stats.paidCount)} قسط مصروف`}
          icon={CircleDollarSign}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="المعلّق"
          value={fmtMoney(stats.pendingTotal)}
          hint={`${fmtNumber(stats.pendingCount)} قسط معلق`}
          icon={Clock}
          tone="amber"
          loading={loading}
        />
        <KpiCard
          title="عدد الأقساط"
          value={fmtNumber(stats.count)}
          hint={`لشهر ${month}`}
          icon={ListChecks}
          tone="slate"
          loading={loading}
        />
      </div>

      {/* شريط الشهر والتوليد */}
      <SectionCard title="شهر الكشف" icon={CalendarDays} description="اختر الشهر ثم ولّد الكشف على أساس الرواتب الأساسية">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="sal-month">الشهر</Label>
            <Input
              id="sal-month"
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value)
                setPage(1)
              }}
              className="num h-9 w-44"
            />
          </div>
          {!isArchive && (
            <Button onClick={() => setGenOpen(true)} disabled={loading}>
              <CalendarPlus className="h-4 w-4" />
              توليد كشف الشهر
            </Button>
          )}
        </div>
      </SectionCard>

      {/* جدول الرواتب */}
      <SectionCard
        title={`كشف رواتب شهر ${month}`}
        description="الصرف للمعلق فقط — يُنشأ قيد محاسبي تلقائي لكل صرفية"
        icon={Banknote}
        action={
          <Badge variant="outline" className="num gap-1">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {fmtNumber(salaries.length)} قسط
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title={`كشف رواتب شهر ${month}`}
            filename={`salaries-${month}`}
            headers={['الموظف', 'كوده', 'الأساسي', 'المكافآت', 'الخصومات', 'الصافي', 'الحالة', 'تاريخ الصرف']}
            rowsLoader={exportRows}
            onBeforePrint={async () => {
              setPrintRows(salaries)
            }}
            onAfterPrint={() => setPrintRows(null)}
          />
          <div className="overflow-hidden rounded-lg border">
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>الموظف</TableHead>
                  <TableHead className="w-24">الشهر</TableHead>
                  <TableHead className="w-32">الأساسي</TableHead>
                  <TableHead className="w-32">المكافآت</TableHead>
                  <TableHead className="w-32">الخصومات</TableHead>
                  <TableHead className="w-36">الصافي</TableHead>
                  <TableHead className="w-28">الحالة</TableHead>
                  <TableHead className="w-28">تاريخ الصرف</TableHead>
                  <TableHead className="no-print w-36">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-14 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span className="text-sm">جارٍ التحميل…</span>
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
                          <p className="font-medium">لا توجد أقساط لهذا الشهر</p>
                          <p className="mt-1 text-xs">ولّد كشف الشهر لإنشاء قسط لكل موظف نشط</p>
                        </div>
                        {!isArchive && (
                          <Button size="sm" variant="outline" onClick={() => setGenOpen(true)}>
                            <CalendarPlus className="h-4 w-4" />
                            توليد كشف الشهر
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayRows.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{s.employee.name}</span>
                          <span className="num text-xs text-muted-foreground">{s.employee.code}</span>
                        </div>
                      </TableCell>
                      <TableCell className="num">{s.month}</TableCell>
                      <TableCell className="num whitespace-nowrap text-end">{fmtMoney(s.base)}</TableCell>
                      <TableCell className="num whitespace-nowrap text-end">{s.bonuses ? fmtMoney(s.bonuses) : '—'}</TableCell>
                      <TableCell className="num whitespace-nowrap text-end">{s.deductions ? fmtMoney(s.deductions) : '—'}</TableCell>
                      <TableCell className="num whitespace-nowrap text-end font-semibold">{fmtMoney(s.net)}</TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} label={AR_SALARY_STATUS[s.status] ?? s.status} />
                      </TableCell>
                      <TableCell className="num whitespace-nowrap">
                        {s.paidAt ? fmtDate(s.paidAt) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="no-print">
                        {s.status === 'PENDING' ? (
                          <div className="flex items-center gap-1">
                            {!isArchive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-emerald-600"
                                title="صرف الراتب"
                                aria-label={`صرف راتب ${s.employee.name}`}
                                onClick={() => openPay(s)}
                              >
                                <Banknote className="h-4 w-4" />
                              </Button>
                            )}
                            {!isArchive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-primary"
                                title="تعديل المكافآت والخصومات"
                                aria-label={`تعديل قسط ${s.employee.name}`}
                                onClick={() => openEdit(s)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {!isArchive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                                title="حذف القسط المعلق"
                                aria-label={`حذف قسط ${s.employee.name}`}
                                onClick={() => setDeleteTarget(s)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
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
                صفحة {fmtNumber(safePage)} من {fmtNumber(totalPages)} — {fmtNumber(salaries.length)} قسط
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

      {/* تأكيد توليد الكشف */}
      <AlertDialog open={genOpen} onOpenChange={setGenOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>توليد كشف رواتب {month}</AlertDialogTitle>
            <AlertDialogDescription>
              سيُنشأ قسط راتب لكل موظف نشط لشهر <span className="num font-medium">{month}</span> على أساس الراتب الأساسي.
              الموظفون الذين لهم كشف مسبق لهذا الشهر سيُتخطَّون.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={generating}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={generating}
              onClick={(e) => {
                e.preventDefault()
                void generate()
              }}
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              توليد
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* نافذة صرف الراتب */}
      <Dialog open={payTarget !== null} onOpenChange={(o) => !o && setPayTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>صرف راتب</DialogTitle>
            <DialogDescription>
              {payTarget ? (
                <>
                  {payTarget.employee.name} — الصافي {fmtMoney(payTarget.net)} لشهر{' '}
                  <span className="num">{payTarget.month}</span>
                </>
              ) : (
                ''
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label>طريقة الصرف</Label>
            <RadioGroup value={payMethod} onValueChange={(v) => setPayMethod(v as PayMethod)} className="gap-2">
              {(['CASH', 'BANK'] as const).map((m) => (
                <div
                  key={m}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3 transition-colors',
                    payMethod === m && 'border-primary/50 bg-primary/5',
                  )}
                >
                  <RadioGroupItem value={m} id={`sal-pay-${m}`} />
                  <Label htmlFor={`sal-pay-${m}`} className="flex-1 cursor-pointer font-normal">
                    {AR_METHOD[m]}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <div className="space-y-1.5">
              <Label>مركز التكلفة (اختياري)</Label>
              <Select
                value={payCCId || 'NONE'}
                onValueChange={(v) => setPayCCId(v === 'NONE' ? '' : v)}
                disabled={payCCLoading}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={payCCLoading ? 'جارٍ تحميل مراكز التكلفة…' : 'بلا مركز'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">بلا مركز</SelectItem>
                  {payCCOptions.length === 0 && !payCCLoading ? (
                    <SelectItem value="__empty" disabled>
                      لا توجد مراكز تكلفة نشطة
                    </SelectItem>
                  ) : (
                    payCCOptions.map((cc) => (
                      <SelectItem key={cc.id} value={cc.id}>
                        <span className="num text-xs text-muted-foreground">{cc.code}</span> — {cc.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              سيُنشأ قيد محاسبي تلقائي بعد الصرف — ويُنسب كاملاً لمركز التكلفة المختار إن وُجد
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)} disabled={paying}>
              إلغاء
            </Button>
            <Button onClick={() => void pay()} disabled={paying}>
              {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
              صرف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* نافذة تعديل القسط المعلق */}
      <Dialog open={editTarget !== null} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>تعديل قسط الراتب</DialogTitle>
            <DialogDescription>
              {editTarget ? (
                <>
                  {editTarget.employee.name} — لشهر <span className="num">{editTarget.month}</span>
                </>
              ) : (
                ''
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
              <span className="text-sm text-muted-foreground">الراتب الأساسي</span>
              <span className="num font-bold">{editTarget ? fmtMoney(editTarget.base) : '—'}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sal-bonuses">المكافآت (ل.س)</Label>
                <NumInput
                  id="sal-bonuses"
                  value={eBonuses}
                  onChange={(e) => setEBonuses(e.target.value)}
                  placeholder="0"
                  className="h-9 text-start"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sal-deductions">الخصومات (ل.س)</Label>
                <NumInput
                  id="sal-deductions"
                  value={eDeductions}
                  onChange={(e) => setEDeductions(e.target.value)}
                  placeholder="0"
                  className="h-9 text-start"
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 p-3">
              <span className="text-sm font-medium">الصافي بعد التعديل</span>
              <span className="num font-bold text-primary">{fmtMoney(editNet)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={saving}>
              إلغاء
            </Button>
            <Button onClick={() => void saveEdit()} disabled={saving}>
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
            <AlertDialogTitle>حذف قسط الراتب</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف القسط المعلق للموظف «{deleteTarget?.employee.name}» لشهر{' '}
              <span className="num">{deleteTarget?.month}</span>؟ لا يمكن التراجع — الأقساط المصروفة لا تُحذف.
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
    </div>
  )
}
