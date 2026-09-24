import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { fmtDate, fmtDateTime, fmtQty, todayYMD } from '@/lib/format'
import { round2 } from '@/lib/journal-server'
import {
  BONUS_TYPES,
  bodyNumber,
  bodyString,
  bodyStringOrNull,
  employeeBrief,
  isValidMonth,
  isValidYMD,
  monthEndExclusive,
  monthStart,
  ymdStart,
  type BonusRow,
  type BonusType,
} from '@/lib/hr-server'

// GET /api/bonuses?type=ALL|BONUS|DEDUCTION&q=&month=YYYY-MM — حركات المكافآت والحسم + مؤشرات الشهر إن حُدد
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const type = sp.get('type') ?? 'ALL'
    const q = (sp.get('q') ?? '').trim()
    const month = sp.get('month') ?? ''
    if (month && !isValidMonth(month)) {
      return NextResponse.json({ error: 'صيغة الشهر غير صالحة (YYYY-MM)' }, { status: 400 })
    }

    // مدى الشهر اختياري — يفلتر القائمة ويحد نطاق المؤشرات
    const monthRange = month ? { date: { gte: monthStart(month), lt: monthEndExclusive(month) } } : {}

    const where: Prisma.BonusDeductionWhereInput = {
      ...monthRange,
    }
    if (type === 'BONUS' || type === 'DEDUCTION') where.type = type
    if (q) {
      where.employee = {
        OR: [{ name: { contains: q } }, { code: { contains: q } }],
      }
    }

    const [records, bonusAgg, dedAgg, countAll] = await Promise.all([
      db.bonusDeduction.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: { employee: { select: { id: true, code: true, name: true } } },
      }),
      db.bonusDeduction.aggregate({ where: { ...monthRange, type: 'BONUS' }, _sum: { amount: true } }),
      db.bonusDeduction.aggregate({ where: { ...monthRange, type: 'DEDUCTION' }, _sum: { amount: true } }),
      db.bonusDeduction.count({ where: monthRange }),
    ])

    const rows: BonusRow[] = records.map((r) => ({
      id: r.id,
      type: r.type,
      date: r.date.toISOString(),
      amount: r.amount,
      reason: r.reason,
      employee: r.employee,
    }))

    const stats = {
      bonusTotal: round2(bonusAgg._sum.amount ?? 0),
      deductionTotal: round2(dedAgg._sum.amount ?? 0),
      count: countAll,
    }

    return NextResponse.json({ records: rows, stats })
  } catch (error) {
    console.error('GET /api/bonuses error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب سجلات المكافآت والحسم' }, { status: 500 })
  }
}

// POST /api/bonuses — تسجيل مكافأة أو حسم لموظف (يدخلان في توليد رواتب شهر تاريخهما)
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
    if (!(BONUS_TYPES as readonly string[]).includes(typeRaw)) {
      return NextResponse.json({ error: 'نوع السجل يجب أن يكون مكافأة (BONUS) أو حسم (DEDUCTION)' }, { status: 400 })
    }
    const type = typeRaw as BonusType

    const amountRaw = bodyNumber(body, 'amount')
    if (amountRaw === null || amountRaw <= 0) {
      return NextResponse.json({ error: 'المبلغ يجب أن يكون رقماً أكبر من صفر' }, { status: 400 })
    }
    const amount = round2(amountRaw)

    const dateStr = bodyString(body, 'date') || todayYMD()
    if (!isValidYMD(dateStr)) {
      return NextResponse.json({ error: 'تاريخ السجل غير صالح (YYYY-MM-DD)' }, { status: 400 })
    }

    const typeLabel = type === 'BONUS' ? 'مكافأة' : 'حسم'

    const createdId = await db.$transaction(async (tx) => {
      const r = await tx.bonusDeduction.create({
        data: {
          employeeId,
          type,
          date: ymdStart(dateStr),
          amount,
          reason: bodyStringOrNull(body, 'reason'),
        },
      })
      await logAudit(tx, {
        action: 'CREATE',
        entity: 'BONUS',
        entityId: r.id,
        entityNumber: employee.code,
        title: `${typeLabel} — ${employee.name}`,
        summary: `إضافة ${typeLabel} للموظف ${employee.name} (${employee.code}) — مبلغ ${fmtQty(amount)} ل.س بتاريخ ${fmtDate(r.date)}`,
        details: {
          'الموظف': `${employee.name} (${employee.code})`,
          'النوع': typeLabel,
          'المبلغ': fmtQty(amount),
          'التاريخ': fmtDate(r.date),
          'السبب': r.reason ?? '—',
          'وقت الإضافة': fmtDateTime(new Date()),
        },
        amount,
      })
      return r.id
    })

    const created = await db.bonusDeduction.findUnique({
      where: { id: createdId },
      include: { employee: { select: { id: true, code: true, name: true } } },
    })

    return NextResponse.json({
      ok: true,
      record: created
        ? {
            id: created.id,
            type: created.type,
            date: created.date.toISOString(),
            amount: created.amount,
            reason: created.reason,
            employee: created.employee,
          }
        : null,
      message: `تمت إضافة ${typeLabel} للموظف ${employee.name}`,
    })
  } catch (error) {
    console.error('POST /api/bonuses error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء إضافة السجل' }, { status: 500 })
  }
}
