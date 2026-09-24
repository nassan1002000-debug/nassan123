import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { AR_LEAVE_TYPE, fmtDate, fmtDateTime } from '@/lib/format'
import {
  bodyString,
  bodyStringOrNull,
  daysInclusive,
  employeeBrief,
  isValidYMD,
  LEAVE_TYPES,
  ymdStart,
  type LeaveRow,
  type LeaveType,
} from '@/lib/hr-server'

// GET /api/leaves?status=ALL|PENDING|APPROVED|REJECTED&q= — قائمة الإجازات + مؤشرات عامة (تتجاهل الفلاتر)
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const status = sp.get('status') ?? 'ALL'
    const q = (sp.get('q') ?? '').trim()

    const where: Prisma.LeaveWhereInput = {}
    if (['PENDING', 'APPROVED', 'REJECTED'].includes(status)) where.status = status
    if (q) {
      where.employee = {
        OR: [{ name: { contains: q } }, { code: { contains: q } }],
      }
    }

    const [leaves, countAll, pending, approvedDaysAgg, rejected] = await Promise.all([
      db.leave.findMany({
        where,
        orderBy: [{ from: 'desc' }, { createdAt: 'desc' }],
        include: { employee: { select: { id: true, code: true, name: true } } },
      }),
      db.leave.count(),
      db.leave.count({ where: { status: 'PENDING' } }),
      db.leave.aggregate({ where: { status: 'APPROVED' }, _sum: { days: true } }),
      db.leave.count({ where: { status: 'REJECTED' } }),
    ])

    const rows: LeaveRow[] = leaves.map((l) => ({
      id: l.id,
      type: l.type,
      from: l.from.toISOString(),
      to: l.to.toISOString(),
      days: l.days,
      reason: l.reason,
      status: l.status,
      employee: l.employee,
    }))

    const stats = {
      count: countAll,
      pending,
      approvedDays: approvedDaysAgg._sum.days ?? 0,
      rejected,
    }

    return NextResponse.json({ leaves: rows, stats })
  } catch (error) {
    console.error('GET /api/leaves error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب الإجازات' }, { status: 500 })
  }
}

// POST /api/leaves — تسجيل طلب إجازة (PENDING) مع حساب الأيام شامل الطرفين
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

    const typeRaw = bodyString(body, 'type')
    if (!(LEAVE_TYPES as readonly string[]).includes(typeRaw)) {
      return NextResponse.json({ error: 'نوع الإجازة غير صالح' }, { status: 400 })
    }
    const type = typeRaw as LeaveType

    const fromStr = bodyString(body, 'from')
    const toStr = bodyString(body, 'to')
    if (!fromStr || !isValidYMD(fromStr)) {
      return NextResponse.json({ error: 'تاريخ البداية مطلوب بصيغة YYYY-MM-DD' }, { status: 400 })
    }
    if (!toStr || !isValidYMD(toStr)) {
      return NextResponse.json({ error: 'تاريخ النهاية مطلوب بصيغة YYYY-MM-DD' }, { status: 400 })
    }
    if (ymdStart(toStr).getTime() < ymdStart(fromStr).getTime()) {
      return NextResponse.json(
        { error: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو مساوياً له' },
        { status: 400 },
      )
    }

    // الأيام شاملة الطرفين — تُحسب من قيم YMD لا من ISO كاملة
    const days = daysInclusive(fromStr, toStr)

    const createdId = await db.$transaction(async (tx) => {
      const l = await tx.leave.create({
        data: {
          employeeId,
          type,
          from: ymdStart(fromStr),
          to: ymdStart(toStr),
          days,
          reason: bodyStringOrNull(body, 'reason'),
          status: 'PENDING',
        },
      })
      await logAudit(tx, {
        action: 'CREATE',
        entity: 'LEAVE',
        entityId: l.id,
        entityNumber: employee.code,
        title: `إجازة ${AR_LEAVE_TYPE[type]} — ${employee.name}`,
        summary: `تسجيل إجازة ${AR_LEAVE_TYPE[type]} للموظف ${employee.name} (${employee.code}) — من ${fmtDate(l.from)} إلى ${fmtDate(l.to)} — ${days} يوم — بانتظار الموافقة`,
        details: {
          'الموظف': `${employee.name} (${employee.code})`,
          'النوع': AR_LEAVE_TYPE[type],
          'من': fmtDate(l.from),
          'إلى': fmtDate(l.to),
          'عدد الأيام': String(days),
          'السبب': l.reason ?? '—',
          'الحالة': 'قيد الانتظار',
          'وقت التسجيل': fmtDateTime(new Date()),
        },
      })
      return l.id
    })

    const created = await db.leave.findUnique({
      where: { id: createdId },
      include: { employee: { select: { id: true, code: true, name: true } } },
    })

    return NextResponse.json({
      ok: true,
      leave: created
        ? {
            id: created.id,
            type: created.type,
            from: created.from.toISOString(),
            to: created.to.toISOString(),
            days: created.days,
            reason: created.reason,
            status: created.status,
            employee: created.employee,
          }
        : null,
      message: `تم تسجيل إجازة للموظف ${employee.name}`,
    })
  } catch (error) {
    console.error('POST /api/leaves error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء تسجيل الإجازة' }, { status: 500 })
  }
}
