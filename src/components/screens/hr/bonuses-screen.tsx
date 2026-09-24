'use client'

// شاشة المكافآت والحسم — إضافة سجل مكافأة أو حسم لموظف/حذف
// KPIs من الخادم + بحث ونوع + تقسيم صفحي عميل + طباعة وتصدير إكسل لكل الصفوف المفلترة

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Gift,
  Inbox,
  Loader2,
  MinusCircle,
  Plus,
  Scale,
  ScrollText,
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
import { fmtDate, fmtMoney, fmtNumber, fmtUSD, todayYMD } from '@/lib/format'
import { useIsArchive } from '@/lib/store'
import { AR_BONUS_TYPE, fetchEmployeeOptions } from './hr-shared'
import type {
  BonusRow,
  BonusesResponse,
  BonusesStats,
  BonusType,
  EmployeeOption,
} from './hr-shared'

const PAGE_SIZE = 10

type BonusTypeFilter = 'ALL' | 'BONUS' | 'DEDUCTION'

const EMPTY_STATS: BonusesStats = { bonusTotal: 0, deductionTotal: 0, count: 0 }

export default function BonusesScreen() {
  const { toast } = useToast()
  // وضع استعراض أرشيف فترة مقفلة — يخفي أزرار الكتابة (الإضافة/الحذف)
  const isArchive = useIsArchive()

  const [records, setRecords] = useState<BonusRow[]>([])
  const [stats, setStats] = useState<BonusesStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState<BonusTypeFilter>('ALL')
  const [page, setPage] = useState(1)
  const [printRows, setPrintRows] = useState<BonusRow[] | null>(null)

  // ===== نافذة سجل جديد =====
  const [formOpen, setFormOpen] = useState(false)
  const [fEmployeeId, setFEmployeeId] = useState('')
  const [fType, setFType] = useState<BonusType>('BONUS')
  const [fDate, setFDate] = useState('')
  const [fAmount, setFAmount] = useState('')
  const [fReason, setFReason] = useState('')
  const [empOptions, setEmpOptions] = useState<EmployeeOption[]>([])
  const [empLoading, setEmpLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // ===== حذف =====
  const [deleteTarget, setDeleteTarget] = useState<BonusRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/bonuses')
      const data = await res.json().catch(() => null)
      if (!res.ok || !data || !Array.isArray((data as BonusesResponse).records)) {
        throw new Error((data as { error?: string } | null)?.error ?? 'تعذر جلب سجلات المكافآت والحسم')
      }
      const payload = data as BonusesResponse
      setRecords(payload.records)
      setStats(payload.stats)
    } catch (err) {
      toast({
        title: 'تعذر جلب سجلات المكافآت والحسم',
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

  // ===== الفلترة محلياً — بالنوع وباسم الموظف أو كوده =====
  const filtered = useMemo(() => {
    const term = q.trim()
    return records.filter((r) => {
      if (typeFilter !== 'ALL' && r.type !== typeFilter) return false
      if (term && !r.employee.name.includes(term) && !r.employee.code.toLowerCase().includes(term.toLowerCase()))
        return false
      return true
    })
  }, [records, q, typeFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  )

  // الصفوف المعروضة — كل الصفوف المفلترة عند الطباعة وإلا صفحة التقسيم الحالية
  const displayRows = printRows ?? pageRows

  // الصافي — المكافآت ناقص الحسم
  const net = stats.bonusTotal - stats.deductionTotal

  // ===== الإجراءات =====
  const openNew = useCallback(async () => {
    setFEmployeeId('')
    setFType('BONUS')
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
      toast({ title: 'الموظف مطلوب', description: 'اختر موظف السجل', variant: 'destructive' })
      return
    }
    const amount = Number(fAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: 'المبلغ غير صالح', description: 'أدخل مبلغاً أكبر من صفر', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/bonuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: fEmployeeId,
          type: fType,
          date: fDate || undefined,
          amount,
          reason: fReason.trim() || undefined,
        }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر حفظ السجل')
      toast({ title: data?.message ?? (fType === 'BONUS' ? 'تم تسجيل المكافأة' : 'تم تسجيل الحسم') })
      setFormOpen(false)
      await load()
    } catch (err) {
      toast({
        title: 'تعذر حفظ السجل',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }, [fEmployeeId, fType, fDate, fAmount, fReason, load, toast])

  const doDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/bonuses/${deleteTarget.id}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر الحذف')
      toast({ title: data?.message ?? 'تم حذف السجل' })
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
      filtered.map((r) => [
        r.employee.name,
        r.employee.code,
        AR_BONUS_TYPE[r.type] ?? r.type,
        r.date.slice(0, 10),
        r.amount,
        r.reason ?? '—',
      ]),
    [filtered],
  )

  return (
    <div className="space-y-4">
      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          title="إجمالي المكافآت"
          value={fmtMoney(stats.bonusTotal)}
          hint={`≈ ${fmtUSD(stats.bonusTotal)}`}
          icon={Gift}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="إجمالي الحسم"
          value={fmtMoney(stats.deductionTotal)}
          hint={`≈ ${fmtUSD(stats.deductionTotal)}`}
          icon={MinusCircle}
          tone="rose"
          loading={loading}
        />
        <KpiCard title="عدد السجلات" value={fmtNumber(stats.count)} icon={ScrollText} tone="slate" loading={loading} />
        <KpiCard
          title="الصافي"
          value={fmtMoney(net)}
          hint={`≈ ${fmtUSD(net)}`}
          icon={Scale}
          tone="gold"
          loading={loading}
        />
      </div>

      {/* الفلاتر */}
      <SectionCard title="بحث وفلترة" icon={Search}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="bon-q">بحث</Label>
            <Input
              id="bon-q"
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
            <Label>النوع</Label>
            <Select
              value={typeFilter}
              onValueChange={(v) => {
                setTypeFilter(v as BonusTypeFilter)
                setPage(1)
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">الكل</SelectItem>
                <SelectItem value="BONUS">مكافآت</SelectItem>
                <SelectItem value="DEDUCTION">حسم</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end sm:col-span-2 lg:justify-end">
            {!isArchive && (
              <Button onClick={() => void openNew()}>
                <Plus className="h-4 w-4" />
                إضافة سجل
              </Button>
            )}
          </div>
        </div>
      </SectionCard>

      {/* جدول المكافآت والحسم */}
      <SectionCard
        title="سجلات المكافآت والحسم"
        description="تُراعى عند تعديل أقساط الرواتب المعلقة — الحذف متاح دائماً"
        icon={Gift}
        action={
          <Badge variant="outline" className="num gap-1">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {fmtNumber(filtered.length)} نتيجة
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title="سجلات المكافآت والحسم"
            filename="bonuses"
            headers={['الموظف', 'كوده', 'النوع', 'التاريخ', 'المبلغ', 'السبب']}
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
                  <TableHead className="w-24">النوع</TableHead>
                  <TableHead className="w-28">التاريخ</TableHead>
                  <TableHead className="w-36">المبلغ</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead className="no-print w-16">إجراءات</TableHead>
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
                          <p className="font-medium">لا توجد سجلات</p>
                          <p className="mt-1 text-xs">أضف أول سجل مكافأة أو حسم</p>
                        </div>
                        {!isArchive && (
                          <Button size="sm" variant="outline" onClick={() => void openNew()}>
                            <Plus className="h-4 w-4" />
                            إضافة سجل
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{r.employee.name}</span>
                          <span className="num text-xs text-muted-foreground">{r.employee.code}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={r.type === 'BONUS'
                          ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                          : 'border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-400'}>
                          {AR_BONUS_TYPE[r.type] ?? r.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="num whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                      <TableCell className="num whitespace-nowrap text-end">{fmtMoney(r.amount)}</TableCell>
                      <TableCell className="max-w-56 truncate" title={r.reason ?? undefined}>
                        {r.reason ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="no-print">
                        {!isArchive && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                            title="حذف السجل"
                            aria-label={`حذف سجل ${r.employee.name}`}
                            onClick={() => setDeleteTarget(r)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
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
                صفحة {fmtNumber(safePage)} من {fmtNumber(totalPages)} — {fmtNumber(filtered.length)} سجل
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

      {/* نافذة سجل جديد */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>سجل مكافأة أو حسم</DialogTitle>
            <DialogDescription>يُضاف للموظف ويُراعى عند تعديل قسط راتبه المعلق</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
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
            <div className="space-y-1.5">
              <Label>النوع *</Label>
              <Select value={fType} onValueChange={(v) => setFType(v as BonusType)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BONUS">مكافأة</SelectItem>
                  <SelectItem value="DEDUCTION">حسم</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bon-date">التاريخ</Label>
              <Input
                id="bon-date"
                type="date"
                value={fDate}
                onChange={(e) => setFDate(e.target.value)}
                className="num h-9"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="bon-amount">المبلغ (ل.س) *</Label>
              <NumInput
                id="bon-amount"
                value={fAmount}
                onChange={(e) => setFAmount(e.target.value)}
                placeholder="0.00"
                className="h-9 text-start"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="bon-reason">السبب</Label>
              <Input
                id="bon-reason"
                value={fReason}
                onChange={(e) => setFReason(e.target.value)}
                placeholder={fType === 'BONUS' ? 'مثال: مكافأة إنجاز مشروع' : 'مثال: تأخير متكرر'}
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

      {/* تأكيد الحذف */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف السجل</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف سجل «{deleteTarget ? AR_BONUS_TYPE[deleteTarget.type] : ''}» للموظف «
              {deleteTarget?.employee.name}» بمبلغ {deleteTarget ? fmtMoney(deleteTarget.amount) : ''}؟
              لا يمكن التراجع عن الحذف.
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
