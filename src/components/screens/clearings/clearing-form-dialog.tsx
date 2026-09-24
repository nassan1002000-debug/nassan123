'use client'

// نموذج إنشاء سند مقاصة — Task 101
// اختيار الشخص (من يجمع صفات متعددة) → بطاقات أدواره وأرصدته → اقتراح آلي للأزواج المتقابلة
// → تعديل حر للمبالغ → حفظ وترحيل بقيد متوازن MC-xxxx بلا أي حركة نقدية

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, Loader2, Plus, Scale, Trash2, UserRound } from 'lucide-react'
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
import { fmtMoney, todayYMD } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ClearingPersonRow, ClearingRoleRow, EditablePair } from './types'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

const todayStr = () => todayYMD()

const roleBadgeClass = (kind: string) =>
  kind === 'CUSTOMER'
    ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
    : kind === 'SUPPLIER'
      ? 'bg-rose-500/12 text-rose-700 dark:text-rose-400 border-rose-500/30'
      : 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/30'

/** بطاقة دور — الرصيد الموقّع: موجب عليه (مدين لنا) وسالب له (دائن) */
function RoleCard({ role }: { role: ClearingRoleRow }) {
  const abs = Math.abs(role.balance)
  const state =
    Math.abs(role.balance) < 0.005
      ? { text: 'متزن — لا حاجة للمقاصة', cls: 'text-muted-foreground' }
      : role.balance > 0
        ? { text: `مدين لنا بـ ${fmtMoney(abs)}`, cls: 'text-emerald-600 dark:text-emerald-400 font-bold' }
        : { text: `دائن له بـ ${fmtMoney(abs)}`, cls: 'text-rose-600 dark:text-rose-400 font-bold' }
  return (
    <div className="rounded-lg border bg-card/60 p-3" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className={roleBadgeClass(role.kind)}>
          {role.label}
        </Badge>
        <span className="num text-xs text-muted-foreground" dir="ltr">
          {role.refCode}
        </span>
      </div>
      <div className="mt-2 text-sm font-semibold leading-tight">{role.accountName}</div>
      <div className="num text-[11px] text-muted-foreground" dir="ltr">
        {role.accountCode}
      </div>
      <div className={cn('mt-1.5 text-sm', state.cls)}>{state.text}</div>
    </div>
  )
}

export function ClearingFormDialog({ open, onClose, onCreated }: Props) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [persons, setPersons] = useState<ClearingPersonRow[]>([])
  const [personKey, setPersonKey] = useState('')
  const [date, setDate] = useState(todayStr())
  const [notes, setNotes] = useState('')
  const [pairs, setPairs] = useState<EditablePair[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setPersonKey('')
    setPairs([])
    setNotes('')
    setDate(todayStr())
    fetch('/api/clearings?candidates=1')
      .then((r) => (r.ok ? r.json() : { persons: [] }))
      .then((d: { persons?: ClearingPersonRow[] }) => setPersons(d.persons ?? []))
      .catch(() => setPersons([]))
      .finally(() => setLoading(false))
  }, [open])

  const person = useMemo(() => persons.find((p) => p.key === personKey) ?? null, [persons, personKey])

  // اختيار الشخص يعيد بناء الأزواج من اقتراحاته الآلية
  useEffect(() => {
    if (!person) {
      setPairs([])
      return
    }
    setPairs(
      person.suggestions.map((s) => ({
        debitAccountId: s.debitAccountId,
        creditAccountId: s.creditAccountId,
        amount: String(s.amount),
      })),
    )
  }, [person])

  const roleById = useMemo(() => {
    const m = new Map<string, ClearingRoleRow>()
    for (const r of person?.roles ?? []) m.set(r.accountId, r)
    return m
  }, [person])

  const pairsValid =
    pairs.length > 0 &&
    pairs.every(
      (p) =>
        p.debitAccountId &&
        p.creditAccountId &&
        p.debitAccountId !== p.creditAccountId &&
        Number(p.amount) > 0,
    )
  const valid = !!person && !!date && pairsValid

  const addPair = () => setPairs((prev) => [...prev, { debitAccountId: '', creditAccountId: '', amount: '' }])
  const removePair = (idx: number) => setPairs((prev) => prev.filter((_, i) => i !== idx))
  const updatePair = (idx: number, patch: Partial<EditablePair>) =>
    setPairs((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)))

  const submit = async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/clearings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          notes: notes.trim() || null,
          pairs: pairs.map((p) => ({
            debitAccountId: p.debitAccountId,
            creditAccountId: p.creditAccountId,
            amount: Number(p.amount),
          })),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ title: 'تعذر حفظ سند المقاصة', description: data?.error ?? 'خطأ غير متوقع', variant: 'destructive' })
        return
      }
      toast({
        title: `تم إنشاء سند المقاصة ${data?.voucher?.number ?? ''}`,
        description: 'رُحّل بالقيد المتوازن — يظهر في دفتر الأستاذ وكشوف الأطراف فوراً',
      })
      onCreated()
      onClose()
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" aria-hidden />
            سند مقاصة جديد
          </DialogTitle>
          <DialogDescription>
            موازنة الذمم المتقابلة لشخص يجمع أكثر من صفة (عميل ↔ مورد ↔ موظف) — بلا أي حركة نقدية على الصندوق
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> جارٍ تحميل المرشحين…
          </div>
        ) : persons.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
            <UserRound className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm font-semibold">لا يوجد شخص يجمع بين أكثر من صفة حالياً</p>
            <p className="max-w-md text-xs text-muted-foreground">
              سند المقاصة يعوّض أرصدة الشخص الواحد عبر صفاته المختلفة — أنشئ ملفي طرف (عميل ومورد) أو
              (طرف وموظف) بالاسم نفسه في «العملاء والموردون» و«ملفات الموظفين» وسيظهرا هنا تلقائياً
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* اختيار الشخص */}
            <div className="grid gap-1.5">
              <Label htmlFor="clearing-person">الشخص (صفات متعددة)</Label>
              <Select value={personKey} onValueChange={setPersonKey}>
                <SelectTrigger id="clearing-person" aria-label="اختيار الشخص">
                  <SelectValue placeholder="اختر الشخص…" />
                </SelectTrigger>
                <SelectContent>
                  {persons.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.name}
                      {p.suggestions.length > 0
                        ? ` — ${p.roles.length} صفات (يُقترح مقاصة ${p.suggestions.length})`
                        : ` — ${p.roles.length} صفات (بلا أرصدة متقابلة)`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* بطاقات الأدوار والأرصدة */}
            {person && (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {person.roles.map((r) => (
                    <RoleCard key={r.accountId} role={r} />
                  ))}
                </div>

                {/* الأزواج */}
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label>أزواج المقاصة (مدين ↔ دائن)</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addPair}>
                      <Plus className="h-4 w-4" aria-hidden /> إضافة زوج
                    </Button>
                  </div>
                  {person.suggestions.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      قُترحت الأزواج أدناه آلياً من الأرصدة المتقابلة — عدّل المبالغ أو أضف أزواجاً بحرية
                    </p>
                  )}
                  {pairs.length === 0 && (
                    <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                      لا توجد أرصدة متقابلة بين صفات هذا الشخص — أضف زوجاً يدوياً إن رغبت
                    </p>
                  )}
                  {pairs.map((p, idx) => {
                    const debitRole = roleById.get(p.debitAccountId)
                    const creditRole = roleById.get(p.creditAccountId)
                    const debitCap = debitRole ? Math.abs(debitRole.balance) : null
                    const creditCap = creditRole ? Math.abs(creditRole.balance) : null
                    const capHint =
                      debitCap !== null && creditCap !== null
                        ? Math.min(debitCap, creditCap)
                        : null
                    return (
                      <div key={idx} className="grid gap-2 rounded-lg border bg-card/40 p-3 sm:grid-cols-[1fr_auto_1fr_140px_auto] sm:items-center">
                        <Select value={p.debitAccountId || undefined} onValueChange={(v) => updatePair(idx, { debitAccountId: v })}>
                          <SelectTrigger aria-label="الحساب المدين" className="w-full">
                            <SelectValue placeholder="مدين — علينا له…" />
                          </SelectTrigger>
                          <SelectContent>
                            {person.roles.map((r) => (
                              <SelectItem key={r.accountId} value={r.accountId} disabled={r.accountId === p.creditAccountId}>
                                {r.accountName} ({r.label})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <ArrowLeftRight className="mx-auto h-4 w-4 rotate-90 text-muted-foreground sm:rotate-0" aria-hidden />
                        <Select value={p.creditAccountId || undefined} onValueChange={(v) => updatePair(idx, { creditAccountId: v })}>
                          <SelectTrigger aria-label="الحساب الدائن" className="w-full">
                            <SelectValue placeholder="دائن — لنا عليه…" />
                          </SelectTrigger>
                          <SelectContent>
                            {person.roles.map((r) => (
                              <SelectItem key={r.accountId} value={r.accountId} disabled={r.accountId === p.debitAccountId}>
                                {r.accountName} ({r.label})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <NumInput
                          value={p.amount}
                          onChange={(e) => updatePair(idx, { amount: e.target.value })}
                          placeholder="المبلغ"
                          aria-label={`مبلغ الزوج ${idx + 1}`}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removePair(idx)}
                          aria-label={`حذف الزوج ${idx + 1}`}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                        {capHint !== null && capHint > 0 && (
                          <p className="num text-[11px] text-muted-foreground sm:col-span-5" dir="ltr">
                            ≤ {fmtMoney(capHint)}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* التاريخ والبيان */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="clearing-date">التاريخ</Label>
                    <Input
                      id="clearing-date"
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="clearing-notes">البيان / السبب (اختياري)</Label>
                    <Textarea
                      id="clearing-notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="مثال: مقاصة متبادلة بين حسابات العميل والمورد بالاسم الواحد"
                      rows={1}
                      className="min-h-10"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button type="button" onClick={submit} disabled={!valid || saving || loading || persons.length === 0}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> جارٍ الحفظ والترحيل…
              </>
            ) : (
              <>
                <Scale className="h-4 w-4" aria-hidden /> حفظ وترحيل
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
