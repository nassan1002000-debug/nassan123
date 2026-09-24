import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fmt, round2 } from '@/lib/journal-server'
import { logAudit, auditMoney } from '@/lib/audit-server'
import { AR_ENTRY_STATUS, AR_SOURCE, fmtDateTime } from '@/lib/format'

type RouteParams = { params: Promise<{ id: string }> }

// POST /api/journal/[id]/post — ترحيل قيد (مسودة فقط) مع تحقق نهائي من التوازن
export async function POST(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const entry = await db.journalEntry.findUnique({
      where: { id },
      include: { lines: { select: { debit: true, credit: true } } },
    })
    if (!entry) return NextResponse.json({ error: 'القيد غير موجود' }, { status: 404 })
    if (entry.status === 'POSTED') {
      return NextResponse.json({ error: 'القيد مُرحّل مسبقاً' }, { status: 400 })
    }
    if (entry.status === 'CANCELLED') {
      return NextResponse.json({ error: 'لا يمكن ترحيل قيد ملغى' }, { status: 400 })
    }

    // تحقق أخير من التوازن قبل الترحيل
    const totalDebit = round2(entry.lines.reduce((s, l) => s + l.debit, 0))
    const totalCredit = round2(entry.lines.reduce((s, l) => s + l.credit, 0))
    if (Math.abs(totalDebit - totalCredit) >= 0.01) {
      return NextResponse.json(
        { error: `لا يمكن ترحيل قيد غير متوازن: المدين ${fmt(totalDebit)} والدائن ${fmt(totalCredit)}` },
        { status: 400 },
      )
    }

    // الترحيل + التوثيق في سجل التدقيق داخل المعاملة نفسها (نمط الفواتير)
    const updated = await db.$transaction(async (tx) => {
      const u = await tx.journalEntry.update({
        where: { id },
        data: { status: 'POSTED', totalDebit, totalCredit },
      })

      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'JOURNAL',
        entityId: id,
        entityNumber: u.number,
        title: `قيد يومية ${u.number}`,
        summary: `ترحيل قيد يومية ${u.number} — صار أثره المحاسبي فعّالاً — البيان: ${u.description} — مدين ${fmt(u.totalDebit)} / دائن ${fmt(u.totalCredit)} ل.س`,
        details: {
          'الرقم': u.number,
          'البيان': u.description,
          'المصدر': AR_SOURCE[u.source] ?? u.source,
          'الحالة': `${AR_ENTRY_STATUS.DRAFT} ← ${AR_ENTRY_STATUS.POSTED}`,
          'المدين (ل.س)': auditMoney(u.totalDebit),
          'الدائن (ل.س)': auditMoney(u.totalCredit),
          'وقت الترحيل': fmtDateTime(new Date()),
        },
        amount: u.totalDebit,
      })

      return u
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
    console.error('POST /api/journal/[id]/post error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء ترحيل القيد' }, { status: 500 })
  }
}
