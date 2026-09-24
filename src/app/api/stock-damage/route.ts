import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  StockError,
  applyBalanceDelta,
  parseOptionalCost,
  parseOptionalDate,
  parsePositiveQty,
  requireLeafWarehouse,
  ITEM_TABLE_SELECT,
  WAREHOUSE_TABLE_SELECT,
} from '@/lib/stock-server'
import { computePurchaseInfo, purchaseCostOf } from '@/lib/items-server'
import { postDamageJournal } from '@/lib/stock-journal'
import { PeriodClosedError } from '@/lib/period-server'
import { logAudit, auditMoney } from '@/lib/audit-server'
import { AR_DAMAGE_REASON } from '@/lib/format'

export const dynamic = 'force-dynamic'

// أسباب التلف المعتمدة — من القاموس المشترك الوحيد (تُخزّن التسمية العربية في حقل السبب)
const REASONS = new Set(Object.keys(AR_DAMAGE_REASON))

// ==================== GET: قائمة حالات التلف (الأحدث أولاً) ====================
export async function GET() {
  try {
    const records = await db.stockMovement.findMany({
      where: { refType: 'DAMAGE' },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: {
        item: { select: ITEM_TABLE_SELECT },
        warehouse: { select: WAREHOUSE_TABLE_SELECT },
      },
    })

    const data = records.map((r) => ({
      id: r.id,
      date: r.date,
      quantity: r.quantity,
      unitCost: r.unitCost,
      value: r.quantity * r.unitCost,
      reason: r.reason,
      item: {
        ...r.item,
        primaryImageUrl: r.item.images[0]?.url ?? null,
      },
      warehouse: r.warehouse,
    }))

    return NextResponse.json(data)
  } catch (error) {
    console.error('StockDamage GET error:', error)
    return NextResponse.json({ error: 'فشل جلب حالات التلف' }, { status: 500 })
  }
}

// ==================== POST: تسجيل حالة تلف (إخراج من المخزون بقيمة تقديرية) ====================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })
    }

    const item = await db.item.findUnique({ where: { id: String(body.itemId ?? '') } })
    if (!item) return NextResponse.json({ error: 'المادة غير موجودة' }, { status: 400 })

    const warehouse = await requireLeafWarehouse(body.warehouseId, 'قسم التلف')
    const quantity = parsePositiveQty(body.quantity)
    const date = parseOptionalDate(body.date)

    const reasonCode = typeof body.reason === 'string' && REASONS.has(body.reason) ? body.reason : 'DAMAGE'
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 200) : null
    const reasonText = notes ? `${AR_DAMAGE_REASON[reasonCode]} — ${notes}` : AR_DAMAGE_REASON[reasonCode]

    // قيمة التلف التقديرية: تكلفة مُدخلة أو سعر الشراء التلقائي (المتوسط المرجح المحفوظ ← الوسطي المحسوب ← آخر سعر)
    const purchaseMap = await computePurchaseInfo()
    const unitCost = parseOptionalCost(body.unitCost, purchaseCostOf(purchaseMap.get(item.id), item.avgCost))

    let journalNumber: string | null = null
    const created = await db.$transaction(async (tx) => {
      await applyBalanceDelta(tx, item.id, warehouse.id, -quantity)
      const movement = await tx.stockMovement.create({
        data: {
          date,
          type: 'OUT',
          itemId: item.id,
          warehouseId: warehouse.id,
          quantity,
          unitCost,
          reason: reasonText,
          refType: 'DAMAGE',
        },
      })

      // قيد التلف المحاسبي (P0-3): مدين مصروف التلف والهالك / دائن المخزون بقيمة الحركة
      const value = quantity * unitCost
      const entry = await postDamageJournal(tx, {
        movementId: movement.id,
        date,
        itemName: item.name,
        value,
        reasonText,
      })
      journalNumber = entry?.number ?? null

      // التوثيق داخل المعاملة نفسها (قاعدة المشروع)
      await logAudit(tx, {
        action: 'CREATE',
        entity: 'DAMAGE',
        entityId: movement.id,
        entityNumber: journalNumber,
        title: `تلف مخزون — ${item.name}`,
        summary: `تسجيل تلف «${item.name}» كمية ${auditMoney(quantity)} ${item.unit} بقيمة ${auditMoney(value)} ل.س من ${warehouse.name} — السبب: ${reasonText} — القيد: ${journalNumber ?? 'بلا قيد (قيمة صفرية)'}`,
        amount: value,
        details: {
          'المادة': item.name,
          'الكمية': `${auditMoney(quantity)} ${item.unit}`,
          'تكلفة الوحدة': `${auditMoney(unitCost)} ل.س`,
          'القيمة': `${auditMoney(value)} ل.س`,
          'المستودع': warehouse.name,
          'السبب': reasonText,
          'رقم القيد المحاسبي': journalNumber ?? 'بلا قيد',
        },
      })

      return movement
    })

    return NextResponse.json({ ...created, journalEntryNumber: journalNumber }, { status: 201 })
  } catch (error) {
    if (error instanceof StockError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof PeriodClosedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('StockDamage POST error:', error)
    return NextResponse.json({ error: 'فشل تسجيل حالة التلف' }, { status: 500 })
  }
}
