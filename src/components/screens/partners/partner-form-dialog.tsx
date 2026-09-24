'use client'

// نموذج إنشاء/تعديل ملف طرف (عميل أو مورد) — الكود تلقائي حسب النوع، الاسم إلزامي
// تعدد الأدوار: عند الإنشاء يمكن ربط الملف بحساب موجود من الشجرة (مثل حساب موظف ليصبح عميلاً على حسابه نفسه)
import { useEffect, useMemo, useState } from 'react'
import { Link2, Loader2, Phone, Save, UserPlus } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { AR_PARTNER_TYPE } from '@/lib/format'
import type { PartnerRow } from './types'

/** خيار حساب موجود للربط — من شجرة الحسابات */
interface LinkableAccountOption {
  id: string
  code: string
  name: string
  /** شارات الأدوار الحالية على الحساب (موظف/عميل/مورد) — لتوضيح من هو صاحب الحساب */
  roles: { kind: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE'; code: string }[]
}

interface Props {
  open: boolean
  onClose: () => void
  /** null = إنشاء جديد */
  editing: PartnerRow | null
  nextCustomerCode: string
  nextSupplierCode: string
  onSaved: () => void
}

export function PartnerFormDialog({
  open,
  onClose,
  editing,
  nextCustomerCode,
  nextSupplierCode,
  onSaved,
}: Props) {
  const { toast } = useToast()
  const isEdit = !!editing

  const [type, setType] = useState('CUSTOMER')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  // تعدد الأدوار — ربط بحساب موجود من الشجرة بدل إنشاء حساب جديد (اختياري، للإنشاء فقط)
  const [linkAccounts, setLinkAccounts] = useState<LinkableAccountOption[]>([])
  const [linkAccountId, setLinkAccountId] = useState('NONE')

  // إعادة الضبط عند كل فتح
  useEffect(() => {
    if (editing) {
      setType(editing.type)
      setName(editing.name)
      setPhone(editing.phone ?? '')
      setAddress(editing.address ?? '')
      setNotes(editing.notes ?? '')
      setActive(editing.isActive)
      setLinkAccountId('NONE')
    } else {
      setType('CUSTOMER')
      setName('')
      setPhone('')
      setAddress('')
      setNotes('')
      setActive(true)
      setLinkAccountId('NONE')
    }
  }, [editing, open])

  // جلب حسابات الشجرة القابلة للربط (للإنشاء فقط): ورقية نشطة مع شارات أدوارها الحالية
  useEffect(() => {
    if (!open || isEdit) return
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
                a.links && a.links.length > 0
                  ? a.links
                  : a.link
                    ? [a.link]
                    : []
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
  }, [open, isEdit])

  const nameError = useMemo(() => {
    const v = name.trim()
    if (!v) return 'اسم الطرف إلزامي'
    if (v.length < 2) return 'حرفان على الأقل'
    return ''
  }, [name])

  const phoneError = useMemo(() => {
    const v = phone.trim()
    if (!v) return ''
    if (!/^[0-9+\-\s()]{5,20}$/.test(v))
      return 'أرقام ورموز + - والمسافات فقط (5 إلى 20 خانة)'
    return ''
  }, [phone])

  const valid = !nameError && !phoneError && name.trim().length > 0

  // الحسابات المتاحة للدور المختار: تُستبعد الحسابات المرتبطة أصلاً بملف من نفس الدور
  const availableLinkAccounts = useMemo(
    () =>
      linkAccounts.filter(
        (a) => !a.roles.some((r) => r.kind === (type === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER')),
      ),
    [linkAccounts, type],
  )

  // إن اختير حساب صار غير متاح بعد تغيير النوع — يُعاد الاختبار لـ«بلا ربط»
  useEffect(() => {
    if (linkAccountId !== 'NONE' && !availableLinkAccounts.some((a) => a.id === linkAccountId)) {
      setLinkAccountId('NONE')
    }
  }, [availableLinkAccounts, linkAccountId])

  const roleLabel = (kind: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE') =>
    kind === 'CUSTOMER' ? 'عميل' : kind === 'SUPPLIER' ? 'مورد' : 'موظف'

  const submit = async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      const res = await fetch(isEdit ? `/api/partners/${editing!.id}` : '/api/partners', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEdit
            ? { name, phone, address, notes, isActive: active }
            : {
                type,
                name,
                phone,
                address,
                notes,
                accountId: linkAccountId !== 'NONE' ? linkAccountId : null,
              },
        ),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({
          title: isEdit ? 'تعذر حفظ التعديلات' : 'تعذر إنشاء الملف',
          description: data?.error ?? 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        return
      }
      toast({ title: data?.message ?? 'تم الحفظ' })
      onSaved()
      onClose()
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const previewCode = isEdit
    ? editing!.code
    : type === 'SUPPLIER'
      ? nextSupplierCode
      : nextCustomerCode

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            {isEdit ? `تعديل الملف ${editing!.code}` : 'ملف طرف جديد'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'بيانات الملف — الكود والنوع لا يتغيران'
              : 'النوع يحدد اتجاه الحساب: العملاء ذمم مدينة والموردون ذمم دائنة'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* النوع + الكود التلقائي */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-type">النوع</Label>
              {isEdit ? (
                <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
                  {AR_PARTNER_TYPE[type] ?? type}
                </div>
              ) : (
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="p-type" aria-label="النوع">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CUSTOMER">عميل</SelectItem>
                    <SelectItem value="SUPPLIER">مورد</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>الكود (تلقائي)</Label>
              <div className="flex h-9 items-center rounded-md border border-dashed bg-muted/30 px-3">
                <span className="num font-semibold text-primary">{previewCode}</span>
              </div>
            </div>
          </div>

          {/* تعدد الأدوار — ربط بحساب موجود من الشجرة (للإنشاء) أو عرض الحساب المرتبط (للتعديل) */}
          {isEdit ? (
            editing?.accountCode ? (
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">الحساب المرتبط في الشجرة</p>
                  <p className="text-xs text-muted-foreground">
                    كل حركات هذا الملف تُقيَّد على الحساب {editing.accountCode} — لا يتغير الربط بعد الإنشاء
                  </p>
                </div>
                <span className="num rounded-md border bg-background px-2 py-1 text-sm font-semibold text-primary">
                  {editing.accountCode}
                </span>
              </div>
            ) : null
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="p-linkacc" className="flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-primary" />
                ربط بحساب موجود (اختياري)
              </Label>
              <Select value={linkAccountId} onValueChange={setLinkAccountId}>
                <SelectTrigger id="p-linkacc" aria-label="ربط بحساب موجود">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="NONE">
                    بلا ربط — يُنشأ حساب فرعي جديد تلقائياً
                  </SelectItem>
                  {availableLinkAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="num text-muted-foreground">{a.code}</span> — {a.name}
                      {a.roles.length > 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {' '}
                          ({a.roles.map((r) => `${roleLabel(r.kind)} ${r.code}`).join(' + ')})
                        </span>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                مثال: اجعل موظفاً له حساب (115xxx) عميلاً على حسابه نفسه — أو مورداً عميلاً أيضاً — بلا حساب جديد
                ولا ازدواج. الحسابات المرتبطة أصلاً بملف من نفس الدور مستبعدة تلقائياً
              </p>
            </div>
          )}

          {/* الاسم */}
          <div className="space-y-1.5">
            <Label htmlFor="p-name" className={nameError ? 'text-rose-600' : ''}>
              اسم الطرف <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="p-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: شركة النور للتجارة"
              aria-invalid={!!nameError}
              className={nameError ? 'border-rose-400 focus-visible:ring-rose-300' : ''}
            />
            {nameError ? (
              <p className="text-xs text-rose-600">{nameError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">الاسم التجاري الكامل كما في السجلات</p>
            )}
          </div>

          {/* الهاتف والعنوان */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-phone" className={phoneError ? 'text-rose-600' : ''}>
                الهاتف
              </Label>
              <div className="relative">
                <Phone className="absolute end-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="p-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="09xxxxxxxx"
                  inputMode="tel"
                  dir="ltr"
                  className="num h-9 pl-9 text-left"
                  aria-invalid={!!phoneError}
                />
              </div>
              {phoneError ? <p className="text-xs text-rose-600">{phoneError}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-address">العنوان</Label>
              <Input
                id="p-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="المدينة — الحي"
                className="h-9"
              />
            </div>
          </div>

          {/* ملاحظات */}
          <div className="space-y-1.5">
            <Label htmlFor="p-notes">ملاحظات</Label>
            <Textarea
              id="p-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="شروط التعامل، المسؤول، أي تفاصيل إضافية…"
              rows={2}
              className="resize-none"
            />
          </div>

          {/* مفتاح النشاط — للتعديل فقط */}
          {isEdit && (
            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">الملف نشط</p>
                <p className="text-xs text-muted-foreground">
                  الملفات الموقوفة لا تظهر بقوائم الفواتير والسندات
                </p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} aria-label="الملف نشط" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isEdit ? 'حفظ التعديلات' : 'إنشاء الملف'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
