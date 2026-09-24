'use client'

// شاشة ملفات الموظفين — إدارة كاملة (إضافة/تعديل/تفعيل-إيقاف/حذف محمي خلفياً)
// KPIs من الخادم + بحث وحالة + تقسيم صفحي عميل 10/صف + طباعة وتصدير إكسل لكل الصفوف المفلترة

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Eye,
  HandCoins,
  Inbox,
  Link2,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Power,
  Search,
  Trash2,
  UserCheck,
  Users,
  Wallet,
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
import { fmtDate, fmtMoney, fmtNumber, fmtUSD, todayYMD } from '@/lib/format'
import { useIsArchive } from '@/lib/store'
import { cn } from '@/lib/utils'
import { EmployeeViewDialog } from './employee-view-dialog'
import type { EmployeeRow, EmployeesResponse, EmployeesStats } from './hr-shared'

const PAGE_SIZE = 10

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE'

/** خيار حساب موجود للربط — من شجرة الحسابات */
interface LinkableAccountOption {
  id: string
  code: string
  name: string
  /** شارات الأدوار الحالية على الحساب (موظف/عميل/مورد) */
  roles: { kind: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE'; code: string }[]
}

export default function EmployeesScreen() {
  const { toast } = useToast()
  // وضع استعراض أرشيف فترة مقفلة — يخفي أزرار الكتابة (الإضافة/التعديل/الحذف)
  const isArchive = useIsArchive()

  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [stats, setStats] = useState<EmployeesStats>({ total: 0, active: 0, monthlyPayroll: 0, unpaidAdvancesTotal: 0 })
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [page, setPage] = useState(1)
  const [printRows, setPrintRows] = useState<EmployeeRow[] | null>(null)
  const [viewId, setViewId] = useState<string | null>(null)

  // ===== نافذة النموذج (إضافة/تعديل) =====
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [fCode, setFCode] = useState('')
  const [fName, setFName] = useState('')
  const [fPosition, setFPosition] = useState('')
  const [fDepartment, setFDepartment] = useState('')
  const [fPhone, setFPhone] = useState('')
  const [fHireDate, setFHireDate] = useState('')
  const [fBaseSalary, setFBaseSalary] = useState('')
  const [fActive, setFActive] = useState(true)
  const [saving, setSaving] = useState(false)
  // تعدد الأدوار — ربط الموظف بحساب موجود من الشجرة بدل إنشاء حساب جديد (اختياري، للإنشاء فقط)
  const [linkAccounts, setLinkAccounts] = useState<LinkableAccountOption[]>([])
  const [linkAccountId, setLinkAccountId] = useState('NONE')

  // ===== حذف =====
  const [deleteTarget, setDeleteTarget] = useState<EmployeeRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/employees')
      const data = await res.json().catch(() => null)
      if (!res.ok || !data || !Array.isArray((data as EmployeesResponse).employees)) {
        throw new Error((data as { error?: string } | null)?.error ?? 'تعذر جلب الموظفين')
      }
      const payload = data as EmployeesResponse
      setEmployees(payload.employees)
      setStats(payload.stats)
    } catch (err) {
      toast({
        title: 'تعذر جلب الموظفين',
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
    return employees.filter((e) => {
      if (statusFilter === 'ACTIVE' && !e.isActive) return false
      if (statusFilter === 'INACTIVE' && e.isActive) return false
      if (
        term &&
        !e.name.includes(term) &&
        !e.position.includes(term) &&
        !e.code.toLowerCase().includes(term.toLowerCase())
      )
        return false
      return true
    })
  }, [employees, q, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  )

  // الصفوف المعروضة — كل الصفوف المفلترة عند الطباعة وإلا صفحة التقسيم الحالية
  const displayRows = printRows ?? pageRows

  // ===== الإجراءات =====
  const openNew = useCallback(() => {
    setEditId(null)
    setFCode('')
    setFName('')
    setFPosition('')
    setFDepartment('')
    setFPhone('')
    setFHireDate(todayYMD())
    setFBaseSalary('')
    setFActive(true)
    setLinkAccountId('NONE')
    setFormOpen(true)
  }, [])

  // جلب حسابات الشجرة القابلة للربط (للإنشاء فقط): ورقية نشطة بلا ملف موظف مع شارات أدوارها
  useEffect(() => {
    if (!formOpen || editId) return
    let cancelled = false
    fetch('/api/accounts')
      .then((r) => (r.ok ? r.json() : []))
      .then(
        (
          rows: {
            id: string
            code: string
            name: string
            isActive: boolean
            parentId: string | null
            link?: { kind: string; id: string; code: string } | null
            links?: { kind: string; id: string; code: string }[] | null
          }[],
        ) => {
          if (cancelled || !Array.isArray(rows)) return
          const parentIds = new Set(rows.map((a) => a.parentId).filter(Boolean) as string[])
          const opts: LinkableAccountOption[] = rows
            .filter((a) => a.isActive && !parentIds.has(a.id))
            .map((a) => {
              const links =
                a.links && a.links.length > 0 ? a.links : a.link ? [a.link] : []
              return {
                id: a.id,
                code: a.code,
                name: a.name,
                roles: links.map((l) => ({
                  kind: l.kind as 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE',
                  code: l.code,
                })),
              }
            })
            .filter((a) => !a.roles.some((r) => r.kind === 'EMPLOYEE'))
            .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
          setLinkAccounts(opts)
        },
      )
      .catch(() => {
        if (!cancelled) setLinkAccounts([])
      })
    return () => {
      cancelled = true
    }
  }, [formOpen, editId])

  const openEdit = useCallback((e: EmployeeRow) => {
    setEditId(e.id)
    setFCode(e.code)
    setFName(e.name)
    setFPosition(e.position)
    setFDepartment(e.department ?? '')
    setFPhone(e.phone ?? '')
    setFHireDate(e.hireDate.slice(0, 10))
    setFBaseSalary(String(e.baseSalary))
    setFActive(e.isActive)
    setFormOpen(true)
  }, [])

  const save = useCallback(async () => {
    if (!fName.trim()) {
      toast({ title: 'الاسم مطلوب', description: 'أدخل اسم الموظف', variant: 'destructive' })
      return
    }
    if (!fPosition.trim()) {
      toast({ title: 'الوظيفة مطلوبة', description: 'أدخل المسمى الوظيفي', variant: 'destructive' })
      return
    }
    const baseSalary = Number(fBaseSalary)
    if (!Number.isFinite(baseSalary) || baseSalary <= 0) {
      toast({ title: 'الراتب غير صالح', description: 'أدخل راتباً أساسياً أكبر من صفر', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const url = editId ? `/api/employees/${editId}` : '/api/employees'
      const res = await fetch(url, {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: fCode.trim() || undefined,
          name: fName.trim(),
          position: fPosition.trim(),
          department: fDepartment.trim() || undefined,
          phone: fPhone.trim() || undefined,
          hireDate: fHireDate || undefined,
          baseSalary,
          isActive: fActive,
          // تعدد الأدوار — ربط بحساب موجود (للإنشاء فقط)
          ...(editId ? {} : { accountId: linkAccountId !== 'NONE' ? linkAccountId : null }),
        }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر الحفظ')
      toast({ title: data?.message ?? 'تم حفظ الموظف' })
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
  }, [editId, fCode, fName, fPosition, fDepartment, fPhone, fHireDate, fBaseSalary, fActive, linkAccountId, load, toast])

  const toggleActive = useCallback(
    async (e: EmployeeRow) => {
      try {
        const res = await fetch(`/api/employees/${e.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !e.isActive }),
        })
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) throw new Error(data?.error ?? 'تعذر تغيير الحالة')
        toast({ title: e.isActive ? `تم إيقاف الموظف ${e.name}` : `تم تفعيل الموظف ${e.name}` })
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
      const res = await fetch(`/api/employees/${deleteTarget.id}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر الحذف')
      toast({ title: data?.message ?? 'تم حذف الموظف' })
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
      filtered.map((e) => [
        e.code,
        e.name,
        e.position,
        e.department ?? '—',
        e.phone ?? '—',
        e.hireDate.slice(0, 10),
        e.baseSalary,
        e.isActive ? 'نشط' : 'موقوف',
      ]),
    [filtered],
  )

  return (
    <div className="space-y-4">
      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          title="عدد الموظفين"
          value={fmtNumber(stats.total)}
          hint={`${fmtNumber(stats.active)} نشط`}
          icon={Users}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="الموظفون النشطون"
          value={fmtNumber(stats.active)}
          hint={`من أصل ${fmtNumber(stats.total)}`}
          icon={UserCheck}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="إجمالي الرواتب الشهرية"
          value={fmtMoney(stats.monthlyPayroll)}
          hint={`≈ ${fmtUSD(stats.monthlyPayroll)}`}
          icon={Wallet}
          tone="amber"
          loading={loading}
        />
        <KpiCard
          title="سلف غير مسددة"
          value={fmtMoney(stats.unpaidAdvancesTotal)}
          hint={`≈ ${fmtUSD(stats.unpaidAdvancesTotal)}`}
          icon={HandCoins}
          tone="rose"
          loading={loading}
        />
      </div>

      {/* الفلاتر */}
      <SectionCard title="بحث وفلترة" icon={Search}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="emp-q">بحث</Label>
            <Input
              id="emp-q"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
              placeholder="الاسم أو الكود أو الوظيفة…"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label>الحالة</Label>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as StatusFilter)
                setPage(1)
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">الكل</SelectItem>
                <SelectItem value="ACTIVE">النشطون</SelectItem>
                <SelectItem value="INACTIVE">الموقوفون</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end sm:col-span-2 lg:justify-end">
            {!isArchive && (
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" />
                موظف جديد
              </Button>
            )}
          </div>
        </div>
      </SectionCard>

      {/* جدول الموظفين */}
      <SectionCard
        title="قائمة الموظفين"
        description="ملفات الموظفين ورواتبهم الأساسية وسلفهم غير المسددة"
        icon={Users}
        action={
          <Badge variant="outline" className="num gap-1">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {fmtNumber(filtered.length)} نتيجة
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title="ملفات الموظفين"
            filename="employees"
            headers={['الكود', 'الاسم', 'الوظيفة', 'القسم', 'الهاتف', 'التعيين', 'الراتب الأساسي', 'الحالة']}
            rowsLoader={exportRows}
            onBeforePrint={async () => {
              setPrintRows(filtered)
            }}
            onAfterPrint={() => setPrintRows(null)}
          />
          <div className="overflow-hidden rounded-lg border">
            <Table className="min-w-[1000px]">
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-24">الكود</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الوظيفة</TableHead>
                  <TableHead>القسم</TableHead>
                  <TableHead className="w-32">الهاتف</TableHead>
                  <TableHead className="w-28">التعيين</TableHead>
                  <TableHead className="w-36">الراتب الأساسي</TableHead>
                  <TableHead className="w-24">الحالة</TableHead>
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
                          <p className="font-medium">لا يوجد موظفون</p>
                          <p className="mt-1 text-xs">أضف أول موظف لتبدأ إدارة الموارد البشرية</p>
                        </div>
                        {!isArchive && (
                          <Button size="sm" variant="outline" onClick={openNew}>
                            <Plus className="h-4 w-4" />
                            موظف جديد
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayRows.map((e) => (
                    <TableRow
                      key={e.id}
                      className={cn('cursor-pointer', !e.isActive && 'opacity-60')}
                      onClick={() => setViewId(e.id)}
                    >
                      <TableCell className="num font-bold">{e.code}</TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="font-medium text-primary hover:underline">{e.name}</p>
                          {e.accountCode ? (
                            <p className="num text-xs text-muted-foreground" title="الحساب المرتبط في شجرة الحسابات">
                              حساب {e.accountCode}
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>{e.position}</TableCell>
                      <TableCell>{e.department ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="num">
                        <div className="flex items-center gap-1.5">
                          {e.phone ?? <span className="text-muted-foreground">—</span>}
                          {e.whatsappUrl && (
                            <a
                              href={e.whatsappUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(ev) => ev.stopPropagation()}
                              className="shrink-0 rounded-full p-1 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                              title="واتساب"
                              aria-label={`فتح محادثة واتساب مع ${e.name}`}
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="num whitespace-nowrap">{fmtDate(e.hireDate)}</TableCell>
                      <TableCell className="num whitespace-nowrap text-end">{fmtMoney(e.baseSalary)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={e.isActive
                          ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                          : 'border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-400'}>
                          {e.isActive ? 'نشط' : 'موقوف'}
                        </Badge>
                      </TableCell>
                      <TableCell className="no-print" onClick={(ev) => ev.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                            title="عرض"
                            aria-label={`عرض بطاقة الموظف ${e.name}`}
                            onClick={() => setViewId(e.id)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {!isArchive && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-primary"
                              title="تعديل"
                              aria-label={`تعديل الموظف ${e.name}`}
                              onClick={() => openEdit(e)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {!isArchive && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn('h-8 w-8 text-muted-foreground hover:text-primary', e.isActive && 'text-emerald-600 dark:text-emerald-400')}
                              title={e.isActive ? 'إيقاف' : 'تفعيل'}
                              aria-label={`${e.isActive ? 'إيقاف' : 'تفعيل'} الموظف ${e.name}`}
                              onClick={() => void toggleActive(e)}
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
                              aria-label={`حذف الموظف ${e.name}`}
                              onClick={() => setDeleteTarget(e)}
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
                صفحة {fmtNumber(safePage)} من {fmtNumber(totalPages)} — {fmtNumber(filtered.length)} موظف
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? 'تعديل موظف' : 'موظف جديد'}</DialogTitle>
            <DialogDescription>
              {editId ? 'عدّل بيانات الموظف ثم احفظ' : 'الكود اختياري — يُولَّد تلقائياً إن تُرك فارغاً'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="emp-code">الكود</Label>
              <Input
                id="emp-code"
                value={fCode}
                onChange={(e) => setFCode(e.target.value)}
                placeholder="EMP-001"
                className="num h-9"
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-name">الاسم *</Label>
              <Input
                id="emp-name"
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="الاسم الكامل"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-position">الوظيفة *</Label>
              <Input
                id="emp-position"
                value={fPosition}
                onChange={(e) => setFPosition(e.target.value)}
                placeholder="مثال: محاسب"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-dept">القسم</Label>
              <Input
                id="emp-dept"
                value={fDepartment}
                onChange={(e) => setFDepartment(e.target.value)}
                placeholder="مثال: الإدارة المالية"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-phone">الهاتف</Label>
              <Input
                id="emp-phone"
                value={fPhone}
                onChange={(e) => setFPhone(e.target.value)}
                placeholder="09xxxxxxxx"
                className="num h-9"
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-hire">تاريخ التعيين</Label>
              <Input
                id="emp-hire"
                type="date"
                value={fHireDate}
                onChange={(e) => setFHireDate(e.target.value)}
                className="num h-9"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="emp-salary">الراتب الأساسي (ل.س) *</Label>
              <NumInput
                id="emp-salary"
                value={fBaseSalary}
                onChange={(e) => setFBaseSalary(e.target.value)}
                placeholder="0.00"
                className="h-9 text-start"
              />
            </div>
            <div className="space-y-1.5 rounded-lg border p-3 sm:col-span-2">
              <Label htmlFor="emp-linkacc" className="flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-primary" />
                ربط بحساب موجود (اختياري)
              </Label>
              {!editId ? (
                <>
                  <Select value={linkAccountId} onValueChange={setLinkAccountId}>
                    <SelectTrigger id="emp-linkacc" aria-label="ربط بحساب موجود">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="NONE">بلا ربط — يُنشأ حساب فرعي جديد تلقائياً</SelectItem>
                      {linkAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          <span className="num text-muted-foreground">{a.code}</span> — {a.name}
                          {a.roles.length > 0 ? (
                            <span className="text-xs text-muted-foreground">
                              {' '}
                              ({a.roles
                                .map((r) =>
                                  `${r.kind === 'CUSTOMER' ? 'عميل' : r.kind === 'SUPPLIER' ? 'مورد' : 'موظف'} ${r.code}`,
                                )
                                .join(' + ')})
                            </span>
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    مثال: اجعل عميلاً له حساب (113xxx) موظفاً على حسابه نفسه — بلا حساب جديد ولا ازدواج
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  الربط يُحدد عند الإنشاء فقط — لا يتغير بعد ذلك
                </p>
              )}
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3 sm:col-span-2">
              <div>
                <p className="text-sm font-medium">موظف نشط</p>
                <p className="text-xs text-muted-foreground">النشطون فقط يظهرون في قوائم الرواتب والسلف والإجازات والدوام</p>
              </div>
              <Switch checked={fActive} onCheckedChange={setFActive} aria-label="تفعيل الموظف" />
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
            <AlertDialogTitle>حذف الموظف</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف الموظف «{deleteTarget?.name}» ({deleteTarget?.code})؟ لا يمكن التراجع عن الحذف.
              الموظفون المرتبطون برواتب أو سلف أو إجازات أو سجلات دوام لا يمكن حذفهم — أوقفه بدلاً من ذلك.
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

      {/* بطاقة الموظف — البيانات وأحدث الرواتب والسلف */}
      <EmployeeViewDialog employeeId={viewId} onClose={() => setViewId(null)} />
    </div>
  )
}
