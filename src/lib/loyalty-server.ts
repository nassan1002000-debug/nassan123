// منطق الخادم لنقاط الولاء — كل عمليات الاحتساب والتعديل والاسترداد والصرف
// تُنفَّذ حصراً داخل معاملات ذرية محكمة $transaction مع حارس رصيد صارم
// لا حركة تُكتب خارج معاملة، ولا رصيد يهبط تحت الصفر تحت أي ظرف.
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  calculateAwardPoints,
  LOYALTY_DEFAULTS,
  LOYALTY_TX_TYPES,
  type LoyaltySettingsData,
  type LoyaltyTxType,
} from '@/lib/loyalty'
import { round2 } from '@/lib/math'
import { ensureInvoiceAccounts, INVOICE_ACCOUNTS } from '@/lib/invoice-journal'
import { nextEntryNumber } from '@/lib/journal-server'
import { nextPaymentNumber } from '@/lib/payments-server'
import { assertPeriodOpen } from '@/lib/period-server'

/** خطأ نقاط الولاء — رسالة عربية واضحة وحالة HTTP مناسبة */
export class LoyaltyError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

type Tx = Prisma.TransactionClient

/** عميل معاملة يصلح للقراءة — نفس نمط invoices-server */
export type LoyaltyDb = Tx | Pick<typeof db, 'loyaltySettings' | 'loyaltyTransaction'>

// ==================== الإعدادات ====================

/**
 * قراءة إعدادات المنظومة — ينشئ الصف الافتراضي تلقائياً عند أول استدعاء.
 * آمنة للاستدعاء داخل المعاملة أو خارجها.
 */
export async function getLoyaltySettings(client?: LoyaltyDb): Promise<LoyaltySettingsData> {
  const c = client ?? db
  let row = await c.loyaltySettings.findUnique({ where: { id: 1 } })
  if (!row) {
    // upsert يقاوم سباق التهيئة الأول بين طلبين متوازيين
    row = await c.loyaltySettings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, ...LOYALTY_DEFAULTS },
    })
  }
  return {
    isEnabled: row.isEnabled,
    minInvoiceValue: row.minInvoiceValue,
    cycleDays: row.cycleDays,
    basePoints: row.basePoints,
    pointPrice: row.pointPrice,
    multiplicationFactor: row.multiplicationFactor,
  }
}

/** تحقق قيم الإعدادات الواردة من لوحة الإدارة — يرمي LoyaltyError برسالة عربية */
export function validateLoyaltySettingsBody(body: unknown): Partial<LoyaltySettingsData> & {
  isEnabled?: boolean
} {
  if (!body || typeof body !== 'object') throw new LoyaltyError('بيانات غير صالحة')
  const b = body as Record<string, unknown>
  const out: Partial<LoyaltySettingsData> & { isEnabled?: boolean } = {}

  if (typeof b.isEnabled === 'boolean') out.isEnabled = b.isEnabled

  if (b.minInvoiceValue !== undefined) {
    const v = Number(b.minInvoiceValue)
    if (!Number.isFinite(v) || v < 0 || v > 1_000_000_000) {
      throw new LoyaltyError('الحد الأدنى لقيمة الفاتورة يجب أن يكون رقماً بين 0 ومليار ل.س')
    }
    out.minInvoiceValue = v
  }

  if (b.cycleDays !== undefined) {
    const v = Number(b.cycleDays)
    if (!Number.isInteger(v) || v < 1 || v > 365) {
      throw new LoyaltyError('عدد أيام الدورة الأسبوعية يجب أن يكون عدداً صحيحاً بين 1 و365')
    }
    out.cycleDays = v
  }

  if (b.basePoints !== undefined) {
    const v = Number(b.basePoints)
    if (!Number.isInteger(v) || v < 1 || v > 1_000_000) {
      throw new LoyaltyError('عدد النقاط الأساسية يجب أن يكون عدداً صحيحاً بين 1 ومليون')
    }
    out.basePoints = v
  }

  if (b.pointPrice !== undefined) {
    const v = Number(b.pointPrice)
    if (!Number.isFinite(v) || v <= 0 || v > 1_000_000_000) {
      throw new LoyaltyError('سعر النقطة الواحدة يجب أن يكون رقماً موجباً لا يتجاوز مليار ل.س')
    }
    out.pointPrice = v
  }

  if (b.multiplicationFactor !== undefined) {
    const v = Number(b.multiplicationFactor)
    if (!Number.isFinite(v) || v <= 0 || v > 100) {
      throw new LoyaltyError('نسبة مضاعفة النقاط الأسبوعية يجب أن تكون رقماً موجباً بين 0 و100 (مثل 1.5 أو 2.0)')
    }
    out.multiplicationFactor = v
  }

  return out
}

// ==================== الرصيد والحركات الذرية ====================

/**
 * رصيد عميل لحظياً — مجموع النقاط الموقعة (المتاح) + إجمالي ما استُرد سابقاً
 * (REDEEM + CASHOUT بقيمها المطلقة). تُستدعى داخل المعاملة للكتابة وخارجها للعرض.
 */
export async function getCustomerPoints(
  client: LoyaltyDb,
  customerId: string,
): Promise<{ available: number; redeemed: number; earned: number }> {
  const [sum, redeemedSum, earnedSum] = await Promise.all([
    client.loyaltyTransaction.aggregate({ where: { customerId }, _sum: { points: true } }),
    client.loyaltyTransaction.aggregate({
      where: { customerId, type: { in: ['REDEEM', 'CASHOUT'] }, points: { lt: 0 } },
      _sum: { points: true },
    }),
    client.loyaltyTransaction.aggregate({
      where: { customerId, type: 'EARN', points: { gt: 0 } },
      _sum: { points: true },
    }),
  ])
  return {
    available: sum._sum.points ?? 0,
    redeemed: Math.abs(redeemedSum._sum.points ?? 0),
    earned: earnedSum._sum.points ?? 0,
  }
}

export interface LoyaltyMovementInput {
  customerId: string
  /** النقاط الموقعة: موجبة للإضافة، سالبة للخصم — صفر يُرفض */
  points: number
  type: LoyaltyTxType
  reason: string
  refType?: string | null
  refId?: string | null
  refNumber?: string | null
  /** توقيت الحركة — يُفاضل بالميلي ثانية عند تعدد الحركات في معاملة واحدة لترتيب كشف ثابت */
  at?: Date
}

/**
 * تسجيل حركة نقاط داخل معاملة ذرية — القلب المحكم للمنظومة:
 * 1) يجمع الرصيد الحالي للعميل داخل المعاملة نفسها
 * 2) يرفض الخصم الذي يهبط بالرصيد تحت الصفر برسالة عربية بالمتاح
 * 3) يكتب الحركة مع لقطة الرصيد بعد الحركة (balanceAfter) لبناء الكشف بلا إعادة حساب
 */
export async function applyLoyaltyMovement(tx: Tx, input: LoyaltyMovementInput): Promise<number> {
  if (!Number.isInteger(input.points) || input.points === 0) {
    throw new LoyaltyError('عدد النقاط يجب أن يكون صحيحاً غير صفري')
  }
  if (!(LOYALTY_TX_TYPES as readonly string[]).includes(input.type)) {
    throw new LoyaltyError('نوع حركة النقاط غير صالح')
  }
  const reason = input.reason?.trim()
  if (!reason) throw new LoyaltyError('بيان وسبب الحركة إلزامي')
  if (reason.length > 400) throw new LoyaltyError('السبب طويل جداً — 400 خانة كحد أقصى')

  const customer = await tx.partner.findUnique({
    where: { id: input.customerId },
    select: { id: true, type: true, isActive: true, name: true },
  })
  if (!customer) throw new LoyaltyError('العميل غير موجود', 404)
  if (customer.type !== 'CUSTOMER') {
    throw new LoyaltyError(`«${customer.name}» مورد — حركات نقاط الولاء للعملاء حصراً`)
  }

  const agg = await tx.loyaltyTransaction.aggregate({
    where: { customerId: input.customerId },
    _sum: { points: true },
  })
  const current = agg._sum.points ?? 0
  const after = current + input.points
  if (after < 0) {
    throw new LoyaltyError(
      `لا يمكن تنفيذ العملية — رصيد نقاط «${customer.name}» الحالي (${current} نقطة) لا يكفي لخصم ${Math.abs(input.points)} نقطة`,
    )
  }

  await tx.loyaltyTransaction.create({
    data: {
      customerId: input.customerId,
      type: input.type,
      points: input.points,
      balanceAfter: after,
      reason,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      refNumber: input.refNumber ?? null,
      ...(input.at ? { createdAt: input.at } : {}),
    },
  })
  return after
}

// ==================== أثر فاتورة البيع على النقاط (داخل معاملة الفاتورة) ====================

export interface InvoiceLoyaltyAward {
  points: number
  invoiceValue: number
}

/**
 * منح نقاط فاتورة بيع — يُستدعى داخل معاملة إنشاء/تعديل الفاتورة حصراً.
 * يعيد عدد النقاط الممنوحة (0 إن لم تستوفِ الفاتورة الشروط أو النظام غير منشط).
 */
export async function awardInvoicePoints(
  tx: Tx,
  opts: {
    invoiceId: string
    invoiceNumber: string
    date: Date
    customerId: string
    invoiceValue: number
    /** توقيت مُفاضل للترتيب داخل الكشف عند تعدد الحركات بمعاملة واحدة */
    at?: Date
  },
): Promise<number> {
  const settings = await getLoyaltySettings(tx)
  if (!settings.isEnabled) return 0
  const points = calculateAwardPoints(opts.invoiceValue, settings)
  if (points <= 0) return 0
  await applyLoyaltyMovement(tx, {
    customerId: opts.customerId,
    points,
    type: 'EARN',
    reason: `استحقاق نقاط ولاء — فاتورة مبيعات ${opts.invoiceNumber} بقيمة ${opts.invoiceValue.toLocaleString('en-US')} ل.س`,
    refType: 'INVOICE',
    refId: opts.invoiceId,
    refNumber: opts.invoiceNumber,
    at: opts.at,
  })
  return points
}

/**
 * عكس نقاط فاتورة (تعديل أو حذف) — يخصم ما مُنح سابقاً داخل المعاملة نفسها.
 * تُهمل بصمت إن لم تمنح الفاتورة نقاطاً (points = 0).
 */
export async function revokeInvoicePoints(
  tx: Tx,
  opts: {
    invoiceId: string
    invoiceNumber: string
    customerId: string
    earnedPoints: number
    cause: 'تعديل الفاتورة' | 'حذف الفاتورة'
    at?: Date
  },
): Promise<void> {
  if (opts.earnedPoints <= 0) return
  await applyLoyaltyMovement(tx, {
    customerId: opts.customerId,
    points: -opts.earnedPoints,
    type: 'REVOKE',
    reason: `إلغاء استحقاق ${opts.earnedPoints} نقطة — فاتورة مبيعات ${opts.invoiceNumber} بسبب ${opts.cause}`,
    refType: 'INVOICE',
    refId: opts.invoiceId,
    refNumber: opts.invoiceNumber,
    at: opts.at,
  })
}

export interface InvoiceRedemption {
  /** القيمة المالية للنقاط المستردة (النقاط × سعر النقطة) — تُرحَّل ضمن الحسم الكلي */
  value: number
  /**
   * نص جاهز للإلحاق بملاحظات الفاتورة (طلب صريح): يذكر صراحة عدد النقطة المستردة،
   * الرصيد السابق قبل هذه الفاتورة، والرصيد المتبقي الحالي بعدها — كي تقرأ ملاحظات
   * الفاتورة نفسها دون الرجوع لكشف نقاط الولاء لمعرفة أثر الاسترداد على رصيد العميل
   */
  note: string
}

/**
 * استرداد نقاط كحسم داخل فاتورة مبيعات — يُستدعى داخل معاملة الفاتورة حصراً.
 * يفحص التنشيط والرصيد ويخصم النقاط ويعيد قيمتها المالية (النقاط × سعر النقطة)
 * كي تُرحَّل ضمن الحسم الكلي إلى حساب الحسم الممنوح (4110)، ونص جاهز لملاحظات الفاتورة.
 */
export async function redeemInvoicePoints(
  tx: Tx,
  opts: {
    invoiceId: string
    invoiceNumber: string
    date: Date
    customerId: string
    points: number
    at?: Date
  },
): Promise<InvoiceRedemption | null> {
  const pts = Math.floor(opts.points)
  if (!(pts > 0)) return null
  const settings = await getLoyaltySettings(tx)
  if (!settings.isEnabled) {
    throw new LoyaltyError('نظام نقاط الولاء غير منشط — لا يمكن الاسترداد داخل الفاتورة')
  }
  const { available } = await getCustomerPoints(tx, opts.customerId)
  if (pts > available) {
    throw new LoyaltyError(
      `رصيد نقاط العميل لا يكفي — المتاح ${available} نقطة والمطلوب استرداده ${pts} نقطة`,
    )
  }
  const value = round2(pts * settings.pointPrice)
  const remainingBalance = await applyLoyaltyMovement(tx, {
    customerId: opts.customerId,
    points: -pts,
    type: 'REDEEM',
    reason: `حسم نقاط ولاء داخل فاتورة المبيعات ${opts.invoiceNumber} — ${pts} نقطة × ${settings.pointPrice.toLocaleString('en-US')} ل.س = ${value.toLocaleString('en-US')} ل.س`,
    refType: 'INVOICE',
    refId: opts.invoiceId,
    refNumber: opts.invoiceNumber,
    at: opts.at,
  })
  return {
    value,
    note: `تسوية نقاط الولاء — استرداد ${pts} نقطة من الرصيد السابق ${available} نقطة | الرصيد المتبقي الحالي للعميل: ${remainingBalance} نقطة`,
  }
}

/**
 * إرجاع نقاط كانت مستردة في فاتورة عُدلت أو حُذفت — داخل المعاملة نفسها.
 * تُهمل بصمت إن لم تكن هناك نقاط مستردة.
 */
export async function restoreInvoiceRedemption(
  tx: Tx,
  opts: {
    invoiceId: string
    invoiceNumber: string
    customerId: string
    redeemedPoints: number
    cause: 'تعديل الفاتورة' | 'حذف الفاتورة'
    at?: Date
  },
): Promise<void> {
  if (opts.redeemedPoints <= 0) return
  await applyLoyaltyMovement(tx, {
    customerId: opts.customerId,
    points: opts.redeemedPoints,
    type: 'REVOKE',
    reason: `إرجاع ${opts.redeemedPoints} نقطة كانت محسومة داخل فاتورة المبيعات ${opts.invoiceNumber} بسبب ${opts.cause}`,
    refType: 'INVOICE',
    refId: opts.invoiceId,
    refNumber: opts.invoiceNumber,
    at: opts.at,
  })
}

// ==================== صرف الكاش المباشر — سند دفع من الصندوق (1110) ====================

/**
 * صرف القيمة المالية لنقاط العميل نقداً — يُستدعى داخل معاملة ذرية واحدة تشمل:
 * 1) خصم النقاط من كشف حساب العميل (تُصفر المستبدلة فوراً)
 * 2) إنشاء سند دفع VCH يخرج من الصندوق (1110)
 * 3) ترحيل قيد مزدوج: مدين الحسم الممنوح (4110) — دائن الصندوق (1110)
 *    بحارة التوازن الصارم نفسه المعمول به في قيود الفواتير والسندات
 */
export async function cashOutLoyaltyPoints(
  tx: Tx,
  opts: { customerId: string; customerName: string; points: number },
): Promise<{ voucherNumber: string; amount: number; points: number; entryNumber: string }> {
  const settings = await getLoyaltySettings(tx)
  if (!settings.isEnabled) {
    throw new LoyaltyError('نظام نقاط الولاء غير منشط — فعّله من تبويب الإعدادات أولاً')
  }
  const pts = Math.floor(opts.points)
  if (!(pts > 0)) throw new LoyaltyError('عدد النقاط المطلوب صرفها يجب أن يكون أكبر من صفر')

  const { available } = await getCustomerPoints(tx, opts.customerId)
  if (pts > available) {
    throw new LoyaltyError(
      `رصيد نقاط العميل لا يكفي — المتاح ${available} نقطة والمطلوب صرفه ${pts} نقطة`,
    )
  }

  const amount = round2(pts * settings.pointPrice)
  if (!(amount > 0)) throw new LoyaltyError('قيمة الصرف يجب أن تكون أكبر من صفر')

  // إنفاذ الفترات المقفلة: صرف مؤرَّخ اليوم داخل فترة مقفلة ⇒ رفض
  const now = new Date()
  await assertPeriodOpen(tx, now, 'سند صرف نقاط ولاء')

  // 1) سند الدفع — VCH متتالية مشتركة مع كل السندات داخل المعاملة (بأرضية الترقيم — أرقام المدوّر لا تُعاد)
  const voucherNumber = await nextPaymentNumber(tx)
  const payment = await tx.payment.create({
    data: {
      number: voucherNumber,
      type: 'PAYMENT',
      date: now,
      amount,
      method: 'CASH',
      partnerId: opts.customerId,
      invoiceId: null,
      notes: `صرف قيمة نقاط الولاء نقداً — ${pts} نقطة × ${settings.pointPrice.toLocaleString('en-US')} ل.س`,
    },
    select: { id: true },
  })

  // 2) خصم النقاط من كشف العميل — تُصفر المستبدلة فوراً
  await applyLoyaltyMovement(tx, {
    customerId: opts.customerId,
    points: -pts,
    type: 'CASHOUT',
    reason: `صرف نقدي لنقاط الولاء — سند دفع ${voucherNumber} (${pts} نقطة × ${settings.pointPrice.toLocaleString('en-US')} ل.س = ${amount.toLocaleString('en-US')} ل.س)`,
    refType: 'PAYMENT',
    refId: payment.id,
    refNumber: voucherNumber,
  })

  // 3) القيد المزدوج: مدين الحسم الممنوح (4110) — دائن الصندوق (1110) — التوازن مضمون بنيوياً
  const byCode = await ensureInvoiceAccounts(tx)
  const discount = INVOICE_ACCOUNTS.DISCOUNT_GIVEN
  const cash = INVOICE_ACCOUNTS.CASH
  const doc = `سند دفع ${voucherNumber} — صرف نقاط ولاء العميل ${opts.customerName}`
  const totalDebit = amount
  const totalCredit = amount
  if (Math.abs(totalDebit - totalCredit) >= 0.01) {
    throw new Error(`قيد صرف النقاط ${voucherNumber} غير متوازن — تعذر آلي يجب الإبلاغ عنه`)
  }
  const entryNumber = await nextEntryNumber(tx)
  await tx.journalEntry.create({
    data: {
      number: entryNumber,
      date: now,
      description: doc,
      source: 'PAYMENT',
      status: 'POSTED',
      totalDebit,
      totalCredit,
      refType: 'PAYMENT',
      refId: payment.id,
      lines: {
        create: [
          {
            accountId: byCode.get(discount.code)!,
            debit: amount,
            credit: 0,
            description: `حسم ممنوح — صرف قيمة نقاط ولاء ${pts} نقطة للعميل ${opts.customerName}`,
            order: 0,
          },
          {
            accountId: byCode.get(cash.code)!,
            debit: 0,
            credit: amount,
            description: `خروج نقدي من الصندوق — صرف نقاط ولاء العميل ${opts.customerName}`,
            order: 1,
          },
        ],
      },
    },
    select: { id: true },
  })

  return { voucherNumber, amount, points: pts, entryNumber }
}

/** هل يوجد سند صرف نقاط ولاء مرتبط بهذا السند؟ — حارس الحذف في مسار السندات */
export async function isLoyaltyCashOutVoucher(client: LoyaltyDb, paymentId: string): Promise<boolean> {
  const found = await client.loyaltyTransaction.findFirst({
    where: { refType: 'PAYMENT', refId: paymentId, type: 'CASHOUT' },
    select: { id: true },
  })
  return !!found
}
