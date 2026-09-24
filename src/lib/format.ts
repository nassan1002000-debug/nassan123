// أدوات التنسيق — العملة المزدوجة (ل.س أساسي + $ مرجعي) والقواميس العربية
// سعر الصرف ونمط الأرقام حالتان حيّتان: تُقرآن متزامناً من localStorage عند إقلاع المتصفح
// (بلا وميض) ثم تُحدّثان بعد الإقلاع من GET /api/settings في الشيل الرئيسي

const DEFAULT_EXCHANGE_RATE = 130 // 1$ = 130 ل.س (افتراضي — يُستبدل بقيمة الإعدادات)

let exchangeRate = DEFAULT_EXCHANGE_RATE

// تهيئة متزامنة من localStorage — تُنفذ مرة واحدة عند تحميل الموديول في المتصفح فقط
if (typeof window !== 'undefined') {
  const saved = window.localStorage.getItem('exchangeRate')
  if (saved) {
    const n = Number.parseFloat(saved)
    if (Number.isFinite(n) && n >= 1 && n <= 1_000_000) exchangeRate = n
  }
}

/** سعر الصرف الحالي (1$ = X ل.س) */
export function getExchangeRate(): number {
  return exchangeRate
}

/** تحديث سعر الصرف حياً — يُخزن في localStorage أيضاً ليبقى بعد إعادة التحميل */
export function setExchangeRate(v: number): void {
  if (!Number.isFinite(v) || v < 1 || v > 1_000_000) return
  exchangeRate = v
  if (typeof window !== 'undefined') window.localStorage.setItem('exchangeRate', String(v))
}

// ==================== الخانات العشرية للمبالغ (0/1/2) ====================

export type DecimalPlaces = 0 | 1 | 2

let decimalPlaces: DecimalPlaces = 2

// تهيئة متزامنة من localStorage عند الإقلاع في المتصفح (الافتراضي منزلتان)
if (typeof window !== 'undefined') {
  const saved = window.localStorage.getItem('decimalPlaces')
  if (saved === '0' || saved === '1' || saved === '2') decimalPlaces = Number(saved) as DecimalPlaces
}

export function getDecimalPlaces(): DecimalPlaces {
  return decimalPlaces
}

/** تبديل عدد الخانات العشرية للمبالغ — يُخزن localStorage (الشاشات تُحدّث بإعادة تحميل الصفحة) */
export function setDecimalPlaces(n: DecimalPlaces): void {
  decimalPlaces = n
  if (typeof window !== 'undefined') window.localStorage.setItem('decimalPlaces', String(n))
}

// ==================== نمط الأرقام (لاتينية/عربية) ====================

export type NumeralMode = 'latin' | 'arabic'

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'

let numeralMode: NumeralMode = 'latin'

// تهيئة متزامنة من localStorage عند الإقلاع في المتصفح (الافتراضي لاتيني)
if (typeof window !== 'undefined') {
  const saved = window.localStorage.getItem('numeralMode')
  if (saved === 'arabic' || saved === 'latin') numeralMode = saved
}

export function getNumeralMode(): NumeralMode {
  return numeralMode
}

/** تبديل نمط الأرقام — يُخزن localStorage (الشاشات تُحدّث بإعادة تحميل الصفحة) */
export function setNumeralMode(m: NumeralMode): void {
  numeralMode = m
  if (typeof window !== 'undefined') window.localStorage.setItem('numeralMode', m)
}

/** تبديل الأرقام 0-9 إلى ٠-٩ عندما يكون النمط عربياً — الفواصل والصيغة الأمريكية تبقى كما هي */
function withDigits(s: string): string {
  if (numeralMode !== 'arabic') return s
  return s.replace(/[0-9]/g, (d) => ARABIC_DIGITS[Number(d)])
}

/** الأشهر العربية — مصدر وحيد للرسوم والتقارير */
export const AR_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
]

/** تاريخ اليوم بصيغة YYYY-MM-DD بالتوقيت المحلي (لا UTC) — لحقول التاريخ في النماذج */
export function todayYMD(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** تحويل داخلي ل.س ← $ — العرض عبر fmtUSD (بلا مستهلك خارجي حالياً) */
function toUSD(syp: number): number {
  return syp / getExchangeRate()
}

export function fmtMoney(n: number): string {
  const v = withDigits(
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    }).format(Number.isFinite(n) ? n : 0),
  )
  // RLE (\u202B) ... PDF (\u202C): يفرض اتجاه RTL على المبلغ كوحدة واحدة
  // فيظهر الرقم أولاً (يميناً) ورمز العملة «ل.س» بعده (يساراً) حتى داخل عناصر dir=ltr مثل .num
  return `\u202B${v} ل.س\u202C`
}

export function fmtUSD(syp: number): string {
  const usd = toUSD(syp)
  const v = withDigits(
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    }).format(Number.isFinite(usd) ? usd : 0),
  )
  return `$${v}`
}

export function fmtNumber(n: number): string {
  return withDigits(new Intl.NumberFormat('en-US').format(Number.isFinite(n) ? n : 0))
}

export function fmtQty(n: number): string {
  return withDigits(
    new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 2,
    }).format(Number.isFinite(n) ? n : 0),
  )
}

export function fmtDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  // للعرض فقط — لا تُستخدم لقيم حقول الإدخال (todayYMD مخصصة لذلك)
  return withDigits(`${y}/${m}/${day}`)
}

export function fmtDateTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return withDigits(`${fmtDate(date)} ${h}:${min}`)
}

// ==================== القواميس العربية ====================

export const AR_ACCOUNT_TYPE: Record<string, string> = {
  ASSET: 'أصول',
  LIABILITY: 'التزامات',
  EQUITY: 'حقوق ملكية',
  REVENUE: 'إيرادات',
  EXPENSE: 'مصروفات',
}

export const AR_NATURE: Record<string, string> = {
  DEBIT: 'مدين',
  CREDIT: 'دائن',
}

export const AR_ENTRY_STATUS: Record<string, string> = {
  DRAFT: 'مسودة',
  POSTED: 'مُرحّلة',
  CANCELLED: 'ملغاة',
}

export const AR_SOURCE: Record<string, string> = {
  MANUAL: 'يدوي',
  SALES: 'مبيعات',
  PURCHASE: 'مشتريات',
  RECEIPT: 'سند قبض',
  PAYMENT: 'سند دفع',
  SALARY: 'رواتب',
  EXPENSE: 'مصروفات',
  ADVANCE: 'سلف موظفين',
  OPENING: 'افتتاحي',
  STOCK: 'تسويات مخزنية',
  CLEARING: 'سند مقاصة',
}

export const AR_PAYMENT_TYPE: Record<string, string> = {
  RECEIPT: 'سند قبض',
  PAYMENT: 'سند دفع',
}

export const AR_METHOD: Record<string, string> = {
  CASH: 'نقداً',
  BANK: 'بنك',
  CHEQUE: 'شيك',
}

export const AR_INVOICE_TYPE: Record<string, string> = {
  SALE: 'بيع',
  SALES_RETURN: 'مردود بيع',
  PURCHASE: 'شراء',
  PURCHASE_RETURN: 'مردود شراء',
}

export const AR_INVOICE_STATUS: Record<string, string> = {
  PAID: 'مدفوعة',
  PARTIAL: 'مدفوعة جزئياً',
  UNPAID: 'غير مدفوعة',
}

export const AR_MOVE_TYPE: Record<string, string> = {
  IN: 'إدخال',
  OUT: 'إخراج',
  TRANSFER: 'تحويل',
}

export const AR_REF_TYPE: Record<string, string> = {
  MANUAL: 'يدوي',
  INVOICE: 'فاتورة',
  STOCKTAKING: 'جرد',
  DAMAGE: 'تلف',
  TRANSFER: 'تحويل',
  SALARY: 'راتب',
  ADVANCE: 'سلفة',
}

export const AR_DAMAGE_REASON: Record<string, string> = {
  DAMAGE: 'تلف',
  SPOILAGE: 'هدر/فساد',
  LOSS: 'فقد',
  EXPIRY: 'انتهاء صلاحية',
  BREAKAGE: 'كسر/تحطيم',
  OTHER: 'أخرى',
}

export const AR_LEAVE_TYPE: Record<string, string> = {
  ANNUAL: 'سنوية',
  SICK: 'مرضية',
  UNPAID: 'بدون راتب',
  EMERGENCY: 'اضطرارية',
}

export const AR_LEAVE_STATUS: Record<string, string> = {
  PENDING: 'قيد الانتظار',
  APPROVED: 'مقبولة',
  REJECTED: 'مرفوضة',
}

export const AR_ATTENDANCE_STATUS: Record<string, string> = {
  PRESENT: 'حاضر',
  ABSENT: 'غائب',
  LATE: 'متأخر',
  LEAVE: 'إجازة',
}

export const AR_PARTNER_TYPE: Record<string, string> = {
  CUSTOMER: 'عميل',
  SUPPLIER: 'مورد',
}

export const AR_ROLE: Record<string, string> = {
  ADMIN: 'مدير النظام',
  ACCOUNTANT: 'محاسب',
  VIEWER: 'مشاهد',
}
