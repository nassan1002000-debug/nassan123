'use client'

// شاشة طلبات الإجازات — إنشاء طلب/موافقة/رفض (قيد الانتظار فقط)/حذف (قيد الانتظار فقط)
// KPIs من الخادم + بحث وحالة + تقسيم صفحي عميل + طباعة وتصدير إكسل لكل الصفوف المفلترة

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarCheck,
  CheckCircle2,
  Clock,
  FileText,
  Inbox,
  Loader2,
  Plus,
  Search,
  Trash2,
  XCircle,
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
import { AR_LEAVE_STATUS, AR_LEAVE_TYPE, fmtDate, fmtNumber, todayYMD } from '@/lib/format'
import { useIsArchive } from '@/lib/store'
import { fetchEmployeeOptions } from './hr-shared'
import type { EmployeeOption, LeaveRow, LeaveType, LeavesResponse, LeavesStats } from './hr-shared'

const PAGE_SIZE = 10

type LeaveStatusFilter = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'

const EMPTY_STATS: LeavesStats = { count: 0, pending: 0, approvedDays: 0, rejected: 0 }

const LEAVE_TYPES: LeaveType[] = ['ANNUAL', 'SICK', 'UNPAID', 'EMERGENCY']

export default function LeavesScreen() {
  const { toast } = useToast()
  // وضع استعراض أرشيف فترة مقفلة — يخفي أزرار الكتابة (الطلب/الموافقة/الرفض/الحذف)
  const isArchive = useIsArchive()

  const [leaves, setLeaves] = useState<LeaveRow[]>([])
  const [stats, setStats] = useState<LeavesStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<LeaveStatusFilter>('ALL')
  const [page, setPage] = useState(1)
  const [printRows, setPrintRows] = useState<LeaveRow[] | null>(null)

  // ===== نافذة طلب إجازة =====
  const [formOpen, setFormOpen] = useState(false)
  const [fEmployeeId, setFEmployeeId] = useState('')
  const [fType, setFType] = useState<LeaveType>('ANNUAL')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [fReason, setFReason] = useState('')
  const [empOptions, setEmpOptions] = useState<EmployeeOption[]>([])
  const [empLoading, setEmpLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // ===== موافقة/رفض — تعطيل زر الصف أثناء التنفيذ =====
  const [busyId, setBusyId] = useState<string | null>(null)

  // ===== حذف =====
  const [deleteTarget, setDeleteTarget] = useState<LeaveRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/leaves')
      const data = await res.json().catch(() => null)
      if (!res.ok || !data || !Array.isArray((data as LeavesResponse).leaves)) {
        throw new Error((data as { error?: string } | null)?.error ?? 'تعذر جلب الإجازات')
      }
      const payload = data as LeavesResponse
      setLeaves(payload.leaves)
      setStats(payload.stats)
    } catch (err) {
      toast({
        title: 'تعذر جلب الإجازات',
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
    return leaves.filter((l) => {
      if (statusFilter !== 'ALL' && l.status !== statusFilter) return false
      if (term && !l.employee.name.includes(term) && !l.employee.code.toLowerCase().includes(term.toLowerCase()))
        return false
      return true
    })
  }, [leaves, q, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  )

  // الصفوف المعروضة — كل الصفوف المفلترة عند الطباعة وإلا صفحة التقسيم الحالية
  const displayRows = printRows ?? pageRows

  // عدد الأيام المتوقع أثناء إدخال الطلب (شامل الطرفين)
  const formDays = useMemo(() => {
    if (!fFrom || !fTo) return null
    const diff = Math.floor((new Date(fTo).getTime() - new Date(fFrom).getTime()) / 86_400_000) + 1
    return diff > 0 ? diff : null
  }, [fFrom, fTo])

  // ===== الإجراءات =====
  const openNew = useCallback(async () => {
    setFEmployeeId('')
    setFType('ANNUAL')
    setFFrom(todayYMD())
    setFTo(todayYMD())
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
      toast({ title: 'الموظف مطلوب', description: 'اختر موظف الطلب', variant: 'destructive' })
      return
    }
    if (!fFrom || !fTo || !formDays) {
      toast({ title: 'تواريخ غير صالحة', description: 'تأكد أن تاريخ النهاية ليس قبل تاريخ البداية', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/leaves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: fEmployeeId,
          type: fType,
          from: fFrom,
          to: fTo,
          reason: fReason.trim() || undefined,
        }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر حفظ الطلب')
      toast({ title: data?.message ?? 'تم تقديم طلب الإجازة' })
      setFormOpen(false)
      await load()
    } catch (err) {
      toast({
        title: 'تعذر حفظ الطلب',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }, [fEmployeeId, fType, fFrom, fTo, fReason, formDays, load, toast])

  // موافقة أو رفض — للطلبات قيد الانتظار فقط
  const decide = useCallback(
    async (l: LeaveRow, status: 'APPROVED' | 'REJECTED') => {
      setBusyId(l.id)
      try {
        const res = await fetch(`/api/leaves/${l.id}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        })
        const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
        if (!res.ok) throw new Error(data?.error ?? 'تعذر تسجيل القرار')
        toast({
          title: data?.message ?? (status === 'APPROVED' ? 'تمت الموافقة على الطلب' : 'تم رفض الطلب'),
        })
        await load()
      } catch (err) {
        toast({
          title: 'تعذر تسجيل القرار',
          description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
      } finally {
        setBusyId(null)
      }
    },
    [load, toast],
  )

  const doDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/leaves/${deleteTarget.id}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر الحذف')
      toast({ title: data?.message ?? 'تم حذف الطلب' })
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
      filtered.map((l) => [
        l.employee.name,
        l.employee.code,
        AR_LEAVE_TYPE[l.type] ?? l.type,
        l.from.slice(0, 10),
        l.to.slice(0, 10),
        l.days,
        l.reason ?? '—',
        AR_LEAVE_STATUS[l.status] ?? l.status,
      ]),
    [filtered],
  )

  return (
    <div className="space-y-4">
      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="الطلبات" value={fmtNumber(stats.count)} icon={FileText} tone="gold" loading={loading} />
        <KpiCard
          title="قيد الانتظار"
          value={fmtNumber(stats.pending)}
          hint="بانتظار القرار"
          icon={Clock}
          tone="amber"
          loading={loading}
        />
        <KpiCard
          title="أيام مقبولة"
          value={fmtNumber(stats.approvedDays)}
          hint={`من ${fmtNumber(stats.count)} طلب`}
          icon={CalendarCheck}
          tone="emerald"
          loading={loading}
        />
        <KpiCard title="مرفوضة" value={fmtNumber(stats.rejected)} icon={XCircle} tone="rose" loading={loading} />
      </div>

      {/* الفلاتر */}
      <SectionCard title="بحث وفلترة" icon={Search}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="lv-q">بحث</Label>
            <Input
              id="lv-q"
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
                setStatusFilter(v as LeaveStatusFilter)
                setPage(1)
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">الكل</SelectItem>
                <SelectItem value="PENDING">قيد الانتظار</SelectItem>
                <SelectItem value="APPROVED">مقبولة</SelectItem>
                <SelectItem value="REJECTED">مرفوضة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end sm:col-span-2 lg:justify-end">
            {!isArchive && (
              <Button onClick={() => void openNew()}>
                <Plus className="h-4 w-4" />
                طلب إجازة
              </Button>
            )}
          </div>
        </div>
      </SectionCard>

      {/* جدول الإجازات */}
      <SectionCard
        title="طلبات الإجازات"
        description="الموافقة والرفض والحذف متاحة للطلبات قيد الانتظار فقط"
        icon={CalendarCheck}
        action={
          <Badge variant="outline" className="num gap-1">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {fmtNumber(filtered.length)} نتيجة
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title="طلبات الإجازات"
            filename="leaves"
            headers={['الموظف', 'كوده', 'النوع', 'من', 'إلى', 'الأيام', 'السبب', 'الحالة']}
            rowsLoader={exportRows}
            onBeforePrint={async () => {
              setPrintRows(filtered)
            }}
            onAfterPrint={() => setPrintRows(null)}
          />
          <div className="overflow-hidden rounded-lg border">
            <Table className="min-w-[880px]">
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>الموظف</TableHead>
                  <TableHead className="w-24">النوع</TableHead>
                  <TableHead className="w-28">من</TableHead>
                  <TableHead className="w-28">إلى</TableHead>
                  <TableHead className="w-16 text-center">الأيام</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead className="w-28">الحالة</TableHead>
                  <TableHead className="no-print w-36">إجراءات</TableHead>
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
                          <p className="font-medium">لا توجد طلبات إجازة</p>
                          <p className="mt-1 text-xs">قدّم أول طلب إجازة لموظف نشط</p>
                        </div>
                        {!isArchive && (
                          <Button size="sm" variant="outline" onClick={() => void openNew()}>
                            <Plus className="h-4 w-4" />
                            طلب إجازة
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayRows.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{l.employee.name}</span>
                          <span className="num text-xs text-muted-foreground">{l.employee.code}</span>
                        </div>
                      </TableCell>
                      <TableCell>{AR_LEAVE_TYPE[l.type] ?? l.type}</TableCell>
                      <TableCell className="num whitespace-nowrap">{fmtDate(l.from)}</TableCell>
                      <TableCell className="num whitespace-nowrap">{fmtDate(l.to)}</TableCell>
                      <TableCell className="num text-center font-semibold">{fmtNumber(l.days)}</TableCell>
                      <TableCell className="max-w-56 truncate" title={l.reason ?? undefined}>
                        {l.reason ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={l.status} label={AR_LEAVE_STATUS[l.status] ?? l.status} />
                      </TableCell>
                      <TableCell className="no-print">
                        {l.status === 'PENDING' ? (
                          <div className="flex items-center gap-1">
                            {!isArchive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-emerald-600"
                                title="موافقة"
                                aria-label={`موافقة على طلب ${l.employee.name}`}
                                disabled={busyId === l.id}
                                onClick={() => void decide(l, 'APPROVED')}
                              >
                                {busyId === l.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                            {!isArchive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                                title="رفض"
                                aria-label={`رفض طلب ${l.employee.name}`}
                                disabled={busyId === l.id}
                                onClick={() => void decide(l, 'REJECTED')}
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            )}
                            {!isArchive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                                title="حذف الطلب"
                                aria-label={`حذف طلب ${l.employee.name}`}
                                disabled={busyId === l.id}
                                onClick={() => setDeleteTarget(l)}
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
                صفحة {fmtNumber(safePage)} من {fmtNumber(totalPages)} — {fmtNumber(filtered.length)} طلب
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

      {/* نافذة طلب إجازة */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>طلب إجازة</DialogTitle>
            <DialogDescription>تقديم طلب إجازة لموظف نشط — يبقى بانتظار القرار</DialogDescription>
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
            <div className="space-y-1.5">
              <Label>النوع *</Label>
              <Select value={fType} onValueChange={(v) => setFType(v as LeaveType)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {AR_LEAVE_TYPE[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="lv-from">من *</Label>
                <Input
                  id="lv-from"
                  type="date"
                  value={fFrom}
                  onChange={(e) => setFFrom(e.target.value)}
                  className="num h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lv-to">إلى *</Label>
                <Input
                  id="lv-to"
                  type="date"
                  value={fTo}
                  onChange={(e) => setFTo(e.target.value)}
                  className="num h-9"
                />
              </div>
            </div>
            {formDays ? (
              <p className="text-xs text-muted-foreground">
                عدد الأيام (شاملة الطرفين): <span className="num font-medium">{fmtNumber(formDays)}</span>
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="lv-reason">السبب</Label>
              <Input
                id="lv-reason"
                value={fReason}
                onChange={(e) => setFReason(e.target.value)}
                placeholder="سبب الإجازة…"
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
            <AlertDialogTitle>حذف طلب الإجازة</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف طلب إجازة الموظف «{deleteTarget?.employee.name}»؟ لا يمكن التراجع —
              الطلبات المقضي بها (مقبولة/مرفوضة) لا تُحذف.
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
