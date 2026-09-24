'use client'

// نموذج إنشاء/تعديل قيد يومية — بنود ديناميكية + مؤشر توازن حيّ + حفظ كمسودة أو حفظ وترحيل

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { AR_SOURCE, fmtMoney } from '@/lib/format'
import { round2 } from '@/lib/math'
import { cn } from '@/lib/utils'
import { AccountCombobox, flattenAccounts, type AccountApiNode } from './account-combobox'
import type { CostCenterOption, FlatAccount, JournalEntryDetail } from './types'

interface FormLine {
  key: string
  accountId: string | null
  description: string
  costCenterId: string
  debit: string
  credit: string
}

interface JournalFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** معرّف القيد عند التعديل — null للإنشاء */
  editId: string | null
  /** الرقم المقترح للقيد الجديد (للعرض فقط) */
  nextNumber: string
  onSaved: () => void
}

function todayYMD(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ymdOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return todayYMD()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function JournalFormDialog({ open, onOpenChange, editId, nextNumber, onSaved }: JournalFormDialogProps) {
  const { toast } = useToast()
  const keyCounter = useRef(0)

  const [entryLoading, setEntryLoading] = useState(false)
  const [saving, setSaving] = useState<'DRAFT' | 'POSTED' | null>(null)
  const [date, setDate] = useState<string>(todayYMD)
  const [description, setDescription] = useState('')
  const [source, setSource] = useState('MANUAL')
  const [lines, setLines] = useState<FormLine[]>([])
  const [accounts, setAccounts] = useState<FlatAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [costCenters, setCostCenters] = useState<CostCenterOption[]>([])

  const emptyLine = useCallback((): FormLine => {
    keyCounter.current += 1
    return {
      key: `line-${keyCounter.current}`,
      accountId: null,
      description: '',
      costCenterId: '',
      debit: '',
      credit: '',
    }
  }, [])

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true)
    setAccountsError(null)
    try {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      // /api/accounts يرجع مصفوفة flat بـ parentId — flattenAccounts يحوّلها لمستويات ومسارات
      const raw = Array.isArray(data) ? (data as AccountApiNode[]) : []
      setAccounts(flattenAccounts(raw).filter((a) => a.isActive))
    } catch {
      setAccountsError('تعذر تحميل دليل الحسابات — تحقق من الاتصال ثم أعد المحاولة')
    } finally {
      setAccountsLoading(false)
    }
  }, [])

  // تحميل بيانات النموذج عند الفتح
  useEffect(() => {
    if (!open) return
    keyCounter.current = 0
    setDate(todayYMD())
    setDescription('')
    setSource('MANUAL')
    setLines([emptyLine(), emptyLine()])
    setCostCenters([])

    if (editId) {
      setEntryLoading(true)
      fetch(`/api/journal/${editId}`)
        .then((r) => {
          if (!r.ok) throw new Error('failed')
          return r.json()
        })
        .then((e: JournalEntryDetail) => {
          setDate(ymdOf(e.date))
          setDescription(e.description)
          setSource(e.source)
          keyCounter.current = 0
          setLines(
            e.lines.map((l) => {
              keyCounter.current += 1
              return {
                key: `line-${keyCounter.current}`,
                accountId: l.accountId,
                description: l.description ?? '',
                costCenterId: l.costCenter?.id ?? '',
                debit: l.debit ? String(l.debit) : '',
                credit: l.credit ? String(l.credit) : '',
              }
            }),
          )
        })
        .catch(() => {
          toast({ title: 'تعذر تحميل بيانات القيد', variant: 'destructive' })
          onOpenChange(false)
        })
        .finally(() => setEntryLoading(false))
    }

    void loadAccounts()
    fetch('/api/cost-centers')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((d: unknown) => setCostCenters(Array.isArray(d) ? (d as CostCenterOption[]) : []))
      .catch(() => setCostCenters([]))
  }, [open, editId, emptyLine, loadAccounts, toast, onOpenChange])

  // ===== المؤشرات الحيّة =====
  const totals = useMemo(() => {
    let d = 0
    let c = 0
    for (const l of lines) {
      d += Number(l.debit) || 0
      c += Number(l.credit) || 0
    }
    d = round2(d)
    c = round2(c)
    return { debit: d, credit: c, diff: round2(d - c) }
  }, [lines])

  const balanced = Math.abs(totals.diff) < 0.01 && totals.debit > 0

  const invalidLines = useMemo(
    () =>
      lines.filter((l) => {
        const d = Number(l.debit) || 0
        const c = Number(l.credit) || 0
        return !l.accountId || (d === 0 && c === 0) || (d > 0 && c > 0)
      }).length,
    [lines],
  )

  const problem = entryLoading
    ? 'جاري تحميل بيانات القيد…'
    : !description.trim()
      ? 'أدخل بيان القيد أولاً'
      : !date
        ? 'أدخل تاريخ القيد'
        : invalidLines > 0
          ? `أكمل بنود القيد — هناك ${invalidLines} بند ناقص (حساب أو مبلغ في طرف واحد)`
          : !balanced
            ? 'القيد غير متوازن — لا يمكن الحفظ حتى يتساوى المدين والدائن'
            : null

  const canSave = !problem && !saving

  // ===== إدارة البنود =====
  const updateLine = useCallback((key: string, patch: Partial<FormLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }, [])

  const removeLine = useCallback((key: string) => {
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((l) => l.key !== key)))
  }, [])

  const addLine = useCallback(() => {
    setLines((prev) => [...prev, emptyLine()])
  }, [emptyLine])

  // ===== الحفظ =====
  const save = useCallback(
    async (status: 'DRAFT' | 'POSTED') => {
      if (!description.trim()) {
        toast({ title: 'البيان مطلوب', description: 'أدخل بيان القيد قبل الحفظ', variant: 'destructive' })
        return
      }
      if (!date) {
        toast({ title: 'تاريخ القيد مطلوب', variant: 'destructive' })
        return
      }
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]
        const d = Number(l.debit) || 0
        const c = Number(l.credit) || 0
        if (!l.accountId) {
          toast({ title: `البند ${i + 1}: اختر الحساب`, variant: 'destructive' })
          return
        }
        if (d === 0 && c === 0) {
          toast({ title: `البند ${i + 1}: أدخل مبلغاً مديناً أو دائناً`, variant: 'destructive' })
          return
        }
        if (d > 0 && c > 0) {
          toast({ title: `البند ${i + 1}: لا يمكن إدخال مبالغ في الطرفين معاً`, variant: 'destructive' })
          return
        }
      }
      if (!balanced) {
        toast({
          title: 'القيد غير متوازن',
          description: `الفرق بين المدين والدائن: ${fmtMoney(Math.abs(totals.diff))}`,
          variant: 'destructive',
        })
        return
      }

      setSaving(status)
      try {
        const res = await fetch(editId ? `/api/journal/${editId}` : '/api/journal', {
          method: editId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date,
            description: description.trim(),
            source,
            status,
            lines: lines.map((l) => ({
              accountId: l.accountId,
              debit: Number(l.debit) || 0,
              credit: Number(l.credit) || 0,
              description: l.description.trim() || undefined,
              costCenterId: l.costCenterId || undefined,
            })),
          }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          toast({
            title: 'تعذر حفظ القيد',
            description: (data as { error?: string } | null)?.error ?? 'حدث خطأ غير متوقع',
            variant: 'destructive',
          })
          return
        }
        const number = (data as { number?: string } | null)?.number ?? ''
        toast({
          title:
            status === 'POSTED'
              ? editId
                ? 'تم تحديث القيد وترحيله بنجاح'
                : 'تم إنشاء القيد وترحيله بنجاح'
              : editId
                ? 'تم تحديث المسودة بنجاح'
                : 'تم حفظ القيد كمسودة',
          description: `رقم القيد: ${number}`,
        })
        onSaved()
        onOpenChange(false)
      } catch {
        toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
      } finally {
        setSaving(null)
      }
    },
    [balanced, date, description, editId, lines, onOpenChange, onSaved, source, toast, totals.diff],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94vh] w-[calc(100vw_-_var(--sidebar-w)_-_1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1152px]">
        {/* الرأس */}
        <div className="border-b px-5 py-4">
          <DialogHeader className="text-start">
            <DialogTitle>{editId ? 'تعديل قيد يومية' : 'قيد يومية جديد'}</DialogTitle>
            <DialogDescription>
              أدخل بيانات القيد وبنوده — يجب أن يتساوى المدين والدائن قبل الحفظ
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* المتن */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {entryLoading && (
            <div className="flex items-center justify-center gap-2 rounded-lg border bg-muted/40 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري تحميل بيانات القيد…
            </div>
          )}

          <div className={cn('space-y-4', entryLoading && 'pointer-events-none opacity-40')}>
            {/* بيانات القيد الأساسية */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-xs">رقم القيد</Label>
                <Input
                  value={editId ? '' : nextNumber}
                  placeholder={editId ? '—' : nextNumber}
                  disabled
                  className="num h-9 bg-muted/50 text-muted-foreground"
                  title="يُولَّد الرقم تلقائياً عند الحفظ"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  التاريخ <span className="text-rose-500">*</span>
                </Label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">المصدر</Label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(AR_SOURCE)
                      // سند المقاصة مصدر آلي تُنشئه /api/clearings حصراً — لا يُختار يدوياً
                      .filter(([key]) => key !== 'CLEARING')
                      .map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">عدد البنود</Label>
                <div className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
                  <Badge variant="outline" className="num">
                    {lines.length}
                  </Badge>
                  <span className="text-xs text-muted-foreground">بنداً على الأقل</span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                البيان <span className="text-rose-500">*</span>
              </Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="مثال: إثبات مبيعات نقدية لشهر كانون الثاني…"
                rows={2}
                className="resize-none"
              />
            </div>

            {/* بنود القيد */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">
                  بنود القيد <span className="text-rose-500">*</span>
                </Label>
                {accountsError && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void loadAccounts()}>
                    إعادة تحميل الحسابات
                  </Button>
                )}
              </div>

              {accountsError && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {accountsError}
                </div>
              )}

              <div className="overflow-x-auto rounded-lg border">
                <Table className="min-w-[880px]">
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="w-10 text-center">م</TableHead>
                      <TableHead className="min-w-[230px]">الحساب</TableHead>
                      <TableHead className="min-w-[150px]">البيان</TableHead>
                      <TableHead className="min-w-[160px]">مركز التكلفة</TableHead>
                      <TableHead className="w-32 text-center">مدين</TableHead>
                      <TableHead className="w-32 text-center">دائن</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, i) => {
                      const d = Number(l.debit) || 0
                      const c = Number(l.credit) || 0
                      const invalid = !l.accountId || (d === 0 && c === 0) || (d > 0 && c > 0)
                      return (
                        <TableRow key={l.key} className={cn(invalid && 'bg-rose-500/[0.04]')}>
                          <TableCell className="num text-center text-xs text-muted-foreground">
                            {i + 1}
                          </TableCell>
                          <TableCell>
                            <AccountCombobox
                              accounts={accounts}
                              value={l.accountId}
                              loading={accountsLoading}
                              onChange={(accountId) => updateLine(l.key, { accountId })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={l.description}
                              onChange={(e) => updateLine(l.key, { description: e.target.value })}
                              placeholder="بيان البند (اختياري)"
                              className="h-9 text-sm"
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={l.costCenterId || 'NONE'}
                              onValueChange={(v) => updateLine(l.key, { costCenterId: v === 'NONE' ? '' : v })}
                            >
                              <SelectTrigger className="h-9 w-full text-sm">
                                <SelectValue placeholder="بدون" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NONE">بدون مركز</SelectItem>
                                {costCenters.map((cc) => (
                                  <SelectItem key={cc.id} value={cc.id}>
                                    <span className="num text-xs text-muted-foreground">{cc.code}</span>
                                    {' — '}
                                    {cc.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <NumInput
                              value={l.debit}
                              onChange={(e) =>
                                updateLine(l.key, {
                                  debit: e.target.value,
                                  credit: e.target.value && Number(e.target.value) > 0 ? '' : l.credit,
                                })
                              }
                              placeholder="0.00"
                              className="h-9 text-start"
                            />
                          </TableCell>
                          <TableCell>
                            <NumInput
                              value={l.credit}
                              onChange={(e) =>
                                updateLine(l.key, {
                                  credit: e.target.value,
                                  debit: e.target.value && Number(e.target.value) > 0 ? '' : l.debit,
                                })
                              }
                              placeholder="0.00"
                              className="h-9 text-start"
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
                              disabled={lines.length <= 2}
                              title={lines.length <= 2 ? 'الحد الأدنى بندين' : 'حذف البند'}
                              onClick={() => removeLine(l.key)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <Button type="button" variant="outline" size="sm" onClick={addLine} disabled={accountsLoading}>
                <Plus className="h-4 w-4" />
                إضافة بند
              </Button>
            </div>
          </div>
        </div>

        {/* المؤشر الحيّ للأرصدة + أزرار الحفظ */}
        <div className="space-y-3 border-t bg-muted/30 px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="text-muted-foreground">
                إجمالي المدين:{' '}
                <span className="num font-bold text-foreground">{fmtMoney(totals.debit)}</span>
              </span>
              <span className="text-muted-foreground">
                إجمالي الدائن:{' '}
                <span className="num font-bold text-foreground">{fmtMoney(totals.credit)}</span>
              </span>
              <span className="text-muted-foreground">
                الفرق:{' '}
                <span className="num font-bold text-foreground">{fmtMoney(Math.abs(totals.diff))}</span>
              </span>
            </div>
            {balanced ? (
              <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                متوازن ✓
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                غير متوازن — الفرق {fmtMoney(Math.abs(totals.diff))}
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block" tabIndex={canSave ? -1 : 0}>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!canSave}
                    onClick={() => void save('DRAFT')}
                  >
                    {saving === 'DRAFT' && <Loader2 className="h-4 w-4 animate-spin" />}
                    حفظ كمسودة
                  </Button>
                </span>
              </TooltipTrigger>
              {problem && <TooltipContent>{problem}</TooltipContent>}
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block" tabIndex={canSave ? -1 : 0}>
                  <Button type="button" disabled={!canSave} onClick={() => void save('POSTED')}>
                    {saving === 'POSTED' && <Loader2 className="h-4 w-4 animate-spin" />}
                    حفظ وترحيل
                  </Button>
                </span>
              </TooltipTrigger>
              {problem && <TooltipContent>{problem}</TooltipContent>}
            </Tooltip>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
