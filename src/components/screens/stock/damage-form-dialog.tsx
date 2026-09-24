'use client'

// نافذة تسجيل حالة تلف — إخراج كمية من قسم بسبب موثق وقيمة تقديرية:
// • الأقسام النهائية فقط + عرض المتوفر قبل التأكيد (لا تلف فوق المتاح)
// • القيمة التقديرية = الكمية × التكلفة (الافتراضي سعر الشراء التلقائي)

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, PackageX, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NumInput } from '@/components/ui/number-input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { fmtMoney, fmtNumber, fmtUSD, AR_DAMAGE_REASON, todayYMD } from '@/lib/format'
import { ItemCombobox } from './item-combobox'
import { balanceOf, estimatedCostOf, type ItemLite, type WarehouseLite } from './types'

interface DamageFormDialogProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  items: ItemLite[]
  warehouses: WarehouseLite[]
}

export function DamageFormDialog({ open, onClose, onSaved, items, warehouses }: DamageFormDialogProps) {
  const { toast } = useToast()
  const [itemId, setItemId] = useState<string | null>(null)
  const [warehouseId, setWarehouseId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [reason, setReason] = useState('DAMAGE')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(() => todayYMD())
  const [saving, setSaving] = useState(false)

  // إعادة ضبط النموذج عند كل فتح — لا بيانات قديمة من جلسة سابقة
  useEffect(() => {
    if (!open) return
    setItemId(null)
    setWarehouseId('')
    setQuantity('')
    setUnitCost('')
    setReason('DAMAGE')
    setNotes('')
    setDate(todayYMD())
  }, [open])

  const item = useMemo(() => items.find((i) => i.id === itemId) ?? null, [items, itemId])
  const qty = parseFloat(quantity) || 0
  // الافتراضي بنفس منطق الخادم (purchaseCostOf): آخر سعر شراء ← الوسطي ← الحقل المخزن — قيمة تقديرية قابلة للتعديل
  const defaultCost = estimatedCostOf(item)
  const cost = unitCost === '' ? defaultCost : parseFloat(unitCost) || 0
  const value = qty * cost

  const balance = balanceOf(item, warehouseId)
  const insufficient = item !== null && warehouseId !== '' && qty > balance

  async function submit() {
    if (!item) return toast({ title: 'اختر المادة التالفة', variant: 'destructive' })
    if (!warehouseId) return toast({ title: 'اختر القسم الذي حدث فيه التلف', variant: 'destructive' })
    if (!(qty > 0)) return toast({ title: 'الكمية التالفة يجب أن تكون أكبر من صفر', variant: 'destructive' })
    if (insufficient) {
      return toast({ title: `المتوفر (${fmtNumber(balance)}) لا يكفي — لا يمكن تسجيل تلف فوق المتاح`, variant: 'destructive' })
    }

    setSaving(true)
    try {
      const res = await fetch('/api/stock-damage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          warehouseId,
          quantity: qty,
          ...(unitCost === '' ? {} : { unitCost: cost }),
          reason,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          date: new Date(`${date}T12:00:00`).toISOString(),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'فشل تسجيل حالة التلف')
      toast({ title: 'سُجلت حالة التلف وخُصمت الكمية من رصيد القسم' })
      setItemId(null)
      setWarehouseId('')
      setQuantity('')
      setUnitCost('')
      setReason('DAMAGE')
      setNotes('')
      onSaved()
      onClose()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'فشل تسجيل حالة التلف', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageX className="h-5 w-5 text-rose-500" />
            تسجيل حالة تلف مخزون
          </DialogTitle>
          <DialogDescription>
            الكمية تُخصم من رصيد القسم فوراً وتوثق بقيمة تقديرية — الحالة تظهر في سجل الحركات كمصدر «تلف»
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>المادة التالفة *</Label>
            <ItemCombobox items={items} value={itemId} onChange={setItemId} />
          </div>

          <div className="space-y-1.5">
            <Label>القسم الذي حدث فيه التلف *</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger aria-label="اختيار القسم">
                <SelectValue placeholder="اختر القسم…" />
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

          {item && warehouseId && (
            <p
              className={cn(
                'rounded-lg border px-3 py-2 text-xs font-semibold',
                insufficient
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                  : 'border-border bg-muted/40 text-muted-foreground',
              )}
            >
              المتوفر حالياً في القسم: <span className="num text-sm font-bold">{fmtNumber(balance)}</span>
              {insufficient && ' — لا يمكن تسجيل تلف أكبر من المتوفر!'}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dm-qty">الكمية التالفة *</Label>
              <NumInput
                id="dm-qty"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dm-cost">تكلفة الوحدة (ل.س)</Label>
              <NumInput
                id="dm-cost"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder={item ? String(defaultCost) : 'سعر الشراء التلقائي'}
              />
              <p className="text-[11px] text-muted-foreground">
                قيمة تقديرية قابلة للتعديل — تُحتسب تلقائياً: آخر سعر شراء ثم الوسطي ثم السعر المخزن
              </p>
            </div>
          </div>

          {/* القيمة التقديرية */}
          {qty > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-500/5 px-3.5 py-2.5">
              <span className="text-xs font-semibold text-muted-foreground">القيمة التقديرية للتالف</span>
              <span className="text-start">
                <span className="num block text-sm font-bold text-rose-600 dark:text-rose-400">{fmtMoney(value)}</span>
                <span className="num block text-[10px] text-muted-foreground">≈ {fmtUSD(value)}</span>
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>سبب التلف *</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger aria-label="سبب التلف">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AR_DAMAGE_REASON).map(([code, label]) => (
                  <SelectItem key={code} value={code}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
            <div className="space-y-1.5">
              <Label htmlFor="dm-notes">ملاحظات / تفاصيل</Label>
              <Textarea
                id="dm-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="مثال: تلف بسبب تسرب مياه بالرف A-3…"
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dm-date" className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                التاريخ
              </Label>
              <Input id="dm-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="num" />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={saving || !item || qty <= 0 || !warehouseId}>
            <Save className="h-4 w-4" />
            {saving ? 'جارٍ التسجيل…' : 'تسجيل التلف'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
