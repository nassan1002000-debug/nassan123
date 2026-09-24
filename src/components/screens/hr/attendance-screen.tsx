'use client'

// شاشة سجل الدوام — تسجيل حضور يوم محدد (إنشاء/تعديل عبر upsert على الموظف+التاريخ)/حذف
// KPIs من الخادم (حاضر/غائب/متأخر/إجازة) + تقسيم صفحي عميل + طباعة وتصدير إكسل لكل الصفوف

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Clock,
  Inbox,
  Loader2,
  Pencil,
  Plane,
  Plus,
  Trash2,
  UserCheck,
  UserX,
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
import { AR_ATTENDANCE_STATUS, fmtDate, fmtNumber, todayYMD } from '@/lib/format'
import { useIsArchive } from '@/lib/store'
import { fetchEmployeeOptions } from './hr-shared'
import type {
  AttendanceResponse,
  AttendanceRow,
  AttendanceStats,
  AttendanceStatus,
  EmployeeOption,
} from './hr-shared'

const PAGE_SIZE = 10

const EMPTY_STATS: AttendanceStats = { present: 0, absent: 0, late: 0, leave: 0, total: 0 }

const STATUSES: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE']

export default function AttendanceScreen() {
  const { toast } = useToast()
  // وضع استعراض أرشيف فترة مقفلة — يخفي أزرار الكتابة (التسجيل/التعديل/الحذف)
  const isArchive = useIsArchive()

  const [date, setDate] = useState(() => todayYMD())
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [stats, setStats] = useState<AttendanceStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [printRows, setPrintRows] = useState<AttendanceRow[] | null>(null)

  // ===== نافذة التسجيل (إنشاء/تعديل — POST يعمل upsert على الموظف+التاريخ) =====
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [fEmployeeId, setFEmployeeId] = useState('')
  const [fDate, setFDate] = useState('')
  const [fStatus, setFStatus] = useState<AttendanceStatus>('PRESENT')
  const [fCheckIn, setFCheckIn] = useState('')
  const [fCheckOut, setFCheckOut] = useState('')
  const [empOptions, setEmpOptions] = useState<EmployeeOption[]>([])
  const [empLoading, setEmpLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // ===== حذف =====
  const [deleteTarget, setDeleteTarget] = useState<AttendanceRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/attendance?date=${encodeURIComponent(date)}`)
      const data = await res.json().catch(() => null)
      if (!res.ok || !data || !Array.isArray((data as AttendanceResponse).attendance)) {
        throw new Error((data as { error?: string } | null)?.error ?? 'تعذر جلب سجل الدوام')
      }
      const payload = data as AttendanceResponse
      setRows(payload.attendance)
      setStats(payload.stats)
    } catch (err) {
      toast({
        title: 'تعذر جلب سجل الدوام',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [date, toast])

  useEffect(() => {
    void load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [rows, safePage],
  )

  // الصفوف المعروضة — كل صفوف اليوم عند الطباعة وإلا صفحة التقسيم الحالية
  const displayRows = printRows ?? pageRows

  // ===== الإجراءات =====
  const openNew = useCallback(async () => {
    setEditId(null)
    setFEmployeeId('')
    setFDate(date)
    setFStatus('PRESENT')
    setFCheckIn('')
    setFCheckOut('')
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
  }, [date, toast])

  const openEdit = useCallback(
    async (a: AttendanceRow) => {
      setEditId(a.id)
      setFEmployeeId(a.employee.id)
      setFDate(a.date.slice(0, 10))
      setFStatus(a.status)
      setFCheckIn(a.checkIn ?? '')
      setFCheckOut(a.checkOut ?? '')
      setFormOpen(true)
      setEmpLoading(true)
      try {
        const opts = await fetchEmployeeOptions()
        // ضمان ظهور موظف السجل في القائمة حتى لو كان موقوفاً حالياً
        if (!opts.some((o) => o.id === a.employee.id)) {
          opts.unshift({ id: a.employee.id, code: a.employee.code, name: a.employee.name })
        }
        setEmpOptions(opts)
      } catch {
        // عند الفشل نكتفي بموظف السجل نفسه — الحقول معطلة في وضع التعديل على أي حال
        setEmpOptions([{ id: a.employee.id, code: a.employee.code, name: a.employee.name }])
      } finally {
        setEmpLoading(false)
      }
    },
    [],
  )

  const save = useCallback(async () => {
    if (!editId && !fEmployeeId) {
      toast({ title: 'الموظف مطلوب', description: 'اختر موظف السجل', variant: 'destructive' })
      return
    }
    if (!fDate) {
      toast({ title: 'التاريخ مطلوب', description: 'حدد تاريخ سجل الدوام', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: fEmployeeId,
          date: fDate,
          status: fStatus,
          checkIn: fCheckIn || undefined,
          checkOut: fCheckOut || undefined,
        }),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; created?: boolean; error?: string; message?: string }
        | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر حفظ السجل')
      toast({ title: data?.message ?? (data?.created ? 'تم تسجيل الدوام' : 'تم تحديث السجل') })
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
  }, [editId, fEmployeeId, fDate, fStatus, fCheckIn, fCheckOut, load, toast])

  const doDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/attendance/${deleteTarget.id}`, { method: 'DELETE' })
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
      rows.map((a) => [
        a.employee.name,
        a.employee.code,
        a.employee.position,
        AR_ATTENDANCE_STATUS[a.status] ?? a.status,
        a.checkIn ?? '—',
        a.checkOut ?? '—',
      ]),
    [rows],
  )

  return (
    <div className="space-y-4">
      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          title="حاضر"
          value={fmtNumber(stats.present)}
          hint={`من ${fmtNumber(stats.total)} سجل`}
          icon={UserCheck}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="غائب"
          value={fmtNumber(stats.absent)}
          hint={`من ${fmtNumber(stats.total)} سجل`}
          icon={UserX}
          tone="rose"
          loading={loading}
        />
        <KpiCard
          title="متأخر"
          value={fmtNumber(stats.late)}
          hint={`من ${fmtNumber(stats.total)} سجل`}
          icon={Clock}
          tone="amber"
          loading={loading}
        />
        <KpiCard
          title="إجازة"
          value={fmtNumber(stats.leave)}
          hint={`من ${fmtNumber(stats.total)} سجل`}
          icon={Plane}
          tone="slate"
          loading={loading}
        />
      </div>

      {/* شريط اليوم والتسجيل */}
      <SectionCard title="يوم الدوام" icon={CalendarDays} description="اختر التاريخ لعرض سجل ذلك اليوم وتسجيل الحضور">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="att-date">التاريخ</Label>
            <Input
              id="att-date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                setPage(1)
              }}
              className="num h-9 w-44"
            />
          </div>
          {!isArchive && (
            <Button onClick={() => void openNew()}>
              <Plus className="h-4 w-4" />
              تسجيل دوام
            </Button>
          )}
        </div>
      </SectionCard>

      {/* جدول الدوام */}
      <SectionCard
        title={`سجل الدوام — ${fmtDate(date)}`}
        description="الحفظ يعمل upsert: تسجيل موظف له سجل في نفس اليوم يحدّثه بدل تكراره"
        icon={CalendarDays}
        action={
          <Badge variant="outline" className="num gap-1">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {fmtNumber(rows.length)} سجل
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title={`سجل الدوام — ${fmtDate(date)}`}
            filename={`attendance-${date}`}
            headers={['الموظف', 'كوده', 'الوظيفة', 'الحالة', 'الحضور', 'الانصراف']}
            rowsLoader={exportRows}
            onBeforePrint={async () => {
              setPrintRows(rows)
            }}
            onAfterPrint={() => setPrintRows(null)}
          />
          <div className="overflow-hidden rounded-lg border">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>الموظف</TableHead>
                  <TableHead>الوظيفة</TableHead>
                  <TableHead className="w-24">الحالة</TableHead>
                  <TableHead className="w-24">الحضور</TableHead>
                  <TableHead className="w-24">الانصراف</TableHead>
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
                          <p className="font-medium">لا توجد سجلات لهذا اليوم</p>
                          <p className="mt-1 text-xs">سجّل حضور موظف لبدء كشف اليوم</p>
                        </div>
                        {!isArchive && (
                          <Button size="sm" variant="outline" onClick={() => void openNew()}>
                            <Plus className="h-4 w-4" />
                            تسجيل دوام
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
                      <TableCell>{a.employee.position}</TableCell>
                      <TableCell>
                        <StatusBadge status={a.status} label={AR_ATTENDANCE_STATUS[a.status] ?? a.status} />
                      </TableCell>
                      <TableCell className="num whitespace-nowrap">
                        {a.checkIn ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="num whitespace-nowrap">
                        {a.checkOut ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="no-print">
                        <div className="flex items-center gap-1">
                          {!isArchive && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-primary"
                              title="تعديل"
                              aria-label={`تعديل سجل ${a.employee.name}`}
                              onClick={() => void openEdit(a)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {!isArchive && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                              title="حذف"
                              aria-label={`حذف سجل ${a.employee.name}`}
                              onClick={() => setDeleteTarget(a)}
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
                صفحة {fmtNumber(safePage)} من {fmtNumber(totalPages)} — {fmtNumber(rows.length)} سجل
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

      {/* نافذة تسجيل/تعديل الدوام */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? 'تعديل سجل دوام' : 'تسجيل دوام'}</DialogTitle>
            <DialogDescription>
              {editId
                ? 'الموظف والتاريخ ثابتان في وضع التعديل — عدّل الحالة والأوقات فقط'
                : 'تسجيل موظف له سجل في نفس اليوم يحدّث السجل الموجود (upsert)'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>الموظف *</Label>
              <Select
                value={fEmployeeId}
                onValueChange={setFEmployeeId}
                disabled={empLoading || !!editId}
              >
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
              <Label htmlFor="att-fdate">التاريخ *</Label>
              <Input
                id="att-fdate"
                type="date"
                value={fDate}
                onChange={(e) => setFDate(e.target.value)}
                disabled={!!editId}
                className="num h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label>الحالة *</Label>
              <Select value={fStatus} onValueChange={(v) => setFStatus(v as AttendanceStatus)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {AR_ATTENDANCE_STATUS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="att-in">وقت الحضور</Label>
              <Input
                id="att-in"
                type="time"
                value={fCheckIn}
                onChange={(e) => setFCheckIn(e.target.value)}
                className="num h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="att-out">وقت الانصراف</Label>
              <Input
                id="att-out"
                type="time"
                value={fCheckOut}
                onChange={(e) => setFCheckOut(e.target.value)}
                className="num h-9"
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
            <AlertDialogTitle>حذف سجل الدوام</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف سجل دوام الموظف «{deleteTarget?.employee.name}» ليوم{' '}
              {deleteTarget ? fmtDate(deleteTarget.date) : ''}؟ لا يمكن التراجع عن الحذف.
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
