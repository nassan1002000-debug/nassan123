import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { fmtDateTime, fmtQty } from '@/lib/format'
import { round2 } from '@/lib/journal-server'
import { bodyString, isValidMonth, monthEndExclusive, monthStart } from '@/lib/hr-server'

// POST /api/salaries/generate — توليد أقساط شهر لموظفي النشطين بلا قسط له
// القاعدة لا تحمل قيد تفرّد [employeeId, month] — لذا تُفحص الأقساط القائمة تطبيقياً قبل الإنشاء
// (schema.prisma خارج نطاق هذه المهمة — القيد موثّق كذهبية قاعدية مستقبلية)
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'بيانات الطلب غير صالحة' }, { status: 400 })

    const month = bodyString(body, 'month')
    if (!isValidMonth(month)) {
      return NextResponse.json({ error: 'الشهر مطلوب بصيغة YYYY-MM' }, { status: 400 })
    }

    const [employees, existing] = await Promise.all([
      db.employee.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
      db.salary.findMany({ where: { month }, select: { employeeId: true } }),
    ])
    const hasRow = new Set(existing.map((r) => r.employeeId))

    // مدى الشهر — لجمع مكافآت/احتسابات الشهر لكل موظف من حركات المكافآت والحسم
    const mStart = monthStart(month)
    const mEnd = monthEndExclusive(month)
    const aggKey = (employeeId: string, type: string) => `${employeeId}:${type}`

    const result = await db.$transaction(async (tx) => {
      // تجميع واحد لكل أنواع حركات الشهر بدل استعلام لكل موظف
      const aggs = await tx.bonusDeduction.groupBy({
        by: ['employeeId', 'type'],
        where: { date: { gte: mStart, lt: mEnd } },
        _sum: { amount: true },
      })
      const sums = new Map(aggs.map((a) => [aggKey(a.employeeId, a.type), round2(a._sum.amount ?? 0)]))

      let created = 0
      let skipped = 0
      let totalNet = 0

      for (const emp of employees) {
        if (hasRow.has(emp.id)) {
          skipped++
          continue
        }
        const base = round2(emp.baseSalary)
        const bonuses = sums.get(aggKey(emp.id, 'BONUS')) ?? 0
        const deductions = sums.get(aggKey(emp.id, 'DEDUCTION')) ?? 0
        const net = round2(base + bonuses - deductions)
        await tx.salary.create({
          data: { employeeId: emp.id, month, base, bonuses, deductions, net, status: 'PENDING' },
        })
        created++
        totalNet += net
      }

      // سجل تدقيق واحد لعملية التوليد كلها
      await logAudit(tx, {
        action: 'CREATE',
        entity: 'SALARY',
        entityId: null,
        entityNumber: month,
        title: `كشف رواتب شهر ${month}`,
        summary: `توليد كشف رواتب شهر ${month} — ${created} قسط جديد بإجمالي صافي ${fmtQty(round2(totalNet))} ل.س — ${skipped} موظف لديهم قسط مسبق`,
        details: {
          'الشهر': month,
          'الأقساط المولّدة': String(created),
          'موظف لديهم قسط مسبق': String(skipped),
          'إجمالي الصافي المولّد': fmtQty(round2(totalNet)),
          'وقت التوليد': fmtDateTime(new Date()),
        },
        amount: round2(totalNet),
      })

      return { created, skipped }
    })

    return NextResponse.json({
      ok: true,
      created: result.created,
      skipped: result.skipped,
      message: `تم توليد ${result.created} قسطاً — ${result.skipped} موظف لديهم قسط مسبق`,
    })
  } catch (error) {
    console.error('POST /api/salaries/generate error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء توليد كشف الرواتب' }, { status: 500 })
  }
}
