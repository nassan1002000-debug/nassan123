import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { AR_ATTENDANCE_STATUS, fmtDateTime, todayYMD } from '@/lib/format'
import {
  ATTENDANCE_STATUSES,
  bodyString,
  employeeBrief,
  isValidHHMM,
  isValidYMD,
  ymdRange,
  ymdStart,
  type AttendanceRow,
  type AttendanceStatus,
} from '@/lib/hr-server'

// GET /api/attendance?date=YYYY-MM-DD — سجل دوام يوم واحد (افتراضياً اليوم بتوقيت الخادم) مرتب بكود الموظف
export async function GET(req: NextRequest) {
  try {
    const dateStr = req.nextUrl.searchParams.get('date') || todayYMD()
    if (!isValidYMD(dateStr)) {
      return NextResponse.json({ error: 'صيغة التاريخ غير صالحة (YYYY-MM-DD)' }, { status: 400 })
    }

    // مدى اليوم كاملاً — البذرة تحفظ تواريخ الدوام بتوقيت 10:00 لا منتصف الليل
    const records = await db.attendance.findMany({
      where: { date: ymdRange(dateStr) },
      orderBy: { employee: { code: 'asc' } },
      include: { employee: { select: { id: true, code: true, name: true, position: true } } },
    })

    const rows: AttendanceRow[] = records.map((r) => ({
      id: r.id,
      date: r.date.toISOString(),
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      status: r.status,
      employee: r.employee,
    }))

    const stats = {
      present: rows.filter((r) => r.status === 'PRESENT').length,
      absent: rows.filter((r) => r.status === 'ABSENT').length,
      late: rows.filter((r) => r.status === 'LATE').length,
      leave: rows.filter((r) => r.status === 'LEAVE').length,
      total: rows.length,
    }

    return NextResponse.json({ attendance: rows, stats })
  } catch (error) {
    console.error('GET /api/attendance error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب سجل الدوام' }, { status: 500 })
  }
}

// POST /api/attendance — تسجيل/تحديث دوام موظف ليوم واحد (upsert على الفريد [employeeId, date])
// جسم الطلب يمثل السجل كاملاً: الحالة + وقتا الحضور والانصراف (الفراغان يعنيان بلا وقت)
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'بيانات الطلب غير صالحة' }, { status: 400 })

    const employeeId = bodyString(body, 'employeeId')
    if (!employeeId) return NextResponse.json({ error: 'الموظف مطلوب' }, { status: 400 })
    const employee = await employeeBrief(employeeId)
    if (!employee) {
      return NextResponse.json({ error: 'ملف الموظف غير موجود' }, { status: 404 })
    }

    const dateStr = bodyString(body, 'date')
    if (!dateStr || !isValidYMD(dateStr)) {
      return NextResponse.json({ error: 'التاريخ مطلوب بصيغة YYYY-MM-DD' }, { status: 400 })
    }

    const statusRaw = bodyString(body, 'status')
    if (!(ATTENDANCE_STATUSES as readonly string[]).includes(statusRaw)) {
      return NextResponse.json({ error: 'حالة الدوام غير صالحة' }, { status: 400 })
    }
    const status = statusRaw as AttendanceStatus

    // الأوقات اختيارية بصيغة HH:MM (00:00–23:59) — السلسلة الفارغة تعني بلا وقت
    const checkInRaw = bodyString(body, 'checkIn')
    if (checkInRaw && !isValidHHMM(checkInRaw)) {
      return NextResponse.json({ error: 'وقت الحضور غير صالح (HH:MM)' }, { status: 400 })
    }
    const checkOutRaw = bodyString(body, 'checkOut')
    if (checkOutRaw && !isValidHHMM(checkOutRaw)) {
      return NextResponse.json({ error: 'وقت الانصراف غير صالح (HH:MM)' }, { status: 400 })
    }
    const checkIn = checkInRaw || null
    const checkOut = checkOutRaw || null

    // البحث بمدى اليوم كاملاً (لا بمطابقة منتصف الليل) — البذرة تحفظ الدوام بتوقيت 10:00
    const existing = await db.attendance.findFirst({
      where: { employeeId, date: ymdRange(dateStr) },
    })

    const created = !existing

    await db.$transaction(async (tx) => {
      if (existing) {
        await tx.attendance.update({
          where: { id: existing.id },
          data: { status, checkIn, checkOut },
        })
        const changes: string[] = []
        if (existing.status !== status)
          changes.push(
            `الحالة: ${AR_ATTENDANCE_STATUS[existing.status] ?? existing.status} ← ${AR_ATTENDANCE_STATUS[status]}`,
          )
        if ((existing.checkIn ?? null) !== checkIn)
          changes.push(`الحضور: ${existing.checkIn ?? '—'} ← ${checkIn ?? '—'}`)
        if ((existing.checkOut ?? null) !== checkOut)
          changes.push(`الانصراف: ${existing.checkOut ?? '—'} ← ${checkOut ?? '—'}`)
        await logAudit(tx, {
          action: 'UPDATE',
          entity: 'ATTENDANCE',
          entityId: existing.id,
          entityNumber: employee.code,
          title: `دوام ${employee.name} — ${dateStr}`,
          summary: `تحديث سجل دوام ${employee.name} (${employee.code}) ليوم ${dateStr} — ${changes.length > 0 ? changes.join('؛ ') : 'تعديل دون تغيير قيم دالة'}`,
          details: {
            'الموظف': `${employee.name} (${employee.code})`,
            'التاريخ': dateStr,
            'الحالة': AR_ATTENDANCE_STATUS[status],
            'وقت الحضور': checkIn ?? '—',
            'وقت الانصراف': checkOut ?? '—',
            'التغييرات': changes.length > 0 ? changes.join('؛ ') : 'لا تغييرات دالة',
            'وقت التعديل': fmtDateTime(new Date()),
          },
        })
      } else {
        const rec = await tx.attendance.create({
          data: {
            employeeId,
            date: ymdStart(dateStr),
            status,
            checkIn,
            checkOut,
          },
        })
        await logAudit(tx, {
          action: 'CREATE',
          entity: 'ATTENDANCE',
          entityId: rec.id,
          entityNumber: employee.code,
          title: `دوام ${employee.name} — ${dateStr}`,
          summary: `تسجيل دوام ${employee.name} (${employee.code}) ليوم ${dateStr} — الحالة: ${AR_ATTENDANCE_STATUS[status]}${checkIn ? ` — حضور ${checkIn}` : ''}${checkOut ? ` — انصراف ${checkOut}` : ''}`,
          details: {
            'الموظف': `${employee.name} (${employee.code})`,
            'التاريخ': dateStr,
            'الحالة': AR_ATTENDANCE_STATUS[status],
            'وقت الحضور': checkIn ?? '—',
            'وقت الانصراف': checkOut ?? '—',
            'وقت التسجيل': fmtDateTime(new Date()),
          },
        })
      }
    })

    return NextResponse.json({
      ok: true,
      created,
      message: created ? 'تم تسجيل الدوام' : 'تم تحديث سجل الدوام',
    })
  } catch (error) {
    console.error('POST /api/attendance error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء تسجيل الدوام' }, { status: 500 })
  }
}
