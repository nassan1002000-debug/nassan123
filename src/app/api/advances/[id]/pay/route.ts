import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { fmtDateTime, fmtQty } from '@/lib/format'
import { nextEntryNumber, round2 } from '@/lib/journal-server'
import { ensureInvoiceAccounts, INVOICE_ACCOUNTS } from '@/lib/invoice-journal'
import { assertPeriodOpen, PeriodClosedError } from '@/lib/period-server'
import { bodyString, bodyStringOrNull, HrHttpError, type PayMethod } from '@/lib/hr-server'

type Params = { params: Promise<{ id: string }> }

// POST /api/advances/[id]/pay — صرف السلفة (نقداً أو بنك) + قيد مزدوج مُرحّل
// الدليل: مدين 1150 سلف الموظفين — دائن 1110 الصندوق أو 1120 البنك
// costCenterId اختياري في الجسم — إن وُجد يُنسب القيد كاملاً (سطراه) للمركز بعد التحقق من وجوده وفعاليته
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'بيانات الطلب غير صالحة' }, { status: 400 })

    const methodRaw = bodyString(body, 'method')
    if (methodRaw !== 'CASH' && methodRaw !== 'BANK') {
      return NextResponse.json({ error: 'طريقة الصرف يجب أن تكون نقدي (CASH) أو بنك (BANK)' }, { status: 400 })
    }
    const method = methodRaw as PayMethod

    // مركز التكلفة اختياري — نص فارغ أو مفقود يعني بلا مركز (كما كان)
    const costCenterId = bodyStringOrNull(body, 'costCenterId')
    let costCenter: { id: string; code: string; name: string } | null = null
    if (costCenterId) {
      const cc = await db.costCenter.findUnique({
        where: { id: costCenterId },
        select: { id: true, code: true, name: true, isActive: true },
      })
      if (!cc) {
        return NextResponse.json({ error: 'مركز التكلفة غير موجود' }, { status: 400 })
      }
      if (!cc.isActive) {
        return NextResponse.json({ error: 'مركز التكلفة غير نشط' }, { status: 400 })
      }
      costCenter = { id: cc.id, code: cc.code, name: cc.name }
    }

    const advance = await db.advance.findUnique({
      where: { id },
      include: {
        employee: {
          select: { id: true, code: true, name: true, accountId: true, account: { select: { code: true } } },
        },
      },
    })
    if (!advance) {
      return NextResponse.json({ error: 'السلفة غير موجودة' }, { status: 404 })
    }
    if (advance.status !== 'UNPAID') {
      return NextResponse.json({ error: 'السلفة مصروفة مسبقاً' }, { status: 409 })
    }

    const amount = round2(advance.amount)
    const now = new Date()

    const entryNumber = await db.$transaction(async (tx) => {
      // إنفاذ الفترات المقفلة: صرف سلفة بتاريخ اليوم داخل فترة مقفلة ⇒ رفض
      await assertPeriodOpen(tx, now, 'صرف السلفة')
      // حرس الحالة داخل المعاملة — يمنع الصرف المزدوج في سباق نادر
      const upd = await tx.advance.updateMany({
        where: { id, status: 'UNPAID' },
        data: { status: 'PAID' },
      })
      if (upd.count === 0) throw new HrHttpError('السلفة مصروفة مسبقاً', 409)

      // ضمان الحسابات النظامية بالأكواد (1150/1110/1120)
      const byCode = await ensureInvoiceAccounts(tx)
      // حساب الموظف الفرعي تحت «سلف الموظفين» إن رُبط — وإلا حساب التحكم 1150 مباشرة
      const empSubCode = advance.employee.account?.code ?? null
      const advancesAcc =
        (empSubCode && byCode.get(empSubCode)) || byCode.get(INVOICE_ACCOUNTS.ADVANCES.code)!
      const cashBankAcc = byCode.get(method === 'BANK' ? INVOICE_ACCOUNTS.BANK.code : INVOICE_ACCOUNTS.CASH.code)!

      const number = await nextEntryNumber(tx)
      await tx.journalEntry.create({
        data: {
          number,
          date: now,
          description: `صرف سلفة للموظف ${advance.employee.name} (${advance.employee.code})`,
          source: 'ADVANCE',
          status: 'POSTED',
          totalDebit: amount,
          totalCredit: amount,
          refType: 'ADVANCE',
          refId: advance.id,
          lines: {
            create: [
              {
                accountId: advancesAcc,
                costCenterId: costCenter?.id ?? null,
                debit: amount,
                credit: 0,
                description: `سلفة الموظف ${advance.employee.name} (${advance.employee.code})`,
                order: 0,
              },
              {
                accountId: cashBankAcc,
                costCenterId: costCenter?.id ?? null,
                debit: 0,
                credit: amount,
                description: `صرف ${method === 'BANK' ? 'بنكي' : 'نقدي'} — سلفة الموظف ${advance.employee.name}`,
                order: 1,
              },
            ],
          },
        },
        select: { id: true },
      })

      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'ADVANCE',
        entityId: advance.id,
        entityNumber: advance.employee.code,
        title: `سلفة — ${advance.employee.name}`,
        summary: `صرف سلفة ${advance.employee.name} (${advance.employee.code}) — مبلغ ${fmtQty(amount)} ل.س — ${method === 'BANK' ? 'بنك' : 'نقداً'} — القيد ${number}`,
        details: {
          'الموظف': `${advance.employee.name} (${advance.employee.code})`,
          'المبلغ': fmtQty(amount),
          'تاريخ السلفة': fmtDateTime(advance.date),
          'طريقة الصرف': method === 'BANK' ? 'بنك' : 'نقداً',
          'مركز التكلفة': costCenter ? `${costCenter.name} (${costCenter.code})` : 'بلا مركز',
          'رقم القيد': number,
          'وقت الصرف': fmtDateTime(now),
        },
        amount,
      })

      return number
    })

    return NextResponse.json({
      ok: true,
      message: `تم صرف السلفة وإنشاء القيد ${entryNumber}`,
      entryNumber,
    })
  } catch (error) {
    if (error instanceof HrHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof PeriodClosedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('POST /api/advances/[id]/pay error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء صرف السلفة' }, { status: 500 })
  }
}
