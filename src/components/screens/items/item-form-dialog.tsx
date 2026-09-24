'use client'

// نموذج بطاقة المادة/الصنف — 5 تبويبات:
// الأساسيات | الوحدات | الأسعار | الصور | المستودع
// • الترقيم التلقائي لرقم البطاقة (+1 عن السابقة) يظهر في الرأس
// • رمز الباركود: كتابة / قراءة من صورة / مسح كاميرا حية
// • سعر الشراء: يُجلب تلقائياً من آخر فاتورة مشتريات (آخر سعر أو الوسطي) — لا يُعدل من البطاقة
// • الضريبة: نسبة % مع احتساب قيمتها والإجمالي شامل الضريبة
// • المستودع: بحث عن القسم + الحد الأدنى/الأعلى + الرصيد الحالي + مكان التواجد
// • الصور بحد 10 مع أساسية/تحديد وتنزيل/معاينة بالزوم

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  BadgeDollarSign,
  Banknote,
  CheckCircle2,
  Images,
  Layers,
  Lock,
  MapPin,
  Package,
  Percent,
  Plus,
  ReceiptText,
  Settings2,
  Trash2,
  UserRound,
  Warehouse as WarehouseIcon,
} from 'lucide-react'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { fmtDate, fmtMoney, fmtQty, fmtUSD } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ImageViewer } from '@/components/common/image-viewer'
import {
  LEVEL_ICONS,
  LEVEL_META,
  LEVEL_STYLES,
  buildWarehouseIndex,
  type WarehouseDTO,
} from '../warehouses/types'
import {
  MAX_UNITS,
  leafWarehouseIds,
  warehousePath,
  type ItemDTO,
  type PendingImage,
} from './types'
import { ItemImagesManager } from './item-images'
import { BarcodeCapture } from './barcode-capture'

type FormTab = 'basics' | 'units' | 'prices' | 'images' | 'warehouse'

interface UnitRow {
  key: string
  name: string
  factor: string
  barcode: string
  isActive: boolean
}

interface ItemFormDialogProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  warehouses: WarehouseDTO[]
  editItem: ItemDTO | null
  nextCode: string
  /** مواقع التواجد المستخدمة سابقاً — لاقتراحات حقل مكان المادة */
  locations: string[]
}

let rowSeq = 0
const nextRowKey = () => `u-${Date.now().toString(36)}-${rowSeq++}`

export function ItemFormDialog({
  open,
  onClose,
  onSaved,
  warehouses,
  editItem,
  nextCode,
  locations,
}: ItemFormDialogProps) {
  const { toast } = useToast()
  const uploadedNewRef = useRef<string[]>([]) // صور رُفعت ولم تُحفظ — تُنظف عند الإلغاء

  const [activeTab, setActiveTab] = useState<FormTab>('basics')
  const [saving, setSaving] = useState(false)

  // الأساسيات
  const [name, setName] = useState('')
  const [barcode, setBarcode] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)

  // وحدات المادة
  const [units, setUnits] = useState<UnitRow[]>([])

  // الأسعار
  const [salePrice, setSalePrice] = useState('')
  const [taxRate, setTaxRate] = useState('')
  const [purchaseBasis, setPurchaseBasis] = useState<'last' | 'avg'>('last')

  // المستودع
  const [warehouseId, setWarehouseId] = useState('')
  const [warehouseSearch, setWarehouseSearch] = useState('')
  const [minStock, setMinStock] = useState('')
  const [maxStock, setMaxStock] = useState('')
  const [location, setLocation] = useState('')

  // الصور
  const [images, setImages] = useState<PendingImage[]>([])
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)

  // ==================== التهيئة عند الفتح ====================
  useEffect(() => {
    if (!open) return
    uploadedNewRef.current = []
    setActiveTab('basics')
    setSaving(false)
    setPreviewIdx(null)
    setPurchaseBasis('last')
    setWarehouseSearch('')

    if (editItem) {
      setName(editItem.name)
      setBarcode(editItem.barcode ?? '')
      setDescription(editItem.description ?? '')
      setIsActive(editItem.isActive)
      setUnits(
        editItem.units.map((u) => ({
          key: nextRowKey(),
          name: u.name,
          factor: String(u.factor),
          barcode: u.barcode ?? '',
          isActive: u.isActive,
        })),
      )
      setSalePrice(String(editItem.salePrice || ''))
      setTaxRate(String(editItem.taxRate || ''))
      setMinStock(String(editItem.minStock || ''))
      setMaxStock(String(editItem.maxStock || ''))
      setLocation(editItem.location ?? '')
      setImages(
        editItem.images.map((img) => ({
          key: nextRowKey(),
          url: img.url,
          fileName: img.fileName,
          originalName: img.fileName,
          isPrimary: img.isPrimary,
          existingId: img.id,
        })),
      )
      setWarehouseId(editItem.warehouseId ?? '')
    } else {
      setName('')
      setBarcode('')
      setDescription('')
      setIsActive(true)
      setUnits([])
      setSalePrice('')
      setTaxRate('')
      setMinStock('')
      setMaxStock('')
      setLocation('')
      setImages([])
      setWarehouseId('')
    }
  }, [open, editItem])

  // ==================== شجرة المستودعات ====================
  const leaves = useMemo(() => leafWarehouseIds(warehouses), [warehouses])
  const selectedPath = useMemo(
    () => (warehouseId ? warehousePath(warehouses, warehouseId) : []),
    [warehouses, warehouseId],
  )

  // بحث عن القسم: الأقسام المطابقة + أسلافها فقط
  const filteredWarehouses = useMemo(() => {
    const q = warehouseSearch.trim().toLowerCase()
    if (!q) return warehouses
    const matching = warehouses.filter(
      (w) => w.name.toLowerCase().includes(q) || w.code.toLowerCase().includes(q),
    )
    const allowed = new Set<string>()
    for (const m of matching) {
      for (const p of warehousePath(warehouses, m.id)) allowed.add(p.id)
    }
    return warehouses.filter((w) => allowed.has(w.id))
  }, [warehouses, warehouseSearch])

  const index = useMemo(() => buildWarehouseIndex(filteredWarehouses), [filteredWarehouses])

  // الرصيد الحالي في القسم المختار (عند التعديل)
  const currentBalance = useMemo(() => {
    if (!editItem || !warehouseId) return null
    return editItem.balances?.find((b) => b.warehouseId === warehouseId)?.quantity ?? 0
  }, [editItem, warehouseId])

  // ==================== سعر الشراء التلقائي ====================
  const purchaseInfo = editItem?.purchaseInfo ?? null
  const purchaseValue = purchaseInfo ? (purchaseBasis === 'last' ? purchaseInfo.last : purchaseInfo.avg) : 0

  // ==================== التنظيف عند الإلغاء ====================
  const cleanupUploads = useCallback(() => {
    // منذ Task 28 الصور داخل القاعدة (data URL) — لا ملفات قرص تنظفها
    // والنداء يبقى لتنظيف أي صور قديمة على القرص من حقبة ما قبلها فقط
    const pending = uploadedNewRef.current.filter((u) => !u.startsWith('data:'))
    if (pending.length === 0) return
    uploadedNewRef.current = []
    fetch('/api/files', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: pending }),
    }).catch(() => undefined)
  }, [])

  function handleClose() {
    if (saving) return
    cleanupUploads()
    onClose()
  }

  // ==================== وحدات المادة ====================
  function addUnit() {
    if (units.length >= MAX_UNITS) return
    setUnits((rows) => [...rows, { key: nextRowKey(), name: '', factor: '', barcode: '', isActive: true }])
  }

  function updateUnit(key: string, patch: Partial<UnitRow>) {
    setUnits((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function removeUnit(key: string) {
    setUnits((rows) => rows.filter((r) => r.key !== key))
  }

  // ==================== التحقق ====================
  // الحقول الإلزامية للحفظ: الاسم + وحدة واحدة على الأقل + إسناد قسم + الحد الأدنى/الأعلى
  function validate(): { tab: FormTab; message: string } | null {
    if (!name.trim()) return { tab: 'basics', message: 'اسم المادة مطلوب' }
    if (units.length === 0) return { tab: 'units', message: 'أضف وحدة واحدة على الأقل — الوحدة إلزامية للحفظ' }
    for (const r of units) {
      if (!r.name.trim()) return { tab: 'units', message: 'أسماء الوحدات مطلوبة — أكمل الصفوف أو احذفها' }
    }
    const dup = units.map((r) => r.name.trim()).filter((n, i, arr) => arr.indexOf(n) !== i)
    if (dup.length > 0) return { tab: 'units', message: `تكرار في أسماء الوحدات: «${dup[0]}»` }
    if (!warehouseId) return { tab: 'warehouse', message: 'أسنِد المادة إلى قسم — آخر ابن في سلسلة المستودعات' }
    if (!leaves.has(warehouseId)) {
      return {
        tab: 'warehouse',
        message:
          'القسم المُسنَدة إليه المادة صار غير نهائي (به مستودعات فرعية) — اختر قسماً نهائياً من الشجرة ليُقبل الحفظ',
      }
    }
    const min = parseFloat(minStock) || 0
    const max = parseFloat(maxStock) || 0
    if (min <= 0) return { tab: 'warehouse', message: 'الحد الأدنى للمخزون إلزامي — أدخل قيمة أكبر من صفر' }
    if (max <= 0) return { tab: 'warehouse', message: 'الحد الأعلى للمخزون إلزامي — أدخل قيمة أكبر من صفر' }
    if (max < min) {
      return { tab: 'warehouse', message: 'الحد الأعلى يجب أن يكون أكبر من أو يساوي الحد الأدنى' }
    }
    return null
  }

  // ==================== الحفظ ====================
  async function handleSave() {
    const problem = validate()
    if (problem) {
      setActiveTab(problem.tab)
      toast({ title: problem.message, variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        barcode: barcode.trim() || null,
        description: description.trim() || null,
        warehouseId,
        // سعر الشراء لا يُرسل — يُحتسب تلقائياً من فواتير المشتريات على الخادم
        salePrice: parseFloat(salePrice) || 0,
        taxRate: parseFloat(taxRate) || 0,
        minStock: parseFloat(minStock) || 0,
        maxStock: parseFloat(maxStock) || 0,
        location: location.trim() || null,
        isActive,
        images: images.map((img) => ({
          id: img.existingId,
          url: img.url,
          fileName: img.fileName,
          isPrimary: img.isPrimary,
        })),
        units: units.map((r) => ({
          name: r.name.trim(),
          factor: parseFloat(r.factor) || 1,
          barcode: r.barcode.trim() || null,
          isActive: r.isActive,
        })),
      }

      const res = await fetch(editItem ? `/api/items/${editItem.id}` : '/api/items', {
        method: editItem ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'فشل الحفظ')

      uploadedNewRef.current = []
      toast({
        title: editItem ? `تم تحديث البطاقة ${editItem.code}` : `أُنشئت بطاقة المادة ${data?.code ?? ''}`,
      })
      onSaved()
      onClose()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'فشل حفظ البطاقة', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const problem = validate()

  // الحقول الإلزامية الناقصة — لتظليلها بالأحمر مباشرة أثناء التعبئة
  const missing = {
    name: !name.trim(),
    units: units.length === 0 || units.some((r) => !r.name.trim()),
    warehouse: !warehouseId,
    min: (parseFloat(minStock) || 0) <= 0,
    max: (parseFloat(maxStock) || 0) <= 0,
  }

  const sale = parseFloat(salePrice) || 0
  const tax = parseFloat(taxRate) || 0
  const taxValue = (sale * tax) / 100
  const saleWithTax = sale + taxValue

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="flex max-h-[94vh] w-[calc(100vw_-_var(--sidebar-w)_-_1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1152px]">
        {/* الرأس: العنوان + رقم البطاقة التلقائي */}
        <DialogHeader className="border-b px-5 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 pe-8">
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-primary/12 p-1.5 text-primary">
                <Package className="h-4 w-4" />
              </div>
              <DialogTitle className="text-base font-bold">
                {editItem ? `تعديل بطاقة المادة — ${editItem.code}` : 'بطاقة مادة / صنف جديد'}
              </DialogTitle>
            </div>
            {!editItem && (
              <Badge variant="outline" className="gap-1 border-primary/40 bg-primary/10 font-mono text-xs text-primary">
                رقم البطاقة: <span className="num">{nextCode}</span>
                <span className="font-sans font-normal opacity-75">(تلقائي +1)</span>
              </Badge>
            )}
          </div>
          <DialogDescription className="sr-only">
            نموذج إنشاء أو تعديل بطاقة مادة بالباركود والصور والوحدات والإسناد للمستودعات
          </DialogDescription>
        </DialogHeader>

        {/* التبويبات */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            setActiveTab(v as FormTab)
            // فتح تبويب الوحدات وهو فارغ يجهّز صف الوحدة الأولى تلقائياً (الوحدة إلزامية)
            if (v === 'units' && units.length === 0) addUnit()
          }}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="border-b px-5 pt-3">
            <TabsList className="h-auto w-full justify-start gap-1 rounded-t-lg bg-muted/50 p-1">
              <TabsTrigger value="basics" className="gap-1.5">
                <Settings2 className="h-3.5 w-3.5" />
                الأساسيات
              </TabsTrigger>
              <TabsTrigger value="units" className="gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                الوحدات
                {units.length > 0 ? (
                  <span
                    className={cn(
                      'num rounded-full px-1.5 text-[10px] font-bold',
                      missing.units
                        ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                        : 'bg-primary/15 text-primary',
                    )}
                  >
                    {units.length}
                  </span>
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                )}
              </TabsTrigger>
              <TabsTrigger value="prices" className="gap-1.5">
                <BadgeDollarSign className="h-3.5 w-3.5" />
                الأسعار
              </TabsTrigger>
              <TabsTrigger value="images" className="gap-1.5">
                <Images className="h-3.5 w-3.5" />
                الصور
                {images.length > 0 && (
                  <span className="num rounded-full bg-amber-500/20 px-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                    {images.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="warehouse" className="gap-1.5">
                <WarehouseIcon className="h-3.5 w-3.5" />
                المستودع
                {missing.warehouse ? (
                  <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* المحتوى */}
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {/* ============ الأساسيات ============ */}
            <TabsContent value="basics" className="mt-0 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="item-name">
                    اسم المادة <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="item-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: أرز بسمتي 5 كغ"
                    autoFocus
                    aria-invalid={missing.name}
                    className={cn(missing.name && 'border-rose-400 focus-visible:ring-rose-300')}
                  />
                </div>
                <BarcodeCapture value={barcode} onChange={setBarcode} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="item-desc">الوصف</Label>
                <Textarea
                  id="item-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="وصف اختياري للمادة — المواصفات، الماركة، ملاحظات…"
                  rows={3}
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch id="item-active" checked={isActive} onCheckedChange={setIsActive} />
                <Label htmlFor="item-active" className="text-sm">
                  مادة نشطة (قابلة للتعامل فوراً بالفواتير والحركات)
                </Label>
              </div>
            </TabsContent>

            {/* ============ الوحدات ============ */}
            <TabsContent value="units" className="mt-0 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold">
                    وحدات المادة <span className="text-rose-500">*</span>
                  </h4>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    وحدة واحدة على الأقل إلزامية للحفظ — وحدات تُتداول بها المادة (كرتون، نصف جملة…) مع معامل تحويل اختياري
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" disabled={units.length >= MAX_UNITS} onClick={addUnit}>
                  <Plus className="h-4 w-4" />
                  إضافة وحدة
                </Button>
              </div>

              <p className="text-xs font-semibold text-muted-foreground">
                وحدات (<span className="num">{units.length}</span>/
                <span className="num">{MAX_UNITS}</span>)
              </p>

              {units.length === 0 ? (
                <div className="rounded-xl border border-dashed border-rose-300 py-8 text-center text-sm text-muted-foreground dark:border-rose-500/40">
                  <Layers className="mx-auto mb-2 h-7 w-7 opacity-40" />
                  <span className="font-semibold text-rose-600 dark:text-rose-400">الوحدة إلزامية</span> — أضف
                  وحدة واحدة على الأقل قبل الحفظ
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="w-8">#</TableHead>
                        <TableHead>
                          اسم الوحدة <span className="text-rose-500">*</span>
                        </TableHead>
                        <TableHead>معامل التحويل (اختياري)</TableHead>
                        <TableHead>الرمز الشريطي</TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {units.map((r, i) => (
                        <TableRow key={r.key}>
                          <TableCell className="num text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell>
                            <Input
                              value={r.name}
                              onChange={(e) => updateUnit(r.key, { name: e.target.value })}
                              placeholder="كرتون"
                              aria-invalid={!r.name.trim()}
                              className={cn('h-9', !r.name.trim() && 'border-rose-400 focus-visible:ring-rose-300')}
                              aria-label="اسم الوحدة"
                            />
                          </TableCell>
                          <TableCell>
                            <NumInput
                              value={r.factor}
                              onChange={(e) => updateUnit(r.key, { factor: e.target.value })}
                              placeholder="1"
                              className="h-9 w-24"
                              aria-label="معامل التحويل"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={r.barcode}
                              onChange={(e) => updateUnit(r.key, { barcode: e.target.value })}
                              placeholder="CR01-120-X"
                              dir="ltr"
                              className="num h-9 w-40"
                              aria-label="الرمز الشريطي للوحدة"
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={r.isActive}
                                onCheckedChange={(v) => updateUnit(r.key, { isActive: v })}
                                aria-label="حالة الوحدة"
                              />
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-[10px]',
                                  r.isActive
                                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                    : 'text-muted-foreground',
                                )}
                              >
                                {r.isActive ? 'مفعّل' : 'موقوف'}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-rose-500 hover:text-rose-600"
                              onClick={() => removeUnit(r.key)}
                              aria-label="حذف الوحدة"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            {/* ============ الأسعار ============ */}
            <TabsContent value="prices" className="mt-0 space-y-4">
              {/* سعر الشراء — تلقائي من فواتير المشتريات ولا يُعدل من البطاقة */}
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-bold">سعر الشراء (تلقائي)</Label>
                    <Badge variant="outline" className="gap-1 border-primary/40 bg-background text-[10px] text-primary">
                      <Lock className="h-3 w-3" />
                      غير قابل للتعديل
                    </Badge>
                  </div>
                  {purchaseInfo && (
                    <div className="flex items-center gap-1 rounded-lg border bg-background p-0.5">
                      <button
                        type="button"
                        onClick={() => setPurchaseBasis('last')}
                        className={cn(
                          'rounded-md px-3 py-1 text-xs font-semibold transition-colors',
                          purchaseBasis === 'last' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        آخر سعر شراء
                      </button>
                      <button
                        type="button"
                        onClick={() => setPurchaseBasis('avg')}
                        className={cn(
                          'rounded-md px-3 py-1 text-xs font-semibold transition-colors',
                          purchaseBasis === 'avg' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        السعر الوسطي
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
                  <p className="num text-2xl font-bold text-primary">
                    {fmtMoney(purchaseValue)}
                    <span className="num ms-2 text-xs font-normal text-muted-foreground">≈ {fmtUSD(purchaseValue)}</span>
                  </p>
                  {purchaseInfo ? (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <ReceiptText className="h-3.5 w-3.5" />
                        آخر فاتورة: <span className="num font-semibold text-foreground/80">{purchaseInfo.lastInvoiceNumber}</span>
                        {purchaseInfo.lastInvoiceDate && (
                          <span className="num">— {fmtDate(purchaseInfo.lastInvoiceDate)}</span>
                        )}
                      </span>
                      <span className="num">{purchaseInfo.invoicesCount} فاتورة مشتريات</span>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      لا توجد فواتير مشتريات لهذه المادة بعد — يُجلب السعر تلقائياً من آخر فاتورة شراء فور إدخالها
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <PriceField id="sale" label="سعر البيع" value={salePrice} onChange={setSalePrice} usd={fmtUSD(sale)} money={fmtMoney(sale)} />
                <PriceField
                  id="tax"
                  label="نسبة الضريبة %"
                  value={taxRate}
                  onChange={setTaxRate}
                  hint="تُحتسب على سعر البيع وتُضاف عند الفوترة"
                >
                  {sale > 0 && tax > 0 && (
                    <div className="mt-2 space-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                      <p className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Percent className="h-3 w-3" />
                          قيمة الضريبة (<span className="num">{fmtQty(tax)}%</span>)
                        </span>
                        <span className="num font-semibold">{fmtMoney(taxValue)}</span>
                      </p>
                      <p className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Banknote className="h-3 w-3" />
                          الإجمالي شامل الضريبة
                        </span>
                        <span className="num font-bold text-primary">{fmtMoney(saleWithTax)}</span>
                      </p>
                    </div>
                  )}
                </PriceField>
              </div>

              {sale > 0 && purchaseValue > 0 && (
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-xl border px-4 py-3 text-sm',
                    sale >= purchaseValue
                      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                      : 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300',
                  )}
                >
                  {sale >= purchaseValue ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0" />
                  )}
                  هامش البيع المتوقع:{' '}
                  <span className="num font-bold">{fmtMoney(sale - purchaseValue)}</span>
                  <span className="text-xs opacity-75">
                    (≈ {fmtUSD(sale - purchaseValue)} —{' '}
                    <span className="num">
                      {purchaseValue > 0 ? fmtQty(((sale - purchaseValue) / purchaseValue) * 100) : 0}%
                    </span>
                    )
                  </span>
                </div>
              )}
            </TabsContent>

            {/* ============ الصور ============ */}
            <TabsContent value="images" className="mt-0">
              <ItemImagesManager
                images={images}
                onChange={(next) => {
                  // تتبع الصور الجديدة للتنظيف عند الإلغاء
                  for (const img of next) {
                    if (!img.existingId && !uploadedNewRef.current.includes(img.url)) {
                      uploadedNewRef.current.push(img.url)
                    }
                  }
                  setImages(next)
                }}
                onPreview={(idx) => setPreviewIdx(idx)}
                zipName={name.trim() || nextCode}
              />
            </TabsContent>

            {/* ============ المستودع ============ */}
            <TabsContent value="warehouse" className="mt-0 space-y-3">
              <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-2.5 text-xs">
                المادة تُسند إلى <span className="font-bold">القسم النهائي</span> — أي آخر ابن في سلسلة
                المستودعات (لا يوجد بداخله مستودعات أخرى). المستويات غير النهائية معطلة للاختيار.
              </div>

              {/* الحد الأدنى / الأعلى + مكان التواجد — الحدان إلزاميان ويرتبطان بجرس التنبيهات */}
              <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-3">
                <PriceField
                  id="min"
                  label="الحد الأدنى للمخزون"
                  required
                  value={minStock}
                  onChange={setMinStock}
                  error={missing.min}
                  hint="يرن جرس التنبيهات عند نزول الرصيد تحته"
                />
                <PriceField
                  id="max"
                  label="الحد الأعلى للمخزون"
                  required
                  value={maxStock}
                  onChange={setMaxStock}
                  error={missing.max}
                  hint="سقف التخزين المستهدف للقسم — ينبه الجرس عند تجاوزه"
                />
                <div className="space-y-1.5">
                  <Label htmlFor="item-location" className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    مكان التواجد
                  </Label>
                  <Input
                    id="item-location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="رف A-3 / ممر 2…"
                    className="h-10"
                    list="item-location-suggestions"
                    aria-label="مكان التواجد داخل القسم"
                  />
                  <datalist id="item-location-suggestions">
                    {locations.map((loc) => (
                      <option key={loc} value={loc} />
                    ))}
                  </datalist>
                  <p className="text-[11px] text-muted-foreground">ابحث أو اكتب — تظهر اقتراحات المواقع السابقة</p>
                </div>
              </div>

              {/* البحث عن القسم */}
              <div className="relative">
                <Input
                  value={warehouseSearch}
                  onChange={(e) => setWarehouseSearch(e.target.value)}
                  placeholder="ابحث عن القسم بالاسم أو الكود — وسيُعرض موقعه في الشجرة…"
                  className="ps-8"
                  aria-label="بحث عن القسم"
                />
                <MapPin className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>

              <RadioGroup value={warehouseId} onValueChange={setWarehouseId} className="gap-2">
                {index.roots.map((root) => (
                  <WarehousePickNode key={root.id} node={root} depth={0} leaves={leaves} />
                ))}
              </RadioGroup>

              {warehouses.length === 0 ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-5 text-center">
                  <p className="text-sm font-bold text-amber-600 dark:text-amber-400">
                    لا توجد مستودعات بعد — لا يمكن حفظ البطاقة
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    بطاقة المادة تشترط إسنادها إلى قسم نهائي في شجرة المستودعات — افتح شاشة
                    «المستودعات» وأنشئ المستودع ثم أقسامه، وعد لهنا لإكمال البطاقة
                  </p>
                </div>
              ) : (
                filteredWarehouses.length === 0 && (
                  <p className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
                    لا يوجد قسم مطابق لبحثك — جرّب كلمة أخرى
                  </p>
                )
              )}

              {selectedPath.length > 0 && (
                <div className="rounded-xl border bg-muted/30 px-4 py-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold">
                    <MapPin className="h-3.5 w-3.5 text-primary" />
                    المسار الكامل في الشجرة
                  </p>
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    {selectedPath.map((w, i) => (
                      <span key={w.id} className="flex items-center gap-1">
                        {i > 0 && <span className="text-muted-foreground">←</span>}
                        <span
                          className={cn(
                            'rounded-md px-1.5 py-0.5 font-semibold',
                            i === selectedPath.length - 1 && 'bg-primary/15 text-primary',
                          )}
                        >
                          {w.name}
                        </span>
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {(() => {
                      const leaf = selectedPath[selectedPath.length - 1]
                      return leaf?.keeperName ? (
                        <span className="flex items-center gap-1.5">
                          <UserRound className="h-3.5 w-3.5" />
                          أمين القسم: <span className="font-semibold text-foreground/80">{leaf.keeperName}</span>
                          {leaf.keeperPhone && <span className="num">• {leaf.keeperPhone}</span>}
                        </span>
                      ) : null
                    })()}
                    {currentBalance !== null && (
                      <span className="num flex items-center gap-1.5">
                        <Package className="h-3.5 w-3.5" />
                        الرصيد الحالي في هذا القسم: <span className="font-bold text-foreground/80">{fmtQty(currentBalance)}</span>
                      </span>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>

        {/* التذييل */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-5 py-3">
          <div className="flex items-center gap-2 text-xs">
            {problem ? (
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5" />
                {problem.message}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                كل المتطلبات مكتملة — جاهز للحفظ
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleClose} disabled={saving}>
              إلغاء
            </Button>
            <Button onClick={handleSave} disabled={saving || Boolean(problem)}>
              {saving ? 'جارٍ الحفظ…' : editItem ? 'حفظ التعديلات' : 'حفظ البطاقة'}
            </Button>
          </div>
        </div>
      </DialogContent>

      {/* عارض الصور — فوق النموذج */}
      <ImageViewer
        images={images.map((i) => ({ url: i.url, title: i.originalName }))}
        index={previewIdx}
        onClose={() => setPreviewIdx(null)}
        onIndexChange={setPreviewIdx}
        contextTitle={name.trim() || nextCode}
      />
    </Dialog>
  )
}

// ==================== عناصر مساعدة ====================

function PriceField({
  id,
  label,
  value,
  onChange,
  usd,
  money,
  hint,
  required = false,
  error = false,
  children,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  usd?: string
  money?: string
  hint?: string
  required?: boolean
  error?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`item-${id}`}>
        {label} {required && <span className="text-rose-500">*</span>}
      </Label>
      <NumInput
        id={`item-${id}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        aria-invalid={error}
        className={cn('h-10', error && 'border-rose-400 focus-visible:ring-rose-300')}
      />
      {usd && money && (
        <p className="text-[11px] text-muted-foreground">
          <span className="num">{money}</span> <span className="num">≈ {usd}</span>
        </p>
      )}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {children}
    </div>
  )
}

/** عقدة اختيار المستودع — الأوراق فقط قابلة للاختيار (راديو)، الآباء معطّلون مع تفسير */
function WarehousePickNode({
  node,
  depth,
  leaves,
}: {
  node: ReturnType<typeof buildWarehouseIndex>['nodes'][number]
  depth: number
  leaves: Set<string>
}) {
  const isLeaf = leaves.has(node.id)
  const Icon = LEVEL_ICONS[node.level] ?? WarehouseIcon
  const style = LEVEL_STYLES[node.level]

  return (
    <div style={{ paddingInlineStart: `${depth * 1.25}rem` }}>
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-colors',
          style?.card,
          !isLeaf && 'opacity-60',
        )}
      >
        <span className={cn('shrink-0 rounded-lg p-1.5', style?.iconBox)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="truncate text-sm font-bold">{node.name}</span>
            <Badge variant="outline" className={cn('shrink-0 text-[10px]', style?.badge)}>
              {LEVEL_META[node.level]?.short}
            </Badge>
            <span className="num text-[11px] text-muted-foreground">{node.code}</span>
          </div>
          {node.keeperName && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <UserRound className="h-3 w-3" />
              {node.keeperName}
            </p>
          )}
        </div>
        {isLeaf ? (
          <Label
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-primary/30 bg-background px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/5"
            htmlFor={`wh-${node.id}`}
          >
            <RadioGroupItem id={`wh-${node.id}`} value={node.id} className="h-3.5 w-3.5" />
            إسناد المادة هنا
          </Label>
        ) : (
          <span
            className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"
            title="يحتوي مستودعات فرعية — ليس قسماً نهائياً"
          >
            <Lock className="h-3 w-3" />
            غير نهائي
          </span>
        )}
      </div>
      {node.children.map((child) => (
        <WarehousePickNode key={child.id} node={child} depth={depth + 1} leaves={leaves} />
      ))}
    </div>
  )
}
