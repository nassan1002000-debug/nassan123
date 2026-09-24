import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { StockError, applyBalanceDelta } from '@/lib/stock-server'
import { cancelDamageJournal } from '@/lib/stock-journal'
import { assertPeriodOpen, PeriodClosedError } from '@/lib/period-server'
import { logAudit, auditMoney } from '@/lib/audit-server'
import { fmtDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

// ==================== DELETE: حذف حالة تلف مع استرداد الكمية للرصيد ====================
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const record = await db.stockMovement.findFirst({
      where: { id, refType: 'DAMAGE' },
      include: { item: { select: { name: true } }, warehouse: { select: { name: true } } },
    })
    if (!record) {
      return NextResponse.json({ error: 'حالة التلف غير موجودة' }, { status: 404 })
    }

    // إنفاذ الفترات المقفلة: حذف حالة تلف مؤرّخة داخل فترة مقفلة يُعيد كمية ويُلغي
    // قيداً — تعديل فعلي على أرصدة ودفاتر فترة مفترض أنها لا تتغير أبداً بعد الإقفال
    // (نفس حرس DELETE /api/invoices/[id] — كان غائباً هنا كلياً)
    await assertPeriodOpen(db, record.date, 'حذف حالة تلف')

    await db.$transaction(async (tx) => {
      // استرداد الكمية المُتلفة إلى رصيد القسم
      await applyBalanceDelta(tx, record.itemId, record.warehouseId, record.quantity)

      // عكس قيد التلف المرتبط (إن وُجد — الحركة بقيمة صفرية بلا قيد أصلاً) قبل
      // حذف الحركة نفسها؛ كانت الحركة تُحذف هنا بلا لمس قيدها فيبقى مرحّلاً
      // للأبد بمصروف وهمي بعد أن عاد المخزون فعلياً — عدم اتساق دائم بين
      // الدفاتر والمخزون (القسم 0 البند 5: معاملة ذرّية واحدة لكل مستند)
      const cancelledEntryNumber = await cancelDamageJournal(tx, record.id)

      await tx.stockMovement.delete({ where: { id: record.id } })

      await logAudit(tx, {
        action: 'DELETE',
        entity: 'DAMAGE',
        entityId: record.id,
        entityNumber: cancelledEntryNumber,
        title: `حذف تلف مخزون — ${record.item.name}`,
        summary:
          `حذف حالة تلف «${record.item.name}» كمية ${auditMoney(record.quantity)} من ${record.warehouse.name} ` +
          `— أُعيدت الكمية للرصيد — ${cancelledEntryNumber ? `أُلغي القيد ${cancelledEntryNumber} المرتبط` : 'لا قيد مرتبط (قيمة صفرية)'}`,
        details: {
          'المادة': record.item.name,
          'الكمية المُستردة': auditMoney(record.quantity),
          'المستودع': record.warehouse.name,
          'تكلفة الوحدة (ل.س)': auditMoney(record.unitCost),
          'القيد المحاسبي': cancelledEntryNumber
            ? `أُلغي القيد ${cancelledEntryNumber} (POSTED ← CANCELLED)`
            : 'لا قيد مرتبط',
          'وقت الحذف': fmtDateTime(new Date()),
        },
        amount: record.quantity * record.unitCost,
      })
    })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    if (error instanceof StockError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof PeriodClosedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('StockDamage DELETE error:', error)
    return NextResponse.json({ error: 'فشل حذف حالة التلف' }, { status: 500 })
  }
}
