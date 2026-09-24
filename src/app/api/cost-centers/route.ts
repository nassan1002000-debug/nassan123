import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { fmtDateTime } from '@/lib/format'

// GET /api/cost-centers — وضعان:
//   افتراضي (بدون معاملات): القائمة المختصرة للنشطة فقط — للقوائم المنسدلة (نموذج القيود)
//   ?all=1: قائمة إدارية كاملة (نشطة وموقوفة) مع إحصاءات الارتباط بأسطر القيود
//   ?suggest=1: اقتراح الكود التالي التسلسلي الحر CC-xxx
export async function GET(req: NextRequest) {
  try {
    const all = req.nextUrl.searchParams.get('all') === '1'
    const suggest = req.nextUrl.searchParams.get('suggest') === '1'

    if (suggest) {
      const codes = await db.costCenter.findMany({
        where: { code: { startsWith: 'CC-' } },
        select: { code: true },
      })
      let max = 0
      for (const { code } of codes) {
        const n = parseInt(code.slice(3), 10)
        if (Number.isFinite(n) && n > max) max = n
      }
      return NextResponse.json({ code: `CC-${String(max + 1).padStart(3, '0')}` })
    }

    if (all) {
      const [centers, groups, entryLinks] = await Promise.all([
        db.costCenter.findMany({ orderBy: { code: 'asc' } }),
        db.journalEntryLine.groupBy({
          by: ['costCenterId'],
          where: { costCenterId: { not: null }, entry: { status: { not: 'CANCELLED' } } },
          _count: { _all: true },
          _sum: { debit: true, credit: true },
        }),
        db.journalEntryLine.findMany({
          where: { costCenterId: { not: null }, entry: { status: { not: 'CANCELLED' } } },
          distinct: ['entryId'],
          select: { costCenterId: true, entryId: true },
        }),
      ])

      const stat = (id: string) => {
        const g = groups.find((x) => x.costCenterId === id)
        return {
          linesCount: g?._count._all ?? 0,
          entriesCount: entryLinks.filter((l) => l.costCenterId === id).length,
          totalDebit: g?._sum.debit ?? 0,
          totalCredit: g?._sum.credit ?? 0,
        }
      }

      return NextResponse.json(
        centers.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          isActive: c.isActive,
          createdAt: c.createdAt.toISOString(),
          ...stat(c.id),
        })),
      )
    }

    const costCenters = await db.costCenter.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    })
    return NextResponse.json(costCenters)
  } catch (error) {
    console.error('GET /api/cost-centers error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب مراكز التكلفة' }, { status: 500 })
  }
}

// POST /api/cost-centers — إضافة مركز تكلفة جديد (الكود تلقائي CC-xxx إن أهمل)
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const codeInput = typeof body?.code === 'string' ? body.code.trim() : ''
    const isActive = body?.isActive === undefined ? true : Boolean(body.isActive)

    if (!name) {
      return NextResponse.json({ error: 'اسم مركز التكلفة مطلوب' }, { status: 400 })
    }

    let code = codeInput
    if (!code) {
      const codes = await db.costCenter.findMany({
        where: { code: { startsWith: 'CC-' } },
        select: { code: true },
      })
      let max = 0
      for (const { code: c } of codes) {
        const n = parseInt(c.slice(3), 10)
        if (Number.isFinite(n) && n > max) max = n
      }
      code = `CC-${String(max + 1).padStart(3, '0')}`
    } else {
      const dup = await db.costCenter.findUnique({ where: { code }, select: { id: true } })
      if (dup) return NextResponse.json({ error: `الكود ${code} مستخدم مسبقاً` }, { status: 409 })
    }

    const created = await db.$transaction(async (tx) => {
      const c = await tx.costCenter.create({
        data: { code, name, isActive },
      })
      await logAudit(tx, {
        action: 'CREATE',
        entity: 'COST_CENTER',
        entityId: c.id,
        entityNumber: c.code,
        title: `مركز تكلفة ${c.code}`,
        summary: `إضافة مركز تكلفة ${c.code} — ${c.name} — الحالة: ${c.isActive ? 'نشط' : 'موقوف'}`,
        details: {
          'الكود': c.code,
          'الاسم': c.name,
          'الحالة': c.isActive ? 'نشط' : 'موقوف',
          'وقت الإضافة': fmtDateTime(new Date()),
        },
      })
      return c
    })

    return NextResponse.json({ ok: true, costCenter: created, message: `تمت إضافة مركز التكلفة ${created.code}` })
  } catch (error) {
    console.error('POST /api/cost-centers error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء إضافة مركز التكلفة' }, { status: 500 })
  }
}
