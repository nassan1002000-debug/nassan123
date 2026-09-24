// أدوات خادم مشتركة لشاشات المخزون — الأقسام النهائية، تحديث الأرصدة، التحقق من الكميات
// تُستخدم في: حركات المخزون، أمر الجرد، تلف المخزون
import { db } from '@/lib/db'
import type { Prisma, Warehouse } from '@prisma/client'
import { nextSequentialNumber } from '@/lib/math'
import { fmtQty } from '@/lib/format'

/** عميل المعاملة (transaction client) */
export type Tx = Prisma.TransactionClient

/** خطأ عمل مخزني — يعاد للمستخدم برسالة عربية واضحة وحالة 409 */
export class StockError extends Error {
  status: number
  constructor(message: string, status = 409) {
    super(message)
    this.status = status
  }
}

/**
 * القسم النهائي فقط (آخر مستوى — لا مستودعات بداخله) هو هدف الحركة المخزنية.
 * يعيد المستودع أو يرمي StockError برسالة واضحة.
 */
export async function requireLeafWarehouse(id: unknown, label = 'القسم'): Promise<Warehouse> {
  if (!id || typeof id !== 'string') {
    throw new StockError(`يجب اختيار ${label}`, 400)
  }
  const wh = await db.warehouse.findUnique({
    where: { id },
    select: { id: true, code: true, name: true, level: true, isActive: true, _count: { select: { children: true } } },
  })
  if (!wh) throw new StockError(`${label} المختار غير موجود`, 400)
  if (wh._count.children > 0) {
    throw new StockError(`«${wh.name}» يحتوي مستودعات فرعية — الحركة تتم على القسم النهائي (آخر مستوى) فقط`, 400)
  }
  if (!wh.isActive) throw new StockError(`${label} «${wh.name}» موقوف — اختر قسماً نشطاً`, 400)
  // إعادة الشكل الكامل (بلا _count)
  const full = await db.warehouse.findUnique({ where: { id: wh.id } })
  return full!
}

/**
 * تعديل رصيد مادة في قسم بمقدار delta داخل معاملة.
 * delta موجب = إضافة، سالب = خصم (يرفض تجاوز المتوفر).
 * يعيد الرصيد الجديد.
 */
export async function applyBalanceDelta(tx: Tx, itemId: string, warehouseId: string, delta: number): Promise<number> {
  const balance = await tx.itemBalance.findUnique({
    where: { itemId_warehouseId: { itemId, warehouseId } },
  })
  const current = balance?.quantity ?? 0
  const next = current + delta
  if (next < 0) {
    throw new StockError(`الكمية المتوفرة لا تكفي — المتوفر حالياً ${fmtQty(current)}`)
  }
  if (balance) {
    await tx.itemBalance.update({ where: { id: balance.id }, data: { quantity: next } })
  } else {
    await tx.itemBalance.create({ data: { itemId, warehouseId, quantity: next } })
  }
  return next
}

/** تعيين رصيد مادة في قسم إلى قيمة محددة (تسوية جرد) — يعيد (القديم، الجديد) */
export async function setBalance(tx: Tx, itemId: string, warehouseId: string, quantity: number): Promise<{ old: number; new: number }> {
  const balance = await tx.itemBalance.findUnique({
    where: { itemId_warehouseId: { itemId, warehouseId } },
  })
  const old = balance?.quantity ?? 0
  if (balance) {
    await tx.itemBalance.update({ where: { id: balance.id }, data: { quantity } })
  } else {
    await tx.itemBalance.create({ data: { itemId, warehouseId, quantity } })
  }
  return { old, new: quantity }
}

/** تحقق من كمية صحيحة موجبة */
export function parsePositiveQty(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n) || n <= 0) {
    throw new StockError('الكمية يجب أن تكون رقماً أكبر من صفر', 400)
  }
  return n
}

/** تحقق من تكلفة اختيارية غير سالبة */
export function parseOptionalCost(v: unknown, fallback: number): number {
  if (v === undefined || v === null || v === '') return fallback
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n) || n < 0) return fallback
  return n
}

/** تحقق من تاريخ اختياري صالح */
export function parseOptionalDate(v: unknown): Date {
  if (!v || typeof v !== 'string') return new Date()
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? new Date() : d
}

/** رقم أمر الجرد التالي = الأكبر الحالي + 1 (ST-001، ST-002، …) — floor: أرضية أرقام المدوَّر للأرشيف */
export function nextStocktakingNumber(numbers: string[], floor = 0): string {
  return nextSequentialNumber('ST-', numbers, 3, floor)
}

/** select مشترك لبيانات المادة في الجداول (مع الصورة الأساسية) */
export const ITEM_TABLE_SELECT = {
  id: true,
  code: true,
  name: true,
  barcode: true,
  purchasePrice: true,
  avgCost: true, // المتوسط المرجح — مصدر التكلفة في تقدير التلف وفروق الجرد
  salePrice: true,
  images: { where: { isPrimary: true }, take: 1, select: { url: true, fileName: true } },
  units: { where: { isActive: true }, select: { name: true, factor: true } },
} satisfies Prisma.ItemSelect

export type ItemTableData = Prisma.ItemGetPayload<{ select: typeof ITEM_TABLE_SELECT }>

/** select مشترك لبيانات القسم في الجداول */
export const WAREHOUSE_TABLE_SELECT = {
  id: true,
  code: true,
  name: true,
  level: true,
  keeperName: true,
} satisfies Prisma.WarehouseSelect
