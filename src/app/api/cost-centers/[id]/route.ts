import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { fmtDateTime } from '@/lib/format'

type Params = { params: Promise<{ id: string }> }

// GET /api/cost-centers/[id]?from=&to= — بطاقة المركز + تقرير حركاته ضمن القيود المُرحّلة
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const center = await db.costCenter.findUnique({ where: { id } })
    if (!center) {
      return NextResponse.json({ error: 'مركز التكلفة غير موجود' }, { status: 404 })
    }

    const sp = request.nextUrl.searchParams
    const dateFilter: Prisma.DateTimeFilter = {}
    const fromStr = sp.get('from')
    const toStr = sp.get('to')
    if (fromStr) {
      const d = new Date(`${fromStr}T00:00:00.000`)
      if (!Number.isNaN(d.getTime())) dateFilter.gte = d
    }
    if (toStr) {
      const d = new Date(`${toStr}T23:59:59.999`)
      if (!Number.isNaN(d.getTime())) dateFilter.lte = d
    }
    const hasRange = Boolean(dateFilter.gte || dateFilter.lte)

    const lines = await db.journalEntryLine.findMany({
      where: {
        costCenterId: id,
        entry: { status: 'POSTED', ...(hasRange ? { date: dateFilter } : {}) },
      },
      orderBy: [{ entry: { date: 'asc' } }, { order: 'asc' }],
      select: {
        debit: true,
        credit: true,
        description: true,
        account: { select: { code: true, name: true } },
        entry: { select: { id: true, number: true, date: true, description: true } },
      },
    })

    let totalDebit = 0
    let totalCredit = 0
    const movements = lines.map((l) => {
      totalDebit += l.debit
      totalCredit += l.credit
      return {
        entryId: l.entry.id,
        entryNumber: l.entry.number,
        entryDate: l.entry.date.toISOString(),
        entryDescription: l.entry.description,
        accountCode: l.account.code,
        accountName: l.account.name,
        description: l.description,
        debit: l.debit,
        credit: l.credit,
      }
    })

    return NextResponse.json({
      costCenter: {
        id: center.id,
        code: center.code,
        name: center.name,
        isActive: center.isActive,
      },
      movements,
      totals: { totalDebit, totalCredit, net: totalDebit - totalCredit, count: movements.length },
    })
  } catch (error) {
    console.error('GET /api/cost-centers/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب تقرير مركز التكلفة' }, { status: 500 })
  }
}

// PUT /api/cost-centers/[id] — تعديل المركز (الكود/الاسم/الحالة)
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const existing = await db.costCenter.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'مركز التكلفة غير موجود' }, { status: 404 })
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const name = typeof body?.name === 'string' ? body.name.trim() : existing.name
    const code = typeof body?.code === 'string' ? body.code.trim() : existing.code
    const isActive = body?.isActive === undefined ? existing.isActive : Boolean(body.isActive)

    if (!name) return NextResponse.json({ error: 'اسم مركز التكلفة مطلوب' }, { status: 400 })
    if (!code) return NextResponse.json({ error: 'كود مركز التكلفة مطلوب' }, { status: 400 })

    if (code !== existing.code) {
      const dup = await db.costCenter.findUnique({ where: { code }, select: { id: true } })
      if (dup && dup.id !== id) {
        return NextResponse.json({ error: `الكود ${code} مستخدم مسبقاً` }, { status: 409 })
      }
    }

    const updated = await db.$transaction(async (tx) => {
      const c = await tx.costCenter.update({
        where: { id },
        data: { code, name, isActive },
      })

      const changes: string[] = []
      if (c.code !== existing.code) changes.push(`الكود: ${existing.code} ← ${c.code}`)
      if (c.name !== existing.name) changes.push(`الاسم: ${existing.name} ← ${c.name}`)
      if (c.isActive !== existing.isActive)
        changes.push(`الحالة: ${existing.isActive ? 'نشط' : 'موقوف'} ← ${c.isActive ? 'نشط' : 'موقوف'}`)

      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'COST_CENTER',
        entityId: id,
        entityNumber: c.code,
        title: `مركز تكلفة ${c.code}`,
        summary: `تعديل مركز تكلفة ${c.code} — ${c.name} — ${changes.length > 0 ? changes.join('؛ ') : 'تعديل دون تغيير قيم دالة'}`,
        details: {
          'الكود': c.code,
          'الاسم': c.name,
          'التغييرات': changes.length > 0 ? changes.join('؛ ') : 'لا تغييرات دالة',
          'وقت التعديل': fmtDateTime(new Date()),
        },
      })

      return c
    })

    return NextResponse.json({ ok: true, costCenter: updated, message: 'تم حفظ التعديلات' })
  } catch (error) {
    console.error('PUT /api/cost-centers/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حفظ التعديلات' }, { status: 500 })
  }
}

// DELETE /api/cost-centers/[id] — حذف المركز (ممنوع عند ارتباطه بأسطر قيود)
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const existing = await db.costCenter.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'مركز التكلفة غير موجود' }, { status: 404 })
    }

    const linesCount = await db.journalEntryLine.count({ where: { costCenterId: id } })
    if (linesCount > 0) {
      return NextResponse.json(
        {
          error: `لا يمكن حذف مركز التكلفة — مرتبط بـ${linesCount} سطر قيود مسجل. يمكن إيقافه بدلاً من حذفه`,
        },
        { status: 409 },
      )
    }

    await db.$transaction(async (tx) => {
      await tx.costCenter.delete({ where: { id } })
      await logAudit(tx, {
        action: 'DELETE',
        entity: 'COST_CENTER',
        entityId: id,
        entityNumber: existing.code,
        title: `مركز تكلفة ${existing.code}`,
        summary: `حذف مركز تكلفة ${existing.code} — ${existing.name}`,
        details: {
          'الكود': existing.code,
          'الاسم': existing.name,
          'الحالة قبل الحذف': existing.isActive ? 'نشط' : 'موقوف',
          'أثر الحذف': 'المركز بلا ارتباط بأي قيود — حذف نظيف',
          'وقت الحذف': fmtDateTime(new Date()),
        },
      })
    })

    return NextResponse.json({ ok: true, message: `تم حذف مركز التكلفة ${existing.code}` })
  } catch (error) {
    console.error('DELETE /api/cost-centers/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حذف مركز التكلفة' }, { status: 500 })
  }
}
