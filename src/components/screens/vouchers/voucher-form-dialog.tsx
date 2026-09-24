'use client'

// نموذج إنشاء سند قبض/دفع — تاريخ + مبلغ + طريقة + طرف أو حساب مصروف (Task 102) + بيان

import { useEffect, useMemo, useState } from 'react'
import { Loader2, ReceiptText, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { Input } from '@/components/ui/input'
import { NumInput } from '@/components/ui/number-input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useActionBus, APP_EVENTS } from '@/lib/action-bus'
import { printVoucher } from './print-voucher'
import { fmtMoney, fmtUSD, todayYMD } from '@/lib/format'

export interface PartnerOption {
  id: string
  code: string
  name: string
  type: string // CUSTOMER | SUPPLIER
}

/** حساب مصروف من الدليل — للأوراق الفرعية النشطة فقط (Task 102) */
export interface ExpenseAccountOption {
  id: string
  code: string
  name: string
}

/** حساب موظف شخصي من الشجرة — فرعي تحت 1150 ومرتبط بملف موظف (Task 104) */
export interface EmployeeAccountOption {
  id: string
  code: string
  name: string
  employeeCode: string
}

interface Props {
  open: boolean
  onClose: () => void
  type: 'RECEIPT' | 'PAYMENT'
  nextNumber: string
  onCreated: () => void
}

const todayStr = () => todayYMD()

export function VoucherFormDialog({ open, onClose, type, nextNumber, onCreated }: Props) {
  const { toast } = useToast()
  const [date, setDate] = useState(todayStr())
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('CASH')
  const [partnerId, setPartnerId] = useState('NONE')
  // Task 102/104 — وضع الجهة: طرف معروف أو حساب مصروف أو حساب موظف شخصي من الشجرة
  const [partyMode, setPartyMode] = useState<'PARTNER' | 'EXPENSE' | 'EMPLOYEE'>('PARTNER')
  const [accountId, setAccountId] = useState('NONE')
  const [expenseAccounts, setExpenseAccounts] = useState<ExpenseAccountOption[]>([])
  const [employeeAccounts, setEmployeeAccounts] = useState<EmployeeAccountOption[]>([])
  const [notes, setNotes] = useState('')
  const [partners, setPartners] = useState<PartnerOption[]>([])
  const [saving, setSaving] = useState(false)

  // Task 40 — تأكيد إلغاء العملية (Esc): لا تطهير للحقول إلا بقرار صريح
  const [confirmCancel, setConfirmCancel] = useState(false)

  const isReceipt = type === 'RECEIPT'

  useEffect(() => {
    if (!open) return
    // إعادة ضبط النموذج عند كل فتح
    setDate(todayStr())
    setAmount('')
    setMethod('CASH')
    setPartnerId('NONE')
    setPartyMode('PARTNER')
    setAccountId('NONE')
    setNotes('')
    fetch('/api/partners')
      .then((r) => (r.ok ? r.json() : { partners: [] }))
      .then((d: { partners?: PartnerOption[] }) => setPartners(d.partners ?? []))
      .catch(() => setPartners([]))
    fetch('/api/accounts')
      .then((r) => (r.ok ? r.json() : []))
      .then(
        (
          rows: {
            id: string
            code: string
            name: string
            type: string
            isActive: boolean
            parentId: string | null
            link?: { kind: string; id: string; code: string } | null
            links?: { kind: string; id: string; code: string }[] | null
          }[],
        ) => {
          // حسابات مصروف نشطة وليست مجموعاً رئيسياً (ليست أباً لأي حساب)
          const parentIds = new Set(rows.map((a) => a.parentId).filter(Boolean) as string[])
          const leaves = rows
            .filter((a) => a.type === 'EXPENSE' && a.isActive && !parentIds.has(a.id))
            .map(({ id, code, name }) => ({ id, code, name }))
          setExpenseAccounts(leaves)
          // حسابات الموظفين الشخصية النشطة — المرتبطة بملف موظف من شجرة الحسابات (Task 104)
          // تعدد الأدوار: الحساب قد يحمل أدواراً أخرى (عميل/مورد) — links تحتوي كلها
          const empAccs = rows
            .filter((a) => {
              if (!a.isActive) return false
              const links = a.links && a.links.length > 0 ? a.links : a.link ? [a.link] : []
              return links.some((l) => l.kind === 'EMPLOYEE')
            })
            .map((a) => {
              const links = a.links && a.links.length > 0 ? a.links : a.link ? [a.link] : []
              const emp = links.find((l) => l.kind === 'EMPLOYEE')
              return {
                id: a.id,
                code: a.code,
                name: a.name,
                employeeCode: emp?.code ?? '',
              }
            })
          setEmployeeAccounts(empAccs)
        },
      )
      .catch(() => {
        setExpenseAccounts([])
        setEmployeeAccounts([])
      })
  }, [open])

  // الأطراف المعروضة: العملاء للمقبوضات والموردون للمدفوعات أولاً، والبقية متاحة أيضاً
  const partnerOptions = useMemo(() => {
    const preferred = isReceipt ? 'CUSTOMER' : 'SUPPLIER'
    return [...partners].sort((a, b) => Number(b.type === preferred) - Number(a.type === preferred))
  }, [partners, isReceipt])

  const amountNum = Number(amount)
  // Task 102/104 — صلاحية النموذج: وضعا المصروف والموظف يتطلبان اختيار حساب فعلي
  const valid =
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    !!date &&
    (partyMode === 'PARTNER' || accountId !== 'NONE')

  // معاينة القيد المتوقع في وضعي المصروف والموظف — شفافية محاسبية كاملة قبل الحفظ
  const journalPreview = useMemo(() => {
    if (partyMode === 'PARTNER' || accountId === 'NONE' || !(amountNum > 0)) return null
    const acc =
      partyMode === 'EXPENSE'
        ? expenseAccounts.find((a) => a.id === accountId)
        : employeeAccounts.find((a) => a.id === accountId)
    if (!acc) return null
    const cashSide = method === 'BANK' ? 'البنك' : method === 'CHEQUE' ? null : 'الصندوق'
    if (!cashSide) {
      return `شيك — يبقى على ذمة ${partyMode === 'EMPLOYEE' ? 'الموظف' : 'الطرف'} حتى الصرف (بلا قيد فوري)`
    }
    if (partyMode === 'EMPLOYEE') {
      return isReceipt
        ? `سيُرحّل تلقائياً: مدين ${cashSide} / دائن حساب الموظف ${acc.name} (${acc.code})`
        : `سيُرحّل تلقائياً: مدين حساب الموظف ${acc.name} (${acc.code}) / دائن ${cashSide}`
    }
    return `سيُرحّل تلقائياً: مدين ${acc.name} (${acc.code}) / دائن ${cashSide}`
  }, [isReceipt, partyMode, accountId, amountNum, expenseAccounts, employeeAccounts, method])

  // ===== الحفظ — Task 40: printAfter يحفظ ثم يطبع السند بالقالب المطور (فشل الطباعة لا يبطل الحفظ)
  const submit = async (opts?: { printAfter?: boolean }) => {
    if (!valid || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          date,
          amount: amountNum,
          method,
          partnerId: partyMode === 'PARTNER' && partnerId !== 'NONE' ? partnerId : null,
          accountId: partyMode !== 'PARTNER' && accountId !== 'NONE' ? accountId : null,
          notes: notes.trim() || null,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ title: 'تعذر الحفظ', description: data?.error ?? 'خطأ غير متوقع', variant: 'destructive' })
        return
      }
      // حفظ وطباعة (Ctrl+P / F9): طباعة السند المحفوظ فوراً من استجابة الإنشاء مباشرة
      if (opts?.printAfter && data?.number) {
        const printed = printVoucher({
          number: data.number,
          type: type,
          date: data.date ?? date,
          amount: Number(data.amount ?? amountNum),
          method: data.method ?? method,
          notes: data.notes ?? null,
          partnerName: data.partner?.name ?? null,
          partnerCode: data.partner?.code ?? null,
          accountName: data.account?.name ?? null,
          accountCode: data.account?.code ?? null,
          invoiceNumber: data.invoice?.number ?? null,
        })
        if (!printed) {
          toast({
            title: 'تم الحفظ لكن تعذر فتح نافذة الطباعة',
            description: 'اسمح بالنوافذ المنبثقة في المتصفح ثم افتح بطاقة العرض واطبع يدوياً',
            variant: 'destructive',
          })
        }
      }
      toast({
        title: `${isReceipt ? 'سند القبض' : 'سند الدفع'} ${data?.number ?? ''} أُنشئ بنجاح`,
        description: `المبلغ ${fmtMoney(amountNum)} — ${data.partner?.name ?? data.account?.name ?? 'بدون طرف'}${data.account ? (data.account.isEmployee ? ' (حساب موظف)' : ' (مصروف)') : ''}`,
      })
      onCreated()
      onClose()
    } catch {
      // فشل الشبكة — بلا finally صامت
      toast({ title: 'تعذر الحفظ', description: 'تعذر الاتصال بالخادم — تحقق من الاتصال وأعد المحاولة', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // ===== Task 40 — ربط الاختصارات المركزية =====
  // 1) تسجيل «المستند النشط» عند الفتح ليوجّه Ctrl+S/F8 و Ctrl+P/F9 و Esc إلى هذا النموذج
  useEffect(() => {
    if (!open) return
    useActionBus.getState().setActiveDoc({ kind: 'voucher-form', label: isReceipt ? 'سند قبض' : 'سند دفع' })
    return () => {
      useActionBus.getState().setActiveDoc(null)
    }
  }, [open, isReceipt])

  // 2) الاستجابة للاختصارات — بدون مصفوفة تبعيات ليأخذ المستمعون أحدث نسخة من submit في كل عرض
  useEffect(() => {
    if (!open) return
    const onSave = () => {
      if (valid && !saving) void submit()
    }
    const onSavePrint = () => {
      if (valid && !saving) void submit({ printAfter: true })
    }
    const onCancel = () => setConfirmCancel(true)
    window.addEventListener(APP_EVENTS.SAVE_CURRENT, onSave)
    window.addEventListener(APP_EVENTS.SAVE_PRINT_CURRENT, onSavePrint)
    window.addEventListener(APP_EVENTS.CANCEL_CURRENT, onCancel)
    return () => {
      window.removeEventListener(APP_EVENTS.SAVE_CURRENT, onSave)
      window.removeEventListener(APP_EVENTS.SAVE_PRINT_CURRENT, onSavePrint)
      window.removeEventListener(APP_EVENTS.CANCEL_CURRENT, onCancel)
    }
  })

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            سند {isReceipt ? 'قبض' : 'دفع'} جديد
            <span className="num text-sm font-normal text-muted-foreground">{nextNumber}</span>
          </DialogTitle>
          <DialogDescription>
            {isReceipt
              ? 'تسجيل مبلغ محصّل من عميل أو من حساب موظف — نقداً أو بنك أو شيك'
              : 'تسجيل مبلغ مدفوع لمورد أو مصروف مباشر أو لحساب موظف — نقداً أو بنك'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-date">التاريخ *</Label>
              <Input id="v-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-method">الطريقة *</Label>
              <Select
                value={method}
                onValueChange={setMethod}
                disabled={partyMode === 'EXPENSE' && method === 'CHEQUE'}
              >
                <SelectTrigger id="v-method" aria-label="طريقة الدفع">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">نقداً</SelectItem>
                  <SelectItem value="BANK">بنك / حوالة</SelectItem>
                  <SelectItem value="CHEQUE" disabled={partyMode === 'EXPENSE'}>
                    شيك{partyMode === 'EXPENSE' ? ' (غير متاح للمصروف)' : ''}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="v-amount">المبلغ (ل.س) *</Label>
            <NumInput
              id="v-amount"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {Number.isFinite(amountNum) && amountNum > 0 && (
              <p className="text-xs text-muted-foreground">
                ما يعادل ≈ <span className="num font-medium">{fmtUSD(amountNum)}</span>
              </p>
            )}
          </div>

          {partyMode === 'EMPLOYEE' ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="v-empacc" className="flex items-center gap-1.5">
                  <UserRound className="h-3.5 w-3.5 text-sky-600" />
                  حساب الموظف * (من شجرة الحسابات)
                </Label>
                <button
                  type="button"
                  onClick={() => {
                    setPartyMode('PARTNER')
                    setAccountId('NONE')
                  }}
                  className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                >
                  رجوع إلى الطرف
                </button>
              </div>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="v-empacc" aria-label="حساب الموظف">
                  <SelectValue placeholder="اختر حساب الموظف" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="NONE" disabled>
                    — اختر حساب الموظف —
                  </SelectItem>
                  {employeeAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="num text-muted-foreground">{a.code}</span> — {a.name}
                      {a.employeeCode ? (
                        <span className="num text-xs text-muted-foreground"> ({a.employeeCode})</span>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {journalPreview ? (
                <p className="rounded-md border border-dashed bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                  {journalPreview}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  مثل: صرف أجر نقل أو سلفة للموظف من الصندوق — يُقيَّد على حسابه الشخصي في الشجرة (تحت 1150)
                </p>
              )}
            </div>
          ) : isReceipt ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="v-partner">الطرف</Label>
                <button
                  type="button"
                  onClick={() => setPartyMode('EMPLOYEE')}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-sky-600 transition-colors hover:bg-sky-500/10"
                >
                  <UserRound className="h-3.5 w-3.5" />
                  قبض من حساب موظف
                </button>
              </div>
              <Select value={partnerId} onValueChange={setPartnerId}>
                <SelectTrigger id="v-partner" aria-label="الطرف">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="NONE">بدون طرف</SelectItem>
                  {partnerOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="num text-muted-foreground">{p.code}</span> — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : partyMode === 'EXPENSE' ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="v-expense" className="flex items-center gap-1.5">
                  <ReceiptText className="h-3.5 w-3.5 text-rose-600" />
                  حساب المصروف * (من دليل الحسابات)
                </Label>
                <button
                  type="button"
                  onClick={() => {
                    setPartyMode('PARTNER')
                    setAccountId('NONE')
                  }}
                  className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                >
                  رجوع إلى الطرف
                </button>
              </div>
              <Select
                value={accountId}
                onValueChange={(v) => {
                  setAccountId(v)
                  if (v !== 'NONE' && method === 'CHEQUE') setMethod('CASH')
                }}
              >
                <SelectTrigger id="v-expense" aria-label="حساب المصروف">
                  <SelectValue placeholder="اختر حساب المصروف" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="NONE" disabled>
                    — اختر حساب المصروف —
                  </SelectItem>
                  {expenseAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="num text-muted-foreground">{a.code}</span> — {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {journalPreview ? (
                <p className="rounded-md border border-dashed bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                  {journalPreview}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  مثل: إيجارات، كهرباء، اتصالات، نقل وتوصيل — سيُقيّد المصروف مباشرة على الدليل
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="v-partner">الطرف</Label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPartyMode('EMPLOYEE')}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-sky-600 transition-colors hover:bg-sky-500/10"
                  >
                    <UserRound className="h-3.5 w-3.5" />
                    دفع لحساب موظف
                  </button>
                  <button
                    type="button"
                    onClick={() => setPartyMode('EXPENSE')}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-500/10"
                  >
                    <ReceiptText className="h-3.5 w-3.5" />
                    دفع مصروف بدل طرف
                  </button>
                </div>
              </div>
              <Select value={partnerId} onValueChange={setPartnerId}>
                <SelectTrigger id="v-partner" aria-label="الطرف">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="NONE">بدون طرف</SelectItem>
                  {partnerOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="num text-muted-foreground">{p.code}</span> — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="v-notes">البيان</Label>
            <Textarea
              id="v-notes"
              rows={2}
              placeholder={isReceipt ? 'مثال: دفعة نقدية من العميل...' : 'مثال: سداد دفعة للمورد...'}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            حفظ السند
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Task 40 — تأكيد إلغاء العملية (Esc): لا إغلاق ولا تطهير بالخطأ — قرار صريح بحماية البيانات */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إلغاء العملية الحالية؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُغلق نموذج سند {isReceipt ? 'القبض' : 'الدفع'} وتُطهَّر جميع الحقول غير المحفوظة. لا يمكن التراجع عن هذه الخطوة.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>متابعة العمل</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={(e) => {
                e.preventDefault()
                setConfirmCancel(false)
                onClose()
                toast({ title: 'أُلغيت العملية وطُهّرت الحقول' })
              }}
            >
              إلغاء وتطهير الحقول
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
