import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { AR_LEAVE_TYPE, fmtDate, fmtDateTime } from '@/lib/format'

type Params = { params: Promise<{ id: string }> }

// DELETE /api/leaves/[id] — حذف طلب إجازة لم يُفصل فيه بعد (PENDING فقط)
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const leave = await db.leave.findUnique({
      where: { id },
      include: { employee: { select: { id: true, code: true, name: true } } },
    })
    if (!leave) {
      return NextResponse.json({ error: 'طلب الإجازة غير موجود' }, { status: 404 })
    }
    if (leave.status !== 'PENDING') {
      return NextResponse.json({ error: 'لا يمكن حذف إجازة تم الفصل فيها مسبقاً' }, { status: 409 })
    }

    await db.$transaction(async (tx) => {
      await tx.leave.delete({ where: { id } })
      await logAudit(tx, {
        action: 'DELETE',
        entity: 'LEAVE',
        entityId: id,
        entityNumber: leave.employee.code,
        title: `إجازة ${AR_LEAVE_TYPE[leave.type] ?? leave.type} — ${leave.employee.name}`,
        summary: `حذف طلب إجازة ${AR_LEAVE_TYPE[leave.type] ?? leave.type} للموظف ${leave.employee.name} (${leave.employee.code}) — من ${fmtDate(leave.from)} إلى ${fmtDate(leave.to)} — ${leave.days} يوم — كان قيد الانتظار`,
        details: {
          'الموظف': `${leave.employee.name} (${leave.employee.code})`,
          'النوع': AR_LEAVE_TYPE[leave.type] ?? leave.type,
          'من': fmtDate(leave.from),
          'إلى': fmtDate(leave.to),
          'عدد الأيام': String(leave.days),
          'السبب': leave.reason ?? '—',
          'الحالة قبل الحذف': 'قيد الانتظار',
          'وقت الحذف': fmtDateTime(new Date()),
        },
      })
    })

    return NextResponse.json({ ok: true, message: 'تم حذف طلب الإجازة' })
  } catch (error) {
    console.error('DELETE /api/leaves/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حذف الإجازة' }, { status: 500 })
  }
}
