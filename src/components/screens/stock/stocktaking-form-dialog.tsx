'use client'

// نافذة أمر جرد جديد — اختيار قسم نهائي يملأ الجدول بمواده تلقائياً:
// • كمية النظام تُجلب من الأرصدة الحالية (والخادم يعيد احتسابها عند الحفظ — مصدر الحقيقة)
// • الكمية المجرودة تُملأ مسبقاً = كمية النظام (تعديل السطر يميّزه بصرياً بفرق)
// • فلتر «الفروقات فقط» + بحث بالأسطر + ملخص حي (زيادات/نقصات/قيمة الفرق)

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarDays, ClipboardCheck, Diff, Save, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NumInput } from '@/components/ui/number-input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { fmtMoney, fmtNumber, fmtQty, fmtUSD, todayYMD } from '@/lib/format'
import { estimatedCostOf, type ItemLite, type WarehouseLite } from './types'

interface DraftLine {
  item: ItemLite
  systemQty: number
  countedQty: number
}

interface StocktakingFormDialogProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  items: ItemLite[]
  warehouses: WarehouseLite[]
}

export function StocktakingFormDialog({ open, onClose, onSaved, items, warehouses }: StocktakingFormDialogProps) {
  const { toast } = useToast()
  const [warehouseId, setWarehouseId] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(() => todayYMD())
  const [lineSearch, setLineSearch] = useState('')
  const [diffOnly, setDiffOnly] = useState(false)
  const [saving, setSaving] = useState(false)

  const warehouse = warehouses.find((w) => w.id === warehouseId) ?? null

  // إعادة ضبط النموذج عند كل فتح — لا قسم ولا أسطر قديمة من جلسة سابقة
  useEffect(() => {
    if (!open) return
    setWarehouseId('')
    setLines([])
    setNotes('')
    setDate(todayYMD())
    setLineSearch('')
    setDiffOnly(false)
  }, [open])

  /** اختيار القسم يملأ الأسطر بموادّه من بطاقات المواد (الكمية بنظام من الأرصدة) */
  function pickWarehouse(id: string) {
    setWarehouseId(id)
    const sectionItems = items.filter((i) => i.warehouseId === id || i.balances.some((b) => b.warehouseId === id))
    setLines(
      sectionItems.map((i) => ({
        item: i,
        systemQty: i.balances.find((b) => b.warehouseId === id)?.quantity ?? 0,
        countedQty: i.balances.find((b) => b.warehouseId === id)?.quantity ?? 0,
      })),
    )
    setLineSearch('')
    setDiffOnly(false)
  }

  function setCounted(itemId: string, value: number) {
    setLines((prev) => prev.map((ln) => (ln.item.id === itemId ? { ...ln, countedQty: value } : ln)))
  }

  // ملخص حي — القيمة التقديرية بنفس منطق الخادم (آخر سعر شراء ← الوسطي ← الحقل المخزن)
  const summary = useMemo(() => {
    const diffs = lines.filter((ln) => ln.countedQty !== ln.systemQty)
    const increases = diffs.filter((ln) => ln.countedQty > ln.systemQty)
    const decreases = diffs.filter((ln) => ln.countedQty < ln.systemQty)
    const value = diffs.reduce((s, ln) => s + (ln.countedQty - ln.systemQty) * estimatedCostOf(ln.item), 0)
    return { diffs: diffs.length, increases: increases.length, decreases: decreases.length, value }
  }, [lines])

  const visibleLines = useMemo(() => {
    const q = lineSearch.trim().toLowerCase()
    return lines.filter((ln) => {
      if (diffOnly && ln.countedQty === ln.systemQty) return false
      if (q && ![ln.item.name, ln.item.code, ln.item.barcode ?? ''].join(' ').toLowerCase().includes(q)) return false
      return true
    })
  }, [lines, lineSearch, diffOnly])

  async function submit() {
    if (!warehouseId) return toast({ title: 'اختر قسم الجرد أولاً', variant: 'destructive' })
    if (lines.length === 0) return toast({ title: 'القسم لا يحتوي مواداً — اختر قسماً آخر', variant: 'destructive' })

    setSaving(true)
    try {
      const res = await fetch('/api/stocktaking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId,
          date: new Date(`${date}T12:00:00`).toISOString(),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          lines: lines.map((ln) => ({ itemId: ln.item.id, countedQty: ln.countedQty })),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'فشل إنشاء أمر الجرد')
      toast({ title: `أُنشئ أمر الجرد ${data.number} كمسودة — راجعه ثم رحّله` })
      setWarehouseId('')
      setLines([])
      setNotes('')
      onSaved()
      onClose()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'فشل إنشاء أمر الجرد', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            أمر جرد جديد
          </DialogTitle>
          <DialogDescription>
            اختر القسم لتظهر موادّه بكميات النظام — عدّل الكميات المجرودة فعلياً ثم احفظ كمسودة
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto pe-1">
          {/* القسم + التاريخ */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
            <div className="space-y-1.5">
              <Label>قسم الجرد *</Label>
              <Select value={warehouseId} onValueChange={pickWarehouse}>
                <SelectTrigger aria-label="اختيار قسم الجرد">
                  <SelectValue placeholder="اختر القسم النهائي…" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name} <span className="num text-xs text-muted-foreground">({w.code})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-date" className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                تاريخ الجرد
              </Label>
              <Input id="st-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="num" />
            </div>
          </div>

          {warehouse && (
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              أمين القسم: <span className="font-bold text-foreground">{warehouse.keeperName ?? '—'}</span>
              {' · '}أسطر الجرد: <span className="num font-bold text-foreground">{fmtNumber(lines.length)}</span>
            </p>
          )}

          {/* ملخص الفروقات الحي */}
          {lines.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border px-3 py-2 text-center">
                <p className="text-[10px] text-muted-foreground">فروقات</p>
                <p className="num text-sm font-bold text-primary">{fmtNumber(summary.diffs)}</p>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-center">
                <p className="text-[10px] text-muted-foreground">زيادات</p>
                <p className="num text-sm font-bold text-emerald-600 dark:text-emerald-400">{fmtNumber(summary.increases)}</p>
              </div>
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-center">
                <p className="text-[10px] text-muted-foreground">نقصات</p>
                <p className="num text-sm font-bold text-rose-600 dark:text-rose-400">{fmtNumber(summary.decreases)}</p>
              </div>
              <div className="rounded-lg border px-3 py-2 text-center">
                <p className="text-[10px] text-muted-foreground">قيمة الفرق</p>
                <p className={cn('num text-sm font-bold', summary.value < 0 ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400')}>
                  {fmtUSD(summary.value)}
                </p>
              </div>
            </div>
          )}

          {/* أدوات الأسطر */}
          {lines.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-48 flex-1">
                <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={lineSearch}
                  onChange={(e) => setLineSearch(e.target.value)}
                  placeholder="بحث في أسطر الجرد…"
                  className="h-9 ps-8 text-xs"
                  aria-label="بحث في أسطر الجرد"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                <Checkbox checked={diffOnly} onCheckedChange={(v) => setDiffOnly(v === true)} />
                <Diff className="h-3.5 w-3.5 text-primary" />
                الفروقات فقط
              </label>
            </div>
          )}

          {/* جدول الجرد */}
          {lines.length > 0 && (
            <div className="max-h-80 overflow-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/70 backdrop-blur">
                  <tr className="text-start">
                    <th className="p-2 text-start text-xs font-bold">المادة</th>
                    <th className="w-24 p-2 text-center text-xs font-bold">كمية النظام</th>
                    <th className="w-28 p-2 text-center text-xs font-bold">المجرود فعلياً</th>
                    <th className="w-20 p-2 text-center text-xs font-bold">الفرق</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLines.map((ln) => {
                    const diff = ln.countedQty - ln.systemQty
                    const hasDiff = diff !== 0
                    return (
                      <tr
                        key={ln.item.id}
                        className={cn(
                          'border-t',
                          hasDiff ? 'bg-primary/[0.04]' : '',
                        )}
                      >
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            {ln.item.primaryImageUrl && (
                              <img
                                src={ln.item.primaryImageUrl}
                                alt={ln.item.name}
                                className="h-8 w-8 rounded-md border object-cover"
                                loading="lazy"
                              />
                            )}
                            <div className="min-w-0">
                              <p className="max-w-40 truncate text-xs font-bold">{ln.item.name}</p>
                              <p className="num text-[10px] text-muted-foreground">{ln.item.code}</p>
                            </div>
                          </div>
                        </td>
                        <td className="num p-2 text-center text-xs">{fmtQty(ln.systemQty)}</td>
                        <td className="p-2 text-center">
                          <NumInput
                            value={ln.countedQty}
                            onChange={(e) => setCounted(ln.item.id, parseFloat(e.target.value) || 0)}
                            className="h-8 text-center text-xs"
                            aria-label={`الكمية المجرودة — ${ln.item.name}`}
                          />
                        </td>
                        <td className="p-2 text-center">
                          <span
                            className={cn(
                              'num text-xs font-bold',
                              diff > 0 && 'text-emerald-600 dark:text-emerald-400',
                              diff < 0 && 'text-rose-600 dark:text-rose-400',
                            )}
                          >
                            {hasDiff ? `${diff > 0 ? '+' : ''}${fmtQty(diff)}` : '—'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                  {visibleLines.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-6 text-center text-xs text-muted-foreground">
                        لا أسطر مطابقة — {diffOnly ? 'لا فروقات بعد' : 'جرّب تعديل البحث'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ملاحظات */}
          {warehouse && (
            <div className="space-y-1.5">
              <Label htmlFor="st-notes">ملاحظات الأمر</Label>
              <Textarea
                id="st-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="مثال: جرد نصف سنوي بحضور أمين القسم…"
                rows={2}
              />
            </div>
          )}

          {lines.length === 0 && warehouseId === '' && (
            <p className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed py-6 text-xs text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              ابدأ باختيار قسم الجرد — ستظهر موادّه تلقائياً بالكميات الدفترية
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={saving || !warehouseId || lines.length === 0}>
            <Save className="h-4 w-4" />
            {saving ? 'جارٍ الحفظ…' : 'حفظ كمسودة'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
