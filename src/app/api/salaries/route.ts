import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/journal-server'
import { isValidMonth, type SalaryRow } from '@/lib/hr-server'

// GET /api/salaries?month=YYYY-MM — كشف رواتب شهر واحد (افتراضياً الشهر الحالي)
// GET /api/salaries?month=all — كل الأشهر السابقة معاً، الأحدث شهراً أولاً ثم كود الموظف
export async function GET(req: NextRequest) {
  try {
    const raw = req.nextUrl.searchParams.get('month') || new Date().toISOString().slice(0, 7)
    const wantsAll = raw === 'all'
    if (!wantsAll && !isValidMonth(raw)) {
      return NextResponse.json({ error: 'صيغة الشهر غير صالحة (YYYY-MM) — أو all لكل الأشهر' }, { status: 400 })
    }

    const salaries = await db.salary.findMany({
      where: wantsAll ? {} : { month: raw },
      orderBy: wantsAll ? [{ month: 'desc' }, { employee: { code: 'asc' } }] : { employee: { code: 'asc' } },
      include: { employee: { select: { id: true, code: true, name: true, position: true } } },
    })

    // ربط كل قسط بقيده المحاسبي — مصدران محتملان:
    //  1) refType=SALARY / refId=<Salary.id> — نمط الصرف الفردي الفعلي (مسار /pay الحالي)
    //  2) source=SALARY بلا refId — دفعات رواتب مجمّعة تاريخياً (قيد واحد لكل شهر يغطي
    //     كل الموظفين معاً)، تُربط عندها بمطابقة الشهر مع تاريخ القيد لا بمعرف مباشر
    const salaryIds = salaries.map((s) => s.id)
    const [byRefId, bulkBySourceMonth] =
      salaryIds.length > 0
        ? await Promise.all([
            db.journalEntry.findMany({
              where: { refType: 'SALARY', refId: { in: salaryIds }, status: 'POSTED' },
              select: { refId: true, number: true },
            }),
            db.journalEntry.findMany({
              where: { source: 'SALARY', refType: null, status: 'POSTED' },
              select: { number: true, date: true },
            }),
          ])
        : [[], []]
    const entryBySalaryId = new Map(byRefId.map((e) => [e.refId as string, e.number]))
    const entryByMonth = new Map(
      bulkBySourceMonth.map((e) => [e.date.toISOString().slice(0, 7), e.number]),
    )

    const rows: SalaryRow[] = salaries.map((s) => ({
      id: s.id,
      month: s.month,
      base: s.base,
      bonuses: s.bonuses,
      deductions: s.deductions,
      net: s.net,
      status: s.status === 'PAID' ? 'PAID' : 'PENDING',
      paidAt: s.paidAt ? s.paidAt.toISOString() : null,
      employee: s.employee,
      // القسط المعلّق لم يُصرف بعد فلا قيد له — بصرف النظر عن وجود قيد مجمّع لزملائه بالشهر نفسه
      journalEntryNumber:
        s.status === 'PAID' ? entryBySalaryId.get(s.id) ?? entryByMonth.get(s.month) ?? null : null,
    }))

    // إحصاءات الشهر — من كامل أقساطه (لا فلاتر أخرى في هذا المسار)
    const paid = rows.filter((r) => r.status === 'PAID')
    const pending = rows.filter((r) => r.status === 'PENDING')
    const stats = {
      count: rows.length,
      totalBase: round2(rows.reduce((s, r) => s + r.base, 0)),
      totalBonuses: round2(rows.reduce((s, r) => s + r.bonuses, 0)),
      totalDeductions: round2(rows.reduce((s, r) => s + r.deductions, 0)),
      totalNet: round2(rows.reduce((s, r) => s + r.net, 0)),
      paidCount: paid.length,
      paidTotal: round2(paid.reduce((s, r) => s + r.net, 0)),
      pendingCount: pending.length,
      pendingTotal: round2(pending.reduce((s, r) => s + r.net, 0)),
    }

    return NextResponse.json({ salaries: rows, stats })
  } catch (error) {
    console.error('GET /api/salaries error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب كشف الرواتب' }, { status: 500 })
  }
}
