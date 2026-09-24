'use client'

// شاشة المستخدمون والصلاحيات — إدارة كاملة (إضافة/تعديل/حذف محمي بحرس آخر مدير نشط خلفياً)
// 4 KPIs من الخادم + بحث فوري بالاسم/اسم المستخدم + مصفوفة صلاحيات قراءة فقط
// + طباعة وتصدير إكسل لكل الصفوف المفلترة — كلمات المرور مجزأة scrypt ولا تُعرض أبداً

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Calculator,
  Eye,
  Inbox,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
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
import { fmtDate, fmtNumber } from '@/lib/format'
import { useIsArchive } from '@/lib/store'
import { cn } from '@/lib/utils'

// ==================== عقد الـAPI (المطابق للخادم) ====================

export type UserRole = 'ADMIN' | 'ACCOUNTANT' | 'VIEWER'

export interface UserRow {
  id: string
  username: string
  name: string
  role: UserRole
  isActive: boolean
  createdAt: string // ISO
  updatedAt: string // ISO
}

export interface UsersStats {
  total: number
  active: number
  admins: number
  limited: number
}

export interface UsersResponse {
  users: UserRow[]
  stats: UsersStats
}

// ==================== قواميس ومصفوفة الصلاحيات ====================

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: 'مدير',
  ACCOUNTANT: 'محاسب',
  VIEWER: 'مشاهد',
}

const ROLE_DESCRIPTION: Record<UserRole, string> = {
  ADMIN: 'كل الصلاحيات — تشمل إدارة المستخدمين والإعدادات',
  ACCOUNTANT: 'كل العمليات اليومية عدا المستخدمين والإعدادات',
  VIEWER: 'عرض وطباعة وتصدير فقط — بلا أي تعديل',
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/

export default function UsersScreen() {
  const { toast } = useToast()
  // وضع استعراض أرشيف فترة مقفلة — يخفي أزرار الكتابة (الإضافة/التعديل/الحذف)
  const isArchive = useIsArchive()

  const [users, setUsers] = useState<UserRow[]>([])
  const [stats, setStats] = useState<UsersStats>({ total: 0, active: 0, admins: 0, limited: 0 })
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  // ===== نافذة النموذج (إضافة/تعديل) =====
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [fUsername, setFUsername] = useState('')
  const [fName, setFName] = useState('')
  const [fRole, setFRole] = useState<UserRole>('ACCOUNTANT')
  const [fPassword, setFPassword] = useState('')
  const [fActive, setFActive] = useState(true)
  const [saving, setSaving] = useState(false)

  // ===== حذف =====
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/users')
      const data = await res.json().catch(() => null)
      if (!res.ok || !data || !Array.isArray((data as UsersResponse).users)) {
        throw new Error((data as { error?: string } | null)?.error ?? 'تعذر جلب المستخدمين')
      }
      const payload = data as UsersResponse
      setUsers(payload.users)
      setStats(payload.stats)
    } catch (err) {
      toast({
        title: 'تعذر جلب المستخدمين',
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

  // ===== بحث فوري بالاسم الكامل واسم المستخدم =====
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return users
    return users.filter(
      (u) => u.name.toLowerCase().includes(term) || u.username.toLowerCase().includes(term),
    )
  }, [users, q])

  // ===== الإجراءات =====
  const openNew = useCallback(() => {
    setEditId(null)
    setFUsername('')
    setFName('')
    setFRole('ACCOUNTANT')
    setFPassword('')
    setFActive(true)
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((u: UserRow) => {
    setEditId(u.id)
    setFUsername(u.username)
    setFName(u.name)
    setFRole(u.role)
    setFPassword('')
    setFActive(u.isActive)
    setFormOpen(true)
  }, [])

  const save = useCallback(async () => {
    if (!editId) {
      if (!fUsername.trim()) {
        toast({ title: 'اسم المستخدم مطلوب', description: 'أدخل اسم مستخدم لاتينياً (3–32 حرفاً)', variant: 'destructive' })
        return
      }
      if (!USERNAME_RE.test(fUsername.trim())) {
        toast({
          title: 'اسم المستخدم غير صالح',
          description: '3–32 حرفاً لاتينياً أو أرقاماً أو شرطة سفلية فقط — بلا مسافات أو محارف عربية',
          variant: 'destructive',
        })
        return
      }
    }
    if (fName.trim().length < 2) {
      toast({ title: 'الاسم مطلوب', description: 'أدخل الاسم الكامل (حرفان على الأقل)', variant: 'destructive' })
      return
    }
    if (!editId && fPassword.length < 6) {
      toast({ title: 'كلمة المرور مطلوبة', description: '6 أحرف على الأقل', variant: 'destructive' })
      return
    }
    if (editId && fPassword.length > 0 && fPassword.length < 6) {
      toast({ title: 'كلمة المرور قصيرة', description: '6 أحرف على الأقل — أو اتركها فارغة للإبقاء على الحالية', variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      const url = editId ? `/api/users/${editId}` : '/api/users'
      const res = await fetch(url, {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: editId ? undefined : fUsername.trim(),
          name: fName.trim(),
          role: fRole,
          password: fPassword.length > 0 ? fPassword : undefined,
          isActive: fActive,
        }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر الحفظ')
      toast({ title: data?.message ?? 'تم حفظ المستخدم' })
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
  }, [editId, fUsername, fName, fRole, fPassword, fActive, load, toast])

  const doDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/users/${deleteTarget.id}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'تعذر الحذف')
      toast({ title: data?.message ?? 'تم حذف المستخدم' })
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
      filtered.map((u) => [
        u.username,
        u.name,
        ROLE_LABEL[u.role],
        u.isActive ? 'نشط' : 'موقوف',
        fmtDate(u.createdAt),
      ]),
    [filtered],
  )

  return (
    <div className="space-y-4">
      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          title="إجمالي المستخدمين"
          value={fmtNumber(stats.total)}
          hint={`${fmtNumber(stats.active)} نشط`}
          icon={Users}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="المستخدمون النشطون"
          value={fmtNumber(stats.active)}
          hint={`من أصل ${fmtNumber(stats.total)}`}
          icon={UserCheck}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="مدراء النظام"
          value={fmtNumber(stats.admins)}
          hint="محمي بحرس آخر مدير نشط"
          icon={ShieldCheck}
          tone="amber"
          loading={loading}
        />
        <KpiCard
          title="بأدوار محدودة"
          value={fmtNumber(stats.limited)}
          hint="محاسبون ومشاهدون"
          icon={Eye}
          tone="slate"
          loading={loading}
        />
      </div>

      {/* البحث وزر الإضافة */}
      <SectionCard title="بحث" icon={Search}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="user-q">بحث</Label>
            <Input
              id="user-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="الاسم الكامل أو اسم المستخدم…"
              className="h-9"
            />
          </div>
          <div className="flex items-end lg:col-span-2 lg:justify-end">
            {!isArchive && (
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" />
                مستخدم جديد
              </Button>
            )}
          </div>
        </div>
      </SectionCard>

      {/* جدول المستخدمين */}
      <SectionCard
        title="قائمة المستخدمين"
        description="حسابات الدخول وأدوارها وصلاحياتها في النظام"
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
            title="المستخدمون والصلاحيات"
            filename="users"
            headers={['اسم المستخدم', 'الاسم الكامل', 'الدور', 'الحالة', 'أُنشئ']}
            rowsLoader={exportRows}
          />
          <div className="overflow-hidden rounded-lg border">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-40">اسم المستخدم</TableHead>
                  <TableHead>الاسم الكامل</TableHead>
                  <TableHead className="w-28">الدور</TableHead>
                  <TableHead className="w-24">الحالة</TableHead>
                  <TableHead className="w-32">أُنشئ</TableHead>
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
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-14 text-center">
                      <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        <div className="rounded-full bg-muted p-4">
                          <Inbox className="h-8 w-8" />
                        </div>
                        <div>
                          <p className="font-medium">لا يوجد مستخدمون</p>
                          <p className="mt-1 text-xs">أضف أول مستخدم أو عدّل بحثك</p>
                        </div>
                        {!isArchive && (
                          <Button size="sm" variant="outline" onClick={openNew}>
                            <Plus className="h-4 w-4" />
                            مستخدم جديد
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((u) => (
                    <TableRow key={u.id} className={cn(!u.isActive && 'opacity-60')}>
                      <TableCell className="num font-bold" dir="ltr">
                        {u.username}
                      </TableCell>
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell>
                        {u.role === 'ADMIN' ? (
                          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400">
                            {ROLE_LABEL[u.role]}
                          </Badge>
                        ) : u.role === 'ACCOUNTANT' ? (
                          <Badge variant="secondary">{ROLE_LABEL[u.role]}</Badge>
                        ) : (
                          <Badge variant="outline">{ROLE_LABEL[u.role]}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={u.isActive
                          ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                          : 'border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-400'}>
                          {u.isActive ? 'نشط' : 'موقوف'}
                        </Badge>
                      </TableCell>
                      <TableCell className="num whitespace-nowrap">{fmtDate(u.createdAt)}</TableCell>
                      <TableCell className="no-print">
                        <div className="flex items-center gap-1">
                          {!isArchive && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-primary"
                              title="تعديل"
                              aria-label={`تعديل المستخدم ${u.name}`}
                              onClick={() => openEdit(u)}
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
                              aria-label={`حذف المستخدم ${u.name}`}
                              onClick={() => setDeleteTarget(u)}
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
        </div>
      </SectionCard>

      {/* مصفوفة الصلاحيات — قراءة فقط */}
      <SectionCard
        title="مصفوفة الصلاحيات"
        description="ملخص ما يستطيع كل دور فعله في النظام — قراءة فقط"
        icon={ShieldCheck}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-amber-500/12 p-2 text-amber-600 dark:text-amber-400">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-bold">مدير</p>
                <p className="num text-xs text-muted-foreground">ADMIN</p>
              </div>
            </div>
            <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <li className="flex items-start gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                كل الصلاحيات بلا استثناء
              </li>
              <li className="flex items-start gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                إدارة المستخدمين والأدوار وكلمات المرور
              </li>
              <li className="flex items-start gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                الإعدادات وسعر الصرف وسجل التدقيق
              </li>
            </ul>
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-emerald-500/12 p-2 text-emerald-600 dark:text-emerald-400">
                <Calculator className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-bold">محاسب</p>
                <p className="num text-xs text-muted-foreground">ACCOUNTANT</p>
              </div>
            </div>
            <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <li className="flex items-start gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                كل العمليات اليومية: فواتير وقيود ومخزون وصندوق
              </li>
              <li className="flex items-start gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                الموارد البشرية والتقارير
              </li>
              <li className="flex items-start gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                لا يصل للمستخدمين والإعدادات
              </li>
            </ul>
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-muted p-2 text-muted-foreground">
                <Eye className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-bold">مشاهد</p>
                <p className="num text-xs text-muted-foreground">VIEWER</p>
              </div>
            </div>
            <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <li className="flex items-start gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                عرض جميع الشاشات والتقارير
              </li>
              <li className="flex items-start gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                طباعة وتصدير إكسل
              </li>
              <li className="flex items-start gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                بلا أي إضافة أو تعديل أو حذف
              </li>
            </ul>
          </div>
        </div>
      </SectionCard>

      {/* ملاحظة الأمان */}
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        كلمات المرور مخزنة بتجزئة scrypt — لا تُعرض أبداً
      </p>

      {/* نافذة النموذج */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? 'تعديل مستخدم' : 'مستخدم جديد'}</DialogTitle>
            <DialogDescription>
              {editId
                ? `تعديل بيانات «${fUsername}» — اسم المستخدم لا يتغير بعد الإنشاء`
                : 'أنشئ حساب دخول جديداً وحدد دوره وصلاحياته'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="user-username">اسم المستخدم *</Label>
              <Input
                id="user-username"
                value={fUsername}
                onChange={(e) => setFUsername(e.target.value)}
                placeholder="مثال: admin أو m.saleh"
                className="num h-9"
                dir="ltr"
                disabled={editId !== null}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">3–32 حرفاً لاتينياً/أرقام/شرطة سفلية — لا يتغير لاحقاً</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-name">الاسم الكامل *</Label>
              <Input
                id="user-name"
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="مثال: محمد الصالح"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>الدور *</Label>
              <Select value={fRole} onValueChange={(v) => setFRole(v as UserRole)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">مدير</span>
                      <span className="text-xs text-muted-foreground">كل الصلاحيات — المستخدمون والإعدادات</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="ACCOUNTANT">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">محاسب</span>
                      <span className="text-xs text-muted-foreground">كل العمليات اليومية عدا المستخدمين والإعدادات</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="VIEWER">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">مشاهد</span>
                      <span className="text-xs text-muted-foreground">عرض وطباعة وتصدير فقط</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTION[fRole]}</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="user-password">{editId ? 'كلمة مرور جديدة' : 'كلمة المرور *'}</Label>
              <Input
                id="user-password"
                type="password"
                value={fPassword}
                onChange={(e) => setFPassword(e.target.value)}
                placeholder={editId ? 'اتركها فارغة للإبقاء على الحالية' : '6 أحرف على الأقل'}
                className="num h-9"
                dir="ltr"
                autoComplete="new-password"
              />
              {editId && <p className="text-xs text-muted-foreground">اتركها فارغة للإبقاء على كلمة المرور الحالية</p>}
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3 sm:col-span-2">
              <div>
                <p className="text-sm font-medium">مستخدم نشط</p>
                <p className="text-xs text-muted-foreground">الموقوف لا يستطيع الدخول — لا يمكن إيقاف آخر مدير نشط</p>
              </div>
              <Switch checked={fActive} onCheckedChange={setFActive} aria-label="تفعيل المستخدم" />
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
            <AlertDialogTitle>حذف المستخدم</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف المستخدم «{deleteTarget?.name}» ({deleteTarget?.username})؟ لا يمكن التراجع عن الحذف.
              لا يمكن حذف آخر مدير نشط في النظام — أوقفه بدلاً من ذلك إن لزم.
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
