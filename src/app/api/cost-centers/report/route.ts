import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/journal-server'
import { isValidYMD } from '@/lib/hr-server'

interface UnifiedCenterRow {
  id: string
  code: string
  name: string
  isActive: boolean
  entriesCount: number
  totalDebit: number
  totalCredit: number
  net: number
}

// GET /api/cost-centers/report?from=YYYY-MM-DD&to=YYYY-MM-DD&includeEmpty=1
// التقرير الموحد لمراكز التكلفة — تجميع أسطر القيود المُرحّلة (POSTED) ضمن الفترة (تاريخ السطر = تاريخ القيد)
// القاعدة: كل المركزات ذات الحركة (نشطة وغير نشطة) مرتبة بالكود،
// وتضاف المركزات النشطة بلا حركة بقيم صفرية عند تمرير ?includeEmpty=1
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams

    // الفترة الافتراضية: بداية السنة الحالية ← اليوم (توقيت الخادم المحلي)
    const now = new Date()
    const todayYMD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const yearStart = `${now.getFullYear()}-01-01`

    const fromInput = sp.get('from') ?? ''
    const toInput = sp.get('to') ?? ''

    if (fromInput && !isValidYMD(fromInput)) {
      return NextResponse.json({ error: 'تاريخ البداية غير صالح — الصيغة المطلوبة YYYY-MM-DD' }, { status: 400 })
    }
    if (toInput && !isValidYMD(toInput)) {
      return NextResponse.json({ error: 'تاريخ النهاية غير صالح — الصيغة المطلوبة YYYY-MM-DD' }, { status: 400 })
    }

    const from = fromInput || yearStart
    const to = toInput || todayYMD
    if (from > to) {
      return NextResponse.json({ error: 'نطاق الفترة غير صالح — تاريخ البداية بعد تاريخ النهاية' }, { status: 400 })
    }

    const includeEmpty = sp.get('includeEmpty') === '1'

    const lines = await db.journalEntryLine.findMany({
      where: {
        costCenterId: { not: null },
        entry: {
          status: 'POSTED',
          date: { gte: new Date(`${from}T00:00:00.000`), lte: new Date(`${to}T23:59:59.999`) },
        },
      },
      select: { entryId: true, costCenterId: true, debit: true, credit: true },
    })

    // تجميع محلي: مجاميع مدين/دائن + القيود المميزة (distinct entryId) لكل مركز
    const agg = new Map<string, { debit: number; credit: number; entryIds: Set<string> }>()
    const allEntryIds = new Set<string>()
    for (const l of lines) {
      const ccId = l.costCenterId
      if (!ccId) continue
      let a = agg.get(ccId)
      if (!a) {
        a = { debit: 0, credit: 0, entryIds: new Set<string>() }
        agg.set(ccId, a)
      }
      a.debit += l.debit
      a.credit += l.credit
      a.entryIds.add(l.entryId)
      allEntryIds.add(l.entryId)
    }

    const movedIds = [...agg.keys()]
    const movedCenters = movedIds.length
      ? await db.costCenter.findMany({ where: { id: { in: movedIds } } })
      : []
    const emptyActive = includeEmpty
      ? await db.costCenter.findMany({ where: { isActive: true, id: { notIn: movedIds } } })
      : []

    const rows: UnifiedCenterRow[] = []
    for (const c of [...movedCenters, ...emptyActive]) {
      const a = agg.get(c.id)
      const totalDebit = round2(a?.debit ?? 0)
      const totalCredit = round2(a?.credit ?? 0)
      rows.push({
        id: c.id,
        code: c.code,
        name: c.name,
        isActive: c.isActive,
        entriesCount: a?.entryIds.size ?? 0,
        totalDebit,
        totalCredit,
        net: round2(totalDebit - totalCredit),
      })
    }
    rows.sort((x, y) => x.code.localeCompare(y.code))

    // إجماليات التقرير — entriesCount = عدد القيود المميزة على كل المراكز (قيد يمس مركزين يُحسب مرة واحدة)
    const totals = {
      entriesCount: allEntryIds.size,
      totalDebit: round2(rows.reduce((s, r) => s + r.totalDebit, 0)),
      totalCredit: round2(rows.reduce((s, r) => s + r.totalCredit, 0)),
      net: round2(rows.reduce((s, r) => s + r.net, 0)),
    }

    return NextResponse.json({ from, to, centers: rows, totals })
  } catch (error) {
    console.error('GET /api/cost-centers/report error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب التقرير الموحد لمراكز التكلفة' }, { status: 500 })
  }
}
