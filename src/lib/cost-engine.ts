// محرك التكلفة — المتوسط المرجح اللحظي (القسم 4.2)
// ----------------------------------------------------------------------------
// المبدأ: لكل مادة تكلفة وسطية مرجحة واحدة محفوظة على البطاقة (`Item.avgCost`)
// تُحدَّث ذرياً مع كل حركة **دخول** داخل معاملة المستند نفسه:
//
//     المتوسط الجديد = (كمية قبل × متوسط قبل + كمية داخلة × سعرها) ÷ (كمية قبل + كمية داخلة)
//
// وحركات **الخروج** (بيع، تلف، عجز جرد) لا تغيّر المتوسط — تأخذه كما هو لحظة
// الحركة. وهذا هو معنى «لحظياً من أرصدة المخزون قبل الحركة».
//
// لماذا على البطاقة لا محسوبة من الفواتير؟
//   الحساب من بنود فواتير الشراء ينهار عند إقفال الفترة: التدوير ينقل كل الفواتير
//   إلى الأرشيف فتصبح الفترة الجديدة بلا أي سجل شراء، فتُحتسب التكلفة صفراً وتُرحَّل
//   كل فاتورة بيع بإيراد بلا تكلفة ولا يُستهلك المخزون أبداً. التكلفة على البطاقة
//   تعبر حدود الفترات لأنها ليست مستنداً يُدوَّر.
//
// ولماذا لا «آخر سعر شراء»؟
//   لأنه ليس ما تقوله المواصفة، ولأن قراءته كانت مرتّبة بتاريخ آخر فاتورة شراء بلا
//   تقييد بتاريخ المستند محل التسعير — فتُسعَّر مبيعات آذار بتكلفة شراء من آب.
//   المتوسط المحفوظ يُلتقط لحظة الترحيل فلا مجال لتسرّب زمني أصلاً.

import type { Prisma } from '@prisma/client'
import { round2 } from '@/lib/math'

type Tx = Prisma.TransactionClient

/** بند مؤثر في التكلفة — الكمية بالوحدة الأساسية وسعر الوحدة للمشتريات */
export interface CostLine {
  itemId: string
  quantity: number
  /** سعر وحدة الشراء — يخصّ حركات الدخول فقط */
  unitPrice?: number
}

/** خطأ تكلفة — يُترجم في المسارات إلى رسالة عربية للمستخدم */
export class CostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CostError'
  }
}

/** تجميع البنود المتكررة لنفس المادة في بند واحد مرجّح */
function aggregate(lines: CostLine[]): Map<string, { qty: number; value: number }> {
  const out = new Map<string, { qty: number; value: number }>()
  for (const l of lines) {
    if (!l.itemId || !(l.quantity > 0)) continue
    const cur = out.get(l.itemId) ?? { qty: 0, value: 0 }
    cur.qty += l.quantity
    cur.value += l.quantity * (l.unitPrice ?? 0)
    out.set(l.itemId, cur)
  }
  return out
}

/** الكمية على اليد لكل مادة — مجموع أرصدة كل المستودعات قبل الحركة */
async function onHandByItem(tx: Tx, itemIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (itemIds.length === 0) return out
  const rows = await tx.itemBalance.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true, quantity: true },
  })
  for (const r of rows) out.set(r.itemId, (out.get(r.itemId) ?? 0) + r.quantity)
  return out
}

/** التكلفة الوسطية المرجحة الحالية لكل مادة مطلوبة */
export async function currentCosts(tx: Tx, itemIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(itemIds)].filter(Boolean)
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  const items = await tx.item.findMany({
    where: { id: { in: ids } },
    select: { id: true, avgCost: true, purchasePrice: true },
  })
  for (const it of items) {
    // البطاقة أولاً، وآخر سعر شراء شبكة أمان لمادة لم تمر بحركة دخول بعد الإصلاح
    out.set(it.id, it.avgCost > 0 ? it.avgCost : it.purchasePrice)
  }
  return out
}

/**
 * تكلفة بنود حركة خروج (بيع/مردود بيع/تلف) بالمتوسط المرجح اللحظي.
 *
 * **تُستدعى قبل تحديث أرصدة المخزون** فتعكس الحالة «قبل الحركة».
 * ترمي CostError إن كانت مادة بلا تكلفة معروفة: ترحيل بيع بتكلفة صفر يعترف
 * بالإيراد بلا تكلفته ولا يستهلك المخزون — وهو بالضبط العطل الذي جعل الفترة
 * الحية تُرحّل مبيعاتها بمجمل ربح 100%. الفشل الصريح أسلم من الصفر الصامت.
 */
export async function costOfLines(tx: Tx, lines: CostLine[]): Promise<number> {
  const agg = aggregate(lines)
  if (agg.size === 0) return 0
  const costs = await currentCosts(tx, [...agg.keys()])

  const missing: string[] = []
  let total = 0
  for (const [itemId, { qty }] of agg) {
    const unit = costs.get(itemId) ?? 0
    if (!(unit > 0)) {
      missing.push(itemId)
      continue
    }
    total += qty * unit
  }

  if (missing.length > 0) {
    const items = await tx.item.findMany({
      where: { id: { in: missing } },
      select: { code: true, name: true },
    })
    const names = items.map((i) => `${i.code} ${i.name}`).join('، ')
    throw new CostError(
      `لا توجد تكلفة معروفة للمواد التالية فلا يمكن ترحيل تكلفة المبيعات: ${names}. ` +
        `أدخل فاتورة مشتريات لها أولاً، أو صحّح تكلفتها من بطاقة المادة.`,
    )
  }
  return round2(total)
}

/**
 * حركة دخول بضاعة (فاتورة مشتريات): تحدّث المتوسط المرجح وآخر سعر شراء.
 * **تُستدعى قبل تحديث أرصدة المخزون** — المعادلة تحتاج الكمية قبل الحركة.
 */
export async function applyInbound(tx: Tx, lines: CostLine[]): Promise<void> {
  const agg = aggregate(lines)
  if (agg.size === 0) return
  const ids = [...agg.keys()]
  const [onHand, items] = await Promise.all([
    onHandByItem(tx, ids),
    tx.item.findMany({ where: { id: { in: ids } }, select: { id: true, avgCost: true } }),
  ])
  const avgById = new Map(items.map((i) => [i.id, i.avgCost]))

  for (const [itemId, { qty: qtyIn, value: valueIn }] of agg) {
    const qtyBefore = onHand.get(itemId) ?? 0
    const avgBefore = avgById.get(itemId) ?? 0
    const valueBefore = qtyBefore > 0 ? qtyBefore * avgBefore : 0
    const qtyAfter = qtyBefore + qtyIn
    // سعر الوحدة الداخل — يصبح المتوسط كله إن لم يكن على اليد شيء قبل الحركة
    const unitIn = qtyIn > 0 ? valueIn / qtyIn : 0
    const avgAfter = qtyAfter > 0 ? (valueBefore + valueIn) / qtyAfter : unitIn

    await tx.item.update({
      where: { id: itemId },
      data: {
        avgCost: avgAfter,
        // آخر سعر شراء — يُغذَّى هنا حصراً؛ لم يكن يُكتب من أي موضع قبل الإصلاح
        ...(unitIn > 0 ? { purchasePrice: unitIn } : {}),
      },
    })
  }
}

/**
 * عكس حركة دخول: مردود شراء، أو حذف/تعديل فاتورة مشتريات.
 * تُخرج قيمة البضاعة العائدة من الوعاء وتعيد احتساب المتوسط على ما بقي.
 */
export async function reverseInbound(tx: Tx, lines: CostLine[]): Promise<void> {
  const agg = aggregate(lines)
  if (agg.size === 0) return
  const ids = [...agg.keys()]
  const [onHand, items] = await Promise.all([
    onHandByItem(tx, ids),
    tx.item.findMany({ where: { id: { in: ids } }, select: { id: true, avgCost: true } }),
  ])
  const avgById = new Map(items.map((i) => [i.id, i.avgCost]))

  for (const [itemId, { qty: qtyOut, value: valueOut }] of agg) {
    const qtyBefore = onHand.get(itemId) ?? 0
    const avgBefore = avgById.get(itemId) ?? 0
    const valueBefore = qtyBefore > 0 ? qtyBefore * avgBefore : 0
    const qtyAfter = qtyBefore - qtyOut
    // بلا سعر مصاحب يُخرَج بالمتوسط الجاري فلا يتغير المتوسط
    const valueRemoved = valueOut > 0 ? valueOut : qtyOut * avgBefore
    const valueAfter = valueBefore - valueRemoved
    // رصيد صفري أو سالب ⇒ الوعاء فرغ: يُصفَّر المتوسط بدل ترك قيمة معلّقة بلا كمية
    const avgAfter = qtyAfter > 0 && valueAfter > 0 ? valueAfter / qtyAfter : 0

    await tx.item.update({ where: { id: itemId }, data: { avgCost: avgAfter } })
  }
}
