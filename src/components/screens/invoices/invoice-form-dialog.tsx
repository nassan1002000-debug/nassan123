'use client'

// نموذج إنشاء/تعديل فاتورة — ترحيل فوري بلا مسودات
// سلوك الملء التلقائي: المادة ← القسم المرتبط + الوحدة + السعر + العدد (المتوفر في القسم)
// الأرقام: المبيعات ومردودها متسلسلة مقفولة تلقائياً — المشتريات ومردودها يدوية مع اقتراح تسلسلي قابل للتعديل

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Banknote, CheckCircle2, Loader2, Package, Plus, ShoppingBasket, Star, Trash2, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { NumInput } from '@/components/ui/number-input'
import { useToast } from '@/hooks/use-toast'
import { AR_METHOD, fmtMoney, fmtNumber, fmtUSD } from '@/lib/format'
import { tafqitSYP } from '@/lib/tafqit'
import { round2 } from '@/lib/math'
import { calculateAwardPoints } from '@/lib/loyalty'
import { cn } from '@/lib/utils'
import { useActionBus, APP_EVENTS } from '@/lib/action-bus'
import { printInvoice } from './print-invoice'
import { ItemCombobox } from '@/components/screens/stock/item-combobox'
import {
  balanceOf,
  type InvoiceDetail,
  type InvoiceItem,
  type InvoiceKind,
  type LeafWarehouse,
  type PartnerOption,
} from './types'

function todayYMD(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ymdOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return todayYMD()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const MANUAL_HINT: Partial<Record<InvoiceKind, string>> = {
  PURCHASE: 'PINV-…',
  PURCHASE_RETURN: 'PRN-…',
}

const DOC_TITLE: Record<InvoiceKind, string> = {
  SALE: 'فاتورة مبيعات',
  SALES_RETURN: 'مردود مبيعات',
  PURCHASE: 'فاتورة مشتريات',
  PURCHASE_RETURN: 'مردود مشتريات',
}

interface BundleExpandItem {
  itemId: string
  warehouseId: string
  unitName: string
  unitFactor: number
  /** كمية المادة داخل السلة الواحدة */
  qtyPerUnit: number
  /** سعر الوحدة المعتمد في الفاتورة */
  price: number
}

/** سلة مُجملة كسطر واحد في النموذج — تُوسَّع إلى بنودها المخزنية عند الحفظ (Task 36) */
interface BundleRowState {
  id: string
  name: string
  /** عدد السلال — نص حقل الإدخال (عدد صحيح ≥ 1) */
  qty: string
  items: BundleExpandItem[]
  /** لقطة ملء التعديل: حسم السلة المخزن وعدد السلال وقتها — يُقاس خطياً عند تغيير العدد إن غاب القالب */
  snapshotDiscount?: number
  snapshotQty?: number
}

interface FormLine {
  key: string
  itemId: string | null
  warehouseId: string
  unitName: string
  quantity: string
  unitPrice: string
  /** سلة العروض المُجملة — null للبنود اليدوية */
  bundle: BundleRowState | null
}

/** سلة عروض نشطة كما تعيدها GET /api/bundles?active=1 — عقد الواجهة للعميل */
interface ActiveBundle {
  id: string
  name: string
  type: 'GIFT' | 'PERCENT' | 'PRICE'
  discountPercent: number
  startsAt: string
  endsAt: string
  active: boolean
  items: {
    itemId: string
    quantity: number
    isGift: boolean
    bundlePrice: number
    item: { code: string; name: string; salePrice: number }
  }[]
}

interface FormPayment {
  key: string
  amount: string
  method: string
  date: string
  notes: string
}

interface InvoiceFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: InvoiceKind
  editId: string | null
  items: InvoiceItem[]
  warehouses: LeafWarehouse[]
  partners: PartnerOption[]
  nextNumber: string
  onSaved: () => void
  /** مادة أُضيفت من النافذة السريعة — تُحفظ في قائمة الشاشة */
  onItemCreated: (item: InvoiceItem) => void
}

/** مركز تكلفة نشط — يُجلب من /api/cost-centers عند فتح النموذج */
interface CostCenterOption {
  id: string
  code: string
  name: string
}

export function InvoiceFormDialog({
  open,
  onOpenChange,
  type,
  editId,
  items,
  warehouses,
  partners,
  nextNumber,
  onSaved,
  onItemCreated,
}: InvoiceFormDialogProps) {
  const { toast } = useToast()
  const keyCounter = useRef(0)
  const numberTouched = useRef(false)

  const salesFamily = type === 'SALE' || type === 'SALES_RETURN'
  const autoNumber = type === 'SALE' || type === 'SALES_RETURN'
  const outFamily = type === 'SALE' || type === 'PURCHASE_RETURN'

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [existingNumber, setExistingNumber] = useState('')
  const [number, setNumber] = useState('')
  const [date, setDate] = useState(todayYMD)
  const [partnerId, setPartnerId] = useState<string | null>(null)
  const [payMode, setPayMode] = useState<'CASH' | 'CREDIT'>('CASH')
  const [cashMethod, setCashMethod] = useState('CASH')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<FormLine[]>([])
  const [taxRate, setTaxRate] = useState('0')
  const [discount, setDiscount] = useState('')
  const [creditPayments, setCreditPayments] = useState<FormPayment[]>([])

  // مركز التكلفة (اختياري) — يُنسب إليه القيد المحاسبي التلقائي كاملاً
  const [costCenterId, setCostCenterId] = useState('')
  const [costCenters, setCostCenters] = useState<CostCenterOption[]>([])

  // نقاط الولاء — صمام الأمان: كل الواجهة مشروطة بـ isEnabled من الإعدادات،
  // وعند الإيقاف تختفي كلياً وتعود الفاتورة لنموذجها الأصلي المستقر تلقائياً
  const [loyaltyCfg, setLoyaltyCfg] = useState<{
    isEnabled: boolean
    minInvoiceValue: number
    basePoints: number
    pointPrice: number
    multiplicationFactor: number
  } | null>(null)
  const [loyaltySummary, setLoyaltySummary] = useState<{ available: number; redeemed: number } | null>(null)
  const [redeemPoints, setRedeemPoints] = useState('')

  const [quickAdd, setQuickAdd] = useState<{ open: boolean; lineKey: string | null }>({
    open: false,
    lineKey: null,
  })

  // Task 40 — تأكيد إلغاء العملية (Esc): لا تطهير للحقول إلا بقرار صريح
  const [confirmCancel, setConfirmCancel] = useState(false)

  // سلال العروض النشطة — تُجلب عند فتح نموذج فاتورة مبيعات لإنزال موادها تلقائياً
  const [bundles, setBundles] = useState<ActiveBundle[]>([])
  const [bundlesLoading, setBundlesLoading] = useState(false)
  const [bundlesError, setBundlesError] = useState<string | null>(null)
  const [bundlesRetry, setBundlesRetry] = useState(0)
  const [bundlesDialogOpen, setBundlesDialogOpen] = useState(false)
  const [selectedBundleIds, setSelectedBundleIds] = useState<string[]>([])
  // لقطة حسم السلاسل عند ملء التعديل تسكن داخل حالة كل سطر (snapshotDiscount/snapshotQty)

  // منتقي الطرف — قائمة قابلة للبحث (تصفح بالأسهم + Enter بنفس طريقة منتقي المواد تماماً)
  const [partnerOpen, setPartnerOpen] = useState(false)
  const [partnerQuery, setPartnerQuery] = useState('')
  const [partnerHi, setPartnerHi] = useState(0)
  const partnerBoxRef = useRef<HTMLDivElement>(null)
  const partnerListRef = useRef<HTMLDivElement>(null)

  const familyPartners = useMemo(
    () =>
      partners.filter(
        (p) => p.isActive && (salesFamily ? p.type === 'CUSTOMER' : p.type === 'SUPPLIER'),
      ),
    [partners, salesFamily],
  )

  const partnerFiltered = useMemo(() => {
    const q = partnerQuery.trim().toLowerCase()
    if (!q) return familyPartners.slice(0, 50)
    return familyPartners
      .filter((p) => [p.name, p.code, p.phone ?? ''].join(' ').toLowerCase().includes(q))
      .slice(0, 50)
  }, [familyPartners, partnerQuery])

  const selectedPartner = useMemo(
    () => familyPartners.find((p) => p.id === partnerId) ?? null,
    [familyPartners, partnerId],
  )

  // إغلاق قائمة الطرف عند النقر خارجاً
  useEffect(() => {
    if (!partnerOpen) return
    const onDown = (e: MouseEvent) => {
      if (partnerBoxRef.current && !partnerBoxRef.current.contains(e.target as Node)) {
        setPartnerOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [partnerOpen])

  const pickPartner = useCallback((id: string) => {
    setPartnerId(id)
    setPartnerOpen(false)
    setPartnerQuery('')
  }, [])

  // تمرير العنصر المُضاء بلوحة المفاتيح للمرئية
  useEffect(() => {
    partnerListRef.current?.querySelector(`[data-idx="${partnerHi}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [partnerHi])

  /** تنقل بلوحة المفاتيح: أسهم + Enter للاختيار + Escape للإغلاق — مطابق لمنتقي المواد */
  function onPartnerInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!partnerOpen && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault()
      setPartnerOpen(true)
      return
    }
    if (partnerFiltered.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setPartnerHi((h) => (h + 1) % partnerFiltered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setPartnerHi((h) => (h - 1 + partnerFiltered.length) % partnerFiltered.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const p = partnerFiltered[partnerHi]
      if (p) pickPartner(p.id)
    } else if (e.key === 'Escape') {
      setPartnerOpen(false)
      setPartnerQuery('')
    }
  }

  const emptyLine = useCallback((): FormLine => {
    keyCounter.current += 1
    return { key: `line-${keyCounter.current}`, itemId: null, warehouseId: '', unitName: '', quantity: '', unitPrice: '', bundle: null }
  }, [])

  const emptyPayment = useCallback((): FormPayment => {
    keyCounter.current += 1
    return { key: `pay-${keyCounter.current}`, amount: '', method: 'CASH', date: todayYMD(), notes: '' }
  }, [])

  // ===== تحميل البيانات عند الفتح =====
  useEffect(() => {
    if (!open) return
    keyCounter.current = 0
    numberTouched.current = false
    setExistingNumber('')
    setNumber('')
    setDate(todayYMD())
    setPartnerId(null)
    setPayMode('CASH')
    setCashMethod('CASH')
    setNotes('')
    setLines([emptyLine()])
    setTaxRate('0')
    setDiscount('')
    setCreditPayments([])
    setPartnerQuery('')
    setCostCenterId('')
    setCostCenters([])
    setBundlesDialogOpen(false)
    setSelectedBundleIds([])
    // نقاط الولاء — تصفير الحالة عند كل فتح ثم جلب الإعدادات (SALE حصراً)
    setRedeemPoints('')
    setLoyaltySummary(null)
    if (type === 'SALE') {
      fetch('/api/loyalty/settings')
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (d: { settings?: { isEnabled: boolean; minInvoiceValue: number; basePoints: number; pointPrice: number; multiplicationFactor: number } } | null) => {
            if (d?.settings) setLoyaltyCfg(d.settings)
          },
        )
        .catch(() => setLoyaltyCfg(null))
    } else {
      setLoyaltyCfg(null)
    }

    // خيارات مراكز التكلفة النشطة — الفشل لا يمنع الفاتورة (المركز اختياري)
    fetch('/api/cost-centers')
      .then((r) => (r.ok ? r.json() : null))
      .then((list) => {
        if (Array.isArray(list)) setCostCenters(list as CostCenterOption[])
      })
      .catch(() => setCostCenters([]))

    if (editId) {
      setLoading(true)
      fetch(`/api/invoices/${editId}`)
        .then((r) => {
          if (!r.ok) throw new Error('failed')
          return r.json()
        })
        .then(
          (inv: {
            number: string
            date: string
            partner: { id: string }
            costCenter?: { id: string; code: string; name: string } | null
            payModeHint?: never
            subtotal: number
            taxRate: number
            discount: number
            total: number
            paid: number
            notes: string | null
            lines: {
              itemId: string
              warehouseId: string | null
              unitName: string | null
              unitFactor?: number
              quantity: number
              unitPrice: number
              bundleId?: string | null
              bundleName?: string | null
              bundleDiscount?: number
              bundleQty?: number
              bundleGift?: boolean
            }[]
            loyaltyPointsRedeemed?: number
            loyaltyRedeemValue?: number
            payments: { amount: number; method: string; date: string; notes: string | null }[]
          }) => {
            setExistingNumber(inv.number)
            // الرقم اليدوي (مشتريات/مردود مشتريات) يبقى كما هو الأصلي وقابلاً للتعديل
            if (!autoNumber) setNumber(inv.number)
            setDate(ymdOf(inv.date))
            setPartnerId(inv.partner.id)
            setCostCenterId(inv.costCenter?.id ?? '')
            setNotes(inv.notes ?? '')
            setTaxRate(String(inv.taxRate || 0))
            // نقاط الولاء — إعادة ملء خانة الاسترداد من لقطة الفاتورة (الخادم يعيد التوازن عند الحفظ)
            setRedeemPoints(inv.loyaltyPointsRedeemed && inv.loyaltyPointsRedeemed > 0 ? String(inv.loyaltyPointsRedeemed) : '')
            // حسم السلال محفوظ داخل inv.discount — حقل النموذج يحمل الحسم اليدوي فقط (الخادم يعيد حساب حسم السلال من البنود)
            // وقيمة حسم نقاط الولاء تُستبعد أيضاً — تعاد من خانة النقاط نفسها
            const bundleSnapshotSum = round2(inv.lines.reduce((s, l) => s + (l.bundleDiscount ?? 0), 0))
            const loyaltySnapshot = inv.loyaltyRedeemValue ?? 0
            if (bundleSnapshotSum > 0 || loyaltySnapshot > 0) {
              const manualRaw = round2((inv.discount || 0) - bundleSnapshotSum - loyaltySnapshot)
              setDiscount(manualRaw >= 0.005 ? String(Math.floor(manualRaw)) : '')
            } else {
              setDiscount(inv.discount ? String(inv.discount) : '')
            }
            keyCounter.current = 0
            // بنود كل سلة تتجم في سطر مجمل واحد بعدد سلالها المخزن (Task 36) — والبنود الحرة كما هي
            const fillRows: FormLine[] = []
            const openGroups = new Map<string, BundleRowState>()
            for (const l of inv.lines) {
              if (l.bundleId) {
                let row = openGroups.get(l.bundleId)
                if (!row) {
                  const qty = l.bundleQty && l.bundleQty >= 1 ? l.bundleQty : 1
                  keyCounter.current += 1
                  row = {
                    id: l.bundleId,
                    name: l.bundleName ?? 'سلة عروض',
                    qty: String(qty),
                    items: [],
                    snapshotDiscount: 0,
                    snapshotQty: qty,
                  }
                  openGroups.set(l.bundleId, row)
                  fillRows.push({
                    key: `line-${keyCounter.current}`,
                    itemId: null,
                    warehouseId: '',
                    unitName: 'سلة',
                    quantity: '',
                    unitPrice: '',
                    bundle: row,
                  })
                }
                row.items.push({
                  itemId: l.itemId,
                  warehouseId: l.warehouseId ?? '',
                  unitName: l.unitName ?? '',
                  unitFactor: l.unitFactor && l.unitFactor > 0 ? l.unitFactor : 1,
                  qtyPerUnit: row.snapshotQty ? round2(l.quantity / row.snapshotQty) : l.quantity,
                  price: l.unitPrice,
                })
                row.snapshotDiscount = round2((row.snapshotDiscount ?? 0) + (l.bundleDiscount ?? 0))
              } else {
                keyCounter.current += 1
                fillRows.push({
                  key: `line-${keyCounter.current}`,
                  itemId: l.itemId,
                  warehouseId: l.warehouseId ?? '',
                  unitName: l.unitName ?? '',
                  quantity: String(l.quantity),
                  unitPrice: String(l.unitPrice),
                  bundle: null,
                })
              }
            }
            setLines(fillRows.length > 0 ? fillRows : [emptyLine()])
            // الوضع: دفعة واحدة كاملة = نقدي — غير ذلك آجل بالدفعات المسجلة
            const fullPaid = inv.paid >= inv.total - 0.005 && inv.total > 0
            if (fullPaid && inv.payments.length === 1) {
              setPayMode('CASH')
              setCashMethod(inv.payments[0].method)
            } else {
              setPayMode('CREDIT')
              setCreditPayments(
                inv.payments.map((p) => {
                  keyCounter.current += 1
                  return {
                    key: `pay-${keyCounter.current}`,
                    amount: String(p.amount),
                    method: p.method,
                    date: ymdOf(p.date),
                    notes: p.notes ?? '',
                  }
                }),
              )
            }
          },
        )
        .catch(() => {
          toast({ title: 'تعذر تحميل بيانات الفاتورة', variant: 'destructive' })
          onOpenChange(false)
        })
        .finally(() => setLoading(false))
    }
  }, [open, editId, autoNumber, emptyLine, toast, onOpenChange])

  // اقتراح تسلسلي لحقل الرقم اليدوي — يُملأ مرة واحدة ويبقى قابلاً للتعديل حرياً
  useEffect(() => {
    if (!open || editId || autoNumber) return
    if (numberTouched.current) return
    if (nextNumber) setNumber((prev) => (prev.trim() ? prev : nextNumber))
  }, [open, editId, autoNumber, nextNumber])

  // ===== جلب سلال العروض النشطة — فواتير المبيعات حصراً مع إلغاء الطلب عند الإغلاق =====
  useEffect(() => {
    if (!open || type !== 'SALE') return
    const ctrl = new AbortController()
    setBundlesLoading(true)
    setBundlesError(null)
    fetch('/api/bundles?active=1', { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error('failed')
        return r.json() as Promise<{ bundles?: ActiveBundle[] }>
      })
      .then((d) => {
        setBundles(Array.isArray(d?.bundles) ? d.bundles : [])
        setBundlesLoading(false)
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return
        setBundlesError('تعذر جلب سلال العروض النشطة — تحقق من الاتصال')
        setBundlesLoading(false)
      })
    return () => ctrl.abort()
  }, [open, type, bundlesRetry])

  // ===== ملخص نقاط ولاء العميل المختار — يظهر مربع البيانات فقط مع النظام منشطاً وفاتورة مبيعات =====
  const loyaltyEnabled = type === 'SALE' && !!loyaltyCfg?.isEnabled
  useEffect(() => {
    if (!open || !loyaltyEnabled || !partnerId) {
      setLoyaltySummary(null)
      return
    }
    const ctrl = new AbortController()
    fetch(`/api/loyalty/summary?customerId=${partnerId}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          d: {
            isEnabled: boolean
            available: number
            redeemed: number
          } | null,
        ) => {
          if (d && d.isEnabled) setLoyaltySummary({ available: d.available, redeemed: d.redeemed })
          else setLoyaltySummary(null)
        },
      )
      .catch(() => setLoyaltySummary(null))
    return () => ctrl.abort()
  }, [open, loyaltyEnabled, partnerId])

  // ===== البنود الفعلية المخزنية — أسطر السلال المُجملة تُوسَّع إلى موادها × عدد السلال (Task 36) =====
  const effectiveLines = useMemo(() => {
    const out: {
      key: string
      itemId: string
      warehouseId: string
      unitName: string
      unitFactor: number
      quantity: number
      unitPrice: number
      bundleId: string | null
      bundleName: string | null
      bundleQty: number
    }[] = []
    for (const l of lines) {
      if (l.bundle) {
        const q = Math.max(Number(l.bundle.qty) || 0, 0)
        for (const it of l.bundle.items) {
          out.push({
            key: l.key,
            itemId: it.itemId,
            warehouseId: it.warehouseId,
            unitName: it.unitName,
            unitFactor: it.unitFactor,
            quantity: round2(it.qtyPerUnit * q),
            unitPrice: it.price,
            bundleId: l.bundle.id,
            bundleName: l.bundle.name,
            bundleQty: q,
          })
        }
      } else if (l.itemId) {
        const item = items.find((it) => it.id === l.itemId)
        out.push({
          key: l.key,
          itemId: l.itemId,
          warehouseId: l.warehouseId,
          unitName: l.unitName,
          unitFactor: item?.units.find((u) => u.name === l.unitName)?.factor ?? 1,
          quantity: Number(l.quantity) || 0,
          unitPrice: Number(l.unitPrice) || 0,
          bundleId: null,
          bundleName: null,
          bundleQty: 1,
        })
      }
    }
    return out
  }, [lines, items])

  // ===== المؤشرات الحية =====
  const totals = useMemo(() => {
    let subtotal = 0
    for (const l of effectiveLines) {
      subtotal += l.quantity * l.unitPrice
    }
    subtotal = round2(subtotal)
    const tax = round2((subtotal * (Number(taxRate) || 0)) / 100)
    const total = round2(subtotal + tax)
    return { subtotal, tax, total }
  }, [effectiveLines, taxRate])

  const discountVal = Math.max(Number(discount) || 0, 0)

  // ===== حسم السلال — تقدير عميل بخوارزمية مطابقة لخادم السلال (مُعاد كتابتها محلياً) =====
  // كل سلة مُجملة: الحسم من قالبها الحي بأسعار بنودها × عدد السلال — وإن غاب القالب
  // (حُذفت أو انتهت) قيس لقطة الحسم المخزنة خطياً على عدد السلال الجديد
  const bundleInfo = useMemo(() => {
    const cfgById = new Map(bundles.map((b) => [b.id, b]))
    const byKey = new Map<string, { gross: number; discount: number; net: number }>()
    let total = 0
    for (const l of lines) {
      if (!l.bundle) continue
      const row = l.bundle
      const q = Math.max(Number(row.qty) || 0, 0)
      const grossPerUnit = round2(row.items.reduce((s, it) => s + it.qtyPerUnit * it.price, 0))
      const gross = round2(grossPerUnit * q)
      const cfg = cfgById.get(row.id)
      let d = 0
      if (cfg) {
        const cfgByItem = new Map(cfg.items.map((bi) => [bi.itemId, bi]))
        if (cfg.type === 'GIFT') {
          // قيمة مواد الهدية داخل السلة الواحدة × عدد السلال (Q اكتمال = Q هدية مجانية)
          d = round2(
            row.items
              .filter((it) => cfgByItem.get(it.itemId)?.isGift)
              .reduce((s, it) => s + it.qtyPerUnit * it.price, 0) * q,
          )
        } else if (cfg.type === 'PERCENT') {
          // النسبة × إجمالي قيمة بنود السلال الموسعة
          d = round2((gross * cfg.discountPercent) / 100)
        } else {
          // فرق السعر عن السعر المخفض في القالب × الكميات الموسعة
          d = round2(
            row.items.reduce(
              (s, it) => s + Math.max(0, it.price - (cfgByItem.get(it.itemId)?.bundlePrice ?? 0)) * it.qtyPerUnit,
              0,
            ) * q,
          )
        }
      } else {
        // القالب غائب — كل الأنواع خطية بعدد السلال: الحسم المخزن يُقاس بنسبة العدد الجديد للقديم
        const q0 = row.snapshotQty && row.snapshotQty > 0 ? row.snapshotQty : 1
        d = round2((row.snapshotDiscount ?? 0) * (q / q0))
      }
      const net = round2(gross - d)
      byKey.set(l.key, { gross, discount: d, net })
      total = round2(total + d)
    }
    return { total, count: byKey.size, byKey }
  }, [lines, bundles])

  // ===== حسم نقاط الولاء — القيمة الحية للاسترداد المدخل (SALE حصراً والنظام منشطاً) =====
  const redeemPts = loyaltyEnabled ? Math.floor(Number(redeemPoints) || 0) : 0
  const loyaltyVal = round2(redeemPts * (loyaltyCfg?.pointPrice ?? 0))

  // netTotal يشمل حسم السلال وحسم نقاط الولاء — payload.discount يبقى للحسم اليدوي حصراً فيحسبه الخادم فوقهما
  const netTotal = round2(totals.total - Math.min(discountVal + bundleInfo.total + loyaltyVal, totals.total))

  // تلميح حي: النقاط التي ستمنحها هذه الفاتورة آلياً على إجماليها الصافي — بنفس دالة الخادم حرفياً
  const awardHint =
    loyaltyEnabled && netTotal > 0
      ? calculateAwardPoints(netTotal, {
          minInvoiceValue: loyaltyCfg?.minInvoiceValue ?? Infinity,
          basePoints: loyaltyCfg?.basePoints ?? 0,
          multiplicationFactor: loyaltyCfg?.multiplicationFactor ?? 1,
        })
      : 0
  const paidSum = useMemo(() => {
    if (payMode === 'CASH') return netTotal
    return round2(creditPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0))
  }, [payMode, creditPayments, netTotal])
  const remaining = round2(Math.max(0, netTotal - paidSum))

  // ===== تحقق حي =====
  const problem = useMemo(() => {
    if (loading) return 'جارٍ تحميل بيانات الفاتورة…'
    if (!date) return 'أدخل تاريخ الفاتورة'
    if (!partnerId) return salesFamily ? 'اختر العميل أولاً' : 'اختر المورد أولاً'
    if (!autoNumber && !String(number).trim()) {
      return 'رقم الفاتورة إلزامي — اكتب رقم المستند الورقي'
    }
    const filled = lines.filter((l) => l.bundle || l.itemId || l.quantity || l.unitPrice)
    if (filled.length === 0) return 'أضف بنداً واحداً على الأقل — اختر المادة أو أنزل سلة عروض'
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (l.bundle) {
        // سطر السلة المُجملة: عدد صحيح ≥ 1 وكل مادة فيها بسعر بيع موجب
        const q = Number(l.bundle.qty)
        if (!(q >= 1) || !Number.isInteger(q)) {
          return `سلة «${l.bundle.name}»: عدد السلال يجب أن يكون عدداً صحيحاً لا يقل عن 1`
        }
        if (l.bundle.items.some((it) => !(it.price > 0))) {
          return `سلة «${l.bundle.name}»: إحدى موادها بلا سعر بيع — أكمل بطاقة المادة أولاً`
        }
        continue
      }
      const empty = !l.itemId && !l.quantity && !l.unitPrice
      if (empty) continue
      if (!l.itemId) return `البند ${i + 1}: اختر المادة`
      if (!l.warehouseId) return `البند ${i + 1}: اختر القسم المخزني`
      const qty = Number(l.quantity) || 0
      if (!(qty > 0)) return `البند ${i + 1}: العدد يجب أن يكون أكبر من صفر`
      const price = Number(l.unitPrice) || 0
      if (!(price > 0)) return `البند ${i + 1}: سعر الوحدة يجب أن يكون أكبر من صفر`
    }
    // فحص كفاية المخزون على البنود الموسعة (مواد السلال × عدد السلال) عند الإنشاء فقط
    if (!editId && outFamily) {
      for (const el of effectiveLines) {
        const item = items.find((it) => it.id === el.itemId)
        const available = balanceOf(item ?? null, el.warehouseId)
        if (el.quantity > available + 0.0000001) {
          const label = el.bundleName ? `مادة السلة «${el.bundleName}»` : 'البند'
          const name = item?.name ?? ''
          return `${label} «${name}»: العدد المطلوب (${fmtNumber(el.quantity)}) أكبر من المتوفر في القسم (${fmtNumber(available)})`
        }
      }
    }
    if (discountVal + bundleInfo.total + loyaltyVal > totals.total + 0.005)
      return 'قيمة الحسم أكبر من إجمالي الفاتورة'
    if (redeemPts > 0 && loyaltySummary && redeemPts > loyaltySummary.available)
      return `رصيد نقاط العميل لا يكفي — المتاح ${fmtNumber(loyaltySummary.available)} نقطة والمطلوب ${fmtNumber(redeemPts)} نقطة`
    if (payMode === 'CREDIT') {
      for (let i = 0; i < creditPayments.length; i++) {
        if (!(Number(creditPayments[i].amount) > 0)) return `الدفعة ${i + 1}: أدخل مبلغاً أكبر من صفر`
      }
      if (paidSum > netTotal + 0.01) return 'مجموع الدفعات يتجاوز إجمالي الفاتورة'
    }
    return null
  }, [
    loading, date, partnerId, autoNumber, number, lines, editId, outFamily, items, effectiveLines,
    discountVal, totals.total, payMode, creditPayments, paidSum, netTotal, salesFamily,
    redeemPts, loyaltyVal, loyaltySummary,
  ])

  const canSave = !problem && !saving && !loading

  // ===== تعديل البنود =====
  const updateLine = useCallback((key: string, patch: Partial<FormLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }, [])

  const removeLine = useCallback((key: string) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)))
  }, [])

  // ===== التنقل السريع بلوحة المفاتيح داخل جدول البنود: مادة ← عدد ← سعر ← مادة السطر التالي =====
  // معرّف السطر المطلوب تركيز حقل بحث مادته بعد إعادة الرسم القادمة (سطر جديد لم يُولَد بعد
  // وقت الطلب) — useEffect (لا useLayoutEffect) يعمل أصلاً بعد التزام React بالـDOM فعلياً،
  // فالعنصر موجود ومُتاح للتركيز فور تنفيذ الجسم مباشرة بلا حاجة لأي تأجيل إضافي؛ tafadi
  // requestAnimationFrame هنا تحديداً لأنها تتعطل تماماً في التبويبات/النوافذ المخفية
  // (لا تُستدعى إطلاقاً حتى إطار الرسم القادم) فتُفوّت التركيز صامتة بلا أي خطأ ظاهر
  const pendingFocusKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const key = pendingFocusKeyRef.current
    if (!key) return
    pendingFocusKeyRef.current = null
    document.getElementById(`item-search-${key}`)?.focus()
  }, [lines])

  const addLine = useCallback(() => {
    const line = emptyLine()
    pendingFocusKeyRef.current = line.key
    setLines((prev) => [...prev, line])
  }, [emptyLine])

  /** Enter في حقل سعر سطر — يثبّت البند وينتقل لحقل بحث مادة السطر التالي، أو يفتح سطراً جديداً */
  const focusNextAfterPrice = useCallback(
    (key: string) => {
      const idx = lines.findIndex((l) => l.key === key)
      const next = lines[idx + 1]
      if (next && !next.bundle) {
        // سطر تالٍ فارغ ← حقل بحث مادته — سطر تالٍ مملوء مسبقاً (تعديل رجعي) ← حقل عدده
        const targetId = next.itemId ? `qty-${next.key}` : `item-search-${next.key}`
        document.getElementById(targetId)?.focus()
      } else {
        addLine()
      }
    },
    [lines, addLine],
  )

  /** تطبيق مادة على البند — ملء القسم والوحدة والسعر والعدد تلقائياً */
  const applyItem = useCallback(
    (lineKey: string, item: InvoiceItem) => {
      const wh =
        item.warehouseId && warehouses.some((w) => w.id === item.warehouseId)
          ? item.warehouseId
          : (warehouses[0]?.id ?? '')
      const unit = item.units[0]?.name ?? ''
      const price = salesFamily ? item.salePrice : item.purchasePrice
      const available = balanceOf(item, wh)
      updateLine(lineKey, {
        itemId: item.id,
        warehouseId: wh,
        unitName: unit,
        unitPrice: price > 0 ? String(price) : '',
        quantity: available > 0 ? String(available) : '',
      })
    },
    [warehouses, salesFamily, updateLine],
  )

  /** تغيير المادة يفكّ ارتباط البند بأي سلة — والسطر المُجمل لا يحمل منتقي مواد أصلاً */
  const handleItemPick = useCallback(
    (lineKey: string, itemId: string | null) => {
      if (!itemId) {
        updateLine(lineKey, { itemId: null, warehouseId: '', unitName: '', quantity: '', unitPrice: '' })
        return
      }
      const item = items.find((it) => it.id === itemId)
      if (item) applyItem(lineKey, item)
    },
    [items, applyItem, updateLine],
  )

  /** تغيير القسم يعيد ملء العدد بالمتوفر في القسم الجديد */
  const handleWarehouseChange = useCallback(
    (line: FormLine, whId: string) => {
      const item = items.find((it) => it.id === line.itemId)
      const available = balanceOf(item ?? null, whId)
      updateLine(line.key, { warehouseId: whId, quantity: available > 0 ? String(available) : '' })
    },
    [items, updateLine],
  )

  const handleItemCreated = useCallback(
    (item: InvoiceItem) => {
      onItemCreated(item)
      if (quickAdd.lineKey) applyItem(quickAdd.lineKey, item)
      setQuickAdd({ open: false, lineKey: null })
    },
    [onItemCreated, quickAdd.lineKey, applyItem],
  )

  // ===== سلال العروض — الاختيار والإنزال المُجمل (Task 36) =====
  const appliedBundles = useMemo(() => {
    const seen = new Set<string>()
    const out: { id: string; name: string }[] = []
    for (const l of lines) {
      if (!l.bundle || seen.has(l.bundle.id)) continue
      seen.add(l.bundle.id)
      out.push({ id: l.bundle.id, name: l.bundle.name })
    }
    return out
  }, [lines])

  const appliedBundleIds = useMemo(() => new Set(appliedBundles.map((b) => b.id)), [appliedBundles])

  /** سلة غير متاحة: إحدى موادها مفقودة من قائمة مواد النموذج أو موقوفة */
  const bundleUnavailable = useCallback(
    (b: ActiveBundle) =>
      b.items.some((bi) => {
        const it = items.find((x) => x.id === bi.itemId)
        return !it || !it.isActive
      }),
    [items],
  )

  /** حسم تقديري مبسط للسلة من قالبها بأسعار البيع الحالية — يظهر في بطاقة الاختيار */
  const bundleEstimate = useCallback((b: ActiveBundle): number => {
    if (b.type === 'PERCENT') {
      const gross = round2(b.items.reduce((s, bi) => s + bi.quantity * bi.item.salePrice, 0))
      return round2((gross * b.discountPercent) / 100)
    }
    if (b.type === 'PRICE') {
      return round2(b.items.reduce((s, bi) => s + Math.max(0, bi.item.salePrice - bi.bundlePrice) * bi.quantity, 0))
    }
    return round2(b.items.filter((bi) => bi.isGift).reduce((s, bi) => s + bi.quantity * bi.item.salePrice, 0))
  }, [])

  const selectableBundles = useMemo(
    () => bundles.filter((b) => !appliedBundleIds.has(b.id) && !bundleUnavailable(b)),
    [bundles, appliedBundleIds, bundleUnavailable],
  )

  const toggleBundleSelection = useCallback((id: string) => {
    setSelectedBundleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  /** تأكيد الاختيار — كل سلة تنزل سطراً مُجملة واحداً: «سلة عروض: [الاسم]» بعدد سلال 1
   *  موادها كاملة داخل حالته وتُوسَّع إلى بنود مخزنية عند الحفظ (Task 36) */
  const applySelectedBundles = useCallback(() => {
    const chosen = bundles.filter(
      (b) => selectedBundleIds.includes(b.id) && !appliedBundleIds.has(b.id) && !bundleUnavailable(b),
    )
    const newLines: FormLine[] = []
    for (const b of chosen) {
      const rowItems: BundleExpandItem[] = []
      for (const bi of b.items) {
        const item = items.find((x) => x.id === bi.itemId)
        if (!item) continue
        rowItems.push({
          itemId: bi.itemId,
          warehouseId:
            item.warehouseId && warehouses.some((w) => w.id === item.warehouseId)
              ? item.warehouseId
              : (warehouses[0]?.id ?? ''),
          unitName: item.units[0]?.name ?? '',
          unitFactor: item.units[0]?.factor ?? 1,
          qtyPerUnit: bi.quantity,
          price: item.salePrice > 0 ? item.salePrice : 0,
        })
      }
      if (rowItems.length === 0) continue
      keyCounter.current += 1
      newLines.push({
        key: `line-${keyCounter.current}`,
        itemId: null,
        warehouseId: '',
        unitName: 'سلة',
        quantity: '',
        unitPrice: '',
        bundle: { id: b.id, name: b.name, qty: '1', items: rowItems },
      })
    }
    if (newLines.length === 0) return
    setLines((prev) => {
      // فاتورة جديدة فارغة كلياً — يُستبدل السطر الشارحي الفارغ بدل تركه فوق بنود السلة
      const allUntouched = prev.every((l) => !l.bundle && !l.itemId && !l.quantity && !l.unitPrice)
      return allUntouched ? newLines : [...prev, ...newLines]
    })
    toast({
      title: `أُضيفت ${chosen.length} سلة كبند مجمل لكل سلة`,
      description: 'عدّل عدد السلال من خانة العدد — المواد تنزل من المخزون تلقائياً عند الحفظ',
    })
    setSelectedBundleIds([])
    setBundlesDialogOpen(false)
  }, [bundles, selectedBundleIds, appliedBundleIds, bundleUnavailable, items, warehouses, toast])

  // ===== الدفعات =====
  const updatePayment = useCallback((key: string, patch: Partial<FormPayment>) => {
    setCreditPayments((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  }, [])

  // ===== الحفظ — ترحيل فوري: أسطر السلال المُجملة تُوسَّع إلى موادها × عدد السلال (Task 36) =====
  // Task 40 — printAfter: حفظ وترحيل ثم طباعة بالقالب المطور (Ctrl+P / F9) — فشل الطباعة لا يبطل الحفظ
  const save = useCallback(async (opts?: { printAfter?: boolean }) => {
    const payload = {
      type,
      ...(autoNumber ? {} : { number: String(number).trim() }),
      date,
      partnerId,
      costCenterId: costCenterId || undefined,
      notes: notes.trim() || null,
      taxRate: Number(taxRate) || 0,
      discount: Number(discount) || 0,
      // نقاط الولاء — الاسترداد يُرسل للخادم فيحسب قيمته ويخصمها ذرياً داخل معاملة الفاتورة
      ...(type === 'SALE' && redeemPts > 0 ? { redeemPoints: redeemPts } : {}),
      lines: effectiveLines.map((l) => ({
        itemId: l.itemId,
        warehouseId: l.warehouseId,
        unitName: l.unitName || null,
        unitFactor: l.unitFactor,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        bundleId: l.bundleId,
        ...(l.bundleQty > 1 ? { bundleQty: l.bundleQty } : {}),
      })),
      payments:
        payMode === 'CASH'
          ? netTotal > 0
            ? [{ amount: netTotal, method: cashMethod, date, notes: 'سداد كامل عند الترحيل' }]
            : []
          : creditPayments
              .filter((p) => Number(p.amount) > 0)
              .map((p) => ({
                amount: Number(p.amount),
                method: p.method,
                date: p.date || date,
                notes: p.notes.trim() || null,
              })),
    }

    setSaving(true)
    try {
      const res = await fetch(editId ? `/api/invoices/${editId}` : '/api/invoices', {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => null)) as
        | { error?: string; number?: string; id?: string }
        | null
      if (!res.ok) {
        toast({
          title: 'تعذر حفظ الفاتورة',
          description: data?.error ?? 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        return
      }
      // حفظ وطباعة (Ctrl+P / F9): جلب تفاصيل الفاتورة المُرحّلة وطباعتها بالقالب المطور
      if (opts?.printAfter && data?.id) {
        try {
          const detailRes = await fetch(`/api/invoices/${data.id}`)
          const detail = (await detailRes.json().catch(() => null)) as InvoiceDetail | null
          if (detailRes.ok && detail) {
            const printed = printInvoice(detail)
            if (!printed) {
              toast({
                title: 'تم الحفظ لكن تعذر فتح نافذة الطباعة',
                description: 'اسمح بالنوافذ المنبثقة في المتصفح ثم افتح بطاقة العرض واطبع يدوياً',
                variant: 'destructive',
              })
            }
          }
        } catch {
          // فشل جلب التفاصيل للطباعة لا يبطل الحفظ المُرحّل
        }
      }
      toast({
        title: editId ? 'تم تعديل الفاتورة وإعادة ترحيلها' : 'تم إنشاء الفاتورة وترحيلها',
        description: `رقم الفاتورة: ${data?.number ?? ''} — حركات المخزون والسندات سُجلت فوراً`,
      })
      onSaved()
      onOpenChange(false)
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }, [
    effectiveLines, type, autoNumber, number, date, partnerId, costCenterId, notes, taxRate, discount,
    payMode, netTotal, cashMethod, creditPayments, editId, toast, onSaved, onOpenChange, redeemPts,
  ])

  // ===== Task 40 — ربط الاختصارات المركزية =====
  // تسجيل «المستند النشط» ليوجّه Ctrl+S/F8 و Ctrl+P/F9 و Esc إلى هذا النموذج عند فتحه
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    if (open) {
      useActionBus.getState().setActiveDoc({ kind: 'invoice-form', label: DOC_TITLE[type] })
    } else {
      useActionBus.getState().setActiveDoc(null)
    }
    return () => {
      useActionBus.getState().setActiveDoc(null)
    }
  }, [open, type])

  // الاستجابة للاختصارات: حفظ (Ctrl+S/F8) — حفظ وطباعة (Ctrl+P/F9) — تأكيد إلغاء العملية (Esc)
  useEffect(() => {
    const onSave = () => {
      if (openRef.current) void save()
    }
    const onSavePrint = () => {
      if (openRef.current) void save({ printAfter: true })
    }
    const onCancel = () => {
      if (openRef.current) setConfirmCancel(true)
    }
    window.addEventListener(APP_EVENTS.SAVE_CURRENT, onSave)
    window.addEventListener(APP_EVENTS.SAVE_PRINT_CURRENT, onSavePrint)
    window.addEventListener(APP_EVENTS.CANCEL_CURRENT, onCancel)
    return () => {
      window.removeEventListener(APP_EVENTS.SAVE_CURRENT, onSave)
      window.removeEventListener(APP_EVENTS.SAVE_PRINT_CURRENT, onSavePrint)
      window.removeEventListener(APP_EVENTS.CANCEL_CURRENT, onCancel)
    }
  }, [save])

  const partnerLabel = salesFamily ? 'العميل' : 'المورد'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* left-1/2! يبطل قاعدة التمركز خلف الشريط الجانبي (globals.css) لهذه النافذة فقط —
          بعرض 96vw يلزم التمركز على كامل الشاشة (كنافذة مصمم الترويسة) وإلا يفيض
          الطرف الأيمن خارج حدود الشاشة (كان يقص حقل اختيار العميل عملياً) */}
      <DialogContent className="left-1/2! flex h-[95vh] max-w-[96vw] w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[96vw]">
        {/* الرأس */}
        <div className="border-b px-5 py-3">
          <DialogHeader className="text-start">
            <DialogTitle>
              {editId ? `تعديل ${DOC_TITLE[type]}` : `${DOC_TITLE[type]} جديدة`}
              {editId && existingNumber ? <span className="num mr-2 text-muted-foreground">{existingNumber}</span> : null}
            </DialogTitle>
            <DialogDescription>
              {autoNumber
                ? 'الرقم متسلسل تلقائياً ولا يمكن تغييره — تُرحَّل الفاتورة فوراً عند الحفظ (لا مسودات)'
                : 'الرقم مقترح بالتسلسل وقابل للتعديل ليطابق مستند المورد — تُرحَّل الفاتورة فوراً عند الحفظ (لا مسودات)'}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* المتن — قسم البنود يملأ كل المساحة المتبقية عمودياً */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 rounded-lg border bg-muted/40 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جارٍ تحميل بيانات الفاتورة…
            </div>
          )}

          <div className={cn('flex min-h-0 flex-1 flex-col gap-3', loading && 'pointer-events-none opacity-40')}>
            {/* بيانات الفاتورة الأساسية */}
            <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-xs">
                  رقم الفاتورة <span className="text-rose-500">*</span>
                </Label>
                {autoNumber ? (
                  <Input
                    value={editId ? existingNumber : nextNumber}
                    disabled
                    className="num h-9 bg-muted/50 text-muted-foreground"
                    title="الرقم متسلسل تلقائياً ولا يمكن تغييره"
                  />
                ) : (
                  <Input
                    value={number}
                    onChange={(e) => {
                      numberTouched.current = true
                      setNumber(e.target.value)
                    }}
                    placeholder={MANUAL_HINT[type] ?? 'رقم الفاتورة'}
                    className="num h-9"
                    aria-label="رقم الفاتورة"
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  التاريخ <span className="text-rose-500">*</span>
                </Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">طريقة السداد</Label>
                <div className="grid h-9 grid-cols-2 gap-1 rounded-md border p-0.5">
                  {(['CASH', 'CREDIT'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPayMode(m)}
                      aria-pressed={payMode === m}
                      className={cn(
                        'rounded-sm text-sm transition-colors',
                        payMode === m
                          ? 'bg-primary/15 font-semibold text-primary'
                          : 'text-muted-foreground hover:bg-accent',
                      )}
                    >
                      {m === 'CASH' ? 'نقدي' : 'آجل'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">عدد البنود</Label>
                <div className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
                  <Badge variant="outline" className="num">
                    {effectiveLines.length}
                  </Badge>
                  <span className="text-xs text-muted-foreground">بند مخزني — مواد السلال ممددة</span>
                </div>
              </div>
            </div>

            {/* الطرف + مركز التكلفة + الملاحظات — صفاً واحداً لتوفير المساحة العمودية لبنود الفاتورة */}
            <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {partnerLabel} <span className="text-rose-500">*</span>
                </Label>
                <div ref={partnerBoxRef} className="relative">
                  {selectedPartner && !partnerOpen ? (
                    <div className="flex items-center gap-2.5 rounded-md border bg-background px-3 py-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <User className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{selectedPartner.name}</p>
                        <p className="num text-[10px] text-muted-foreground">
                          {selectedPartner.code}
                          {selectedPartner.phone ? ` · ${selectedPartner.phone}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        onClick={() => setPartnerId(null)}
                        aria-label={`مسح ${partnerLabel} المختار`}
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <User className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={partnerQuery}
                        onChange={(e) => {
                          setPartnerQuery(e.target.value)
                          setPartnerHi(0)
                          if (!partnerOpen) setPartnerOpen(true)
                        }}
                        onKeyDown={onPartnerInputKeyDown}
                        onFocus={() => {
                          setPartnerOpen(true)
                          setPartnerHi(0)
                        }}
                        placeholder={`ابحث بالاسم أو الكود أو الهاتف… (${familyPartners.length} ${salesFamily ? 'عميل' : 'مورد'})`}
                        className="h-10 w-full rounded-md border border-input bg-background ps-8 pe-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`بحث واختيار ${partnerLabel}`}
                        role="combobox"
                        aria-expanded={partnerOpen}
                        aria-controls="partner-combobox-list"
                        aria-activedescendant={partnerOpen && partnerFiltered[partnerHi] ? `partner-opt-${partnerFiltered[partnerHi].id}` : undefined}
                      />
                    </div>
                  )}

                  {partnerOpen && (
                    <div
                      ref={partnerListRef}
                      id="partner-combobox-list"
                      className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover shadow-lg"
                      role="listbox"
                      aria-label={`قائمة ${salesFamily ? 'العملاء' : 'الموردين'}`}
                    >
                      {partnerFiltered.length === 0 ? (
                        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                          {salesFamily
                            ? 'لا يوجد عملاء نشطون — أنشئ ملف عميل من شاشة العملاء والموردون'
                            : 'لا يوجد موردون نشطون — أنشئ ملف مورد من شاشة العملاء والموردون'}
                        </p>
                      ) : (
                        partnerFiltered.map((p, idx) => (
                          <button
                            key={p.id}
                            type="button"
                            role="option"
                            id={`partner-opt-${p.id}`}
                            data-idx={idx}
                            aria-selected={p.id === partnerId}
                            onMouseDown={(e) => {
                              // mousedown قبل blur الحقل — يمنع إغلاق القائمة قبل تسجيل الاختيار
                              e.preventDefault()
                              pickPartner(p.id)
                            }}
                            onMouseEnter={() => setPartnerHi(idx)}
                            className={cn(
                              'flex w-full items-center gap-2.5 px-3 py-2 text-start transition-colors hover:bg-accent',
                              idx === partnerHi && 'bg-accent',
                              p.id === partnerId && 'bg-primary/10',
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">{p.name}</span>
                              <span className="num block text-[10px] text-muted-foreground">{p.code}</span>
                            </span>
                            {p.phone && (
                              <span className="num shrink-0 text-[10px] text-muted-foreground" dir="ltr">
                                {p.phone}
                              </span>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* مربع بيانات نقاط الولاء — يظهر تحت اسم العميل مباشرة في فواتير المبيعات حصراً
                    صمام الأمان: النظام غير منشط ⇒ المربع مختفٍ كلياً والواجهة بنموذجها الأصلي */}
                {loyaltyEnabled && (
                  <div className="mt-2 rounded-md border border-primary/30 bg-primary/[0.04] p-2">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
                      <span className="flex items-center gap-1 font-bold text-primary">
                        <Star className="h-3.5 w-3.5" />
                        نقاط الولاء
                      </span>
                      {loyaltySummary ? (
                        <span className="text-muted-foreground">
                          المتاح: <span className="num font-extrabold text-primary">{fmtNumber(loyaltySummary.available)}</span>
                          <span className="mx-1.5 text-muted-foreground/50">|</span>
                          المسترد: <span className="num font-semibold text-amber-600 dark:text-amber-400">{fmtNumber(loyaltySummary.redeemed)}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">…</span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <NumInput
                        value={redeemPoints}
                        onChange={(e) => setRedeemPoints(e.target.value)}
                        placeholder="استرداد 0"
                        className="h-8 w-24 text-start"
                        aria-label="عدد النقاط المطلوب استردادها في هذه الفاتورة"
                      />
                      <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                        {loyaltyVal > 0 ? (
                          <>
                            يتحول إلى حسم نقاط الولاء:{' '}
                            <span className="num font-bold text-amber-700 dark:text-amber-400">{fmtMoney(loyaltyVal)} ل.س</span>
                          </>
                        ) : (
                          <>اكتب عدد النقاط — تنزل قيمتها حسماً أسفل الفاتورة ({fmtMoney(loyaltyCfg?.pointPrice ?? 0)} ل.س/نقطة)</>
                        )}
                      </span>
                    </div>
                    {awardHint > 0 && (
                      <p className="mt-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        ✦ هذه الفاتورة تمنح العميل {fmtNumber(awardHint)} نقطة ولاء آلياً عند الترحيل
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* مركز التكلفة (اختياري) — يُنسب إليه القيد المحاسبي التلقائي كاملاً */}
              <div className="space-y-1.5">
                <Label htmlFor="invoice-cost-center" className="text-xs">
                  مركز التكلفة
                  <span className="ms-1 text-[10px] font-normal text-muted-foreground">(اختياري)</span>
                </Label>
                <Select
                  value={costCenterId || 'NONE'}
                  onValueChange={(v) => setCostCenterId(v === 'NONE' ? '' : v)}
                  disabled={loading}
                >
                  <SelectTrigger id="invoice-cost-center" className="h-10 w-full text-sm" aria-label="مركز التكلفة">
                    <SelectValue placeholder="بدون مركز…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">
                      <span className="text-muted-foreground">بدون مركز تكلفة</span>
                    </SelectItem>
                    {costCenters.map((cc) => (
                      <SelectItem key={cc.id} value={cc.id}>
                        <span className="num text-xs text-muted-foreground">{cc.code}</span> — {cc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 lg:col-span-2">
                <Label className="text-xs">ملاحظات الفاتورة</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات تُذكر تحت اسم العميل/المورد — الشروط، المرجع، أسماء المندوبين…"
                  rows={1}
                  className="h-10 resize-none py-2.5"
                />
              </div>
            </div>

            {/* بنود الفاتورة — يملأ المساحة المتبقية والجدول يتمرر داخلياً */}
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                <Label className="shrink-0 text-xs">
                  بنود الفاتورة <span className="text-rose-500">*</span>
                </Label>
                <p className="hidden min-w-0 flex-1 truncate text-center text-[11px] text-muted-foreground md:block">
                  اختيار المادة يملأ القسم والوحدة والسعر والعدد تلقائياً — المتوفر يظهر رقمياً بالأحمر ويختفي بمجرد كتابة العدد الحقيقي
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  {type === 'SALE' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-amber-500/50 font-semibold text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                      title="إنزال مواد سلال العروض النشطة تلقائياً إلى بنود الفاتورة"
                      onClick={() => setBundlesDialogOpen(true)}
                    >
                      <ShoppingBasket className="h-4 w-4" />
                      <span className="hidden sm:inline">سلال العروض النشطة</span>
                      <span className="sm:hidden">السلال</span>
                      <Badge className="num h-4 min-w-4 px-1 text-[10px]">{bundles.length}</Badge>
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-primary/40 font-semibold text-primary hover:bg-primary/10"
                    onClick={addLine}
                  >
                    <Plus className="h-4 w-4" />
                    إضافة بند
                  </Button>
                </div>
              </div>

              {/* السلال المُجملة تظهر أسطراً مستقلة داخل الجدول نفسه — لا حاجة لرقائق خارجية (Task 36) */}

              <div className="min-h-[180px] flex-1 overflow-auto rounded-lg border">
                <Table className="min-w-[950px]">
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="w-10">م</TableHead>
                      <TableHead className="min-w-[240px]">المادة</TableHead>
                      <TableHead className="min-w-[150px]">القسم المخزني</TableHead>
                      <TableHead className="w-[120px]">الوحدة</TableHead>
                      <TableHead className="w-[110px]">العدد</TableHead>
                      <TableHead className="w-[120px]">سعر الوحدة</TableHead>
                      <TableHead className="w-[120px]">الإجمالي</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, i) => {
                      // ===== سطر السلة المُجملة — بند واحد مستقل: «سلة عروض: [الاسم]» (Task 36) =====
                      if (l.bundle) {
                        const info = bundleInfo.byKey.get(l.key)
                        const grossPerUnit = round2(l.bundle.items.reduce((s, it) => s + it.qtyPerUnit * it.price, 0))
                        const gross = round2(grossPerUnit * (Number(l.bundle.qty) || 0))
                        const net = info?.net ?? round2(gross - (info?.discount ?? 0))
                        const summary = l.bundle.items
                          .map((it) => `${it.price > 0 ? '' : '⚠ '}${items.find((x) => x.id === it.itemId)?.name ?? '؟'} ×${fmtNumber(it.qtyPerUnit)}`)
                          .join('، ')
                        return (
                          <TableRow key={l.key} className="border-s-4 border-s-amber-500/60 bg-amber-500/[0.045]">
                            <TableCell className="num text-center text-xs text-muted-foreground">{i + 1}</TableCell>
                            <TableCell>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                                    <ShoppingBasket className="h-4 w-4" />
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-bold text-amber-800 dark:text-amber-300">
                                      سلة عروض: {l.bundle.name}
                                    </p>
                                    <p className="truncate text-[11px] text-muted-foreground" title={summary}>
                                      {summary}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs text-muted-foreground">حسب مواد السلة</span>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">سلة</span>
                            </TableCell>
                            <TableCell>
                              <NumInput
                                value={l.bundle.qty}
                                onChange={(e) =>
                                  updateLine(l.key, { bundle: { ...l.bundle!, qty: e.target.value } })
                                }
                                onKeyDown={(e) => {
                                  if (e.key !== 'Enter') return
                                  e.preventDefault()
                                  focusNextAfterPrice(l.key)
                                }}
                                placeholder="1"
                                className="h-10 text-start"
                                title="عدد السلال — كل سلة تخرج موادها كاملة من المخزون ويُضاعف حسمها"
                                aria-label={`عدد سلال ${l.bundle.name}`}
                              />
                            </TableCell>
                            <TableCell className="text-end">
                              <span className="num text-sm" title="سعر السلة الواحدة بإجمالي موادها بأسعار الفاتورة">
                                {fmtMoney(grossPerUnit)}
                              </span>
                            </TableCell>
                            <TableCell className="text-end">
                              <span className="num text-sm font-extrabold text-amber-800 dark:text-amber-300">
                                {fmtMoney(net)}
                              </span>
                              {info && info.discount > 0 ? (
                                <p className="num text-[10px] text-muted-foreground">
                                  <span className="line-through">{fmtMoney(gross)}</span> — حسم{' '}
                                  {fmtMoney(info.discount)}
                                </p>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-center">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
                                disabled={lines.length <= 1}
                                title={lines.length <= 1 ? 'البند الوحيد — لا يُحذف' : `إزالة السلة «${l.bundle.name}» كاملة من الفاتورة`}
                                onClick={() => removeLine(l.key)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      }
                      // ===== البنود اليدوية التقليدية =====
                      const item = items.find((it) => it.id === l.itemId) ?? null
                      const available = balanceOf(item, l.warehouseId)
                      const lineTotal = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)
                      const empty = !l.itemId && !l.quantity && !l.unitPrice
                      const invalid = !empty && (!l.itemId || !l.warehouseId || !(Number(l.quantity) > 0) || !(Number(l.unitPrice) > 0))
                      const factor = item?.units.find((u) => u.name === l.unitName)?.factor ?? 1
                      return (
                        <TableRow key={l.key} className={cn(invalid && 'bg-rose-500/[0.04]')}>
                          <TableCell className="num text-center text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell>
                            <div className="min-w-0">
                              <ItemCombobox
                                id={`item-search-${l.key}`}
                                items={items}
                                value={l.itemId}
                                onChange={(id) => handleItemPick(l.key, id)}
                                onAddNew={() => setQuickAdd({ open: true, lineKey: l.key })}
                                onPicked={() => document.getElementById(`qty-${l.key}`)?.focus()}
                              />
                            </div>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={l.warehouseId || undefined}
                              onValueChange={(v) => handleWarehouseChange(l, v)}
                              disabled={!l.itemId}
                            >
                              <SelectTrigger className="h-10 w-full text-sm" aria-label="القسم المخزني">
                                <SelectValue placeholder="القسم…" />
                              </SelectTrigger>
                              <SelectContent>
                                {warehouses.map((w) => (
                                  <SelectItem key={w.id} value={w.id}>
                                    <span className="num text-xs text-muted-foreground">{w.code}</span> — {w.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            {item && item.units.length > 1 ? (
                              <Select
                                value={l.unitName || item.units[0]?.name || undefined}
                                onValueChange={(v) => updateLine(l.key, { unitName: v })}
                              >
                                <SelectTrigger className="h-10 w-full text-sm" aria-label="الوحدة">
                                  <SelectValue placeholder="الوحدة…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {item.units.map((u) => (
                                    <SelectItem key={u.name} value={u.name}>
                                      {u.name}
                                      {u.factor !== 1 ? <span className="num text-[10px] text-muted-foreground"> ×{u.factor}</span> : null}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                value={l.unitName}
                                onChange={(e) => updateLine(l.key, { unitName: e.target.value })}
                                placeholder="الوحدة…"
                                className="h-10 text-sm"
                                aria-label="الوحدة"
                              />
                            )}
                            {factor !== 1 && (
                              <p className="num mt-0.5 text-[10px] text-muted-foreground">المعامل ×{factor}</p>
                            )}
                          </TableCell>
                          <TableCell>
                            <NumInput
                              id={`qty-${l.key}`}
                              value={l.quantity}
                              onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter') return
                                e.preventDefault()
                                document.getElementById(`price-${l.key}`)?.focus()
                              }}
                              placeholder={item ? fmtNumber(available) : '0'}
                              className="h-10 text-start placeholder:font-bold placeholder:text-rose-500"
                              title={item ? `المتوفر حالياً في القسم: ${fmtNumber(available)} — يظهر مؤقتاً حتى كتابة العدد الحقيقي` : undefined}
                              aria-label="العدد"
                            />
                          </TableCell>
                          <TableCell>
                            <NumInput
                              id={`price-${l.key}`}
                              value={l.unitPrice}
                              onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter') return
                                e.preventDefault()
                                focusNextAfterPrice(l.key)
                              }}
                              placeholder="0.00"
                              className="h-10 text-start"
                              aria-label="سعر الوحدة"
                            />
                          </TableCell>
                          <TableCell className="text-end">
                            <span className="num text-sm font-semibold">{fmtMoney(round2(lineTotal))}</span>
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
                              disabled={lines.length <= 1}
                              title={lines.length <= 1 ? 'البند الوحيد — لا يُحذف' : 'حذف البند'}
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

            </div>

          </div>
        </div>

        {/* شريط المجاميع + السداد + الحفظ — مثبت أسفل النافذة دائماً */}
        <div className="shrink-0 space-y-2.5 border-t bg-muted/30 px-5 py-3">
          {/* صف المجاميع */}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="text-muted-foreground">
                المجموع: <span className="num font-bold text-foreground">{fmtMoney(totals.subtotal)}</span>
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                الضريبة:
                <NumInput
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                  className="h-8 w-16 text-start"
                  aria-label="نسبة الضريبة %"
                />
                <span className="num font-bold text-foreground">{fmtMoney(totals.tax)}</span>
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {salesFamily ? 'الحسم الممنوح:' : 'الحسم المكتسب:'}
                <NumInput
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                  placeholder="0"
                  className="h-8 w-24 text-start"
                  aria-label={salesFamily ? 'الحسم الممنوح' : 'الحسم المكتسب'}
                />
              </span>
              {type === 'SALE' && bundleInfo.total > 0 && (
                <span className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
                  حسم السلال ({bundleInfo.count}):
                  <span className="num font-extrabold" dir="ltr">−{fmtMoney(bundleInfo.total)}</span>
                  <span className="text-xs font-normal text-muted-foreground">ل.س</span>
                </span>
              )}
              {loyaltyVal > 0 && (
                <span className="flex items-center gap-1.5 font-semibold text-primary">
                  <Star className="h-3.5 w-3.5" />
                  حسم نقاط الولاء ({fmtNumber(redeemPts)} نقطة):
                  <span className="num font-extrabold" dir="ltr">−{fmtMoney(loyaltyVal)}</span>
                  <span className="text-xs font-normal text-muted-foreground">ل.س</span>
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="text-muted-foreground">
                الإجمالي: <span className="num text-base font-extrabold text-primary">{fmtMoney(netTotal)}</span>
                <span className="num mr-2 text-[11px]">≈ {fmtUSD(netTotal)}</span>
              </span>
              {payMode === 'CREDIT' && (
                <span className="text-muted-foreground">
                  المتبقي: <span className="num font-bold text-amber-600 dark:text-amber-400">{fmtMoney(remaining)}</span>
                </span>
              )}
            </div>
          </div>

          {/* تفقيط الإجمالي — تحويل حي للمبلغ إلى كلمات عربية فصيحة */}
          {netTotal > 0 && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground/80">تفقيط الإجمالي:</span>{' '}
              {tafqitSYP(netTotal)}
            </p>
          )}
          {/* تفقيط المتبقي — قيمة الآجل على ذمة الطرف (Task 34) */}
          {payMode === 'CREDIT' && remaining > 0 && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-amber-700 dark:text-amber-400">تفقيط المتبقي:</span>{' '}
              {tafqitSYP(remaining)}
            </p>
          )}

          {/* السداد مثبت تحت المجاميع مباشرة — النقدي شريط واحد والآجل قائمة دفعات محدودة الارتفاع */}
          {payMode === 'CASH' ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-background/60 px-3 py-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <Banknote className="h-4 w-4 text-primary" />
                  سداد نقدي كامل
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  المبلغ المستلم:
                  <Input value={fmtMoney(netTotal)} disabled className="num h-8 w-32 bg-muted/50" aria-label="المبلغ المستلم" />
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  طريقة الاستلام / الدفع:
                  <Select value={cashMethod} onValueChange={setCashMethod}>
                    <SelectTrigger className="h-8 w-36" aria-label="طريقة الدفع">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(AR_METHOD).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </span>
                <span className="text-xs text-muted-foreground">يُنشأ سند القبض/الدفع تلقائياً برقم VCH عند الترحيل</span>
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border bg-background/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Banknote className="h-4 w-4 text-primary" />
                    دفعات الفاتورة الآجلة
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      'num gap-1',
                      remaining <= 0
                        ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                        : 'border-amber-500/40 text-amber-600 dark:text-amber-400',
                    )}
                  >
                    المتبقي: {fmtMoney(remaining)}
                  </Badge>
                </div>

                {creditPayments.length === 0 ? (
                  <p className="rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
                    بلا دفعات — الفاتورة تُسجل بالكامل على ذمة الطرف. أضف دفعة أولى إن استُلم مبلغ الآن.
                  </p>
                ) : (
                  <div className="max-h-[160px] space-y-2 overflow-y-auto">
                    {creditPayments.map((p, i) => (
                      <div key={p.key} className="grid grid-cols-1 gap-2 rounded-md border bg-background p-2 sm:grid-cols-[110px_130px_140px_1fr_36px]">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">مبلغ الدفعة {i + 1}</Label>
                          <NumInput
                            value={p.amount}
                            onChange={(e) => updatePayment(p.key, { amount: e.target.value })}
                            placeholder="0.00"
                            className="h-9 text-start"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">الطريقة</Label>
                          <Select value={p.method} onValueChange={(v) => updatePayment(p.key, { method: v })}>
                            <SelectTrigger className="h-9 w-full" aria-label="طريقة الدفع">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(AR_METHOD).map(([k, v]) => (
                                <SelectItem key={k} value={k}>
                                  {v}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">التاريخ</Label>
                          <Input
                            type="date"
                            value={p.date}
                            onChange={(e) => updatePayment(p.key, { date: e.target.value })}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">ملاحظة</Label>
                          <Input
                            value={p.notes}
                            onChange={(e) => updatePayment(p.key, { notes: e.target.value })}
                            placeholder="شيك رقم…، حوالة…"
                            className="h-9"
                          />
                        </div>
                        <div className="flex items-end justify-center pb-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
                            aria-label={`حذف الدفعة ${i + 1}`}
                            onClick={() => setCreditPayments((prev) => prev.filter((x) => x.key !== p.key))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <Button type="button" variant="outline" size="sm" onClick={() => setCreditPayments((prev) => [...prev, emptyPayment()])}>
                  <Plus className="h-4 w-4" />
                  إضافة دفعة
                </Button>
              </div>
            )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {problem ? (
              <span className="me-auto flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                {problem}
              </span>
            ) : (
              <span className="me-auto flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                جاهزة للترحيل الفوري عند الحفظ
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block" tabIndex={canSave ? -1 : 0}>
                  <Button type="button" disabled={!canSave} onClick={() => void save()}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                    {editId ? 'حفظ التعديل وترحيله' : 'حفظ وترحيل الفاتورة'}
                  </Button>
                </span>
              </TooltipTrigger>
              {problem && <TooltipContent>{problem}</TooltipContent>}
            </Tooltip>
          </div>
        </div>
      </DialogContent>

      {/* نافذة إضافة مادة جديدة السريعة */}
      <QuickAddItemDialog
        open={quickAdd.open}
        onOpenChange={(v) => setQuickAdd((s) => ({ ...s, open: v }))}
        warehouses={warehouses}
        defaultWarehouseId={quickAdd.lineKey ? (lines.find((l) => l.key === quickAdd.lineKey)?.warehouseId ?? '') : ''}
        onCreated={handleItemCreated}
      />

      {/* نافذة اختيار سلال العروض النشطة — إنزال موادها تلقائياً إلى بنود الفاتورة */}
      <Dialog open={bundlesDialogOpen} onOpenChange={setBundlesDialogOpen}>
        <DialogContent className="w-[calc(100vw_-_var(--sidebar-w)_-_2rem)] sm:max-w-lg">
          <DialogHeader className="text-start">
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBasket className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              سلال العروض النشطة
            </DialogTitle>
            <DialogDescription>اختر سلة أو أكثر لتُضاف موادها تلقائياً إلى الفاتورة</DialogDescription>
          </DialogHeader>

          <div className="max-h-[46vh] space-y-2 overflow-y-auto">
            {bundlesLoading && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                جارٍ جلب السلال النشطة…
              </div>
            )}
            {bundlesError && !bundlesLoading && (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <AlertTriangle className="h-6 w-6 text-amber-500" />
                <p className="text-sm text-muted-foreground">{bundlesError}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => setBundlesRetry((n) => n + 1)}>
                  إعادة المحاولة
                </Button>
              </div>
            )}
            {!bundlesLoading && !bundlesError && bundles.length === 0 && (
              <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                لا توجد سلال عروض نشطة حالياً — تُنشأ من شاشة سلال العروض
              </p>
            )}
            {!bundlesLoading && !bundlesError &&
              bundles.map((b) => {
                const unavailable = bundleUnavailable(b)
                const alreadyApplied = appliedBundleIds.has(b.id)
                const disabled = unavailable || alreadyApplied
                const checked = selectedBundleIds.includes(b.id) || alreadyApplied
                const buyItems = b.items.filter((bi) => !bi.isGift)
                const giftItems = b.items.filter((bi) => bi.isGift)
                const summary =
                  buyItems.map((bi) => `${bi.item.name} ×${fmtNumber(bi.quantity)}`).join('، ') +
                  (giftItems.length > 0
                    ? ` — الهدية: ${giftItems.map((bi) => `${bi.item.name} ×${fmtNumber(bi.quantity)}`).join('، ')}`
                    : '')
                const estimate = bundleEstimate(b)
                return (
                  <div
                    key={b.id}
                    role="checkbox"
                    aria-checked={checked}
                    aria-disabled={disabled}
                    tabIndex={disabled ? -1 : 0}
                    onClick={() => {
                      if (!disabled) toggleBundleSelection(b.id)
                    }}
                    onKeyDown={(e) => {
                      if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault()
                        toggleBundleSelection(b.id)
                      }
                    }}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors hover:bg-accent/40',
                      checked && !alreadyApplied && 'border-primary/60 bg-primary/5',
                      alreadyApplied && 'border-amber-500/40 bg-amber-500/[0.06]',
                      disabled && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <Checkbox checked={checked} disabled={disabled} className="pointer-events-none mt-0.5" aria-hidden tabIndex={-1} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ShoppingBasket className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        <span className="min-w-0 truncate text-sm font-bold">{b.name}</span>
                        {b.type === 'GIFT' && (
                          <Badge className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">
                            سلة مع هدية
                          </Badge>
                        )}
                        {b.type === 'PERCENT' && (
                          <Badge className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-400">
                            حسم {fmtNumber(b.discountPercent)}%
                          </Badge>
                        )}
                        {b.type === 'PRICE' && (
                          <Badge className="border-rose-500/40 bg-rose-500/10 text-[10px] text-rose-700 dark:text-rose-400">
                            سعر مخفض
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 break-words text-[11px] leading-relaxed text-muted-foreground">{summary}</p>
                      {unavailable && (
                        <p className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">تتضمن مادة غير متاحة</p>
                      )}
                      {alreadyApplied && !unavailable && (
                        <p className="mt-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">بنودها مضافة إلى الفاتورة مسبقاً</p>
                      )}
                      {estimate > 0 && (
                        <p className="num mt-1 text-[11px] text-muted-foreground">حسم تقديري: {fmtMoney(estimate)} ل.س</p>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selectableBundles.length === 0}
                onClick={() => setSelectedBundleIds(selectableBundles.map((b) => b.id))}
              >
                تحديد الكل
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selectedBundleIds.length === 0}
                onClick={() => setSelectedBundleIds([])}
              >
                إلغاء التحديد
              </Button>
            </div>
            <Button type="button" size="sm" disabled={selectedBundleIds.length === 0} onClick={applySelectedBundles}>
              <Plus className="h-4 w-4" />
              إضافة المختار ({selectedBundleIds.length})
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Task 40 — تأكيد إلغاء العملية (Esc): لا إغلاق ولا تطهير بالخطأ — قرار صريح بحماية البيانات */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إلغاء العملية الحالية؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُغلق نموذج {DOC_TITLE[type]} وتُطهَّر جميع الحقول والبنود غير المحفوظة. لا يمكن التراجع عن هذه الخطوة.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>متابعة العمل</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={(e) => {
                e.preventDefault()
                setConfirmCancel(false)
                onOpenChange(false)
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

// ==================== نافذة إضافة مادة جديدة — سريعة ومن النظام ====================

interface QuickAddItemDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  warehouses: LeafWarehouse[]
  defaultWarehouseId: string
  onCreated: (item: InvoiceItem) => void
}

function QuickAddItemDialog({ open, onOpenChange, warehouses, defaultWarehouseId, onCreated }: QuickAddItemDialogProps) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [unitName, setUnitName] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [minStock, setMinStock] = useState('')
  const [maxStock, setMaxStock] = useState('')
  const [salePrice, setSalePrice] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setUnitName('')
      setWarehouseId(defaultWarehouseId || warehouses[0]?.id || '')
      setMinStock('')
      setMaxStock('')
      setSalePrice('')
    }
  }, [open, defaultWarehouseId, warehouses])

  const valid =
    name.trim().length >= 2 &&
    unitName.trim().length >= 1 &&
    warehouseId &&
    Number(minStock) > 0 &&
    Number(maxStock) > 0 &&
    Number(maxStock) >= Number(minStock)

  const save = useCallback(async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          units: [{ name: unitName.trim(), factor: 1 }],
          warehouseId,
          minStock: Number(minStock),
          maxStock: Number(maxStock),
          salePrice: Number(salePrice) || 0,
          images: [],
        }),
      })
      const data = (await res.json().catch(() => null)) as
        | ({
            id: string
            code: string
            name: string
            barcode: string | null
            salePrice: number
            warehouseId: string | null
            units: { name: string; factor: number }[]
          } & { error?: string })
        | null
      if (!res.ok || !data) {
        toast({
          title: 'تعذر إنشاء المادة',
          description: data?.error ?? 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        return
      }
      const wh = warehouses.find((w) => w.id === warehouseId)
      const item: InvoiceItem = {
        id: data.id,
        code: data.code,
        name: data.name,
        barcode: data.barcode,
        purchasePrice: 0,
        salePrice: data.salePrice,
        primaryImageUrl: null,
        warehouseId: data.warehouseId,
        warehouseName: wh?.name ?? null,
        isActive: true,
        units: data.units.map((u) => ({ name: u.name, factor: u.factor })),
        balances: [],
      }
      toast({ title: 'تم إنشاء المادة', description: `${data.code} — ${data.name}` })
      onCreated(item)
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }, [valid, saving, name, unitName, warehouseId, minStock, maxStock, salePrice, warehouses, toast, onCreated])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw_-_var(--sidebar-w)_-_2rem)] sm:max-w-[560px]">
        <DialogHeader className="text-start">
          <DialogTitle>إضافة مادة جديدة</DialogTitle>
          <DialogDescription>
            بطاقة مادة سريعة بالحقول الإلزامية — بعد الحفظ تستقر المادة في بند الفاتورة مباشرة، ويمكن إكمال صورتها وتفاصيلها لاحقاً من شاشة بطاقات المواد
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">
              اسم المادة <span className="text-rose-500">*</span>
            </Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: زيت دوار الشمس 1 لتر" className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              الوحدة <span className="text-rose-500">*</span>
            </Label>
            <Input value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="قطعة / كرتون / كجم…" className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              القسم المخزني <span className="text-rose-500">*</span>
            </Label>
            <Select value={warehouseId || undefined} onValueChange={setWarehouseId}>
              <SelectTrigger className="h-9 w-full" aria-label="القسم المخزني">
                <SelectValue placeholder="اختر القسم…" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    <span className="num text-xs text-muted-foreground">{w.code}</span> — {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              الحد الأدنى <span className="text-rose-500">*</span>
            </Label>
            <NumInput value={minStock} onChange={(e) => setMinStock(e.target.value)} className="h-9 text-start" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              الحد الأعلى <span className="text-rose-500">*</span>
            </Label>
            <NumInput value={maxStock} onChange={(e) => setMaxStock(e.target.value)} className="h-9 text-start" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">سعر البيع (ل.س)</Label>
            <NumInput
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              placeholder="0.00 — يُملأ تلقائياً عند اختيار المادة في الفاتورة"
              className="h-9 text-start"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            تراجع
          </Button>
          <Button disabled={!valid || saving} onClick={() => void save()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            حفظ واستقرارها في البند
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
