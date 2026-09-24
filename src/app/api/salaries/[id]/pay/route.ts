import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { fmtDateTime, fmtQty } from '@/lib/format'
import { nextEntryNumber, round2 } from '@/lib/journal-server'
import { ensureInvoiceAccounts, INVOICE_ACCOUNTS } from '@/lib/invoice-journal'
import { assertPeriodOpen, PeriodClosedError } from '@/lib/period-server'
import { bodyString, bodyStringOrNull, HrHttpError, type PayMethod } from '@/lib/hr-server'

type Params = { params: Promise<{ id: string }> }

// POST /api/salaries/[id]/pay — صرف القسط المعلق (نقداً أو بنك) + قيد مزدوج مُرحّل للصافي الموجب
// الدليل: مدين 5200 مصروف الرواتب والأجور — دائن 1110 الصندوق أو 1120 البنك
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

    const salary = await db.salary.findUnique({
      where: { id },
      include: { employee: { select: { id: true, code: true, name: true } } },
    })
    if (!salary) {
      return NextResponse.json({ error: 'قسط الراتب غير موجود' }, { status: 404 })
    }
    if (salary.status !== 'PENDING') {
      return NextResponse.json({ error: 'القسط مصروف مسبقاً' }, { status: 409 })
    }

    const net = round2(salary.net)
    const now = new Date()

    const entryNumber = await db.$transaction(async (tx) => {
      // إنفاذ الفترات المقفلة: صرف راتب بتاريخ اليوم داخل فترة مقفلة ⇒ رفض
      await assertPeriodOpen(tx, now, 'صرف الراتب')
      // حرس الحالة داخل المعاملة — يمنع الصرف المزدوج في سباق نادر
      const upd = await tx.salary.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'PAID', paidAt: now },
      })
      if (upd.count === 0) throw new HrHttpError('القسط مصروف مسبقاً', 409)

      let entryNo: string | null = null

      if (net > 0) {
        // ضمان الحسابات النظامية بالأكواد (5200/1110/1120) — تُنشأ نظامية إن غابت
        const byCode = await ensureInvoiceAccounts(tx)
        const salariesAcc = byCode.get(INVOICE_ACCOUNTS.SALARIES.code)!
        const cashBankAcc = byCode.get(method === 'BANK' ? INVOICE_ACCOUNTS.BANK.code : INVOICE_ACCOUNTS.CASH.code)!

        const number = await nextEntryNumber(tx)
        await tx.journalEntry.create({
          data: {
            number,
            date: now,
            description: `صرف راتب شهر ${salary.month} — الموظف ${salary.employee.name} (${salary.employee.code})`,
            source: 'SALARY',
            status: 'POSTED',
            totalDebit: net,
            totalCredit: net,
            refType: 'SALARY',
            refId: salary.id,
            lines: {
              create: [
                {
                  accountId: salariesAcc,
                  costCenterId: costCenter?.id ?? null,
                  debit: net,
                  credit: 0,
                  description: `مصروف رواتب شهر ${salary.month} — ${salary.employee.name}`,
                  order: 0,
                },
                {
                  accountId: cashBankAcc,
                  costCenterId: costCenter?.id ?? null,
                  debit: 0,
                  credit: net,
                  description: `صرف ${method === 'BANK' ? 'بنكي' : 'نقدي'} — راتب شهر ${salary.month} — ${salary.employee.name}`,
                  order: 1,
                },
              ],
            },
          },
          select: { id: true },
        })
        entryNo = number
      }

      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'SALARY',
        entityId: salary.id,
        entityNumber: `${salary.month}/${salary.employee.code}`,
        title: `راتب ${salary.employee.name} — شهر ${salary.month}`,
        summary: `صرف راتب ${salary.employee.name} (${salary.employee.code}) — شهر ${salary.month} — الصافي ${fmtQty(net)} ل.س — ${method === 'BANK' ? 'بنك' : 'نقداً'}${entryNo ? ` — القيد ${entryNo}` : ' — بلا قيد (صافي صفري)'}`,
        details: {
          'الموظف': `${salary.employee.name} (${salary.employee.code})`,
          'الشهر': salary.month,
          'الراتب الأساسي': fmtQty(salary.base),
          'المكافآت': fmtQty(salary.bonuses),
          'الاحتسابات': fmtQty(salary.deductions),
          'الصافي المصروف': fmtQty(net),
          'طريقة الصرف': method === 'BANK' ? 'بنك' : 'نقداً',
          'مركز التكلفة': costCenter ? `${costCenter.name} (${costCenter.code})` : 'بلا مركز',
          'رقم القيد': entryNo ?? 'بلا قيد',
          'وقت الصرف': fmtDateTime(now),
        },
        amount: net,
      })

      return entryNo
    })

    return NextResponse.json({
      ok: true,
      message: entryNumber ? `تم صرف الراتب وإنشاء القيد ${entryNumber}` : 'تم صرف الراتب',
      entryNumber,
    })
  } catch (error) {
    if (error instanceof HrHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof PeriodClosedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('POST /api/salaries/[id]/pay error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء صرف الراتب' }, { status: 500 })
  }
}
