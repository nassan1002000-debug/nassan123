import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { AR_ATTENDANCE_STATUS, fmtDate, fmtDateTime } from '@/lib/format'

type Params = { params: Promise<{ id: string }> }

// DELETE /api/attendance/[id] — حذف سجل دوام
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const record = await db.attendance.findUnique({
      where: { id },
      include: { employee: { select: { id: true, code: true, name: true } } },
    })
    if (!record) {
      return NextResponse.json({ error: 'سجل الدوام غير موجود' }, { status: 404 })
    }

    const dateStr = fmtDate(record.date)

    await db.$transaction(async (tx) => {
      await tx.attendance.delete({ where: { id } })
      await logAudit(tx, {
        action: 'DELETE',
        entity: 'ATTENDANCE',
        entityId: id,
        entityNumber: record.employee.code,
        title: `دوام ${record.employee.name} — ${dateStr}`,
        summary: `حذف سجل دوام ${record.employee.name} (${record.employee.code}) ليوم ${dateStr} — كانت الحالة: ${AR_ATTENDANCE_STATUS[record.status] ?? record.status}`,
        details: {
          'الموظف': `${record.employee.name} (${record.employee.code})`,
          'التاريخ': dateStr,
          'الحالة قبل الحذف': AR_ATTENDANCE_STATUS[record.status] ?? record.status,
          'وقت الحضور': record.checkIn ?? '—',
          'وقت الانصراف': record.checkOut ?? '—',
          'وقت الحذف': fmtDateTime(new Date()),
        },
      })
    })

    return NextResponse.json({ ok: true, message: 'تم حذف سجل الدوام' })
  } catch (error) {
    console.error('DELETE /api/attendance/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حذف سجل الدوام' }, { status: 500 })
  }
}
