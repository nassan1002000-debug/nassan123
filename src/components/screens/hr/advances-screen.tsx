'use client'

// شاشة سلف الموظفين — تسجيل سلفة/صرف نقدي أو بنكي/حذف (لغير المسددة فقط)
// KPIs من الخادم + بحث وحالة + تقسيم صفحي عميل + طباعة وتصدير إكسل لكل الصفوف المفلترة

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Banknote,
  CircleDollarSign,
  HandCoins,
  Hourglass,
  Inbox,
  Loader2,
  Plus,
  Scale,
  Search,
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
import { fetchEmployeeOptions } from './hr-shared'
import type {
  AdvanceRow,
  AdvancesResponse,
  AdvancesStats,
  EmployeeOption,
  PayMethod,
} from './hr-shared'

const PAGE_SIZE = 10

/** خيار مركز التكلفة للقائمة المنسدلة — من GET /api/cost-centers (الوضع المختصر: النشطة فقط) */
interface CostCenterOption {
  id: string
  code: string
  name: string
}

type AdvanceStatusFilter = 'ALL' | 'UNPAID' | 'PAID'

const EMPTY_STATS: AdvancesStats = { count: 0, unpaidCount: 0, unpaidTotal: 0, paidTotal: 0 }

export default function AdvancesScreen() {
  const { toast } = useToast()
  // وضع استعراض أرشيف فترة مقفلة — يخفي أزرار الكتابة (الإضافة/الصرف/الحذف)
  const isArchive = useIsArchive()

  const [advances, setAdvances] = useState<AdvanceRow[]>([])
  const [stats, setStats] = useState<AdvancesStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<AdvanceStatusFilter>('ALL')
  const [page, setPage] = useState(1)
  const [printRows, setPrintRows] = useState<AdvanceRow[] | null>(null)

  // ===== نافذة سلفة جديدة =====
  const [formOpen, setFormOpen] = useState(false)
  const [fEmployeeId, setFEmployeeId] = useState('')
  const [fDate, setFDate] = useState('')
  const [fAmount, setFAmount] = useState('')
  const [fReason, setFReason] = useState('')
  const [empOptions, setEmpOptions] = useState<EmployeeOption[]>([])
  const [empLoading, setEmpLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // ===== صرف سلفة =====
  const [payTarget, setPayTarget] = useState<AdvanceRow | null>(null)
  const [payMethod, setPayMethod] = useState<PayMethod>('CASH')
  const [payCCId, setPayCCId] = useState('')
  const [payCCOptions, setPayCCOptions] = useState<CostCenterOption[]>([])
  const [payCCLoading, setPayCCLoading] = useState(false)
  const [paying, setPaying] = useState(false)

  // ===== حذف =====
  const [deleteTarget, setDeleteTarget] = useState<AdvanceRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/advances')
      const data = await res.json().catch(() => null)
      if (!res.ok || !data || !Array.isArray((data as AdvancesResponse).advances)) {
        throw new Error((data as { error?: string } | null)?.error ?? 'تعذر جلب السلف')
      }
      const payload = data as AdvancesResponse
      setAdvances(payload.advances)
      setStats(payload.stats)
    } catch (err) {
      toast({
        title: 'تعذر جلب السلف',
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

  // ===== الفلترة محلياً — بالحالة وباسم الموظف أو كوده =====
  const filtered = useMemo(() => {
    const term = q.trim()
    return advances.filter((a) => {
      if (statusFilter === 'UNPAID' && a.status !== 'UNPAID') return false
      if (statusFilter === 'PAID' && a.status !== 'PAID') return false
      if (term && !a.employee.name.includes(term) && !a.employee.code.toLowerCase().includes(term.toLowerCase()))
        return false
      return true
    })
  }, [advances, q, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  )

  // الصفوف المعروضة — كل الصفوف المفلترة عند الطباعة وإلا صفحة التقسيم الحالية
  const displayRows = printRows ?? pageRows

  // متوسط السلفة — إجمالي السلف مقسوماً على عددها
  const avgAmount = stats.count > 0 ? (stats.unpaidTotal + stats.paidTotal) / stats.count : 0

  // ===== الإجراءات =====
  const openNew = useCallback(async () => {
    setFEmployeeId('')
    setFDate(todayYMD())
    setFAmount('')
    setFReason('')
    setFormOpen(true)
    setEmpLoading(true)
    try {
      setEmpOptions(await fetchEmployeeOptions())
    } catch (err) {
      setFormOpen(false)
      toast({
        title: 'تعذر جلب قائمة الموظفين',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setEmpLoading(false)
    }
  }, [toast])

  const save = useCallback(async () => {
    if (!fEmployeeId) {
      toast({ title: 'الموظف مطلوب', description: 'اختر الموظف صاحب السلفة', variant: 'destructive' })
      return
    }
    const amount = Number(fAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: 'المبلغ غير صالح', description: 'أدخل مبلغاً أكبر من صفر', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: fEmployeeId,
          date: fDate || undefined,
          amount,
          reason: fReason.trim() || undefined,
        }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر حفظ السلفة')
      toast({ title: data?.message ?? 'تم تسجيل السلفة' })
      setFormOpen(false)
      await load()
    } catch (err) {
      toast({
        title: 'تعذر حفظ السلفة',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }, [fEmployeeId, fDate, fAmount, fReason, load, toast])

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
    (a: AdvanceRow) => {
      setPayMethod('CASH')
      setPayCCId('')
      setPayCCOptions([])
      setPayTarget(a)
      void loadPayCCOptions()
    },
    [loadPayCCOptions],
  )

  const pay = useCallback(async () => {
    if (!payTarget) return
    setPaying(true)
    try {
      const res = await fetch(`/api/advances/${payTarget.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: payMethod, costCenterId: payCCId || undefined }),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; message?: string; entryNumber?: string | null }
        | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر صرف السلفة')
      toast({
        title: data?.message ?? 'تم صرف السلفة',
        description: data?.entryNumber ? `أُنشئ القيد ${data.entryNumber} في دفتر اليومية` : undefined,
      })
      setPayTarget(null)
      await load()
    } catch (err) {
      toast({
        title: 'تعذر صرف السلفة',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setPaying(false)
    }
  }, [payTarget, payMethod, payCCId, load, toast])

  const doDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/advances/${deleteTarget.id}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر الحذف')
      toast({ title: data?.message ?? 'تم حذف السلفة' })
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
      filtered.map((a) => [
        a.employee.name,
        a.employee.code,
        a.date.slice(0, 10),
        a.amount,
        a.reason ?? '—',
        a.status === 'UNPAID' ? 'غير مسددة' : 'مسددة',
      ]),
    [filtered],
  )

  return (
    <div className="space-y-4">
      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          title="عدد السلف"
          value={fmtNumber(stats.count)}
          hint={`${fmtNumber(stats.unpaidCount)} غير مسددة`}
          icon={HandCoins}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="سلف غير مسددة"
          value={fmtMoney(stats.unpaidTotal)}
          hint={`≈ ${fmtUSD(stats.unpaidTotal)}`}
          icon={Hourglass}
          tone="rose"
          loading={loading}
        />
        <KpiCard
          title="سلف مسددة"
          value={fmtMoney(stats.paidTotal)}
          hint={`≈ ${fmtUSD(stats.paidTotal)}`}
          icon={CircleDollarSign}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="متوسط السلفة"
          value={fmtMoney(avgAmount)}
          hint={`≈ ${fmtUSD(avgAmount)}`}
          icon={Scale}
          tone="amber"
          loading={loading}
        />
      </div>

      {/* الفلاتر */}
      <SectionCard title="بحث وفلترة" icon={Search}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="adv-q">بحث</Label>
            <Input
              id="adv-q"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
              placeholder="اسم الموظف أو كوده…"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label>الحالة</Label>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as AdvanceStatusFilter)
                setPage(1)
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">الكل</SelectItem>
                <SelectItem value="UNPAID">غير مسددة</SelectItem>
                <SelectItem value="PAID">مسددة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end sm:col-span-2 lg:justify-end">
            {!isArchive && (
              <Button onClick={() => void openNew()}>
                <Plus className="h-4 w-4" />
                سلفة جديدة
              </Button>
            )}
          </div>
        </div>
      </SectionCard>

      {/* جدول السلف */}
      <SectionCard
        title="قائمة السلف"
        description="سلف الموظفين — الصرف والحذف متاحان للسلف غير المسددة فقط"
        icon={HandCoins}
        action={
          <Badge variant="outline" className="num gap-1">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {fmtNumber(filtered.length)} نتيجة
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title="سلف الموظفين"
            filename="advances"
            headers={['الموظف', 'كوده', 'التاريخ', 'المبلغ', 'السبب', 'الحالة']}
            rowsLoader={exportRows}
            onBeforePrint={async () => {
              setPrintRows(filtered)
            }}
            onAfterPrint={() => setPrintRows(null)}
          />
          <div className="overflow-hidden rounded-lg border">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>الموظف</TableHead>
                  <TableHead className="w-28">التاريخ</TableHead>
                  <TableHead className="w-36">المبلغ</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead className="w-28">الحالة</TableHead>
                  <TableHead className="no-print w-28">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-14 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span className="text-sm">جارٍ التحميل…</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : displayRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-14 text-center">
                      <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        <div className="rounded-full bg-muted p-4">
                          <Inbox className="h-8 w-8" />
                        </div>
                        <div>
                          <p className="font-medium">لا توجد سلف</p>
                          <p className="mt-1 text-xs">سجّل أول سلفة لموظف نشط</p>
                        </div>
                        {!isArchive && (
                          <Button size="sm" variant="outline" onClick={() => void openNew()}>
                            <Plus className="h-4 w-4" />
                            سلفة جديدة
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayRows.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{a.employee.name}</span>
                          <span className="num text-xs text-muted-foreground">{a.employee.code}</span>
                        </div>
                      </TableCell>
                      <TableCell className="num whitespace-nowrap">{fmtDate(a.date)}</TableCell>
                      <TableCell className="num whitespace-nowrap text-end">{fmtMoney(a.amount)}</TableCell>
                      <TableCell className="max-w-56 truncate" title={a.reason ?? undefined}>
                        {a.reason ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={a.status}
                          label={a.status === 'UNPAID' ? 'غير مسددة' : 'مسددة'}
                        />
                      </TableCell>
                      <TableCell className="no-print">
                        {a.status === 'UNPAID' ? (
                          <div className="flex items-center gap-1">
                            {!isArchive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-emerald-600"
                                title="صرف السلفة"
                                aria-label={`صرف سلفة ${a.employee.name}`}
                                onClick={() => openPay(a)}
                              >
                                <Banknote className="h-4 w-4" />
                              </Button>
                            )}
                            {!isArchive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                                title="حذف السلفة"
                                aria-label={`حذف سلفة ${a.employee.name}`}
                                onClick={() => setDeleteTarget(a)}
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
                صفحة {fmtNumber(safePage)} من {fmtNumber(totalPages)} — {fmtNumber(filtered.length)} سلفة
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

      {/* نافذة سلفة جديدة */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>سلفة جديدة</DialogTitle>
            <DialogDescription>تسجيل سلفة لموظف نشط — تُصرف لاحقاً نقدياً أو بنكياً</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>الموظف *</Label>
              <Select value={fEmployeeId} onValueChange={setFEmployeeId} disabled={empLoading}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={empLoading ? 'جارٍ تحميل الموظفين…' : 'اختر الموظف…'} />
                </SelectTrigger>
                <SelectContent>
                  {empOptions.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      لا يوجد موظفون نشطون
                    </SelectItem>
                  ) : (
                    empOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name} <span className="num text-xs text-muted-foreground">({o.code})</span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="adv-date">التاريخ</Label>
                <Input
                  id="adv-date"
                  type="date"
                  value={fDate}
                  onChange={(e) => setFDate(e.target.value)}
                  className="num h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adv-amount">المبلغ (ل.س) *</Label>
                <NumInput
                  id="adv-amount"
                  value={fAmount}
                  onChange={(e) => setFAmount(e.target.value)}
                  placeholder="0.00"
                  className="h-9 text-start"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adv-reason">السبب</Label>
              <Input
                id="adv-reason"
                value={fReason}
                onChange={(e) => setFReason(e.target.value)}
                placeholder="مثال: ظرف عائلي"
                className="h-9"
              />
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

      {/* نافذة صرف السلفة */}
      <Dialog open={payTarget !== null} onOpenChange={(o) => !o && setPayTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>صرف سلفة</DialogTitle>
            <DialogDescription>
              {payTarget ? `${payTarget.employee.name} — بمبلغ ${fmtMoney(payTarget.amount)}` : ''}
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
                  <RadioGroupItem value={m} id={`adv-pay-${m}`} />
                  <Label htmlFor={`adv-pay-${m}`} className="flex-1 cursor-pointer font-normal">
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

      {/* تأكيد الحذف */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف السلفة</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف سلفة الموظف «{deleteTarget?.employee.name}» بمبلغ{' '}
              {deleteTarget ? fmtMoney(deleteTarget.amount) : ''}؟ لا يمكن التراجع — السلف المسددة لا تُحذف.
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
