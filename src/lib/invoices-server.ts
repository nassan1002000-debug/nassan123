// منطق الخادم المشترك للفواتير — الأنواع، الترقيم، التحقق، أثر المخزون، حالة السداد
// قواعد الأرقام: المبيعات ومردودها تُولَّد تلقائياً (متسلسلة لا تُغيَّر) —
// المشتريات ومردودها يُكتب رقمها يدوياً (رقم فاتورة المورد)
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { PAYMENT_METHODS, nextPaymentNumber } from '@/lib/payments-server'
import { StockError, setBalance } from '@/lib/stock-server'
import { resolveInvoiceBundles } from '@/lib/bundles-server'
import { getCustomerPoints, getLoyaltySettings } from '@/lib/loyalty-server'
import { getSequenceFloor } from '@/lib/period-doc-rotation'
import { round2 } from '@/lib/math'
import { fmtQty } from '@/lib/format'

export const INVOICE_TYPES = ['SALE', 'SALES_RETURN', 'PURCHASE', 'PURCHASE_RETURN'] as const
export type InvoiceType = (typeof INVOICE_TYPES)[number]

/** عميل معاملة يصلح للقراءة داخل المعاملة أو خارجها */
export type DbLike = Prisma.TransactionClient | Pick<typeof db, 'invoice' | 'partner' | 'item' | 'warehouse' | 'setting'>

export class InvoiceError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

/** هل الفاتورة من عائلة المبيعات (طرفها عميل) أم المشتريات (طرفها مورد)؟ */
export function isSalesFamily(type: InvoiceType): boolean {
  return type === 'SALE' || type === 'SALES_RETURN'
}

/** الأنواع التي تخرج من المخزون (بيع ومردود شراء) — تخضع لفحص كفاية الرصيد */
function isOutFamily(type: InvoiceType): boolean {
  return type === 'SALE' || type === 'PURCHASE_RETURN'
}

/** إشارة أثر البند على المخزون: شراء/مردود بيع = إدخال (+) — بيع/مردود شراء = إخراج (−) */
function lineStockSign(type: InvoiceType): 1 | -1 {
  return isOutFamily(type) ? -1 : 1
}

/** البادئة التلقائية للمبيعات ومردودها — المشتريات ومردودها تُكتب يدوياً */
export const AUTO_NUMBER_PREFIX: Partial<Record<InvoiceType, string>> = {
  SALE: 'INV-',
  SALES_RETURN: 'SRN-',
}

/** البادئة المقترحة للأنواع اليدوية (تلميح فقط) */
const MANUAL_NUMBER_HINT: Partial<Record<InvoiceType, string>> = {
  PURCHASE: 'PINV-',
  PURCHASE_RETURN: 'PRN-',
}

/** وصف نوع المستند بالعربية (يُستخدم في سبب الحركة المخزنية) */
export const AR_DOC_LABEL: Record<InvoiceType, string> = {
  SALE: 'فاتورة بيع',
  SALES_RETURN: 'مردود بيع',
  PURCHASE: 'فاتورة مشتريات',
  PURCHASE_RETURN: 'مردود مشتريات',
}

/**
 * الرقم التالي للمتتالية — أعلى رقم موجود عددياً (لا معجمياً) لنفس النوع.
 * للمبيعات ومردودها: رقم نهائي يُولَّد داخل المعاملة ولا يُغيَّر.
 * للمشتريات ومردودها: اقتراح تسلسلي فقط يُملأ في الحقل ويبقى قابلاً للتعديل.
 * الأرقام المحجوزة (فواتير محذوفة بلاحقة xx) تُحتسب في التسلسل — رقم محذوف لا يُعاد أبداً.
 * يُستدعى داخل المعاملة عند الترحيل لتجنب سباقات الترقيم.
 */
export async function nextInvoiceNumber(type: InvoiceType, client?: DbLike): Promise<string> {
  const c = client ?? db
  const prefix = AUTO_NUMBER_PREFIX[type] ?? MANUAL_NUMBER_HINT[type]
  if (!prefix) throw new InvoiceError('نوع فاتورة غير مدعوم للترقيم')
  // أرضية الترقيم — أعلى رقم دُوّر إلى أرشيف الفترة المغلقة عند الإقفال (رقم دُوّر لا يُعاد أبداً)
  let max = await getSequenceFloor(c, prefix)
  // أداء: نقرأ أرقام العائلة نفسها فقط (فهرس رقم الفاتورة — startsWith بمساحة البادئة)
  // بدل مسح جدول الفواتير كاملاً — والمنطق نفسه حرفياً: تعبير نمطي + أعلى رقم عددياً (لا معجمياً)
  const rows = await c.invoice.findMany({
    where: { number: { startsWith: prefix } },
    select: { number: true },
  })
  const re = new RegExp(`^${prefix}(\\d+)(?:xx)?$`) // xx = رقم محجوز لفاتورة محذوفة
  for (const r of rows) {
    const m = re.exec(r.number)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}

// ==================== التحقق من جسم الطلب ====================

export interface ParsedLine {
  itemId: string
  warehouseId: string
  unitName: string | null
  unitFactor: number
  quantity: number
  unitPrice: number
  total: number
  // سلال العروض — bundleId/bundleQty يصلان من الواجهة، والاسم والحسم يُحسبان خليمياً في resolveInvoiceBundles
  bundleId: string | null
  bundleName: string | null
  bundleDiscount: number
  /** عدد السلال الذي يغطيه السطر — لقطة العرض المجمل (Task 36) */
  bundleQty: number
  /** هل كانت المادة هدية السلة لحظة البيع — لقطة للملحق (Task 36) */
  bundleGift: boolean
}

export interface ParsedPayment {
  amount: number
  method: string
  date: Date
  notes: string | null
}

export interface ParsedInvoice {
  type: InvoiceType
  number: string | null // null للمتتالية التلقائية
  date: Date
  partnerId: string
  notes: string | null
  taxRate: number
  discount: number // الحسم الكلي = اليدوي + حسم السلال — يُرحّل معاً إلى 4110
  costCenterId: string | null // مركز التكلفة المختار — يُنسب إليه القيد المحاسبي التلقائي كاملاً
  costCenterName: string | null // اسمه للعرض والتدقيق — null إن لم يُختر مركز
  lines: ParsedLine[]
  payments: ParsedPayment[]
  subtotal: number
  tax: number
  total: number
  paid: number
  status: 'PAID' | 'PARTIAL' | 'UNPAID'
  // سلال العروض — تفاصيل الحسم الخليمي والتوثيق والإحصاءات
  bundleDiscountTotal: number
  bundleNames: string[]
  bundleStats: { bundleId: string; sales: number; discount: number; count: number }[]
  // نقاط الولاء — الاسترداد داخل الفاتورة (لنوع SALE حصراً) وقيمته المالية ضمن الحسم الكلي
  redeemPoints: number
  loyaltyRedeemValue: number
}

const num = (v: unknown, fallback = NaN): number => {
  const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : fallback
}

/**
 * تحقق كامل من جسم الطلب — يرمي InvoiceError برسالة عربية واضحة أو يعيد البيانات المحسوبة.
 * يفحص: النوع، الطرف وتوافقه، الرقم اليدوي، البنود (مادة/قسم نهائي/كمية/سعر)، الضريبة، الحسم، الدفعات.
 */
export async function validateInvoiceBody(
  body: unknown,
  opts: { currentId?: string; currentType?: InvoiceType } = {},
): Promise<ParsedInvoice> {
  if (!body || typeof body !== 'object') throw new InvoiceError('بيانات غير صالحة')
  const b = body as Record<string, unknown>

  // ===== النوع =====
  const rawType = String(b.type ?? '')
  if (!(INVOICE_TYPES as readonly string[]).includes(rawType)) {
    throw new InvoiceError('نوع الفاتورة غير صالح')
  }
  const type = rawType as InvoiceType
  if (opts.currentType && type !== opts.currentType) {
    throw new InvoiceError('لا يمكن تغيير نوع الفاتورة بعد إنشائها')
  }
  const salesFamily = isSalesFamily(type)

  // ===== التاريخ =====
  const dateStr = String(b.date ?? '')
  const date = new Date(dateStr)
  if (!dateStr || Number.isNaN(date.getTime())) throw new InvoiceError('تاريخ الفاتورة غير صالح')

  // ===== الطرف وتوافقه مع نوع الفاتورة =====
  const partnerId = String(b.partnerId ?? '').trim()
  if (!partnerId) {
    throw new InvoiceError(salesFamily ? 'يجب اختيار العميل' : 'يجب اختيار المورد')
  }
  const partner = await db.partner.findUnique({
    where: { id: partnerId },
    select: { id: true, name: true, type: true, isActive: true },
  })
  if (!partner) throw new InvoiceError('الطرف المختار غير موجود')
  if (salesFamily && partner.type !== 'CUSTOMER') {
    throw new InvoiceError(`«${partner.name}» مورد — فاتورة المبيعات تُسجَّل على عميل من ملفات العملاء`)
  }
  if (!salesFamily && partner.type !== 'SUPPLIER') {
    throw new InvoiceError(`«${partner.name}» عميل — فاتورة المشتريات تُسجَّل على مورد من ملفات الموردين`)
  }
  if (!partner.isActive) {
    throw new InvoiceError(`ملف الطرف «${partner.name}» موقوف — فعّله أولاً أو اختر طرفاً نشطاً`)
  }

  // ===== الرقم: تلقائي للمبيعات — يدوي إلزامي للمشتريات =====
  let number: string | null = null
  if (AUTO_NUMBER_PREFIX[type]) {
    // المتتالية التلقائية لا تقبل تغييراً — يُتجاهل ما يصل من الواجهة
    number = null
  } else {
    const raw = String(b.number ?? '').trim()
    if (!raw) throw new InvoiceError('رقم الفاتورة إلزامي — اكتب رقم فاتورة المورد كما هو في المستند الورقي')
    if (raw.length > 40) throw new InvoiceError('رقم الفاتورة طويل جداً — 40 خانة كحد أقصى')
    number = raw
  }

  // ===== الأقسام النهائية النشطة (فحص دفعة واحدة) =====
  const allWarehouses = await db.warehouse.findMany({
    select: { id: true, name: true, isActive: true, _count: { select: { children: true } } },
  })
  const leafById = new Map(
    allWarehouses.filter((w) => w._count.children === 0 && w.isActive).map((w) => [w.id, w]),
  )

  // ===== البنود =====
  const rawLines = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]) : []
  if (rawLines.length === 0) throw new InvoiceError('الفاتورة تحتاج بنداً واحداً على الأقل')
  if (rawLines.length > 60) throw new InvoiceError('الحد الأقصى 60 بنداً في الفاتورة')

  const itemIds = [...new Set(rawLines.map((l) => String(l?.itemId ?? '')).filter(Boolean))]
  const items = await db.item.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true, isActive: true },
  })
  const itemById = new Map(items.map((i) => [i.id, i]))

  const lines: ParsedLine[] = []
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i]
    const label = `البند ${i + 1}`

    const itemId = String(l?.itemId ?? '')
    const item = itemById.get(itemId)
    if (!item) throw new InvoiceError(`${label}: المادة غير موجودة — أعد اختيارها`)
    if (!item.isActive) throw new InvoiceError(`${label}: المادة «${item.name}» موقوفة — فعّل بطاقتها أولاً`)

    const warehouseId = String(l?.warehouseId ?? '')
    const wh = leafById.get(warehouseId)
    if (!wh) {
      throw new InvoiceError(`${label}: اختر قسماً نهائياً نشطاً (آخر مستوى في شجرة المستودعات) للمادة «${item.name}»`)
    }

    const quantity = num(l?.quantity)
    if (!(quantity > 0)) throw new InvoiceError(`${label}: العدد يجب أن يكون رقماً أكبر من صفر`)
    if (quantity > 1_000_000_000) throw new InvoiceError(`${label}: العدد كبير جداً — تحقق من الرقم`)

    const unitPrice = num(l?.unitPrice, 0)
    if (!(unitPrice > 0)) throw new InvoiceError(`${label}: سعر الوحدة يجب أن يكون رقماً أكبر من صفر`)
    if (unitPrice > 1_000_000_000) throw new InvoiceError(`${label}: سعر الوحدة كبير جداً — تحقق من الرقم`)

    const unitName = typeof l?.unitName === 'string' && l.unitName.trim() ? l.unitName.trim().slice(0, 40) : null
    const unitFactorRaw = num(l?.unitFactor, 1)
    const unitFactor = unitFactorRaw > 0 ? unitFactorRaw : 1

    const bundleId =
      typeof l?.bundleId === 'string' && l.bundleId.trim() ? l.bundleId.trim() : null
    // عدد السلال من العرض المجمل — يُقبل ≥ 1 ويُقيد عند 1 للمحاولات الشاذة (الفحص الصارم خادمي بالتغطية)
    const bundleQtyRaw = num(l?.bundleQty, 1)
    const bundleQty = Number.isFinite(bundleQtyRaw) && bundleQtyRaw >= 1 ? Math.min(bundleQtyRaw, 1_000_000_000) : 1

    lines.push({
      itemId,
      warehouseId,
      unitName,
      unitFactor,
      quantity,
      unitPrice,
      total: round2(quantity * unitPrice),
      bundleId,
      bundleName: null,
      bundleDiscount: 0,
      bundleQty,
      bundleGift: false,
    })
  }

  // ===== سلال العروض — تحقق صارم وحسم خليمي (فواتير المبيعات فقط) =====
  const bundleResult = await resolveInvoiceBundles(type, date, lines)
  lines.forEach((l, i) => {
    l.bundleName = bundleResult.lines[i].bundleName
    l.bundleDiscount = bundleResult.lines[i].bundleDiscount
    l.bundleQty = bundleResult.lines[i].bundleQty
  })

  // ختم لقطة الهدية (Task 36): مادة السلة المطابقة للهدية في القالب تحمل العلامة للأبد —
  // كي يعرف الملحق المطبوع ونوافذ العرض المجانية حتى بعد حذف القالب
  const bundleIdsSet = new Set(lines.map((l) => l.bundleId).filter((x): x is string => !!x))
  if (bundleIdsSet.size > 0) {
    const giftTemplates = await db.bundle.findMany({
      where: { id: { in: [...bundleIdsSet] } },
      select: { id: true, items: { select: { itemId: true, isGift: true } } },
    })
    const giftItemIds = new Map(
      giftTemplates.map((b) => [
        b.id,
        new Set(b.items.filter((bi) => bi.isGift).map((bi) => bi.itemId)),
      ]),
    )
    for (const l of lines) {
      if (!l.bundleId) continue
      const gifts = giftItemIds.get(l.bundleId)
      if (gifts?.has(l.itemId)) l.bundleGift = true
    }
  }

  // ===== المجاميع =====
  const subtotal = round2(lines.reduce((s, l) => s + l.total, 0))
  const taxRate = Math.min(Math.max(num(b.taxRate, 0), 0), 100)
  const tax = round2((subtotal * taxRate) / 100)

  // ===== نقاط الولاء — استرداد نقاط العميل كحسم داخل الفاتورة (SALE حصراً) =====
  const rawRedeemPoints = num(b.redeemPoints, 0)
  const redeemPoints = Number.isFinite(rawRedeemPoints) ? Math.floor(Math.max(rawRedeemPoints, 0)) : 0
  if (redeemPoints > 1_000_000) throw new InvoiceError('عدد نقاط الاسترداد كبير جداً — الحد الأقصى مليون نقطة')
  if (redeemPoints > 0 && type !== 'SALE') {
    throw new InvoiceError('استرداد نقاط الولاء متاح داخل فواتير المبيعات حصراً')
  }
  let loyaltyRedeemValue = 0
  if (redeemPoints > 0) {
    const settings = await getLoyaltySettings()
    if (!settings.isEnabled) {
      throw new InvoiceError('نظام نقاط الولاء غير منشط — أزل نقاط الاسترداد أو فعّل النظام من شاشة نقاط الولاء')
    }
    // عند تعديل فاتورة استردت نقاطاً سابقاً: نقاطها القديمة ستُرجع للعميل داخل المعاملة
    // قبل الخصم الجديد — فيُحتسب الرصيد الفعّال بزيادة ما سترجعه هذه الفاتورة تحديداً
    let effectiveAvailable = 0
    if (opts.currentId) {
      const [summary, existing] = await Promise.all([
        getCustomerPoints(db, partnerId),
        db.invoice.findUnique({
          where: { id: opts.currentId },
          select: { partnerId: true, loyaltyPointsRedeemed: true },
        }),
      ])
      effectiveAvailable = summary.available
      if (existing && existing.partnerId === partnerId && existing.loyaltyPointsRedeemed > 0) {
        effectiveAvailable += existing.loyaltyPointsRedeemed
      }
    } else {
      effectiveAvailable = (await getCustomerPoints(db, partnerId)).available
    }
    if (redeemPoints > effectiveAvailable) {
      throw new InvoiceError(
        `رصيد نقاط العميل لا يكفي — المتاح ${effectiveAvailable} نقطة والمطلوب استرداده ${redeemPoints} نقطة`,
      )
    }
    loyaltyRedeemValue = round2(redeemPoints * settings.pointPrice)
  }

  // الحسم الكلي = اليدوي + حسم السلال المحسوب خليمياً + حسم نقاط الولاء — يُرحّل معاً إلى حساب الحسم الممنوح 4110
  const manualDiscount = Math.max(num(b.discount, 0), 0)
  const discount = round2(manualDiscount + bundleResult.bundleDiscountTotal + loyaltyRedeemValue)
  // الإجمالي = المجموع + الضريبة − الحسم (يُرفض حسم أكبر من القيمة قبل الضريبة)
  const total = round2(subtotal + tax)
  if (discount > total + 0.005) {
    throw new InvoiceError('قيمة الحسم أكبر من إجمالي الفاتورة — راجع الرقم')
  }
  const netTotal = round2(total - discount)

  // ===== مركز التكلفة (اختياري) — يُنسب إليه القيد المحاسبي التلقائي كاملاً =====
  // نفس نمط صرف الرواتب/السلف: اختياري، ويُتحقق من وجوده وفعاليته عند اختياره
  const rawCostCenter = String(b.costCenterId ?? '').trim()
  let costCenterId: string | null = null
  let costCenterName: string | null = null
  if (rawCostCenter) {
    const cc = await db.costCenter.findUnique({
      where: { id: rawCostCenter },
      select: { id: true, name: true, isActive: true },
    })
    if (!cc) throw new InvoiceError('مركز التكلفة المختار غير موجود')
    if (!cc.isActive) {
      throw new InvoiceError(`مركز التكلفة «${cc.name}» موقوف — اختر مركزاً نشطاً أو أزل الاختيار`)
    }
    costCenterId = cc.id
    costCenterName = cc.name
  }

  // ===== الدفعات =====
  const rawPayments = Array.isArray(b.payments) ? (b.payments as Record<string, unknown>[]) : []
  const payments: ParsedPayment[] = []
  let paid = 0
  for (let i = 0; i < rawPayments.length; i++) {
    const p = rawPayments[i]
    const amount = num(p?.amount)
    if (!(amount > 0)) throw new InvoiceError(`الدفعة ${i + 1}: المبلغ يجب أن يكون رقماً أكبر من صفر`)
    const method = String(p?.method ?? 'CASH')
    if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
      throw new InvoiceError(`الدفعة ${i + 1}: طريقة الدفع غير صالحة`)
    }
    const pDateStr = String(p?.date ?? '')
    let pDate = pDateStr ? new Date(pDateStr) : new Date('x')
    if (Number.isNaN(pDate.getTime())) pDate = date // بدون تاريخ → تاريخ الفاتورة
    const notes = typeof p?.notes === 'string' && p.notes.trim() ? p.notes.trim().slice(0, 200) : null
    paid = round2(paid + amount)
    payments.push({ amount, method, date: pDate, notes })
  }
  if (paid > netTotal + 0.01) {
    throw new InvoiceError('مجموع الدفعات يتجاوز إجمالي الفاتورة — راجع المبالغ')
  }

  const status: ParsedInvoice['status'] = paid >= netTotal - 0.005 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID'
  const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 500) : null

  return {
    type,
    number,
    date,
    partnerId,
    notes,
    taxRate,
    discount,
    costCenterId,
    costCenterName,
    lines,
    payments,
    subtotal,
    tax,
    total: netTotal,
    paid,
    status,
    bundleDiscountTotal: bundleResult.bundleDiscountTotal,
    bundleNames: bundleResult.bundleNames,
    bundleStats: bundleResult.stats,
    redeemPoints,
    loyaltyRedeemValue,
  }
}

// ==================== أثر الفاتورة على المخزون ====================

export interface StockLine {
  itemId: string
  warehouseId: string
  quantity: number
}

/** تأثيرات بنود فاتورة على (مادة، قسم) — تُدمج البنود المكررة */
function effectsOf(type: InvoiceType, lines: StockLine[]): Map<string, number> {
  const sign = lineStockSign(type)
  const map = new Map<string, number>()
  for (const l of lines) {
    const key = `${l.itemId}::${l.warehouseId}`
    map.set(key, (map.get(key) ?? 0) + sign * l.quantity)
  }
  return map
}

/**
 * مزامنة مخزون فاتورة داخل معاملة (إنشاء/تعديل/حذف):
 * 1) يحسب الرصيد النهائي لكل (مادة، قسم) = الحالي − أثر القديم + أثر الجديد
 * 2) يرفض إن صار الرصيد النهائياً سالباً (رسالة عربية بالمتوفر)
 * 3) يعيّن الأرصدة، ويحذف الحركات القديمة المرتبطة بالفاتورة وينشئ الحركات الجديدة
 * بنود سلال العروض تُسجل حركتها بمسمى صريح: «مبيعات ضمن سلة: [اسم السلة]»
 */
export async function syncInvoiceStock(
  tx: Prisma.TransactionClient,
  opts: {
    invoiceId: string
    type: InvoiceType
    date: Date
    number: string
    partnerName: string
    oldLines: StockLine[]
    newLines: (StockLine & { unitPrice: number; bundleName?: string | null })[]
  },
): Promise<void> {
  const oldEff = effectsOf(opts.type, opts.oldLines)
  const newEff = effectsOf(opts.type, opts.newLines)
  const keys = new Set([...oldEff.keys(), ...newEff.keys()])

  const itemIds = [...keys].map((k) => k.split('::')[0]).filter(Boolean)
  const items = itemIds.length
    ? await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } })
    : []
  const nameOf = new Map(items.map((i) => [i.id, i.name]))

  for (const key of keys) {
    const [itemId, warehouseId] = key.split('::')
    const balance = await tx.itemBalance.findUnique({
      where: { itemId_warehouseId: { itemId, warehouseId } },
    })
    const current = balance?.quantity ?? 0
    const final = current - (oldEff.get(key) ?? 0) + (newEff.get(key) ?? 0)
    if (final < -0.0000001) {
      throw new StockError(
        `لا يمكن تنفيذ العملية — رصيد المادة «${nameOf.get(itemId) ?? itemId}» سيصبح سالباً في هذا القسم (المتوفر حالياً: ${fmtQty(current)})`,
      )
    }
    await setBalance(tx, itemId, warehouseId, final)
  }

  // الحركات المخزنية المرتبطة بالفاتورة: حذف القديم ثم إنشاء الجديد
  await tx.stockMovement.deleteMany({ where: { refType: 'INVOICE', refId: opts.invoiceId } })
  const sign = lineStockSign(opts.type)
  if (opts.newLines.length > 0) {
    await tx.stockMovement.createMany({
      data: opts.newLines.map((l) => ({
        date: opts.date,
        type: sign === 1 ? 'IN' : 'OUT',
        itemId: l.itemId,
        warehouseId: l.warehouseId,
        quantity: l.quantity,
        unitCost: l.unitPrice,
        // بند سلة عرض يُوثق بمسمى صريح دائم — والبقية بمسمى المستند الاعتيادي
        reason:
          l.bundleName
            ? `مبيعات ضمن سلة: ${l.bundleName}`
            : `${AR_DOC_LABEL[opts.type]} ${opts.number} — ${opts.partnerName}`,
        refType: 'INVOICE',
        refId: opts.invoiceId,
      })),
    })
  }
}

/** إنشاء سند قبض/دفع لدفعة فاتورة داخل المعاملة — يرجع رقم السند VCH */
export async function createInvoicePaymentVoucher(
  tx: Prisma.TransactionClient,
  opts: {
    invoiceId: string
    partnerId: string
    salesFamily: boolean
    payment: ParsedPayment
  },
): Promise<string> {
  // رقم السند VCH التالي — نفس منطق nextPaymentNumber لكن داخل معاملة الفاتورة
  const number = await nextPaymentNumber(tx)
  await tx.payment.create({
    data: {
      number,
      type: opts.salesFamily ? 'RECEIPT' : 'PAYMENT',
      date: opts.payment.date,
      amount: opts.payment.amount,
      method: opts.payment.method,
      partnerId: opts.partnerId,
      invoiceId: opts.invoiceId,
      notes: opts.payment.notes,
    },
  })
  return number
}
