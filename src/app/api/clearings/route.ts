// /api/clearings — سندات المقاصة MC-xxxx (Task 101)
//
// GET               — قائمة سندات المقاصة (قيود بمصدر CLEARING) + إحصاءات
// GET ?candidates=1 — الأشخاص المرشحون (صفات متعددة) بأرصدتهم واقتراحات الأزواج
// POST              — إنشاء سند مقاصة: قيد مزدوج مُرحّل متوازن بنيوياً داخل معاملة واحدة
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  loadClearingCandidates,
  postClearingJournal,
  validateClearingBody,
} from '@/lib/clearing-server'
import { PeriodClosedError } from '@/lib/period-server'
import { logAudit, auditMoney } from '@/lib/audit-server'
import { fmtDateTime } from '@/lib/format'

// GET /api/clearings[?candidates=1] — القائمة أو المرشحون
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams

    // المرشحون — أشخاص متعددو الصفات بأرصدتهم واقتراحاتهم
    if (sp.get('candidates')) {
      const persons = await loadClearingCandidates()
      return NextResponse.json({ persons })
    }

    const [entries, aggregates] = await Promise.all([
      db.journalEntry.findMany({
        where: { source: 'CLEARING' },
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        select: {
          id: true,
          number: true,
          date: true,
          description: true,
          status: true,
          totalDebit: true,
          createdAt: true,
          lines: {
            orderBy: { order: 'asc' },
            select: {
              debit: true,
              credit: true,
              description: true,
              account: { select: { code: true, name: true } },
            },
          },
        },
      }),
      db.journalEntry.groupBy({
        by: ['status'],
        where: { source: 'CLEARING' },
        _sum: { totalDebit: true },
        _count: { _all: true },
      }),
    ])

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const monthSum = entries
      .filter((e) => e.status === 'POSTED' && e.date >= monthStart)
      .reduce((s, e) => s + e.totalDebit, 0)

    const postedAgg = aggregates.find((a) => a.status === 'POSTED')

    const vouchers = entries.map((e) => ({
      id: e.id,
      number: e.number,
      date: e.date.toISOString(),
      description: e.description,
      status: e.status,
      total: e.totalDebit,
      lines: e.lines.map((l) => ({
        accountCode: l.account.code,
        accountName: l.account.name,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
      })),
    }))

    return NextResponse.json({
      vouchers,
      totals: {
        count: postedAgg?._count._all ?? 0,
        sum: postedAgg?._sum.totalDebit ?? 0,
        thisMonth: Math.round(monthSum * 100) / 100,
      },
    })
  } catch (error) {
    console.error('GET /api/clearings error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب سندات المقاصة' }, { status: 500 })
  }
}

// POST /api/clearings — إنشاء سند مقاصة (قيد مزدوج متوازن MC-xxxx)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const result = await validateClearingBody(body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    const data = result.data

    // خريطة الحسابات مرة واحدة — للقيد والبيان والتدقيق
    const accountIds = [...new Set(data.pairs.flatMap((p) => [p.debitAccountId, p.creditAccountId]))]
    const accounts = await db.account.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, code: true, name: true },
    })
    const accMap = new Map(accounts.map((a) => [a.id, { code: a.code, name: a.name }]))

    let created: { id: string; number: string } | null = null
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await db.$transaction(async (tx) => {
          const entry = await postClearingJournal(tx, data, accMap)

          // التوثيق في سجل التدقيق — داخل المعاملة نفسها (نمط السندات)
          const pairsText = data.pairs
            .map((p) => {
              const d = accMap.get(p.debitAccountId)
              const c = accMap.get(p.creditAccountId)
              return `مدين ${d?.name ?? '؟'} ↔ دائن ${c?.name ?? '؟'} بـ ${auditMoney(p.amount)} ل.س`
            })
            .join(' — ')
          await logAudit(tx, {
            action: 'CREATE',
            entity: 'CLEARING',
            entityId: entry.id,
            entityNumber: entry.number,
            title: `سند مقاصة ${entry.number}`,
            summary: `إنشاء سند مقاصة ${entry.number} — ${pairsText}${data.notes ? ` — ملاحظات: ${data.notes}` : ''} — أُرحّل آلياً بالقيد نفسه (مصدر: سند مقاصة)`,
            details: {
              'الرقم': entry.number,
              'الإجمالي (ل.س)': auditMoney(data.total),
              'الأزواج': pairsText,
              'الحالة': 'مُرحّل — يظهر في دفتر الأستاذ وكشوف الأطراف',
              'وقت الإنشاء': fmtDateTime(new Date()),
            },
            amount: data.total,
          })
          return entry
        })
      } catch (e) {
        const code = (e as { code?: string })?.code
        if (code === 'P2002' && attempt < 2) continue
        throw e
      }
    }
    if (!created) {
      return NextResponse.json({ error: 'تعذر توليد رقم سند المقاصة — حاول مجدداً' }, { status: 500 })
    }

    return NextResponse.json(
      {
        ok: true,
        voucher: { id: created.id, number: created.number, total: data.total, date: data.date.toISOString() },
      },
      { status: 201 },
    )
  } catch (error) {
    if (error instanceof PeriodClosedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('POST /api/clearings error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء إنشاء سند المقاصة' }, { status: 500 })
  }
}
