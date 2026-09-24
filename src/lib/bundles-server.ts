// منطق سلال العروض الذكية — التحقق، النشاط الزمني، حساب الحسم الخادمي، إحصاءات السلال
// الأنواع الثلاثة:
//   GIFT    — سلة مواد مع صنف هدية: تُحسم قيمة مادة الهدية كاملة عند اكتمال عناصر السلة
//   PERCENT — حسم مئوي على إجمالي قيمة مواد السلة
//   PRICE   — سعر مبيعات مخفض جديد لكل مادة داخل العرض
// الأثر المحاسبي الصارم: حسم السلال يُرحّل آلياً إلى حساب «الحسم الممنوح» (4110)
// عبر حقل discount في الفاتورة — فيبقى القيد المزدوج متوازناً بضمانة postInvoiceJournal
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { InvoiceError } from '@/lib/invoices-server'
import { round2 } from '@/lib/math'

export const BUNDLE_TYPES = ['GIFT', 'PERCENT', 'PRICE'] as const
export type BundleType = (typeof BUNDLE_TYPES)[number]

/** مسميات الأنواع بالعربية — للعرض والتدقيق ورسائل الأخطاء */
export const AR_BUNDLE_TYPE: Record<BundleType, string> = {
  GIFT: 'سلة مع هدية',
  PERCENT: 'حسم نسبة من السلة',
  PRICE: 'سعر مخفض',
}

/** الحد الأقصى لبنود السلة الواحدة */
const MAX_BUNDLE_ITEMS = 30

/** هل السلة نشطة في لحظة معينة (ضمن فترتها الزمنية)؟ */
export function isBundleActive(
  b: { startsAt: Date; endsAt: Date },
  at: Date = new Date(),
): boolean {
  return b.startsAt.getTime() <= at.getTime() && at.getTime() <= b.endsAt.getTime()
}

// ==================== التحقق من جسم طلب إنشاء/تعديل السلة ====================

export interface ParsedBundleItem {
  itemId: string
  quantity: number
  isGift: boolean
  bundlePrice: number
}

export interface ParsedBundle {
  name: string
  type: BundleType
  discountPercent: number
  startsAt: Date
  endsAt: Date
  items: ParsedBundleItem[]
  /** المفتاح اليدوي للتفعيل — null إن لم يصل من الطلب (PUT يحافظ على القائمة عندئذ) */
  enabled: boolean | null
}

const num = (v: unknown, fallback = NaN): number => {
  const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : fallback
}

/**
 * تحقق كامل من جسم طلب السلة — يرمي InvoiceError برسالة عربية أو يعيد البيانات المعيارية.
 * قواعد صارمة: الاسم فريد، النوع من الثلاثة، الفترة منطقية، بنود 1..30 بمواد نشطة،
 * GIFT هدية واحدة حصراً مع بند شراء واحد على الأقل، PERCENT نسبة 0<x≤100،
 * PRICE سعر مخفض إلزامي لكل مادة وأقل من سعر بيعها الحالي.
 */
export async function parseBundleBody(body: unknown): Promise<ParsedBundle> {
  if (!body || typeof body !== 'object') throw new InvoiceError('بيانات السلة غير صالحة')
  const b = body as Record<string, unknown>

  // ===== الاسم =====
  const name = String(b.name ?? '').trim()
  if (!name) throw new InvoiceError('اسم السلة إلزامي')
  if (name.length > 80) throw new InvoiceError('اسم السلة طويل — 80 محرفاً كحد أقصى')

  // ===== النوع =====
  const rawType = String(b.type ?? '')
  if (!(BUNDLE_TYPES as readonly string[]).includes(rawType)) {
    throw new InvoiceError('نوع السلة غير صالح — الأنواع المتاحة: هدية / حسم نسبة / سعر مخفض')
  }
  const type = rawType as BundleType

  // ===== الفترة الزمنية للنشاط =====
  const startsAt = new Date(String(b.startsAt ?? ''))
  const endsAt = new Date(String(b.endsAt ?? ''))
  if (!b.startsAt || Number.isNaN(startsAt.getTime())) throw new InvoiceError('بداية فترة النشاط غير صالحة')
  if (!b.endsAt || Number.isNaN(endsAt.getTime())) throw new InvoiceError('نهاية فترة النشاط غير صالحة')
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new InvoiceError('نهاية فترة النشاط يجب أن تكون بعد بدايتها')
  }

  // ===== نسبة الحسم (للنوع PERCENT) =====
  let discountPercent = 0
  if (type === 'PERCENT') {
    discountPercent = num(b.discountPercent, NaN)
    if (!(discountPercent > 0) || discountPercent > 100) {
      throw new InvoiceError('نسبة الحسم يجب أن تكون رقماً بين 1 و 100')
    }
  }

  // ===== البنود =====
  const rawItems = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]) : []
  if (rawItems.length === 0) throw new InvoiceError('السلة تحتاج مادة واحدة على الأقل')
  if (rawItems.length > MAX_BUNDLE_ITEMS) {
    throw new InvoiceError(`الحد الأقصى ${MAX_BUNDLE_ITEMS} مادة في السلة الواحدة`)
  }

  const itemIds = [...new Set(rawItems.map((i) => String(i?.itemId ?? '')).filter(Boolean))]
  const items = await db.item.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true, isActive: true, salePrice: true },
  })
  const itemById = new Map(items.map((i) => [i.id, i]))

  const parsed: ParsedBundleItem[] = []
  for (let i = 0; i < rawItems.length; i++) {
    const it = rawItems[i]
    const label = `بند السلة ${i + 1}`
    const itemId = String(it?.itemId ?? '')
    const item = itemById.get(itemId)
    if (!item) throw new InvoiceError(`${label}: المادة غير موجودة — أعد اختيارها`)
    if (!item.isActive) throw new InvoiceError(`${label}: المادة «${item.name}» موقوفة — فعّل بطاقتها أولاً`)

    const quantity = num(it?.quantity)
    if (!(quantity > 0)) throw new InvoiceError(`${label}: كمية «${item.name}» يجب أن تكون رقماً أكبر من صفر`)
    if (quantity > 1_000_000_000) throw new InvoiceError(`${label}: كمية «${item.name}» كبيرة جداً`)

    const isGift = it?.isGift === true

    let bundlePrice = 0
    if (type === 'PRICE') {
      bundlePrice = num(it?.bundlePrice, NaN)
      if (!(bundlePrice > 0)) {
        throw new InvoiceError(`${label}: أدخل السعر المخفض الجديد للمادة «${item.name}»`)
      }
      if (!(item.salePrice > 0) || bundlePrice >= item.salePrice) {
        throw new InvoiceError(
          `${label}: السعر المخفض للمادة «${item.name}» يجب أن يكون أقل من سعر بيعها الحالي (${item.salePrice} ل.س)`,
        )
      }
    }

    parsed.push({ itemId, quantity, isGift, bundlePrice })
  }

  // ===== قواعد النوع =====
  const giftCount = parsed.filter((p) => p.isGift).length
  if (type === 'GIFT') {
    if (giftCount !== 1) {
      throw new InvoiceError('سلة الهدية تحتاج مادة هدية واحدة بالضبط — حدد البند المُمنح مجاناً')
    }
    if (parsed.length < 2) {
      throw new InvoiceError('سلة الهدية تحتاج بند شراء واحداً على الأقل غير الهدية')
    }
  } else if (giftCount > 0) {
    throw new InvoiceError('مادة الهدية متاحة في نوع «سلة مع هدية» فقط — أزل تحديد الهدية')
  }

  // ===== المفتاح اليدوي للتفعيل (Task 36) — إيقاف/تشغيل بغض النظر عن تواريخ الفترة =====
  const enabled = typeof b.enabled === 'boolean' ? b.enabled : null

  return { name, type, discountPercent, startsAt, endsAt, items: parsed, enabled }
}

// ==================== حساب حسم السلال لفاتورة مبيعات ====================

export interface BundleLineInput {
  itemId: string
  quantity: number
  unitPrice: number
  bundleId: string | null
  /** عدد السلال الذي يغطيه هذا السطر — من العرض المجمل (Task 36) — يُشتق من التغطية إن غاب */
  bundleQty?: number | null
}

export interface BundleLineResult {
  bundleId: string | null
  bundleName: string | null
  bundleDiscount: number
  /** عدد السلال المعتمد للمجموعة — يُختم على بنودها (Task 36) */
  bundleQty: number
}

export interface BundleInvoiceResult {
  /** البنود مُثراة باسم السلة وحسم كل سطر (معلومي للعرض والتدقيق) */
  lines: BundleLineResult[]
  /** إجمالي حسم السلال — يُضاف إلى حسم الفاتورة اليدوي فيُرحّل معاً إلى 4110 */
  bundleDiscountTotal: number
  /** أسماء السلال المطبقة — لوصف القيد والتدقيق */
  bundleNames: string[]
  /** دلتا الإحصاءات لكل سلة — تُطبق داخل معاملة الفاتورة */
  stats: { bundleId: string; sales: number; discount: number; count: number }[]
}

/**
 * التحقق الخادمي الصارم لبنود السلال في فاتورة مبيعات وحساب حسمها:
 * 1) السلال موجودة ونشطة ضمن فترتها الزمنية بتاريخ الفاتورة
 * 2) كل مادة في السلة موجودة ضمن بنودها بكمية تغطي كمية السلة (اكتمال عناصر السلة)
 * 3) الحسم يُحسب خليمياً من إعدادات السلة لا من العميل:
 *    GIFT — قيمة مادة الهدية (حتى كمية السلة) | PERCENT — النسبة × إجمالي قيمة بنود السلة |
 *    PRICE — فرق سعر كل بند عن سعره المخفض × كميته
 * يرمي InvoiceError برسالة عربية عند أي خرق — فلا تُرحَّل فاتورة سلة غير مكتملة أبداً.
 */
export async function resolveInvoiceBundles(
  type: string,
  invoiceDate: Date,
  lines: BundleLineInput[],
): Promise<BundleInvoiceResult> {
  const neutral: BundleLineResult[] = lines.map(() => ({
    bundleId: null,
    bundleName: null,
    bundleDiscount: 0,
    bundleQty: 1,
  }))

  const bundleIds = [...new Set(lines.map((l) => l.bundleId).filter((x): x is string => !!x))]
  if (bundleIds.length === 0) {
    return { lines: neutral, bundleDiscountTotal: 0, bundleNames: [], stats: [] }
  }
  if (type !== 'SALE') {
    throw new InvoiceError('سلال العروض تُطبق على فواتير المبيعات فقط')
  }

  const bundles = await db.bundle.findMany({
    where: { id: { in: bundleIds } },
    include: { items: { include: { item: { select: { id: true, name: true } } } } },
  })
  const bundleById = new Map(bundles.map((b) => [b.id, b]))

  const results = [...neutral]
  let totalDiscount = 0
  const names: string[] = []
  const stats: BundleInvoiceResult['stats'] = []

  for (const bundleId of bundleIds) {
    const bundle = bundleById.get(bundleId)
    if (!bundle) throw new InvoiceError('إحدى سلال العروض المختارة غير موجودة — أعد فتح قائمة السلال واختر من جديد', 404)
    // الفاتورة مستند بتاريخ يومٍ كامل — تكفي مطابقة اليوم مع فترة النشاط (تقاطع اليوم:
    // سلة بدأت اليوم ساعة 03:00 تقبل فاتورة مؤرخة اليوم، وسلة انتهت أمس ترفض فاتورة اليوم)
    const dayStart = new Date(invoiceDate)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(invoiceDate)
    dayEnd.setHours(23, 59, 59, 999)
    if (bundle.endsAt.getTime() < dayStart.getTime() || bundle.startsAt.getTime() > dayEnd.getTime()) {
      throw new InvoiceError(
        `سلة العرض «${bundle.name}» خارج فترة نشاطها (${bundle.startsAt.toLocaleString('ar')} ← ${bundle.endsAt.toLocaleString('ar')}) — أزل بنودها أو وسّع الفترة`,
      )
    }
    names.push(bundle.name)

    const idxs = lines.map((l, i) => (l.bundleId === bundleId ? i : -1)).filter((i) => i >= 0)
    const configByItem = new Map(bundle.items.map((bi) => [bi.itemId, bi]))

    // عدد السلال للمجموعة (Task 36): الحمل الصريح bundleQty إن وُجد —
    // وإلا يُشتق من نسبة التغطية (بنود فواتير سابقة قبل حقل bundleQty) بسقف لا يقل عن 1
    const coveredOf = (bi: (typeof bundle.items)[number]) =>
      idxs.filter((i) => lines[i].itemId === bi.itemId).reduce((s, i) => s + lines[i].quantity, 0)
    let groupQty = 1
    const explicitQtys = idxs
      .map((i) => lines[i].bundleQty)
      .filter((q): q is number => typeof q === 'number' && Number.isFinite(q) && q >= 1)
    if (explicitQtys.length > 0) {
      groupQty = Math.max(...explicitQtys)
    } else {
      const ratios = bundle.items
        .map((bi) => (bi.quantity > 0 ? coveredOf(bi) / bi.quantity : 1))
        .filter((r) => Number.isFinite(r) && r > 0)
      if (ratios.length > 0) groupQty = Math.max(1, Math.min(...ratios))
    }

    // كل بند بحمولة السلة يجب أن ينتمي فعلاً لإعداداتها
    for (const i of idxs) {
      if (!configByItem.has(lines[i].itemId)) {
        const itemName = bundle.items.find((bi) => bi.itemId === lines[i].itemId)?.item.name
        throw new InvoiceError(`المادة «${itemName ?? lines[i].itemId}» لا تنتمي إلى سلة العرض «${bundle.name}»`)
      }
    }

    // اكتمال عناصر السلة: كل مادة مغطاة بكمية بنودها
    const missing: string[] = []
    for (const bi of bundle.items) {
      const covered = idxs
        .filter((i) => lines[i].itemId === bi.itemId)
        .reduce((s, i) => s + lines[i].quantity, 0)
      if (covered + 1e-9 < bi.quantity) {
        missing.push(`${bi.item.name} (المطلوب ${bi.quantity} — المتوفر ${covered})`)
      }
    }
    if (missing.length > 0) {
      throw new InvoiceError(`سلة العرض «${bundle.name}» غير مكتملة في الفاتورة: ${missing.join('، ')}`)
    }

    // ختم معرف السلة واسمها وعدد سلالها (لقطة دائمة) على كل بنودها — لهوية الحركة المخزنية والعرض
    for (const i of idxs) {
      results[i].bundleId = bundleId
      results[i].bundleName = bundle.name
      results[i].bundleQty = groupQty
    }

    let bundleDiscount = 0
    if (bundle.type === 'GIFT') {
      // قيمة الهدية: تُحسم حتى كمية الهدية المعدّة × عدد السلال — على سطور الهدية بالترتيب
      // (عدد السلال Q يعني Q اكتمالاً للسلة ومنها Q هدية مجانية — Task 36)
      const giftItems = bundle.items.filter((bi) => bi.isGift)
      let remainingQty = round2(giftItems.reduce((s, bi) => s + bi.quantity, 0) * groupQty)
      for (const i of idxs) {
        const cfg = configByItem.get(lines[i].itemId)!
        if (!cfg.isGift) continue
        const d = round2(Math.min(lines[i].quantity, remainingQty) * lines[i].unitPrice)
        results[i].bundleDiscount = d
        bundleDiscount = round2(bundleDiscount + d)
        remainingQty = round2(remainingQty - Math.min(lines[i].quantity, remainingQty))
      }
    } else if (bundle.type === 'PERCENT') {
      // النسبة × إجمالي قيمة بنود السلة — ثم توزيع الحسم على السطور بآخر سطر يمتص التقريب
      const gross = round2(idxs.reduce((s, i) => s + lines[i].quantity * lines[i].unitPrice, 0))
      bundleDiscount = round2((gross * bundle.discountPercent) / 100)
      let distributed = 0
      idxs.forEach((i, k) => {
        const isLast = k === idxs.length - 1
        const d = isLast
          ? round2(bundleDiscount - distributed)
          : round2((lines[i].quantity * lines[i].unitPrice * bundle.discountPercent) / 100)
        results[i].bundleDiscount = d
        distributed = round2(distributed + d)
      })
    } else {
      // PRICE — فرق سعر كل بند عن سعره المخفض × كميته (الفرق لا يكون سالباً)
      for (const i of idxs) {
        const cfg = configByItem.get(lines[i].itemId)!
        const d = round2(Math.max(0, lines[i].unitPrice - cfg.bundlePrice) * lines[i].quantity)
        results[i].bundleDiscount = d
        bundleDiscount = round2(bundleDiscount + d)
      }
    }

    totalDiscount = round2(totalDiscount + bundleDiscount)
    const sales = round2(idxs.reduce((s, i) => s + lines[i].quantity * lines[i].unitPrice, 0))
    stats.push({ bundleId, sales, discount: bundleDiscount, count: 1 })
  }

  return { lines: results, bundleDiscountTotal: totalDiscount, bundleNames: names, stats }
}

// ==================== إحصاءات السلال — داخل معاملة الفاتورة ====================

export type StatsTx = Prisma.TransactionClient

/**
 * تعديل إحصاءات السلال داخل معاملة الفاتورة (إنشاء/تعديل/حذف):
 * totalSales = قيمة بنود السلة بالأسعار الأصلية، totalDiscount = الحسم الممنوح بسببها،
 * saleCount = عدد مرات البيع. دلتا سالبة عند التعديل/الحذف لرجوع الأثر بدقة.
 * السلة المحذوفة قبيل التعديل لا تعيق العملية — يُتخطى تحديثها بصمت (الفواتير تحمل لقطاتها).
 */
export async function adjustBundleStats(
  tx: StatsTx,
  deltas: { bundleId: string; sales: number; discount: number; count: number }[],
): Promise<void> {
  for (const d of deltas) {
    if (d.sales === 0 && d.discount === 0 && d.count === 0) continue
    try {
      await tx.bundle.update({
        where: { id: d.bundleId },
        data: {
          totalSales: { increment: d.sales },
          totalDiscount: { increment: d.discount },
          saleCount: { increment: d.count },
        },
        select: { id: true },
      })
    } catch {
      // P2025 — القالب حُذف: فواتير التاريخ تحمل لقطة الاسم ولا إحصاءات تُحدَّث
    }
  }
}

/** دلتا إحصاءات من بنود فاتورة قديمة (قبل التعديل/الحذف) — كل قيمها سالبة الاتجاه */
export function oldLinesStatsDelta(
  lines: { bundleId: string | null; quantity: number; unitPrice: number; bundleDiscount: number }[],
): { bundleId: string; sales: number; discount: number; count: number }[] {
  const byId = new Map<string, { sales: number; discount: number }>()
  for (const l of lines) {
    if (!l.bundleId) continue
    const cur = byId.get(l.bundleId) ?? { sales: 0, discount: 0 }
    cur.sales = round2(cur.sales + l.quantity * l.unitPrice)
    cur.discount = round2(cur.discount + l.bundleDiscount)
    byId.set(l.bundleId, cur)
  }
  return [...byId.entries()].map(([bundleId, v]) => ({
    bundleId,
    sales: -v.sales,
    discount: -v.discount,
    count: -1,
  }))
}
