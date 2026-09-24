import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { validateEntryBody } from '@/lib/journal-server'
import { assertPeriodOpen, PeriodClosedError } from '@/lib/period-server'
import { logAudit } from '@/lib/audit-server'
import { AR_ENTRY_STATUS, fmtDateTime } from '@/lib/format'

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/journal/[id] — القيد كاملاً مع البنود (للعرض والطباعة والتعديل)
export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const entry = await db.journalEntry.findUnique({
      where: { id },
      include: {
        lines: {
          orderBy: { order: 'asc' },
          include: {
            account: { select: { code: true, name: true, type: true } },
            costCenter: { select: { id: true, code: true, name: true } },
          },
        },
      },
    })
    if (!entry) return NextResponse.json({ error: 'القيد غير موجود' }, { status: 404 })

    return NextResponse.json({
      id: entry.id,
      number: entry.number,
      date: entry.date.toISOString(),
      description: entry.description,
      source: entry.source,
      status: entry.status,
      totalDebit: entry.totalDebit,
      totalCredit: entry.totalCredit,
      lines: entry.lines.map((l) => ({
        id: l.id,
        accountId: l.accountId,
        account: { code: l.account.code, name: l.account.name, type: l.account.type },
        costCenter: l.costCenter
          ? { id: l.costCenter.id, code: l.costCenter.code, name: l.costCenter.name }
          : null,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
        order: l.order,
      })),
    })
  } catch (error) {
    console.error('GET /api/journal/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب القيد' }, { status: 500 })
  }
}

// PUT /api/journal/[id] — تعديل قيد (مسودة فقط) مع استبدال البنود ضمن معاملة
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const existing = await db.journalEntry.findUnique({
      where: { id },
      select: { id: true, status: true },
    })
    if (!existing) return NextResponse.json({ error: 'القيد غير موجود' }, { status: 404 })
    if (existing.status !== 'DRAFT') {
      return NextResponse.json({ error: 'لا يمكن تعديل قيد مُرحّل أو ملغى' }, { status: 400 })
    }

    const body = await req.json().catch(() => null)
    const result = await validateEntryBody(body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    const data = result.data

    await db.$transaction(async (tx) => {
      // إنفاذ الفترات المقفلة: التاريخ الجديد للقيد داخل فترة مقفلة ⇒ رفض التعديل
      await assertPeriodOpen(tx, data.date, 'قيد يومية')
      await tx.journalEntryLine.deleteMany({ where: { entryId: id } })
      await tx.journalEntryLine.createMany({
        data: data.lines.map((l, i) => ({
          entryId: id,
          accountId: l.accountId,
          costCenterId: l.costCenterId,
          debit: l.debit,
          credit: l.credit,
          description: l.description,
          order: i,
        })),
      })
      await tx.journalEntry.update({
        where: { id },
        data: {
          date: data.date,
          description: data.description,
          source: data.source,
          status: data.status,
          totalDebit: data.totalDebit,
          totalCredit: data.totalCredit,
        },
      })
    })

    const full = await db.journalEntry.findUnique({
      where: { id },
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
    return NextResponse.json(full)
  } catch (error) {
    if (error instanceof PeriodClosedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('PUT /api/journal/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء تعديل القيد' }, { status: 500 })
  }
}

// DELETE /api/journal/[id] — حذف قيد (مسودة فقط) — البنود تُحذف تلقائياً (Cascade)
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const existing = await db.journalEntry.findUnique({
      where: { id },
      select: { status: true, number: true, description: true, totalDebit: true, totalCredit: true },
    })
    if (!existing) return NextResponse.json({ error: 'القيد غير موجود' }, { status: 404 })
    if (existing.status !== 'DRAFT') {
      return NextResponse.json(
        { error: 'لا يمكن حذف قيد مُرحّل أو ملغى — يمكنك إلغاؤه فقط' },
        { status: 400 },
      )
    }

    // الحذف + التوثيق في سجل التدقيق داخل المعاملة نفسها (نمط الفواتير)
    await db.$transaction(async (tx) => {
      await tx.journalEntry.delete({ where: { id } })
      await logAudit(tx, {
        action: 'DELETE',
        entity: 'JOURNAL',
        entityId: id,
        entityNumber: existing.number,
        title: `قيد يومية ${existing.number}`,
        summary: `حذف قيد يومية ${existing.number} (مسودة) — البيان: ${existing.description} — مدين ${existing.totalDebit.toFixed(2)} / دائن ${existing.totalCredit.toFixed(2)} ل.س`,
        details: {
          'الرقم': existing.number,
          'البيان': existing.description,
          'الحالة قبل الحذف': AR_ENTRY_STATUS.DRAFT,
          'أثر الحذف': 'مسودة لم تُرحّل — بلا أثر محاسبي',
          'وقت الحذف': fmtDateTime(new Date()),
        },
      })
    })

    return NextResponse.json({ ok: true, number: existing.number })
  } catch (error) {
    console.error('DELETE /api/journal/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حذف القيد' }, { status: 500 })
  }
}
