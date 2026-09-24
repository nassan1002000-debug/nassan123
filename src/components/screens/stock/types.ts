// أنواع وأدوات مشتركة لشاشات المخزون (الحركات، الجرد، التلف)

export interface ItemLite {
  id: string
  code: string
  name: string
  barcode: string | null
  purchasePrice: number
  salePrice: number
  primaryImageUrl: string | null
  /** معلومات سعر الشراء التلقائي من قائمة /api/items (آخر سعر/الوسطي) — لتقدير التكلفة مثل الخادم */
  purchaseInfo?: { last: number; avg: number } | null
  /** سعر الشراء المخزن بالبطاقة — الحلقة الأخيرة في تقدير التكلفة */
  storedPurchasePrice?: number
  /** القسم المُسند إليه في البطاقة (اختياري — مواد قديمة قبل الإلزامية) */
  warehouseId?: string | null
  units: { name: string; factor: number }[]
  balances: { warehouseId: string; quantity: number }[]
}

/** التكلفة المعتمدة للتقدير — نفس منطق الخادم purchaseCostOf: آخر سعر شراء ← الوسطي ← الحقل المخزن */
export function estimatedCostOf(item: ItemLite | null | undefined): number {
  if (!item) return 0
  return item.purchaseInfo?.last || item.purchaseInfo?.avg || item.storedPurchasePrice || item.purchasePrice || 0
}

/** رصيد المادة في قسم معيّن (0 إن لم يوجد سطر رصيد) */
export function balanceOf(item: ItemLite | null, warehouseId: string | null): number {
  if (!item || !warehouseId) return 0
  return item.balances.find((b) => b.warehouseId === warehouseId)?.quantity ?? 0
}

export interface WarehouseLite {
  id: string
  code: string
  name: string
  level: number
  keeperName: string | null
  /** لحساب الأقسام النهائية في الشاشات */
  parentId?: string | null
  isActive?: boolean
}

/** أنواع الحركات */
export type MoveType = 'IN' | 'OUT' | 'TRANSFER'

export const MOVE_TYPE_META: Record<MoveType, { label: string; badge: string }> = {
  IN: {
    label: 'إدخال',
    badge: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  OUT: {
    label: 'إخراج',
    badge: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  },
  TRANSFER: {
    label: 'تحويل',
    badge: 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
}
