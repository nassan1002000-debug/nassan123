import { NextResponse, type NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ENTRY_SOURCES, ENTRY_STATUSES, fmt, nextEntryNumber, validateEntryBody } from '@/lib/journal-server'
import { assertPeriodOpen, PeriodClosedError } from '@/lib/period-server'
import { logAudit, auditMoney } from '@/lib/audit-server'
import { AR_ENTRY_STATUS, AR_SOURCE, fmtDateTime } from '@/lib/format'

// GET /api/journal — قائمة القيود مع الفلترة والتقسيم + الرقم المقترح للقيد التالي
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(sp.get('pageSize') ?? '15', 10) || 15))

    const where: Prisma.JournalEntryWhereInput = {}

    // فلترة الفترة الزمنية
    const fromStr = sp.get('from')
    const toStr = sp.get('to')
    if (fromStr || toStr) {
      const date: Prisma.DateTimeFilter = {}
      if (fromStr) {
        const d = new Date(`${fromStr}T00:00:00.000`)
        if (!Number.isNaN(d.getTime())) date.gte = d
      }
      if (toStr) {
        const d = new Date(`${toStr}T23:59:59.999`)
        if (!Number.isNaN(d.getTime())) date.lte = d
      }
      if (date.gte || date.lte) where.date = date
    }

    // فلترة الحالة والمصدر
    const status = sp.get('status')
    if (status && (ENTRY_STATUSES as readonly string[]).includes(status)) where.status = status
    const source = sp.get('source')
    if (source && (ENTRY_SOURCES as readonly string[]).includes(source)) where.source = source

    // البحث النصي في الرقم أو البيان
    const q = sp.get('q')?.trim()
    if (q) where.OR = [{ number: { contains: q } }, { description: { contains: q } }]

    // الإجماليات تعكس الأثر المحاسبي الفعلي: المُرحّلة فقط افتراضياً، وتتبع الفلتر إن طُلبت حالة معينة — والملغاة لا تدخل أبداً
    const sumWhere: Prisma.JournalEntryWhereInput = { ...where }
    if (status === 'CANCELLED') {
      sumWhere.id = { in: [] } // الملغاة بلا أثر محاسبي
    } else if (!status) {
      sumWhere.status = 'POSTED'
    }

    const [rows, total, aggregate, draftCount] = await Promise.all([
      db.journalEntry.findMany({
        where,
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          lines: {
            orderBy: { order: 'asc' },
            include: {
              account: { select: { code: true, name: true } },
              costCenter: { select: { name: true } },
            },
          },
        },
      }),
      db.journalEntry.count({ where }),
      db.journalEntry.aggregate({ where: sumWhere, _sum: { totalDebit: true, totalCredit: true } }),
      db.journalEntry.count({ where: { ...where, status: 'DRAFT' } }),
    ])

    const nextNumber = await nextEntryNumber(db)

    const entries = rows.map((r) => ({
      id: r.id,
      number: r.number,
      date: r.date.toISOString(),
      description: r.description,
      source: r.source,
      status: r.status,
      totalDebit: r.totalDebit,
      totalCredit: r.totalCredit,
      linesCount: r.lines.length,
      lines: r.lines.map((l) => ({
        accountId: l.accountId,
        account: { code: l.account.code, name: l.account.name },
        costCenterName: l.costCenter?.name ?? null,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
      })),
    }))

    return NextResponse.json({
      entries,
      total,
      page,
      pageSize,
      nextNumber,
      totals: {
        debit: aggregate._sum.totalDebit ?? 0,
        credit: aggregate._sum.totalCredit ?? 0,
        drafts: draftCount,
      },
    })
  } catch (error) {
    console.error('GET /api/journal error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب القيود' }, { status: 500 })
  }
}

// POST /api/journal — إنشاء قيد جديد (مسودة أو مُرحّل) مع تحقق التوازن
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const result = await validateEntryBody(body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    const data = result.data

    // محاولة الإنشاء مع إعادة المحاولة عند تضارب رقم القيد الفريد
    let created: { id: string } | null = null
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await db.$transaction(async (tx) => {
          // إنفاذ الفترات المقفلة: تاريخ القيد داخل فترة مقفلة ⇒ رفض وإرجاع المعاملة
          await assertPeriodOpen(tx, data.date, 'قيد يومية')
          const number = await nextEntryNumber(tx)
          const entry = await tx.journalEntry.create({
            data: {
              number,
              date: data.date,
              description: data.description,
              source: data.source,
              status: data.status,
              totalDebit: data.totalDebit,
              totalCredit: data.totalCredit,
            },
            select: { id: true },
          })
          await tx.journalEntryLine.createMany({
            data: data.lines.map((l, i) => ({
              entryId: entry.id,
              accountId: l.accountId,
              costCenterId: l.costCenterId,
              debit: l.debit,
              credit: l.credit,
              description: l.description,
              order: i,
            })),
          })

          // التوثيق في سجل التدقيق — داخل المعاملة نفسها (نمط الفواتير)
          await logAudit(tx, {
            action: 'CREATE',
            entity: 'JOURNAL',
            entityId: entry.id,
            entityNumber: number,
            title: `قيد يومية ${number}`,
            summary: `إنشاء قيد يومية ${number} (${AR_ENTRY_STATUS[data.status] ?? data.status}) — البيان: ${data.description} — ${data.lines.length} بنوداً — مدين ${fmt(data.totalDebit)} / دائن ${fmt(data.totalCredit)} ل.س`,
            details: {
              'الرقم': number,
              'البيان': data.description,
              'المصدر': AR_SOURCE[data.source] ?? data.source,
              'الحالة': AR_ENTRY_STATUS[data.status] ?? data.status,
              'عدد البنود': data.lines.length,
              'المدين (ل.س)': auditMoney(data.totalDebit),
              'الدائن (ل.س)': auditMoney(data.totalCredit),
              'وقت الإنشاء': fmtDateTime(new Date()),
            },
            amount: data.totalDebit,
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
      return NextResponse.json({ error: 'تعذر توليد رقم القيد — حاول مجدداً' }, { status: 500 })
    }

    const full = await db.journalEntry.findUnique({
      where: { id: created.id },
      include: {
        lines: {
          orderBy: { order: 'asc' },
          include: {
            account: { select: { code: true, name: true } },
            costCenter: { select: { name: true } },
          },
        },
      },
    })
    return NextResponse.json(full, { status: 201 })
  } catch (error) {
    if (error instanceof PeriodClosedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('POST /api/journal error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء إنشاء القيد' }, { status: 500 })
  }
}
