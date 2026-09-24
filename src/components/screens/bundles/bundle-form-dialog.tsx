'use client'

// نافذة نموذج سلة العروض — إنشاء/تعديل السلال بأنواعها الثلاثة
// GIFT (سلة مع هدية) · PERCENT (حسم نسبة) · PRICE (سعر مخفض لكل مادة)
// الميزة الخاصة: «حفظ كنموذج جديد» في وضع التعديل — يحوّل النافذة لوضع الإنشاء
// مع الاحتفاظ بكل القيم ومسح الاسم وتركيزه (POST باسم مختلف) — والإغلاق لا يحفظ شيئاً
// عرض النافذة بحجم شاشات الفوترة (max-w-6xl) وجدول البنود بأعمدته الكاملة:
// المادة · الكمية · الوحدة · السعر الإفرادي الحالي · (الهدية/السعر المخفض) · الإجمالي
// ومفتاح التفعيل اليدوي (Switch) — إيقاف/تشغيل بغض النظر عن تواريخ الفترة (Task 36)

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgePercent,
  CalendarRange,
  CopyPlus,
  Gift,
  Loader2,
  Plus,
  Power,
  Save,
  ShoppingBasket,
  Tags,
  Trash2,
} from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ItemCombobox } from '@/components/screens/stock/item-combobox'
import { useToast } from '@/hooks/use-toast'
import { fmtMoney, fmtNumber } from '@/lib/format'
import { round2 } from '@/lib/math'
import { cn } from '@/lib/utils'
import {
  datetimeLocalToISO,
  defaultPeriod,
  isoToDatetimeLocal,
  type BundleFormLine,
  type BundlePayload,
  type BundleRow,
  type BundleType,
} from './types'
import type { ItemLite } from '@/components/screens/stock/types'

const MAX_LINES = 30

const TYPE_OPTIONS: { value: BundleType; label: string; desc: string; icon: typeof Gift }[] = [
  {
    value: 'GIFT',
    label: 'سلة مع هدية',
    desc: 'سلة مواد مع صنف هدية — تُحسم قيمة مادة الهدية تلقائياً عند اكتمال عناصر السلة',
    icon: Gift,
  },
  {
    value: 'PERCENT',
    label: 'حسم نسبة من السلة',
    desc: 'خصم نسبة من السلة — حسم مئوي على إجمالي قيمة مواد السلة',
    icon: BadgePercent,
  },
  {
    value: 'PRICE',
    label: 'السعر المخفض',
    desc: 'السعر المخفض — سعر مبيعات جديد ومخفض لكل مادة داخل العرض',
    icon: Tags,
  },
]

let lineSeq = 0
function newLine(): BundleFormLine {
  lineSeq += 1
  return { key: `L${lineSeq}`, itemId: null, quantity: '', isGift: false, bundlePrice: '' }
}

interface Props {
  open: boolean
  onClose: () => void
  /** السلة تحت التعديل — null للإنشاء الجديد */
  editing: BundleRow | null
  /** المواد النشطة لمنتقي البنود — من GET /api/items */
  items: ItemLite[]
  onSaved: () => void
}

export function BundleFormDialog({ open, onClose, editing, items, onSaved }: Props) {
  const { toast } = useToast()

  // isEdit حالة مستقلة عن editing — «حفظ كنموذج جديد» يقلبها لوضع الإنشاء مع إبقاء القيم
  const [isEdit, setIsEdit] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<BundleType>('GIFT')
  const [discountPercent, setDiscountPercent] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [lines, setLines] = useState<BundleFormLine[]>([newLine()])
  // المفتاح اليدوي للتفعيل — السلة الجديدة مفعّلة، والتعديل يحمل قائمة السلة (Task 36)
  const [enabledState, setEnabledState] = useState(true)
  const [saving, setSaving] = useState(false)

  const nameRef = useRef<HTMLInputElement>(null)

  // إعادة الضبط عند كل فتح — وضع التعديل يمتلئ من السلة، والإنشاء بافتراضيات معقولة
  useEffect(() => {
    if (!open) return
    if (editing) {
      setIsEdit(true)
      setName(editing.name)
      setType(editing.type)
      setDiscountPercent(editing.type === 'PERCENT' ? String(editing.discountPercent) : '')
      setStartsAt(isoToDatetimeLocal(editing.startsAt))
      setEndsAt(isoToDatetimeLocal(editing.endsAt))
      setEnabledState(editing.enabled)
      setLines(
        editing.items.map((bi) => ({
          key: `S${bi.id}`,
          itemId: bi.itemId,
          quantity: String(bi.quantity),
          isGift: bi.isGift,
          bundlePrice: bi.bundlePrice > 0 ? String(bi.bundlePrice) : '',
        })),
      )
    } else {
      setIsEdit(false)
      setName('')
      setType('GIFT')
      setDiscountPercent('')
      const p = defaultPeriod()
      setStartsAt(p.startsAt)
      setEndsAt(p.endsAt)
      setEnabledState(true)
      setLines([newLine()])
    }
  }, [editing, open])

  // ==================== إدارة البنود ====================

  const updateLine = (key: string, patch: Partial<BundleFormLine>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  /** منع تكرار المادة نفسها في بندَين — السلة الواحدة مادة واحدة ببند واحد */
  const handleItemPick = (key: string, id: string | null) => {
    if (id && lines.some((l) => l.key !== key && l.itemId === id)) {
      toast({
        title: 'المادة مختارة في بند آخر',
        description: 'المادة الواحدة تدخل السلة ببند واحد فقط — زد كميتها في بندها',
        variant: 'destructive',
      })
      return
    }
    updateLine(key, { itemId: id })
  }

  const addLine = () => {
    if (lines.length >= MAX_LINES) return
    setLines((ls) => [...ls, newLine()])
  }

  const removeLine = (key: string) => {
    setLines((ls) => (ls.length <= 1 ? ls : ls.filter((l) => l.key !== key)))
  }

  /** تبديل النوع يُبقي البنود ويفضّ الهدية والأسعار المخفضة — قواعد كل نوع تُعاد من الصفر */
  const changeType = (t: BundleType) => {
    setType(t)
    setLines((ls) => ls.map((l) => ({ ...l, isGift: false, bundlePrice: '' })))
  }

  const setGift = (key: string) => {
    setLines((ls) => ls.map((l) => ({ ...l, isGift: l.key === key })))
  }

  // ==================== التحقق الخفيف — القواعد الصارمة خادمية وتصل برسائلها الحرفية ====================

  const nameError = name.trim() ? '' : 'اسم السلة إلزامي'
  const periodError =
    !startsAt || !endsAt
      ? 'حددا بداية ونهاية فترة النشاط'
      : new Date(endsAt).getTime() <= new Date(startsAt).getTime()
        ? 'نهاية فترة النشاط يجب أن تكون بعد بدايتها'
        : ''
  const percentError =
    type !== 'PERCENT'
      ? ''
      : !(Number(discountPercent) > 0) || Number(discountPercent) > 100
        ? 'نسبة الحسم يجب أن تكون رقماً بين 1 و 100'
        : ''

  // البنود الفارغة كلياً تُتجاهل — والبقية يجب أن تكون مكتملة
  const filledLines = useMemo(() => lines.filter((l) => l.itemId || l.quantity || l.bundlePrice), [lines])
  const invalidLine = filledLines.find((l) => !l.itemId || !(Number(l.quantity) > 0))
  const linesError = filledLines.length === 0
    ? 'السلة تحتاج مادة واحدة على الأقل'
    : invalidLine
      ? 'أكمل بنداً واحداً على الأقل: اختر المادة وأدخل كمية أكبر من صفر'
      : ''

  const giftCount = filledLines.filter((l) => l.isGift).length
  const giftError =
    type !== 'GIFT'
      ? ''
      : giftCount !== 1
        ? 'سلة الهدية تحتاج مادة هدية واحدة بالضبط — حدد البند المُمنح مجاناً'
        : filledLines.length < 2
          ? 'سلة الهدية تحتاج بند شراء واحداً على الأقل غير الهدية'
          : ''

  const priceError =
    type !== 'PRICE'
      ? ''
      : filledLines.some((l) => {
          // مادة غير موجودة في القائمة (موقوفة مثلاً) تُترك للخادم ليصفّها برسالته الحرفية
          const it = items.find((i) => i.id === l.itemId)
          if (!it) return false
          const p = Number(l.bundlePrice)
          return !(p > 0) || p >= it.salePrice
        })
        ? 'أدخل سعراً مخفضاً لكل مادة — أقل من سعر بيعها الحالي'
        : ''

  const valid = !nameError && !periodError && !percentError && !linesError && !giftError && !priceError

  // ==================== ملخص قيمة السلة — قبل الحسم وبعده ====================
  // مطابق لخوارزمية الحسم الخادمية: GIFT قيمة الهدية · PERCENT النسبة × الإجمالي · PRICE فرق الأسعار
  const summary = useMemo(() => {
    let gross = 0
    let discount = 0
    let giftValue = 0
    let ready = true
    for (const l of filledLines) {
      const it = items.find((i) => i.id === l.itemId)
      if (!it || !(Number(l.quantity) > 0)) {
        ready = false
        continue
      }
      const qty = Number(l.quantity)
      const lineGross = round2(qty * it.salePrice)
      gross = round2(gross + lineGross)
      if (type === 'GIFT' && l.isGift) giftValue = round2(giftValue + lineGross)
      if (type === 'PRICE') {
        const p = Number(l.bundlePrice)
        if (p > 0 && p < it.salePrice) discount = round2(discount + (it.salePrice - p) * qty)
        else ready = false
      }
    }
    if (type === 'GIFT') discount = giftValue
    if (type === 'PERCENT') {
      const pct = Number(discountPercent)
      if (!(pct > 0) || pct > 100) ready = false
      else discount = round2((gross * pct) / 100)
    }
    if (type === 'GIFT' && giftCount !== 1) ready = false
    const net = round2(Math.max(0, gross - discount))
    return { gross, discount, net, ready }
  }, [filledLines, items, type, discountPercent, giftCount])

  // ==================== الإرسال ====================

  const buildPayload = (): BundlePayload => ({
    name: name.trim(),
    type,
    discountPercent: type === 'PERCENT' ? Number(discountPercent) : 0,
    startsAt: datetimeLocalToISO(startsAt),
    endsAt: datetimeLocalToISO(endsAt),
    enabled: enabledState,
    items: filledLines.map((l) => ({
      itemId: l.itemId as string,
      quantity: Number(l.quantity),
      isGift: type === 'GIFT' && l.isGift,
      bundlePrice: type === 'PRICE' ? Number(l.bundlePrice) : 0,
    })),
  })

  const send = async (method: 'POST' | 'PUT') => {
    if (!valid || saving) return
    setSaving(true)
    try {
      const res = await fetch(isEdit && method === 'PUT' ? `/api/bundles/${editing!.id}` : '/api/bundles', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast({
          title: method === 'PUT' ? 'تعذر حفظ التعديلات' : 'تعذر إنشاء السلة',
          description: data?.error ?? 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        return
      }
      toast({
        title: method === 'PUT' ? 'تم حفظ التعديلات' : `تم إنشاء السلة «${name.trim()}»`,
        description: enabledState
          ? 'قائمة السلال محدّثة — السلة مفعّلة'
          : 'قائمة السلال محدّثة — السلة موقوفة يدوياً حتى تفعيلها',
      })
      onSaved()
      onClose()
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  /** «حفظ كنموذج جديد» — وضع إنشاء بنفس القيم، اسم فارغ مركّز عليه، والحفظ POST باسم جديد */
  const saveAsTemplate = () => {
    if (saving) return
    setIsEdit(false)
    setName('')
    toast({
      title: 'حفظ كنموذج جديد',
      description: 'اكتب اسماً جديداً للنموذج ثم احفظ',
    })
    setTimeout(() => nameRef.current?.focus(), 80)
  }

  const itemOf = (l: BundleFormLine) => items.find((i) => i.id === l.itemId) ?? null
  const unitOf = (l: BundleFormLine) => itemOf(l)?.units[0]?.name ?? '—'

  // عرض نوع البند في العمود الأخير قبل الحذف
  const lineTotalOf = (l: BundleFormLine): number => {
    const it = itemOf(l)
    const qty = Number(l.quantity) || 0
    if (!it) return 0
    if (type === 'PRICE') {
      const p = Number(l.bundlePrice)
      return p > 0 ? round2(p * qty) : 0
    }
    return round2(it.salePrice * qty)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto pb-3 sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBasket className="h-5 w-5 text-primary" />
            {isEdit ? `تعديل السلة «${editing?.name}»` : 'سلة عروض جديدة'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'عدّل النوع والبنود والفترة — «حفظ كنموذج جديد» ينشئ نسخة مستقلة باسم مختلف'
              : 'حدد نوع العرض ومواد السلة وفترة نشاطها — يُطبق الحسم تلقائياً على فواتير المبيعات'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* الصف العلوي: الاسم + الفترة + مفتاح الحالة — استغلال العرض الموسع */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1.6fr_auto]">
            {/* الاسم */}
            <div className="space-y-1.5">
              <Label htmlFor="b-name" className={nameError ? 'text-rose-600' : ''}>
                اسم السلة <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="b-name"
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: سلة رمضان — جبنة وزيت مع هدية"
                maxLength={80}
                aria-invalid={!!nameError}
                className={cn(nameError && 'border-rose-400 focus-visible:ring-rose-300')}
              />
              {nameError ? (
                <p className="text-xs text-rose-600">{nameError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">اسم مميز يظهر على فواتير المبيعات وسجل التدقيق</p>
              )}
            </div>

            {/* الفترة الزمنية للنشاط */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <CalendarRange className="h-4 w-4 text-muted-foreground" />
                الفترة الزمنية للنشاط <span className="text-rose-500">*</span>
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="b-starts" className="text-[11px] text-muted-foreground">
                    من
                  </Label>
                  <Input
                    id="b-starts"
                    type="datetime-local"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                    className="num h-10"
                    aria-label="بداية فترة النشاط"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="b-ends" className="text-[11px] text-muted-foreground">
                    إلى
                  </Label>
                  <Input
                    id="b-ends"
                    type="datetime-local"
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                    className="num h-10"
                    aria-label="نهاية فترة النشاط"
                  />
                </div>
              </div>
              {periodError ? <p className="text-xs text-rose-600">{periodError}</p> : null}
            </div>

            {/* مفتاح الحالة اليدوي — إيقاف/تشغيل بغض النظر عن تواريخ الفترة (Task 36) */}
            <div
              className={cn(
                'flex min-w-[220px] items-center gap-3 rounded-lg border p-3 transition-colors',
                enabledState ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5',
              )}
            >
              <Power
                className={cn(
                  'h-4 w-4 shrink-0',
                  enabledState ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <Label htmlFor="b-enabled" className="text-xs font-bold">
                  {enabledState ? 'مفعّلة يدوياً' : 'موقوفة يدوياً'}
                </Label>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {enabledState
                    ? 'تظهر في فواتير المبيعات وفق فترتها'
                    : 'مخفية عن الفواتير مهما كانت الفترة'}
                </p>
              </div>
              <Switch
                id="b-enabled"
                checked={enabledState}
                onCheckedChange={setEnabledState}
                aria-label="مفتاح التفعيل اليدوي للسلة"
              />
            </div>
          </div>

          {/* نوع السلة — ثلاث بطاقات راديو */}
          <div className="space-y-1.5">
            <Label>نوع السلة</Label>
            <div role="radiogroup" aria-label="نوع السلة" className="grid gap-2 sm:grid-cols-3">
              {TYPE_OPTIONS.map(({ value, label, desc, icon: Icon }) => {
                const selected = type === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => changeType(value)}
                    className={cn(
                      'flex min-h-11 flex-col items-start gap-1 rounded-lg border p-3 text-start transition-colors',
                      selected
                        ? 'border-primary bg-primary/10 ring-2 ring-ring/40'
                        : 'bg-background hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <span className="flex w-full items-center gap-2">
                      <Icon className={cn('h-4 w-4 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} />
                      <span className="text-sm font-bold">{label}</span>
                    </span>
                    <span className="text-[11px] leading-snug text-muted-foreground">{desc}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              تبديل النوع يُبقي بنود المواد — ويصفّر تحديد الهدية والأسعار المخفضة حسب قواعد النوع الجديد
            </p>
          </div>

          {/* نسبة الحسم — للنوع PERCENT فقط */}
          {type === 'PERCENT' && (
            <div className="space-y-1.5 rounded-lg border bg-emerald-500/5 p-3">
              <Label htmlFor="b-percent" className={percentError ? 'text-rose-600' : ''}>
                نسبة الحسم % <span className="text-rose-500">*</span>
              </Label>
              <NumInput
                id="b-percent"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value)}
                placeholder="10"
                className="h-10 max-w-40"
                aria-label="نسبة الحسم بالمئة"
                aria-invalid={!!percentError}
              />
              {percentError ? (
                <p className="text-xs text-rose-600">{percentError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  يُحسم هذا الجزء من إجمالي قيمة مواد السلة عند اكتمالها — بين 1 و 100
                </p>
              )}
            </div>
          )}

          {/* بنود السلة */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>
                مواد السلة <span className="text-rose-500">*</span>
                <span className="num mr-1.5 text-xs font-normal text-muted-foreground">
                  ({fmtNumber(filledLines.length)}/{fmtNumber(MAX_LINES)})
                </span>
              </Label>
              {type === 'GIFT' && (
                <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                  <Gift className="h-3.5 w-3.5" />
                  حدد بنداً واحداً كمادة الهدية
                </span>
              )}
            </div>

            {/* مسافة سفلية داخل منطقة التمرير (h-72) كي تُعرض قائمة نتائج بحث المواد المنسدلة
                كاملة دون قصّها حتى في آخر بند — مع هوامش سفلية مضغوطة للنافذة */}
            <div className="max-h-[460px] overflow-y-auto rounded-lg border">
              <Table className="min-w-[900px]">
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-10">م</TableHead>
                    <TableHead className="min-w-[230px]">المادة</TableHead>
                    <TableHead className="w-[85px]">الكمية</TableHead>
                    <TableHead className="w-[85px]">الوحدة</TableHead>
                    {type === 'PRICE' ? (
                      <TableHead className="w-[110px]">السعر القديم</TableHead>
                    ) : (
                      <TableHead className="w-[115px]">السعر الإفرادي</TableHead>
                    )}
                    {type === 'GIFT' && <TableHead className="w-[70px] text-center">الهدية</TableHead>}
                    {type === 'PRICE' && <TableHead className="min-w-[125px]">السعر المخفض</TableHead>}
                    <TableHead className={cn('w-[125px]', type === 'PRICE' && 'text-rose-700 dark:text-rose-400')}>
                      {type === 'PRICE' ? 'الإجمالي بعد التخفيض' : 'الإجمالي'}
                    </TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, i) => {
                    const item = itemOf(l)
                    const qty = Number(l.quantity) || 0
                    const lineTotal = lineTotalOf(l)
                    return (
                      <TableRow key={l.key}>
                        <TableCell className="num text-center text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          <ItemCombobox
                            items={items}
                            value={l.itemId}
                            onChange={(id) => handleItemPick(l.key, id)}
                            placeholder="ابحث واختر مادة السلة…"
                          />
                        </TableCell>
                        <TableCell>
                          <NumInput
                            value={l.quantity}
                            onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                            placeholder="0"
                            className="h-10"
                            aria-label={`كمية البند ${i + 1}`}
                            disabled={!l.itemId}
                          />
                        </TableCell>
                        {/* الوحدة المعتمدة للمادة — أول وحدة في بطاقتها */}
                        <TableCell>
                          <span className={cn('text-xs', item ? 'text-foreground/80' : 'text-muted-foreground')}>
                            {unitOf(l)}
                          </span>
                        </TableCell>
                        {/* السعر الإفرادي الحالي — «السعر القديم» مشطوباً في نوع السعر المخفض */}
                        <TableCell>
                          <span
                            className={cn(
                              'num text-sm',
                              type === 'PRICE' && item ? 'text-muted-foreground line-through' : '',
                            )}
                          >
                            {item ? fmtMoney(item.salePrice) : <span className="text-muted-foreground">—</span>}
                          </span>
                        </TableCell>
                        {type === 'GIFT' && (
                          <TableCell className="text-center">
                            <label
                              className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center"
                              title={item ? `تعيين «${item.name}» هدية السلة` : 'اختر المادة أولاً'}
                            >
                              <input
                                type="radio"
                                name="bundle-gift"
                                checked={l.isGift}
                                onChange={() => setGift(l.key)}
                                disabled={!l.itemId}
                                className="h-5 w-5 cursor-pointer accent-primary"
                                aria-label={item ? `تعيين ${item.name} هدية السلة` : `هدية البند ${i + 1}`}
                              />
                            </label>
                          </TableCell>
                        )}
                        {type === 'PRICE' && (
                          <TableCell>
                            <NumInput
                              value={l.bundlePrice}
                              onChange={(e) => updateLine(l.key, { bundlePrice: e.target.value })}
                              placeholder="0.00"
                              className="h-10"
                              aria-label={`السعر المخفض للبند ${i + 1}`}
                              disabled={!l.itemId}
                            />
                          </TableCell>
                        )}
                        {/* الإجمالي حسب الكمية — بعد التخفيض في نوع PRICE */}
                        <TableCell className="text-end">
                          <span
                            className={cn(
                              'num text-sm font-semibold',
                              type === 'PRICE' && lineTotal > 0 && 'text-rose-700 dark:text-rose-400',
                            )}
                          >
                            {item && qty > 0 ? fmtMoney(lineTotal) : <span className="text-muted-foreground">—</span>}
                          </span>
                          {type === 'GIFT' && l.isGift && item && qty > 0 && (
                            <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                              هدية — قيمتها تُحسم
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 sm:h-8 sm:w-8 dark:text-rose-400"
                            disabled={lines.length <= 1}
                            title={lines.length <= 1 ? 'البند الوحيد — لا يُحذف' : 'حذف البند'}
                            aria-label={`حذف البند ${i + 1}`}
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
              {/* مسافة سفلية داخل منطقة التمرير — قائمة نتائج البحث المنسدلة (بحد 288px) تُعرض كاملة
                  حتى عند تحرير آخر بند، فلا تقصّ ولا تغطى (Task 36) */}
              <div className="h-72" aria-hidden="true" />
            </div>

            {/* ملخص قيمة السلة — القيمة الكلية بالأسعار الحالية + الحسم المتوقع + المجموع بعد التخفيض */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-lg border bg-muted/20 p-2.5">
                <p className="text-[11px] text-muted-foreground">إجمالي قيمة السلة (بأسعار البيع الحالية)</p>
                <p className="num mt-0.5 text-sm font-bold">{fmtMoney(summary.gross)} ل.س</p>
              </div>
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5">
                <p className="text-[11px] text-muted-foreground">
                  {type === 'GIFT' ? 'حسم الهدية المتوقع' : type === 'PERCENT' ? 'الحسم المتوقع (النسبة)' : 'حسم فرق الأسعار المتوقع'}
                </p>
                <p className="num mt-0.5 text-sm font-bold text-rose-600 dark:text-rose-400">
                  −{fmtMoney(summary.discount)} ل.س
                  {type === 'PERCENT' && summary.gross > 0 && Number(discountPercent) > 0 ? (
                    <span className="mr-1 text-[10px] font-normal text-muted-foreground">
                      ({fmtNumber(Number(discountPercent))}%)
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
                <p className="text-[11px] text-muted-foreground">المجموع الإجمالي بعد التخفيض</p>
                <p className="num mt-0.5 text-sm font-extrabold text-emerald-700 dark:text-emerald-400">
                  {fmtMoney(summary.net)} ل.س
                </p>
              </div>
            </div>

            {linesError || giftError || priceError ? (
              <p role="alert" className="text-xs text-rose-600">
                {linesError || giftError || priceError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                من مادة إلى {fmtNumber(MAX_LINES)} مادة — مادة الهدية تُمنح مجاناً عند اكتمال السلة (نوع الهدية)
              </p>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 border-primary/40 font-semibold text-primary hover:bg-primary/10 sm:h-8"
              disabled={lines.length >= MAX_LINES}
              onClick={addLine}
            >
              <Plus className="h-4 w-4" />
              إضافة مادة
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          {isEdit && (
            <Button variant="outline" onClick={saveAsTemplate} disabled={saving} title="POST باسم جديد — نسخة مستقلة عن السلة الأصلية">
              <CopyPlus className="h-4 w-4" />
              حفظ كنموذج جديد
            </Button>
          )}
          <Button onClick={() => void send(isEdit ? 'PUT' : 'POST')} disabled={!valid || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isEdit ? 'حفظ التعديلات' : 'حفظ السلة'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
