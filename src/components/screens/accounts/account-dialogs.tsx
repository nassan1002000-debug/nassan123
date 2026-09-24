'use client'

// نوافذ دليل الحسابات: إنشاء/حساب فرعي/تعديل/حذف + دفتر أستاذ وكشف حساب وتفصيلي (عريضة 1152px)

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { NumInput } from '@/components/ui/number-input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/hooks/use-toast'
import { fmtMoney, fmtUSD, fmtDate, AR_ACCOUNT_TYPE, AR_NATURE, AR_SOURCE } from '@/lib/format'
import {
  ACCOUNT_TYPES,
  CONTROL_PARENT_INFO,
  accountDepth,
  directionLabel,
  isOppositeDirection,
  natureForType,
  suggestNextCode,
  type AccountDTO,
  type AccountLink,
  type AccountNature,
  type AccountType,
  type LedgerResponse,
} from './types'
import { printAccountReport } from './print-account-report'
import { exportTableToCsv } from '@/lib/export'
import { ChevronDown, ChevronLeft, FileSpreadsheet, ListTree, Loader2, Printer, Trash2 } from 'lucide-react'

// ==================== نافذة إنشاء/تعديل حساب ====================

export type FormMode = 'create' | 'sub' | 'edit'

interface AccountFormDialogProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  accounts: AccountDTO[]
  mode: FormMode
  target: AccountDTO | null // edit: الحساب نفسه — sub: الأب
}

export function AccountFormDialog({ open, onClose, onSaved, accounts, mode, target }: AccountFormDialogProps) {
  const { toast } = useToast()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('ASSET')
  const [nature, setNature] = useState<AccountNature>('DEBIT')
  const [openingBalance, setOpeningBalance] = useState('0')
  const [parentId, setParentId] = useState<string>('none')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [codeTouched, setCodeTouched] = useState(false)

  const isEdit = mode === 'edit'
  const isSub = mode === 'sub'

  // تهيئة الحقول عند الفتح
  useEffect(() => {
    if (!open) return
    setCodeTouched(false)
    if (isEdit && target) {
      setCode(target.code)
      setName(target.name)
      setType(target.type)
      setNature(target.nature)
      setOpeningBalance(String(target.openingBalance))
      setParentId(target.parentId ?? 'none')
      setIsActive(target.isActive)
    } else if (isSub && target) {
      setCode('')
      setName('')
      setType(target.type)
      setNature(target.nature)
      setOpeningBalance('0')
      setParentId(target.id)
      setIsActive(true)
    } else {
      setCode('')
      setName('')
      setType('ASSET')
      setNature('DEBIT')
      setOpeningBalance('0')
      setParentId('none')
      setIsActive(true)
    }
  }, [open, isEdit, isSub, target])

  // اقتراح الكود التسلسلي تلقائياً (إن لم يعدّله المستخدم)
  useEffect(() => {
    if (!open || isEdit || codeTouched) return
    const pid = isSub && target ? target.id : parentId === 'none' ? null : parentId
    setCode(suggestNextCode(accounts, pid, type))
  }, [open, isEdit, isSub, target, parentId, type, accounts, codeTouched])

  const parentOptions = useMemo(() => {
    return [...accounts]
      .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
      .map((a) => ({ id: a.id, code: a.code, name: a.name, depth: accountDepth(accounts, a.id) }))
  }, [accounts])

  // الأب المختار فعلياً — لكشف كونه حساب تحكم (مزامنة تلقائية مع شاشة الأطراف/الموظفين)
  const effectiveParentId = isSub && target ? target.id : parentId === 'none' ? null : parentId
  const effectiveParent = effectiveParentId ? accounts.find((a) => a.id === effectiveParentId) : null
  const controlInfo =
    !isEdit && effectiveParent ? CONTROL_PARENT_INFO[effectiveParent.code] ?? null : null

  const title = isEdit ? 'تعديل حساب' : isSub ? `حساب فرعي تحت: ${target?.name ?? ''}` : 'حساب جديد'

  async function handleSave() {
    if (!name.trim()) {
      toast({ title: 'الاسم مطلوب', variant: 'destructive' })
      return
    }
    if (!code.trim()) {
      toast({ title: 'الكود مطلوب', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const payload = {
        code: code.trim(),
        name: name.trim(),
        type,
        nature,
        openingBalance: Number(openingBalance) || 0,
        parentId: parentId === 'none' ? null : parentId,
        isActive,
      }
      const res = isEdit
        ? await fetch(`/api/accounts/${target?.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: data.error ?? 'فشل الحفظ', variant: 'destructive' })
        return
      }
      toast({ title: isEdit ? 'تم تعديل الحساب' : 'تم إنشاء الحساب بنجاح' })
      onSaved()
      onClose()
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'حدّث بيانات الحساب ثم احفظ.' : 'املأ بيانات الحساب الجديد ثم احفظ.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="acc-code">كود الحساب *</Label>
              <Input
                id="acc-code"
                value={code}
                onChange={(e) => {
                  setCodeTouched(true)
                  setCode(e.target.value)
                }}
                disabled={isEdit}
                dir="ltr"
                className="num text-left"
                placeholder="مثال: 1130"
              />
              {isEdit && <p className="text-[11px] text-muted-foreground">الكود لا يتغير بعد الإنشاء</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-name">اسم الحساب *</Label>
              <Input
                id="acc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: البنك العربي"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>نوع الحساب</Label>
              <Select
                value={type}
                onValueChange={(v) => {
                  const t = v as AccountType
                  setType(t)
                  setNature(natureForType(t))
                }}
              >
                <SelectTrigger aria-label="نوع الحساب">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {AR_ACCOUNT_TYPE[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>طبيعة الحساب</Label>
              <Select value={nature} onValueChange={(v) => setNature(v as AccountNature)}>
                <SelectTrigger aria-label="طبيعة الحساب">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEBIT">مدين</SelectItem>
                  <SelectItem value="CREDIT">دائن</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {!isSub && !isEdit && (
            <div className="space-y-1.5">
              <Label>الحساب الأب (اختياري)</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger aria-label="الحساب الأب">
                  <SelectValue placeholder="حساب رئيسي" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">— بدون أب (حساب رئيسي) —</SelectItem>
                  {parentOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {'\u00A0'.repeat(p.depth * 2)}
                      {p.code} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {isSub && target && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              الحساب الأب: <span className="font-semibold">{target.code} — {target.name}</span>
              <span className="ms-2 text-xs text-muted-foreground">
                (النوع والطبيعة مورّثان من الأب)
              </span>
            </div>
          )}

          {controlInfo && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
              <span className="font-semibold">مزامنة تلقائية:</span> الحساب تحت «{controlInfo.label}» —
              سيُنشأ معه ملف <span className="font-semibold">{controlInfo.fileLabel}</span> بنفس الاسم في
              الشاشة المعنية ({controlInfo.fileLabel === 'موظف' ? 'الموظفون' : 'العملاء والموردون'})
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="acc-opening">الرصيد الافتتاحي (ل.س)</Label>
              <NumInput
                id="acc-opening"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                className="text-left"
              />
            </div>
            {isEdit && (
              <div className="flex items-center gap-2 pb-1">
                <Switch id="acc-active" checked={isActive} onCheckedChange={setIsActive} />
                <Label htmlFor="acc-active">حساب نشط</Label>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ==================== نافذة تأكيد الحذف ====================

/** تحذير داخل تأكيد الحذف: الحساب مرتبط بملفات عميل/مورد/موظف ستُحذف معه — تعدد الأدوار: قد تكون عدة ملفات */
function LinkedFileWarning({ links }: { links: AccountLink[] }) {
  return (
    <span className="mt-2 block font-semibold text-amber-700 dark:text-amber-400">
      ⚠ الحساب مرتبط بـ{' '}
      {links
        .map((l) => {
          const label = l.kind === 'CUSTOMER' ? 'ملف عميل' : l.kind === 'SUPPLIER' ? 'ملف مورد' : 'ملف موظف'
          return `${label} ${l.code}`
        })
        .join(' و')}{' '}
      — ستُحذف الملفات معه من شاشاتها (يُمنع إن كان لأي منها مستندات).
    </span>
  )
}

interface AccountDeleteDialogProps {
  target: AccountDTO | null
  onClose: () => void
  onDeleted: () => void
}

export function AccountDeleteDialog({ target, onClose, onDeleted }: AccountDeleteDialogProps) {
  const { toast } = useToast()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!target) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/accounts/${target.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: 'تعذر الحذف', description: data.error, variant: 'destructive' })
        return
      }
      toast({ title: `تم حذف الحساب «${target.name}»` })
      onDeleted()
      onClose()
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>حذف الحساب؟</AlertDialogTitle>
          <AlertDialogDescription>
            سيتم حذف الحساب «{target?.code} — {target?.name}» نهائياً. هذا الإجراء لا يمكن التراجع عنه.
            {(() => {
              const links = target?.links && target.links.length > 0 ? target.links : target?.link ? [target.link] : []
              return links.length > 0 ? <LinkedFileWarning links={links} /> : null
            })()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel disabled={deleting}>تراجع</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              handleDelete()
            }}
            disabled={deleting}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            حذف نهائي
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ==================== نوافذ التقارير (دفتر أستاذ / كشف / تفصيلي) ====================

export type ReportMode = 'ledger' | 'summary' | 'detail'

interface AccountReportDialogProps {
  account: AccountDTO | null
  mode: ReportMode
  onClose: () => void
}

const reportLoadSeq = { current: 0 } // عدّاد تسلسلي لطلبات الكشف — يمنع طغيان استجابة أقدم

const REPORT_TITLES: Record<ReportMode, string> = {
  ledger: 'دفتر الأستاذ',
  summary: 'كشف الحساب (ملخص)',
  detail: 'الكشف التفصيلي',
}

export function AccountReportDialog({ account, mode, onClose }: AccountReportDialogProps) {
  const { toast } = useToast()
  const [data, setData] = useState<LedgerResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  // مرشّح فترة التاريخ (اختياري) — يُرسل from/to للـAPI فيطوي ما قبلها في رصيد سابق واحد
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  // توسيع بنود الفاتورة (Expandable Rows) — طياً افتراضياً، معرّفات الأسطر المفتوحة حالياً
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handlePrint = useCallback(
    (expandItems: boolean) => {
      if (!data) return
      const ok = printAccountReport(data, mode, expandItems)
      if (!ok) {
        toast({
          title: 'تعذر فتح نافذة الطباعة',
          description: 'المتصفح حجب النوافذ المنبثقة — اسمح بها لهذا الموقع ثم أعد المحاولة',
          variant: 'destructive',
        })
      }
    },
    [data, mode, toast],
  )

  const handleExport = useCallback(() => {
    if (!data) return
    const headers =
      mode === 'detail'
        ? ['المستند', 'التاريخ', 'البيان', 'الطرف / الموظف', 'الحساب الفرعي', 'مركز التكلفة', 'المصدر', 'مدين', 'دائن', 'الرصيد']
        : ['المستند', 'التاريخ', 'البيان', 'مدين', 'دائن', 'الرصيد']
    const rows = data.lines.map((l) => {
      const base = [l.documentNumber ?? l.entryNumber, l.date.slice(0, 10), l.description]
      const detailCols =
        mode === 'detail'
          ? [
              l.partnerName ?? '—',
              l.accountCode ? `${l.accountCode}${l.accountName ? ` — ${l.accountName}` : ''}` : '—',
              l.costCenterName ?? '—',
              AR_SOURCE[l.source] ?? l.source,
            ]
          : []
      return [...base, ...detailCols, l.debit, l.credit, l.balance]
    })
    exportTableToCsv({ filename: `ledger-${data.account.code}`, headers, rows })
  }, [data, mode])

  const load = useCallback(async (id: string, reportMode: ReportMode, from: string, to: string) => {
    const seq = ++reportLoadSeq.current
    setLoading(true)
    setLoadError(false)
    try {
      const qs = new URLSearchParams({ mode: reportMode })
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const res = await fetch(`/api/accounts/${id}/ledger?${qs.toString()}`)
      const json = res.ok ? await res.json().catch(() => null) : null
      if (seq !== reportLoadSeq.current) return
      if (json) setData(json)
      else setLoadError(true)
    } catch {
      if (seq === reportLoadSeq.current) setLoadError(true)
    } finally {
      if (seq === reportLoadSeq.current) setLoading(false)
    }
  }, [])

  // فتح نافذة جديدة (حساب مختلف): تصفير مرشّح التاريخ والتوسيع — لا يُحمَل سياق الحساب السابق
  const accountId = account?.id
  useEffect(() => {
    if (accountId) {
      setFromDate('')
      setToDate('')
      setExpandedIds(new Set())
    }
  }, [accountId])

  useEffect(() => {
    if (account && mode) {
      setData(null)
      load(account.id, mode, fromDate, toDate)
    }
  }, [account, mode, fromDate, toDate, load])

  const dirText = (dir: string) => directionLabel(dir as 'DEBIT' | 'CREDIT' | 'ZERO')
  const dirClass = (accountNature: string, dir: string) =>
    isOppositeDirection(accountNature as AccountNature, dir as 'DEBIT' | 'CREDIT' | 'ZERO')
      ? 'text-rose-600 dark:text-rose-400'
      : ''

  // عدد أعمدة الجدول محسوباً بدل ثوابت متفرقة — عمود التوسيع + المستند/التاريخ/البيان(3) +
  // (تفصيلي: الطرف/الحساب الفرعي/مركز التكلفة/المصدر) + مدين/دائن/الرصيد(3)
  const totalCols = 1 + 3 + (mode === 'detail' ? 4 : 0) + 3
  // عدد الأعمدة قبل مدين/دائن/الرصيد — يُستعمل لصف الافتتاحي وتذييل الإجمالي
  const leadingCols = totalCols - 3

  return (
    <Dialog open={!!account} onOpenChange={(v) => !v && onClose()}>
      <DialogContent variant="preview" className="w-[calc(100vw_-_var(--sidebar-w)_-_2rem)] sm:max-w-[1440px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {REPORT_TITLES[mode]}
            {account && (
              <span className="text-sm font-normal text-muted-foreground num">
                {account.code} — {account.name}
              </span>
            )}
            {account && (
              <Badge variant="outline">{AR_ACCOUNT_TYPE[account.type]}</Badge>
            )}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {data?.basedOn === 'DOCUMENTS' ? (
              <>
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                >
                  كشف من مستندات الطرف
                </Badge>
                <span>فواتيره ومردوداته وسنداته وسلفه — العملة: الليرة السورية</span>
              </>
            ) : (
              <>حركة القيود المُرحّلة فقط — العملة: الليرة السورية</>
            )}
          </DialogDescription>
          {/* شريط الفلترة والإجراءات — في التدفق العادي (لا absolute) فلا يتراكب أبداً مع
              العنوان/الوصف مهما طال نصهما، وحقلا التاريخ بـ dir="ltr" الصريح كي لا يُعاد
              ترتيب مقاطع يوم/شهر/سنة بصرياً داخل صفحة RTL (سبب التشوه والتداخل السابق) */}
          <div className="no-print flex flex-wrap items-end justify-end gap-2 border-t pt-3">
            <div className="flex items-end gap-1.5">
              <div className="space-y-1">
                <Label htmlFor="report-from" className="text-[10px] text-muted-foreground">من تاريخ</Label>
                <Input
                  id="report-from"
                  type="date"
                  dir="ltr"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="num h-8 w-[136px] text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="report-to" className="text-[10px] text-muted-foreground">إلى تاريخ</Label>
                <Input
                  id="report-to"
                  type="date"
                  dir="ltr"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="num h-8 w-[136px] text-xs"
                />
              </div>
              {(fromDate || toDate) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs text-muted-foreground"
                  onClick={() => {
                    setFromDate('')
                    setToDate('')
                  }}
                >
                  مسح
                </Button>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-primary"
              onClick={() => handlePrint(false)}
              disabled={loading || !data}
              title="طباعة التقرير بترويسة الشركة"
            >
              <Printer className="h-4 w-4" />
              طباعة
            </Button>
            {data?.lines.some((l) => l.items && l.items.length > 0) && (
              <Button
                size="sm"
                variant="outline"
                className="text-primary"
                onClick={() => handlePrint(true)}
                disabled={loading || !data}
                title="طباعة الكشف مع توسيع بنود كل فاتورة تحتها مباشرة"
              >
                <ListTree className="h-4 w-4" />
                طباعة تفصيلية للبنود
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="text-primary"
              onClick={handleExport}
              disabled={loading || !data}
              title="تصدير حركة الحساب إلى ملف إكسل CSV"
            >
              <FileSpreadsheet className="h-4 w-4" />
              تصدير إكسل
            </Button>
          </div>
        </DialogHeader>

        {loading && (
          <div className="space-y-2 py-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        )}

        {!loading && !data && loadError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive">
            تعذر تحميل كشف الحساب — أغلق النافذة وأعد فتحها للمحاولة من جديد
          </div>
        )}

        {!loading && data && (
          <div className="space-y-4">
            {/* الملخص */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">{data.totals.openingRef ?? 'الرصيد الافتتاحي'}</p>
                <p className="mt-1 text-sm font-bold num">{fmtMoney(data.totals.opening)}</p>
                <p className={`text-[11px] mt-0.5 ${dirClass(data.account.nature, data.totals.openingDirection)}`}>
                  {dirText(data.totals.openingDirection)}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">إجمالي المدين</p>
                <p className="mt-1 text-sm font-bold num text-emerald-600 dark:text-emerald-400">
                  {fmtMoney(data.totals.totalDebit)}
                </p>
                <p className="text-[11px] mt-0.5 num">{fmtUSD(data.totals.totalDebit)}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">إجمالي الدائن</p>
                <p className="mt-1 text-sm font-bold num text-rose-600 dark:text-rose-400">
                  {fmtMoney(data.totals.totalCredit)}
                </p>
                <p className="text-[11px] mt-0.5 num">{fmtUSD(data.totals.totalCredit)}</p>
              </div>
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">الرصيد الختامي</p>
                <p className="mt-1 text-sm font-bold num">{fmtMoney(data.totals.closing)}</p>
                <p className={`text-[11px] mt-0.5 ${dirClass(data.account.nature, data.totals.closingDirection)}`}>
                  {dirText(data.totals.closingDirection)}
                </p>
              </div>
            </div>

            <Separator />

            {(mode === 'ledger' || mode === 'detail') && (
              <div className="rounded-lg border overflow-hidden">
                <div className="max-h-[45vh] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/95 backdrop-blur">
                      <tr className="text-muted-foreground text-xs">
                        <th className="w-8 px-1 py-2" aria-hidden="true"></th>
                        <th className="px-3 py-2 text-center font-medium">المستند</th>
                        <th className="px-3 py-2 text-center font-medium">التاريخ</th>
                        <th className="px-3 py-2 text-center font-medium">البيان</th>
                        {mode === 'detail' && (
                          <>
                            <th className="px-3 py-2 text-center font-medium">الطرف / الموظف</th>
                            <th className="px-3 py-2 text-center font-medium">الحساب الفرعي</th>
                            <th className="px-3 py-2 text-center font-medium">مركز التكلفة</th>
                            <th className="px-3 py-2 text-center font-medium">المصدر</th>
                          </>
                        )}
                        <th className="px-3 py-2 text-center font-medium">مدين</th>
                        <th className="px-3 py-2 text-center font-medium">دائن</th>
                        <th className="px-3 py-2 text-center font-medium">الرصيد</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t bg-muted/30">
                        <td className="px-3 py-1.5 text-xs text-muted-foreground" colSpan={totalCols - 1}>
                          {data.totals.openingRef ?? 'رصيد ما قبل الحركة (افتتاحي)'}
                        </td>
                        <td className="px-3 py-1.5 text-end num text-xs">
                          {fmtMoney(data.totals.opening)}
                          <span className={`ms-1 text-[10px] ${dirClass(data.account.nature, data.totals.openingDirection)}`}>
                            {dirText(data.totals.openingDirection)}
                          </span>
                        </td>
                      </tr>
                      {data.lines.map((l) => {
                        const hasItems = !!l.items && l.items.length > 0
                        const isExpanded = expandedIds.has(l.id)
                        return (
                          <Fragment key={l.id}>
                            <tr className="border-t hover:bg-accent/30">
                              <td className="px-1 py-1.5 text-center">
                                {hasItems && (
                                  <button
                                    type="button"
                                    onClick={() => toggleExpanded(l.id)}
                                    className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                    aria-label={isExpanded ? 'طي بنود الفاتورة' : 'توسيع بنود الفاتورة'}
                                    title={isExpanded ? 'طي بنود الفاتورة' : `عرض ${l.items!.length} بنداً`}
                                  >
                                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
                                  </button>
                                )}
                              </td>
                              <td className="px-3 py-1.5 num text-xs font-medium">
                                {l.documentNumber ?? l.entryNumber}
                                {l.documentNumber && l.documentNumber !== l.entryNumber && (
                                  <span className="block text-[10px] font-normal text-muted-foreground">{l.entryNumber}</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 num text-xs whitespace-nowrap">{fmtDate(l.date)}</td>
                              <td className="px-3 py-1.5 max-w-[240px] truncate" title={l.description}>
                                {l.description}
                              </td>
                              {mode === 'detail' && (
                                <>
                                  <td className="px-3 py-1.5 text-xs">{l.partnerName ?? '—'}</td>
                                  <td className="px-3 py-1.5 text-xs">
                                    {l.accountCode ? (
                                      <>
                                        <span className="num font-medium">{l.accountCode}</span>
                                        {l.accountName && (
                                          <span className="ms-1 text-muted-foreground">— {l.accountName}</span>
                                        )}
                                      </>
                                    ) : (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 text-xs">{l.costCenterName ?? '—'}</td>
                                  <td className="px-3 py-1.5 text-xs">{AR_SOURCE[l.source] ?? l.source}</td>
                                </>
                              )}
                              <td className="px-3 py-1.5 text-end num text-xs text-emerald-700 dark:text-emerald-400">
                                {l.debit ? fmtMoney(l.debit) : '—'}
                              </td>
                              <td className="px-3 py-1.5 text-end num text-xs text-rose-700 dark:text-rose-400">
                                {l.credit ? fmtMoney(l.credit) : '—'}
                              </td>
                              <td className="px-3 py-1.5 text-end num text-xs">
                                {fmtMoney(l.balance)}
                                <span className={`ms-1 text-[10px] ${dirClass(data.account.nature, l.balanceDirection)}`}>
                                  {dirText(l.balanceDirection)}
                                </span>
                              </td>
                            </tr>
                            {hasItems && isExpanded && (
                              <tr className="border-t bg-muted/20">
                                <td></td>
                                <td colSpan={totalCols - 1} className="px-3 py-2 ps-8">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-muted-foreground">
                                        <th className="px-2 py-1 text-start font-medium">المادة</th>
                                        <th className="w-20 px-2 py-1 text-center font-medium">الكمية</th>
                                        <th className="w-28 px-2 py-1 text-end font-medium">السعر</th>
                                        <th className="w-28 px-2 py-1 text-end font-medium">الإجمالي</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {l.items!.map((it, i) => (
                                        <tr key={i} className="border-t border-dashed">
                                          <td className="px-2 py-1">{it.itemName}</td>
                                          <td className="num px-2 py-1 text-center">{it.quantity}</td>
                                          <td className="num px-2 py-1 text-end">{fmtMoney(it.unitPrice)}</td>
                                          <td className="num px-2 py-1 text-end font-medium">{fmtMoney(it.total)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                      {data.lines.length === 0 && (
                        <tr>
                          <td colSpan={totalCols} className="px-3 py-8 text-center text-muted-foreground">
                            لا توجد حركات مُرحّلة على هذا الحساب
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 bg-muted/60 font-semibold">
                        <td className="px-3 py-2 text-xs" colSpan={leadingCols}>
                          الإجمالي ({data.totals.count} حركة)
                        </td>
                        <td className="px-3 py-2 text-end num text-xs">{fmtMoney(data.totals.totalDebit)}</td>
                        <td className="px-3 py-2 text-end num text-xs">{fmtMoney(data.totals.totalCredit)}</td>
                        <td className="px-3 py-2 text-end num text-xs">
                          {fmtMoney(data.totals.closing)}
                          <span className={`ms-1 text-[10px] ${dirClass(data.account.nature, data.totals.closingDirection)}`}>
                            {dirText(data.totals.closingDirection)}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

