import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { fmtDate, fmtDateTime, fmtQty } from '@/lib/format'

type Params = { params: Promise<{ id: string }> }

// DELETE /api/bonuses/[id] — حذف سجل مكافأة/حسم
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const record = await db.bonusDeduction.findUnique({
      where: { id },
      include: { employee: { select: { id: true, code: true, name: true } } },
    })
    if (!record) {
      return NextResponse.json({ error: 'السجل غير موجود' }, { status: 404 })
    }

    const typeLabel = record.type === 'BONUS' ? 'مكافأة' : 'حسم'

    await db.$transaction(async (tx) => {
      await tx.bonusDeduction.delete({ where: { id } })
      await logAudit(tx, {
        action: 'DELETE',
        entity: 'BONUS',
        entityId: id,
        entityNumber: record.employee.code,
        title: `${typeLabel} — ${record.employee.name}`,
        summary: `حذف ${typeLabel} للموظف ${record.employee.name} (${record.employee.code}) — مبلغ ${fmtQty(record.amount)} ل.س بتاريخ ${fmtDate(record.date)}`,
        details: {
          'الموظف': `${record.employee.name} (${record.employee.code})`,
          'النوع': typeLabel,
          'المبلغ': fmtQty(record.amount),
          'التاريخ': fmtDate(record.date),
          'السبب': record.reason ?? '—',
          'وقت الحذف': fmtDateTime(new Date()),
        },
        amount: record.amount,
      })
    })

    return NextResponse.json({ ok: true, message: `تم حذف ${typeLabel}` })
  } catch (error) {
    console.error('DELETE /api/bonuses/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حذف السجل' }, { status: 500 })
  }
}
