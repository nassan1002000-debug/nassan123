import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { fmtDate, fmtDateTime, fmtQty } from '@/lib/format'

type Params = { params: Promise<{ id: string }> }

// DELETE /api/advances/[id] — حذف سلفة غير مصروفة فقط (المصروفة/المسددة محصّنة)
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const advance = await db.advance.findUnique({
      where: { id },
      include: { employee: { select: { id: true, code: true, name: true } } },
    })
    if (!advance) {
      return NextResponse.json({ error: 'السلفة غير موجودة' }, { status: 404 })
    }
    if (advance.status !== 'UNPAID') {
      return NextResponse.json({ error: 'لا يمكن حذف سلفة مصروفة أو مسددة مسبقاً' }, { status: 409 })
    }

    await db.$transaction(async (tx) => {
      await tx.advance.delete({ where: { id } })
      await logAudit(tx, {
        action: 'DELETE',
        entity: 'ADVANCE',
        entityId: id,
        entityNumber: advance.employee.code,
        title: `سلفة — ${advance.employee.name}`,
        summary: `حذف سلفة الموظف ${advance.employee.name} (${advance.employee.code}) — مبلغ ${fmtQty(advance.amount)} ل.س بتاريخ ${fmtDate(advance.date)} — كانت غير مصروفة`,
        details: {
          'الموظف': `${advance.employee.name} (${advance.employee.code})`,
          'المبلغ': fmtQty(advance.amount),
          'التاريخ': fmtDate(advance.date),
          'السبب': advance.reason ?? '—',
          'الحالة قبل الحذف': 'غير مصروفة',
          'وقت الحذف': fmtDateTime(new Date()),
        },
        amount: advance.amount,
      })
    })

    return NextResponse.json({ ok: true, message: 'تم حذف السلفة' })
  } catch (error) {
    console.error('DELETE /api/advances/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حذف السلفة' }, { status: 500 })
  }
}
