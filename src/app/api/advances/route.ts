import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { fmtDate, fmtDateTime, fmtQty, todayYMD } from '@/lib/format'
import { round2 } from '@/lib/journal-server'
import { bodyNumber, bodyString, bodyStringOrNull, employeeBrief, isValidYMD, ymdStart, type AdvanceRow } from '@/lib/hr-server'

// GET /api/advances?status=ALL|UNPAID|PAID&q= — قائمة السلف + مؤشرات عامة (تتجاهل الفلاتر)
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const status = sp.get('status') ?? 'ALL'
    const q = (sp.get('q') ?? '').trim()

    const where: Prisma.AdvanceWhereInput = {}
    if (status === 'UNPAID' || status === 'PAID') where.status = status
    if (q) {
      where.employee = {
        OR: [{ name: { contains: q } }, { code: { contains: q } }],
      }
    }

    const [advances, countAll, unpaidCount, unpaidAgg, paidAgg] = await Promise.all([
      db.advance.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: { employee: { select: { id: true, code: true, name: true } } },
      }),
      db.advance.count(),
      db.advance.count({ where: { status: 'UNPAID' } }),
      db.advance.aggregate({ where: { status: 'UNPAID' }, _sum: { amount: true } }),
      db.advance.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }),
    ])

    const rows: AdvanceRow[] = advances.map((a) => ({
      id: a.id,
      date: a.date.toISOString(),
      amount: a.amount,
      reason: a.reason,
      status: a.status,
      employee: a.employee,
    }))

    const stats = {
      count: countAll,
      unpaidCount,
      unpaidTotal: round2(unpaidAgg._sum.amount ?? 0),
      paidTotal: round2(paidAgg._sum.amount ?? 0),
    }

    return NextResponse.json({ advances: rows, stats })
  } catch (error) {
    console.error('GET /api/advances error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب السلف' }, { status: 500 })
  }
}

// POST /api/advances — تسجيل سلفة لموظف (status UNPAID حتى صرفها من [id]/pay)
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

    const amountRaw = bodyNumber(body, 'amount')
    if (amountRaw === null || amountRaw <= 0) {
      return NextResponse.json({ error: 'المبلغ يجب أن يكون رقماً أكبر من صفر' }, { status: 400 })
    }
    const amount = round2(amountRaw)

    const dateStr = bodyString(body, 'date') || todayYMD()
    if (!isValidYMD(dateStr)) {
      return NextResponse.json({ error: 'تاريخ السلفة غير صالح (YYYY-MM-DD)' }, { status: 400 })
    }

    const createdId = await db.$transaction(async (tx) => {
      const a = await tx.advance.create({
        data: {
          employeeId,
          date: ymdStart(dateStr),
          amount,
          reason: bodyStringOrNull(body, 'reason'),
          status: 'UNPAID',
        },
      })
      await logAudit(tx, {
        action: 'CREATE',
        entity: 'ADVANCE',
        entityId: a.id,
        entityNumber: employee.code,
        title: `سلفة — ${employee.name}`,
        summary: `إضافة سلفة للموظف ${employee.name} (${employee.code}) — مبلغ ${fmtQty(amount)} ل.س بتاريخ ${fmtDate(a.date)} — الحالة: غير مصروفة`,
        details: {
          'الموظف': `${employee.name} (${employee.code})`,
          'المبلغ': fmtQty(amount),
          'التاريخ': fmtDate(a.date),
          'السبب': a.reason ?? '—',
          'الحالة': 'غير مصروفة',
          'وقت الإضافة': fmtDateTime(new Date()),
        },
        amount,
      })
      return a.id
    })

    const created = await db.advance.findUnique({
      where: { id: createdId },
      include: { employee: { select: { id: true, code: true, name: true } } },
    })

    return NextResponse.json({
      ok: true,
      advance: created
        ? {
            id: created.id,
            date: created.date.toISOString(),
            amount: created.amount,
            reason: created.reason,
            status: created.status,
            employee: created.employee,
          }
        : null,
      message: `تمت إضافة سلفة للموظف ${employee.name}`,
    })
  } catch (error) {
    console.error('POST /api/advances error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء إضافة السلفة' }, { status: 500 })
  }
}
