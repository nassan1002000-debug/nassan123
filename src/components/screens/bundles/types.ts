// أنواع شاشة سلال العروض — سلال الهدية والحسم النسبي والأسعار المخفضة
// العقد الحرفي للخادم: GET /api/bundles → { bundles: BundleRow[] }

import type { ItemLite } from '@/components/screens/stock/types'

export type BundleType = 'GIFT' | 'PERCENT' | 'PRICE'

/** بند داخل سلة محفوظة — كما يصل من الخادم مع بطاقة المادة */
export interface BundleItemRow {
  id: string
  itemId: string
  quantity: number
  isGift: boolean
  bundlePrice: number
  item: { code: string; name: string; salePrice: number }
}

/** صف السلة في القائمة — كما يصل من الخادم مع بطاقة كل مادة */
export interface BundleRow {
  id: string
  name: string
  type: BundleType
  typeLabel: string
  discountPercent: number
  startsAt: string
  endsAt: string
  active: boolean
  /** المفتاح اليدوي — الإيقاف يخفي السلة عن الفواتير بغض النظر عن الفترة (Task 36) */
  enabled: boolean
  totalSales: number
  saleCount: number
  totalDiscount: number
  items: BundleItemRow[]
}

/** بند في نموذج الإنشاء/التعديل — قيم الحقول نصية لأنها محتوى حقول إدخال */
export interface BundleFormLine {
  key: string
  itemId: string | null
  quantity: string
  isGift: boolean
  bundlePrice: string
}

/** جسم POST/PUT — العقد الحرفي للخادم */
export interface BundlePayload {
  name: string
  type: BundleType
  discountPercent: number
  startsAt: string
  endsAt: string
  /** المفتاح اليدوي للتفعيل — إيقاف/تشغيل بغض النظر عن تواريخ الفترة (Task 36) */
  enabled: boolean
  items: { itemId: string; quantity: number; isGift: boolean; bundlePrice: number }[]
}

export type { ItemLite as BundleItemOption }

// ==================== دورة حياة السلة الزمنية ====================

export type BundleLifecycle = 'ACTIVE' | 'UPCOMING' | 'ENDED'

/** حالة السلة الآن — تُحسب من الفترة محلياً وتطابق شارة active الخادمية */
export function bundleLifecycle(b: Pick<BundleRow, 'startsAt' | 'endsAt'>): BundleLifecycle {
  const now = Date.now()
  if (new Date(b.startsAt).getTime() > now) return 'UPCOMING'
  if (new Date(b.endsAt).getTime() < now) return 'ENDED'
  return 'ACTIVE'
}

// ==================== أدوات الفترة الزمنية (datetime-local) ====================

/** ISO → قيمة حقل datetime-local بالتوقيت المحلي */
export function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** قيمة datetime-local → ISO (التوقيت المحلي ثم التحويل) */
export function datetimeLocalToISO(v: string): string {
  return new Date(v).toISOString()
}

/** افتراضا الفترة في نموذج الإنشاء: من الآن مقرباً لأعلى الساعة إلى +7 أيام بنفس الساعة */
export function defaultPeriod(): { startsAt: string; endsAt: string } {
  const start = new Date()
  start.setMinutes(0, 0, 0)
  start.setHours(start.getHours() + 1)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return { startsAt: isoToDatetimeLocal(start.toISOString()), endsAt: isoToDatetimeLocal(end.toISOString()) }
}

// ==================== بيانات العرض للأنواع الثلاثة ====================

/** شارة النوع — GIFT عنبري، PERCENT زمردي، PRICE وردي (بلا أزرق/نيلي حسب قواعد النظام) */
export const BUNDLE_TYPE_BADGE: Record<BundleType, string> = {
  GIFT: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  PERCENT: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  PRICE: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
}
