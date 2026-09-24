'use client'

// نوافذ المستودعات: نموذج إنشاء/فرعي/تعديل + البطاقة التعريفية (أمين المستودع بارز) + تأكيد الحذف

import { useMemo, useState } from 'react'
import {
  CalendarDays,
  ChevronLeft,
  Loader2,
  MapPin,
  StickyNote,
  Phone,
  Save,
  Trash2,
  UserRound,
  Warehouse,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { fmtDate } from '@/lib/format'
import {
  LEVEL_META,
  LEVEL_ICONS,
  LEVEL_STYLES,
  MAX_LEVEL,
  buildWarehouseIndex,
  pathOf,
  suggestWarehouseCode,
  type WarehouseDTO,
  type WarehouseIndex,
  type WarehouseNode,
} from './types'

export type WarehouseFormMode = 'create' | 'sub' | 'edit'

// ==================== نموذج الإنشاء/التعديل ====================

interface FormDialogProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  warehouses: WarehouseDTO[]
  mode: WarehouseFormMode
  /** في sub: المستودع الأب — في edit: السجل المعدّل */
  target: WarehouseNode | null
}

export function WarehouseFormDialog({ open, onClose, onSaved, warehouses, mode, target }: FormDialogProps) {
  const title = mode === 'edit' ? 'تعديل المستودع' : mode === 'sub' ? 'مستودع فرعي جديد' : 'مستودع جديد'

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[calc(100vw_-_var(--sidebar-w)_-_2rem)] sm:max-w-[640px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            الهيكل الهرمي أربعة مستويات: المستودع الشامل ← مستودع عام ← مستودع فرعي ← قسم — وكل بطاقة مستودع تتضمن أميناً للمستودع
          </DialogDescription>
        </DialogHeader>
        <FormFields
          key={`${mode}-${target?.id ?? 'root'}-${open}`}
          warehouses={warehouses}
          mode={mode}
          target={target}
          onClose={onClose}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  )
}

function FormFields({
  warehouses,
  mode,
  target,
  onClose,
  onSaved,
}: Omit<FormDialogProps, 'open'>) {
  const { toast } = useToast()
  const rootExists = warehouses.some((w) => !w.parentId)

  // الأب: في sub ثابت (target) — في create يُختار — في edit يُقرأ من السجل
  const [parentId, setParentId] = useState<string>(
    mode === 'sub' ? (target?.id ?? '') : mode === 'edit' ? (target?.parentId ?? '') : rootExists ? (warehouses.find((w) => !w.parentId)?.id ?? '') : '',
  )
  const [code, setCode] = useState<string>(
    mode === 'edit' ? (target?.code ?? '') : suggestWarehouseCode(warehouses, mode === 'sub' ? (target?.id ?? null) : rootExists ? (warehouses.find((w) => !w.parentId)?.id ?? null) : null),
  )
  const [name, setName] = useState(mode === 'edit' ? (target?.name ?? '') : '')
  const [keeperName, setKeeperName] = useState(mode === 'edit' ? (target?.keeperName ?? '') : '')
  const [keeperPhone, setKeeperPhone] = useState(mode === 'edit' ? (target?.keeperPhone ?? '') : '')
  const [location, setLocation] = useState(mode === 'edit' ? (target?.location ?? '') : '')
  const [notes, setNotes] = useState(mode === 'edit' ? (target?.notes ?? '') : '')
  const [isActive, setIsActive] = useState(mode === 'edit' ? (target?.isActive ?? true) : true)
  const [saving, setSaving] = useState(false)

  const parentOptions = useMemo(() => {
    // كل مستودع بمستوى أقل من الرابع يمكن أن يكون أباً — مرتبة DFS مع مسافة بادئة
    const index = buildWarehouseIndex(warehouses)
    const out: { id: string; label: string }[] = []
    const walk = (nodes: WarehouseNode[], depth: number) => {
      for (const n of nodes) {
        if (n.level < MAX_LEVEL) {
          out.push({ id: n.id, label: `${'— '.repeat(depth)}${n.name} (${n.code})` })
          walk(n.children, depth + 1)
        }
      }
    }
    walk(index.roots, 0)
    return out
  }, [warehouses])

  const effectiveParentId = mode === 'sub' ? (target?.id ?? null) : parentId || null
  const effectiveParent = effectiveParentId ? warehouses.find((w) => w.id === effectiveParentId) ?? null : null
  const effectiveLevel = mode === 'edit' && !effectiveParentId ? 1 : (effectiveParent ? effectiveParent.level + 1 : 1)
  const levelMeta = LEVEL_META[effectiveLevel]
  const LevelIcon = LEVEL_ICONS[effectiveLevel] ?? Warehouse

  const canSubmit = name.trim().length > 0 && keeperName.trim().length > 0 && !saving

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    try {
      const payload = {
        code: code.trim(),
        name: name.trim(),
        keeperName: keeperName.trim(),
        keeperPhone: keeperPhone.trim(),
        location: location.trim(),
        notes: notes.trim(),
        isActive,
        parentId: effectiveParentId,
      }
      const res =
        mode === 'edit'
          ? await fetch(`/api/warehouses/${target?.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
          : await fetch('/api/warehouses', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: data?.error ?? 'فشل حفظ المستودع', variant: 'destructive' })
        return
      }
      toast({ title: mode === 'edit' ? 'تم تعديل المستودع بنجاح' : `تم إنشاء «${data.name}» بنجاح` })
      onSaved()
      onClose()
    } catch {
      toast({ title: 'فشل الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* الأب والمستوى */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>المستودع الأب</Label>
          {mode === 'sub' ? (
            <div className="flex min-h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
              <LevelIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="break-words leading-snug">{target?.name}</span>
            </div>
          ) : mode === 'edit' ? (
            <div className="flex min-h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
              <LevelIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="break-words leading-snug">
                {effectiveParent ? `${effectiveParent.name} (${effectiveParent.code})` : 'جذر — المستودع الشامل'}
              </span>
            </div>
          ) : (
            <Select
              value={parentId || 'ROOT'}
              onValueChange={(v) => {
                const next = v === 'ROOT' ? '' : v
                setParentId(next)
                setCode(suggestWarehouseCode(warehouses, next || null))
              }}
            >
              <SelectTrigger aria-label="اختيار المستودع الأب">
                <SelectValue placeholder="اختر الأب" />
              </SelectTrigger>
              <SelectContent>
                {!rootExists && <SelectItem value="ROOT">بدون أب — المستودع الشامل (الجذر)</SelectItem>}
                {parentOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>المستوى في الشجرة</Label>
          <div className="flex min-h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
            <span className={cn('shrink-0 rounded-md p-1', LEVEL_STYLES[effectiveLevel]?.iconBox)}>
              <LevelIcon className="h-3.5 w-3.5" />
            </span>
            <span className="break-words font-medium leading-snug">{levelMeta?.label ?? `المستوى ${effectiveLevel}`}</span>
          </div>
        </div>
      </div>

      {/* الكود والاسم */}
      <div className="grid gap-4 sm:grid-cols-[1fr_1.6fr]">
        <div className="space-y-1.5">
          <Label htmlFor="wh-code">الكود</Label>
          <Input
            id="wh-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="يُقترح تلقائياً"
            className="num"
            dir="ltr"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wh-name">
            اسم المستودع <span className="text-rose-500">*</span>
          </Label>
          <Input
            id="wh-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: مستودع دمشق — قسم المظفات"
          />
        </div>
      </div>

      {/* أمين المستودع — إلزامي */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-lg bg-primary/12 p-1.5 text-primary">
            <UserRound className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">
              أمين المستودع <span className="text-rose-500">*</span>
            </p>
            <p className="text-[11px] text-muted-foreground">إلزامي في كل بطاقة مستودع</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wh-keeper">اسم الأمين</Label>
            <Input
              id="wh-keeper"
              value={keeperName}
              onChange={(e) => setKeeperName(e.target.value)}
              placeholder="الاسم الكامل"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-keeper-phone">هاتف الأمين</Label>
            <Input
              id="wh-keeper-phone"
              value={keeperPhone}
              onChange={(e) => setKeeperPhone(e.target.value)}
              placeholder="09xxxxxxxx"
              className="num"
              dir="ltr"
            />
          </div>
        </div>
      </div>

      {/* الموقع */}
      <div className="space-y-1.5">
        <Label htmlFor="wh-location">الموقع / العنوان</Label>
        <div className="relative">
          <MapPin className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="wh-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="مثال: دمشق - القدم - الشارع الثالث"
            className="ps-8"
          />
        </div>
      </div>

      {/* ملاحظات */}
      <div className="space-y-1.5">
        <Label htmlFor="wh-notes">ملاحظات</Label>
        <Textarea
          id="wh-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="ملاحظات إضافية عن المستودع (اختياري)"
          rows={2}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
        <div className="space-y-0.5">
          <Label htmlFor="wh-active" className="text-sm">
            مستودع نشط
          </Label>
          <p className="text-xs text-muted-foreground">المستودعات الموقوفة تظهر فقط عند تفعيل «إظهار غير النشطة»</p>
        </div>
        <Switch id="wh-active" checked={isActive} onCheckedChange={setIsActive} />
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          إلغاء
        </Button>
        <Button onClick={submit} disabled={!canSubmit}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {mode === 'edit' ? 'حفظ التعديلات' : 'إنشاء المستودع'}
        </Button>
      </DialogFooter>
    </div>
  )
}

// ==================== البطاقة التعريفية ====================

interface ProfileDialogProps {
  node: WarehouseNode | null
  index: WarehouseIndex | null
  onClose: () => void
}

export function WarehouseProfileDialog({ node, index, onClose }: ProfileDialogProps) {
  const path = useMemo(() => (node && index ? pathOf(index, node.id) : []), [node, index])
  if (!node || !index) return null

  const LevelIcon = LEVEL_ICONS[node.level] ?? Warehouse
  const tone = LEVEL_STYLES[node.level]?.iconBox ?? ''

  return (
    <Dialog open={!!node} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[calc(100vw_-_var(--sidebar-w)_-_2rem)] sm:max-w-[720px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Badge variant="outline" className="num">
              {node.code}
            </Badge>
            بطاقة تعريف مستودع
          </DialogTitle>
          <DialogDescription>البيانات التعريفية الكاملة للمستودع وأمينه ضمن الشجرة الهرمية</DialogDescription>
        </DialogHeader>

        {/* رأس البطاقة */}
        <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-4">
          <span className={cn('rounded-xl p-3', tone)}>
            <LevelIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="break-words text-lg font-bold leading-snug">{node.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="text-[11px]">
                {LEVEL_META[node.level]?.label ?? `المستوى ${node.level}`}
              </Badge>
              {!node.isActive && <Badge variant="destructive">موقوف</Badge>}
            </div>
          </div>
        </div>

        {/* المسار الأبوي */}
        <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-muted-foreground">المسار:</span>
          {path.map((p, i) => (
            <span key={p.id} className="flex items-center gap-1">
              {i > 0 && <ChevronLeft className="h-3 w-3" />}
              <span className={cn(i === path.length - 1 && 'font-semibold text-foreground')}>{p.name}</span>
            </span>
          ))}
        </div>

        {/* أمين المستودع — بارز */}
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-primary/12 p-2.5 text-primary">
              <UserRound className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">أمين المستودع</p>
              <p className="mt-0.5 break-words text-base font-bold leading-snug">{node.keeperName ?? '— غير مُعيَّن —'}</p>
              {node.keeperPhone && (
                <p className="num mt-1 flex items-center gap-1.5 text-sm text-muted-foreground" dir="ltr">
                  <Phone className="h-3.5 w-3.5" />
                  {node.keeperPhone}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* شبكة البيانات */}
        <div className="grid gap-x-6 gap-y-3 rounded-xl border p-4 sm:grid-cols-2">
          <InfoRow label="الكود" value={<span className="num font-semibold">{node.code}</span>} />
          <InfoRow label="المستوى" value={LEVEL_META[node.level]?.label ?? String(node.level)} />
          <InfoRow
            label="المستودع الأب"
            value={
              node.parentId && index.byId.get(node.parentId)
                ? `${index.byId.get(node.parentId)!.name} (${index.byId.get(node.parentId)!.code})`
                : '— الجذر —'
            }
          />
          <InfoRow label="الموقع" value={node.location ?? '—'} icon={MapPin} />
          <InfoRow
            label="تاريخ الإنشاء"
            value={<span className="num">{fmtDate(node.createdAt)}</span>}
            icon={CalendarDays}
          />
          <InfoRow label="عدد الفروع المباشرة" value={<span className="num font-semibold">{node.childrenCount}</span>} />
          {node.balancesCount > 0 && (
            <InfoRow label="أرصدة أصناف مرتبطة" value={<span className="num">{node.balancesCount}</span>} />
          )}
          {node.movementsCount > 0 && (
            <InfoRow label="حركات مخزون مرتبطة" value={<span className="num">{node.movementsCount}</span>} />
          )}
          {node.notes && (
            <div className="sm:col-span-2">
              <Separator className="mb-3" />
              <p className="flex items-start gap-2 text-sm">
                <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">{node.notes}</span>
              </p>
            </div>
          )}
        </div>

        {/* الفروع المباشرة */}
        <div>
          <p className="mb-2 text-sm font-semibold">الفروع المباشرة</p>
          {node.children.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              لا توجد فروع — {node.level >= MAX_LEVEL ? 'هذا آخر مستوى في الشجرة (قسم)' : 'يمكن إضافة مستودع فرعي منه'}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {node.children.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <Badge variant="outline" className="num shrink-0 text-[11px]">
                    {c.code}
                  </Badge>
                  <span className="min-w-0 flex-1 break-words leading-snug">{c.name}</span>
                  <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                    <UserRound className="h-3 w-3" />
                    {c.keeperName ?? '—'}
                  </span>
                  {!c.isActive && <Badge variant="destructive" className="text-[10px]">موقوف</Badge>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function InfoRow({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon?: typeof MapPin }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 flex items-start gap-1.5 break-words text-sm font-medium leading-snug">
        {Icon && <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        {value}
      </p>
    </div>
  )
}

// ==================== تأكيد الحذف ====================

interface DeleteDialogProps {
  target: WarehouseNode | null
  onClose: () => void
  onDeleted: () => void
}

export function WarehouseDeleteDialog({ target, onClose, onDeleted }: DeleteDialogProps) {
  const { toast } = useToast()
  const [deleting, setDeleting] = useState(false)
  if (!target) return null

  const linked =
    target.balancesCount + target.movementsCount + target.stocktakingsCount > 0

  async function confirmDelete() {
    if (!target) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/warehouses/${target.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: data?.error ?? 'فشل حذف المستودع', variant: 'destructive' })
        return
      }
      toast({ title: data?.message ?? 'تم الحذف بنجاح' })
      onDeleted()
      onClose()
    } catch {
      toast({ title: 'فشل الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent className="w-[calc(100vw_-_var(--sidebar-w)_-_2rem)] sm:max-w-[480px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-rose-500" />
            حذف المستودع «{target.name}»
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                سيُحذف المستودع <span className="num font-semibold">{target.code}</span> نهائياً من الشجرة الهرمية.
              </p>
              {target.childrenCount > 0 && (
                <p className="flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  يوجد {target.childrenCount} مستودع فرعي تابع له — يجب حذف الفروع أولاً
                </p>
              )}
              {linked && (
                <p className="flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  مرتبط ببيانات مخزنية (أرصدة/حركات/جرد) — لا يمكن حذفه
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>إلغاء</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleting || target.childrenCount > 0 || linked}
            onClick={(e) => {
              e.preventDefault()
              confirmDelete()
            }}
            className="bg-rose-600 text-white hover:bg-rose-700"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            تأكيد الحذف
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
