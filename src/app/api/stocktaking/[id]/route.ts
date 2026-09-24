import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  StockError,
  setBalance,
  ITEM_TABLE_SELECT,
  WAREHOUSE_TABLE_SELECT,
} from '@/lib/stock-server'
import { computePurchaseInfo, purchaseCostOf } from '@/lib/items-server'
import { postStocktakingJournal } from '@/lib/stock-journal'
import { PeriodClosedError } from '@/lib/period-server'
import { logAudit, auditMoney } from '@/lib/audit-server'
import { round2 } from '@/lib/journal-server'

export const dynamic = 'force-dynamic'

// ==================== GET: أمر جرد واحد مع أسطره ====================
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const order = await db.stocktaking.findUnique({
      where: { id },
      include: {
        warehouse: { select: WAREHOUSE_TABLE_SELECT },
        lines: {
          include: { item: { select: ITEM_TABLE_SELECT } },
          orderBy: { id: 'asc' },
        },
      },
    })
    if (!order) {
      return NextResponse.json({ error: 'أمر الجرد غير موجود' }, { status: 404 })
    }
    // قيمة الفروقات بسعر الشراء التلقائي (المتوسط المرجح المحفوظ ← الوسطي المحسوب ← آخر سعر)
    // وunitCost لكل سطر يُمرر للواجهة ليطابق عرض السطر حساب الخادم
    const purchaseMap = await computePurchaseInfo()
    const unitCostOf = (itemId: string, fallback: number) =>
      purchaseCostOf(purchaseMap.get(itemId), fallback)
    const varianceValue = order.lines.reduce(
      (sum, ln) => sum + ln.difference * unitCostOf(ln.itemId, ln.item.avgCost),
      0,
    )
    return NextResponse.json({
      ...order,
      lines: order.lines.map((ln) => ({
        ...ln,
        item: { ...ln.item, primaryImageUrl: ln.item.images[0]?.url ?? null },
        unitCost: unitCostOf(ln.itemId, ln.item.avgCost),
      })),
      varianceValue,
    })
  } catch (error) {
    console.error('Stocktaking [id] GET error:', error)
    return NextResponse.json({ error: 'فشل جلب أمر الجرد' }, { status: 500 })
  }
}

// ==================== POST: ترحيل أمر الجرد — تعيين الأرصدة للكميات المجرودة ====================
// كل سطر بفرق ≠ صفر يولّد حركة تسوية (IN زيادة / OUT نقص) مرتبطة بالأمر refType=STOCKTAKING
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const order = await db.stocktaking.findUnique({
      where: { id },
      include: {
        lines: { include: { item: { select: { id: true, purchasePrice: true, avgCost: true, name: true } } } },
      },
    })
    if (!order) {
      return NextResponse.json({ error: 'أمر الجرد غير موجود' }, { status: 404 })
    }
    if (order.status !== 'DRAFT') {
      return NextResponse.json({ error: 'الأمر مُرحّل مسبقاً' }, { status: 409 })
    }

    const adjustments = order.lines.filter((ln) => ln.difference !== 0)

    const purchaseMap = await computePurchaseInfo()
    const unitCostOf = (itemId: string, fallback: number) =>
      purchaseCostOf(purchaseMap.get(itemId), fallback)

    // بيانات قيد التسوية: سطر لكل مادة بفرق (الفرق × التكلفة الفعلية)
    const varianceLines = adjustments.map((ln) => ({
      itemId: ln.itemId,
      itemName: ln.item.name,
      difference: ln.difference,
      unitCost: unitCostOf(ln.itemId, ln.item.avgCost),
    }))
    const varianceValue = round2(
      varianceLines.reduce((s, ln) => s + ln.difference * ln.unitCost, 0),
    )
    const increasesCount = adjustments.filter((a) => a.difference > 0).length
    const decreasesCount = adjustments.filter((a) => a.difference < 0).length

    let journalNumber: string | null = null
    await db.$transaction(async (tx) => {
      for (const ln of adjustments) {
        // تعيين الرصيد للكمية المجرودة فعلياً
        await setBalance(tx, ln.itemId, order.warehouseId, ln.countedQty)
        // حركة تسوية مرتبطة بالأمر
        await tx.stockMovement.create({
          data: {
            date: order.date,
            type: ln.difference > 0 ? 'IN' : 'OUT',
            itemId: ln.itemId,
            warehouseId: order.warehouseId,
            quantity: Math.abs(ln.difference),
            unitCost: unitCostOf(ln.itemId, ln.item.avgCost),
            reason: `تسوية جرد ${order.number} (${ln.difference > 0 ? 'زيادة' : 'نقص'})`,
            refType: 'STOCKTAKING',
            refId: order.id,
          },
        })
      }
      await tx.stocktaking.update({ where: { id }, data: { status: 'POSTED' } })

      // قيد التسوية المحاسبي (P0-3): عجز = مدين مصروف فروق الجرد / دائن المخزون —
      // زيادة بالعكس — ولا قيد إطلاقاً إن لم توجد فروقات
      const entry = await postStocktakingJournal(tx, {
        orderId: order.id,
        number: order.number,
        date: order.date,
        lines: varianceLines,
      })

      // التوثيق داخل المعاملة نفسها (قاعدة المشروع)
      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'STOCKTAKING',
        entityId: order.id,
        entityNumber: order.number,
        title: `ترحيل أمر الجرد ${order.number}`,
        summary:
          adjustments.length === 0
            ? `ترحيل أمر الجرد ${order.number} — لا فروقات (المجرود مطابق للدفترية) — بلا قيد محاسبي`
            : `ترحيل أمر الجرد ${order.number} — ${adjustments.length} مادة بفروقات (زيادة ${increasesCount} / عجز ${decreasesCount}) بقيمة صافية ${auditMoney(varianceValue)} ل.س — القيد: ${entry?.number ?? 'بلا قيد'}`,
        amount: adjustments.length === 0 ? null : Math.abs(varianceValue),
        details:
          adjustments.length === 0
            ? null
            : {
                'عدد المواد بفروقات': String(adjustments.length),
                'الزيادات': String(increasesCount),
                'العجزات': String(decreasesCount),
                'صافي قيمة الفروقات': `${auditMoney(varianceValue)} ل.س`,
                'رقم القيد المحاسبي': entry?.number ?? 'بلا قيد',
                'التكلفة المعتمدة': 'المتوسط المرجح المحفوظ ← الوسطي المحسوب ← آخر سعر شراء',
              },
      })

      return entry
    }).then((entry) => {
      journalNumber = entry?.number ?? null
    })

    return NextResponse.json({
      posted: true,
      adjustments: adjustments.length,
      increases: increasesCount,
      decreases: decreasesCount,
      journalEntryNumber: journalNumber,
    })
  } catch (error) {
    if (error instanceof StockError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof PeriodClosedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('Stocktaking [id] POST error:', error)
    return NextResponse.json({ error: 'فشل ترحيل أمر الجرد' }, { status: 500 })
  }
}

// ==================== DELETE: حذف مسودة فقط ====================
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const order = await db.stocktaking.findUnique({ where: { id }, select: { status: true, number: true } })
    if (!order) {
      return NextResponse.json({ error: 'أمر الجرد غير موجود' }, { status: 404 })
    }
    if (order.status !== 'DRAFT') {
      return NextResponse.json(
        { error: 'الأمر مُرحّل — لا يمكن حذفه لأنه أنتج حركات تسوية فعلية بالأرصدة' },
        { status: 409 },
      )
    }
    await db.stocktaking.delete({ where: { id } }) // الأسطر تُحذف تتابعياً
    return NextResponse.json({ deleted: true, number: order.number })
  } catch (error) {
    console.error('Stocktaking [id] DELETE error:', error)
    return NextResponse.json({ error: 'فشل حذف أمر الجرد' }, { status: 500 })
  }
}
