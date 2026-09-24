// أنواع وأدوات شاشة بطاقات المواد — DTOs + الترقيم التلقائي + أوراق شجرة المستودعات
import { nextSequentialNumber } from '@/lib/math'
import type { WarehouseDTO } from '../warehouses/types'

export interface ItemImageDTO {
  id?: string
  url: string
  fileName: string
  isPrimary: boolean
  sortOrder?: number
}

export interface ItemUnitDTO {
  id?: string
  name: string
  factor: number
  barcode: string | null
  isActive: boolean
}

/** سعر الشراء التلقائي — يُحتسب من فواتير المشتريات (آخر سعر أو الوسطي المرجح) */
export interface PurchaseInfoDTO {
  last: number
  avg: number
  lastInvoiceNumber: string | null
  lastInvoiceDate: string | null
  invoicesCount: number
}

export interface ItemDTO {
  id: string
  code: string
  name: string
  barcode: string | null
  unit: string | null // (ملغى) الوحدة الأساسية — للتوافق فقط
  description: string | null
  /** سعر الشراء المُحتسب تلقائياً من آخر فاتورة مشتريات */
  purchasePrice: number
  purchaseInfo: PurchaseInfoDTO | null
  /** سعر الشراء المخزن بالبطاقة (يُستخدم كحلقة أخيرة في تقدير التكلفة) */
  storedPurchasePrice?: number
  salePrice: number
  taxRate: number
  minStock: number
  maxStock: number
  location: string | null
  isActive: boolean
  warehouseId: string | null
  warehouse: { id: string; code: string; name: string; level: number } | null
  balances: { warehouseId: string; quantity: number }[]
  images: ItemImageDTO[]
  units: ItemUnitDTO[]
  primaryImageUrl: string | null
  counts: { balances: number; movements: number; invoiceLines: number; stocktakingLines: number }
  createdAt: string
  updatedAt: string
}

/** صورة في النموذج (مرفوعة فعلياً + موجودة سابقاً) */
export interface PendingImage {
  key: string
  url: string
  fileName: string
  originalName: string
  isPrimary: boolean
  /** معرّف صورة محفوظة مسبقاً في القاعدة (عند التعديل) */
  existingId?: string
}

// ==================== الترقيم التلقائي ====================

/** رقم البطاقة التالي = الأكبر الحالي + 1 (I-008 مثلاً) */
export function nextItemCode(items: Pick<ItemDTO, 'code'>[]): string {
  return nextSequentialNumber(
    'I-',
    items.map((it) => it.code),
    3,
  )
}

// ==================== أوراق شجرة المستودعات ====================

/** المستودعات النهائية فقط (لا يوجد بداخلها مستودعات أخرى) — هي هدف إسناد المواد */
export function leafWarehouseIds(flat: WarehouseDTO[]): Set<string> {
  const hasChildren = new Set<string>()
  for (const w of flat) if (w.parentId) hasChildren.add(w.parentId)
  return new Set(flat.filter((w) => !hasChildren.has(w.id)).map((w) => w.id))
}

/** سلسلة الأسلاف من الجذر حتى المستودع (للعرض breadcrumb) */
export function warehousePath(flat: WarehouseDTO[], id: string): WarehouseDTO[] {
  const byId = new Map(flat.map((w) => [w.id, w]))
  const path: WarehouseDTO[] = []
  let cur = byId.get(id) ?? null
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    path.unshift(cur)
    cur = cur.parentId ? (byId.get(cur.parentId) ?? null) : null
  }
  return path
}

// ==================== حدود ثابتة ====================

export const MAX_IMAGES = 10
export const MAX_UNITS = 3
