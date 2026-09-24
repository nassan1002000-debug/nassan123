import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { AR_LEAVE_TYPE, fmtDate, fmtDateTime } from '@/lib/format'
import { bodyString, HrHttpError } from '@/lib/hr-server'

type Params = { params: Promise<{ id: string }> }

// POST /api/leaves/[id]/decision — قبول أو رفض طلب إجازة قيد الانتظار (الفصل مرة واحدة)
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'بيانات الطلب غير صالحة' }, { status: 400 })

    const decisionRaw = bodyString(body, 'status')
    if (decisionRaw !== 'APPROVED' && decisionRaw !== 'REJECTED') {
      return NextResponse.json({ error: 'القرار يجب أن يكون قبول (APPROVED) أو رفض (REJECTED)' }, { status: 400 })
    }
    const approved = decisionRaw === 'APPROVED'

    const leave = await db.leave.findUnique({
      where: { id },
      include: { employee: { select: { id: true, code: true, name: true } } },
    })
    if (!leave) {
      return NextResponse.json({ error: 'طلب الإجازة غير موجود' }, { status: 404 })
    }
    if (leave.status !== 'PENDING') {
      return NextResponse.json({ error: 'تم الفصل في الطلب مسبقاً' }, { status: 409 })
    }

    const now = new Date()
    const statusLabel = approved ? 'مقبولة' : 'مرفوضة'

    await db.$transaction(async (tx) => {
      // حرس الحالة داخل المعاملة — يمنع الفصل المزدوج في سباق نادر
      const upd = await tx.leave.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: approved ? 'APPROVED' : 'REJECTED' },
      })
      if (upd.count === 0) throw new HrHttpError('تم الفصل في الطلب مسبقاً', 409)

      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'LEAVE',
        entityId: id,
        entityNumber: leave.employee.code,
        title: `إجازة ${AR_LEAVE_TYPE[leave.type] ?? leave.type} — ${leave.employee.name}`,
        summary: `الفصل في طلب إجازة ${AR_LEAVE_TYPE[leave.type] ?? leave.type} — ${leave.employee.name} (${leave.employee.code}) — القرار: ${statusLabel}`,
        details: {
          'الموظف': `${leave.employee.name} (${leave.employee.code})`,
          'النوع': AR_LEAVE_TYPE[leave.type] ?? leave.type,
          'من': fmtDate(leave.from),
          'إلى': fmtDate(leave.to),
          'عدد الأيام': String(leave.days),
          'القرار': statusLabel,
          'وقت القرار': fmtDateTime(now),
        },
      })
    })

    return NextResponse.json({
      ok: true,
      message: approved ? `تم قبول إجازة ${leave.employee.name}` : `تم رفض إجازة ${leave.employee.name}`,
    })
  } catch (error) {
    if (error instanceof HrHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('POST /api/leaves/[id]/decision error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء تسجيل قرار الإجازة' }, { status: 500 })
  }
}
