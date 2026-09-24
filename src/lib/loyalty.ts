// الرياضيات الصارمة لنقاط الولاء — مكتبة نقية مشتركة (عميل + خادم) بلا أي اعتماد على القاعدة
//
// ⚖️ قاعدة الاحتساب القطعية (لا تُغيَّر):
// 1) شرط التأهيل: الفاتورة الفردية الواحدة فقط — قيمتها تبلغ الحد الأدنى أو تتجاوزه.
//    الفواتير الأصغر من الحد الأدنى تُهمل كلياً (صفر نقاط) ولا تُجمع مع بعضها تحت أي ظرف.
// 2) المضاعفات: عدد المضاعفات الكاملة = floor(قيمة الفاتورة ÷ الحد الأدنى)
//    - المضاعف الأول وحده  ← النقاط الأساسية (20 افتراضياً)
//    - كل مضاعف كامل إضافي ← (الأساسية + 10) — أي 30 نقطة مع القيم الافتراضية
//    الجدول بالقيم الافتراضية (حد أدنى 100,000 ل.س وأساس 20 ونسبة مضاعفة 1.0):
//      100,000 – 199,999 ← 20 نقطة
//      200,000 – 299,999 ← 60 نقطة   (2 مضاعف × 30)
//      300,000 – 399,999 ← 90 نقطة   (3 × 30)
//      400,000 – 499,999 ← 120 نقطة  (4 × 30)
// 3) المبالغ الكسرية التي لا تقفل مضاعفاً كاملاً جديداً تثبت على نقاط المضاعف الكامل الأخير
//    دون أي زيادة تلقائية (floor يتكفل بذلك حرفياً).
// 4) نسبة مضاعفة النقاط الأسبوعية (Multiplication Factor): تُضرب بالنقاط النهائية الناتجة
//    عن جدول المضاعفات ويُقرّب الناتج لأقرب عدد صحيح — قيمتها قابلة للتعديل من لوحة الإدارة
//    (مثل 1.5 أو 2.0) وتُطبّق فوراً على الاحتساب والجدول الحي دون أي تعديل في الكود:
//      بالنسبة 1.5: 20 ← 30 | 60 ← 90 | 90 ← 135 | 120 ← 180
//      بالنسبة 2.0: 20 ← 40 | 60 ← 120 | 90 ← 180 | 120 ← 240

/** إعدادات منظومة نقاط الولاء — نفس حقول نموذج LoyaltySettings بالقاعدة */
export interface LoyaltySettingsData {
  isEnabled: boolean
  minInvoiceValue: number // الحد الأدنى لقيمة الفاتورة المؤهلة (ل.س)
  cycleDays: number // عدد أيام الدورة الأسبوعية (7 أيام — أسبوع كامل)
  basePoints: number // النقاط الأساسية للمضاعف الأول
  pointPrice: number // سعر النقطة الواحدة (ل.س)
  multiplicationFactor: number // نسبة مضاعفة النقاط الأسبوعية — تُضرب بالنقاط النهائية فور الحفظ
}

/** القيم الافتراضية — مطابقة لافتراضات المخطط في القاعدة */
export const LOYALTY_DEFAULTS: LoyaltySettingsData = {
  isEnabled: false,
  minInvoiceValue: 100_000,
  cycleDays: 7,
  basePoints: 20,
  pointPrice: 1_000,
  multiplicationFactor: 1,
}

/** بونص كل مضاعف كامل إضافي فوق الأول — عشرة نقاط ثابتة فوق الأساسية */
export const LOYALTY_MULTIPLIER_BONUS = 10

/**
 * نقاط فاتورة بيع واحدة — الدالة المرجعية الوحيدة للاحتساب في كل النظام.
 * تُحتسب فقط للفاتورة الفردية التي تبلغ الحد الأدنى أو تتجاوزه —
 * والمبالغ الكسرية تثبت على المضاعف الكامل الأخير بلا زيادة —
 * ثم تُضرب النتيجة بنسبة المضاعفة الأسبوعية وتُقرّب لأقرب عدد صحيح.
 * ملاحظة: multiplicationFactor إلزامي في الإعدادات الواردة — لا يمكن لموضع استدعاء أن يتجاهله.
 */
export function calculateAwardPoints(
  invoiceValue: number,
  settings: Pick<LoyaltySettingsData, 'minInvoiceValue' | 'basePoints' | 'multiplicationFactor'>,
): number {
  const min = settings.minInvoiceValue
  if (!(min > 0)) return 0
  if (!(invoiceValue >= min)) return 0 // ما دون الحد الأدنى — صفر نقاط، ولا تجميع نهائياً
  const multipliers = Math.floor(invoiceValue / min)
  if (multipliers <= 0) return 0
  const raw =
    multipliers === 1
      ? settings.basePoints // المضاعف الأول — الأساسية حصراً
      : multipliers * (settings.basePoints + LOYALTY_MULTIPLIER_BONUS)
  const factor = Number.isFinite(settings.multiplicationFactor) && settings.multiplicationFactor > 0
    ? settings.multiplicationFactor
    : 1
  return Math.round(raw * factor)
}

/** صف جدول المضاعفات التوضيحي — يُبنى من الإعدادات الحية (شاملة نسبة المضاعفة) ليعرض القاعدة للمالك بدقة */
export function awardTableRows(
  settings: Pick<LoyaltySettingsData, 'minInvoiceValue' | 'basePoints' | 'multiplicationFactor'>,
  rows = 4,
): { from: number; to: number; points: number }[] {
  const min = settings.minInvoiceValue > 0 ? settings.minInvoiceValue : LOYALTY_DEFAULTS.minInvoiceValue
  const out: { from: number; to: number; points: number }[] = []
  for (let i = 0; i < rows; i++) {
    const from = min * (i + 1)
    const to = min * (i + 2) - 1
    out.push({ from, to, points: calculateAwardPoints(from, settings) })
  }
  return out
}

/** أنواع حركات النقاط — نفس قيم القاعدة */
export const LOYALTY_TX_TYPES = ['EARN', 'REDEEM', 'CASHOUT', 'GIFT', 'DEDUCT', 'REVOKE'] as const
export type LoyaltyTxType = (typeof LOYALTY_TX_TYPES)[number]

/**
 * التسمية العربية لنوع الحركة — تُعرض في كشف الحساب.
 * OPENING (رصيد افتتاحي — ترحيل نقاط الفترة المغلقة بسند القيد الافتتاحي) تُنشأ آلياً
 * من محرك تدوير الفترات حصراً وليست من أنواع الحركات اليدوية، لذا هي خارج LOYALTY_TX_TYPES.
 */
export const AR_LOYALTY_TX_TYPE: Record<LoyaltyTxType | 'OPENING', string> = {
  EARN: 'استحقاق آلي (فاتورة بيع)',
  REDEEM: 'استرداد كحسم (فاتورة)',
  CASHOUT: 'صرف نقدي (سند دفع)',
  GIFT: 'إهداء نقاط',
  DEDUCT: 'خصم وحرمان',
  REVOKE: 'عكس آلي (تعديل/حذف)',
  OPENING: 'رصيد افتتاحي (ترحيل الفترة السابقة)',
}

/** سطر واحد من كشف حساب نقاط العميل — عقد الواجهة الموحد */
export interface LoyaltyStatementRow {
  id: string
  type: LoyaltyTxType
  typeLabel: string
  points: number // موقعة: (+) مضافة — (−) مخصومة
  balanceAfter: number
  reason: string
  refNumber: string | null
  createdAt: string
}

/** ملخص نقاط عميل واحد — عقد مسار الملخص ومربع الفاتورة */
export interface LoyaltyCustomerSummary {
  isEnabled: boolean
  available: number
  redeemed: number
  earned: number
  pointPrice: number
  minInvoiceValue: number
  basePoints: number
  multiplicationFactor: number
}
