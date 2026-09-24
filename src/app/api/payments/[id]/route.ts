import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { cancelPaymentJournal } from '@/lib/payment-journal'
import { isLoyaltyCashOutVoucher } from '@/lib/loyalty-server'
import { assertPeriodOpen } from '@/lib/period-server'
import { logAudit, auditMoney } from '@/lib/audit-server'
import { AR_METHOD, AR_PAYMENT_TYPE, fmtDateTime } from '@/lib/format'

// DELETE /api/payments/[id] — حذف سند مستقل (سند الفاتورة ممنوع حذفه مباشرة)
// داخل معاملة واحدة: إلغاء القيد المرتبط (POSTED → CANCELLED) + حذف السند + التوثيق في سجل التدقيق
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.payment.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        type: true,
        date: true,
        amount: true,
        method: true,
        notes: true,
        invoiceId: true,
        partner: { select: { name: true, type: true } },
        account: { select: { code: true, name: true, employee: { select: { code: true } } } },
      },
    })
    if (!existing) {
      return NextResponse.json({ error: 'السند غير موجود' }, { status: 404 })
    }
    // سند مولّد تلقائياً من فاتورة: حذفه يفسد حالة السداد ورصيد الطرف — يُمنع
    if (existing.invoiceId) {
      return NextResponse.json(
        {
          error: `السند ${existing.number} مولّد تلقائياً من فاتورة ولا يمكن حذفه مباشرة — عدّل دفعات الفاتورة نفسها أو احذفها`,
        },
        { status: 409 },
      )
    }

    // سند صرف نقاط ولاء: حذفه يفسد كشف حساب نقاط العميل والنقاط المصروفة فعلاً — يُمنع
    if (await isLoyaltyCashOutVoucher(db, id)) {
      return NextResponse.json(
        {
          error: `السند ${existing.number} سند صرف نقاط ولاء مرتبط بكشف حساب نقاط العميل — لا يمكن حذفه من هنا`,
        },
        { status: 409 },
      )
    }

    const partnerName = existing.partner?.name ?? ''
    // اسم الجهة: الطرف أو حساب المصروف (Task 102)
    const partyLabel = partnerName || existing.account?.name || 'بدون طرف'
    const typeLabel = AR_PAYMENT_TYPE[existing.type] ?? existing.type

    // إنفاذ الفترات المقفلة: حذف سند مؤرّخ داخل فترة مقفلة ⇒ رفض
    try {
      await assertPeriodOpen(db, existing.date, `حذف ${typeLabel}`)
    } catch {
      return NextResponse.json(
        { error: `لا يمكن حذف السند ${existing.number} — تاريخه داخل فترة محاسبية مقفلة` },
        { status: 409 },
      )
    }

    await db.$transaction(async (tx) => {
      // إلغاء القيد المرتبط بالسند المستقل إن كان مُرحّلاً (نفس آلية journal/[id]/cancel)
      const cancelledEntryNumber = await cancelPaymentJournal(tx, id)

      await tx.payment.delete({ where: { id } })

      // التوثيق في سجل التدقيق — داخل المعاملة نفسها (نمط الفواتير)
      await logAudit(tx, {
        action: 'DELETE',
        entity: 'PAYMENT',
        entityId: id,
        entityNumber: existing.number,
        title: `${typeLabel} ${existing.number}`,
        summary: `حذف ${typeLabel} ${existing.number} — الجهة: ${partyLabel} — المبلغ ${auditMoney(existing.amount)} ل.س — ${AR_METHOD[existing.method] ?? existing.method} — ${cancelledEntryNumber ? `أُلغي القيد ${cancelledEntryNumber} المرتبط بالسند` : 'لا قيد مرتبط كان بحاجة للإلغاء'}${existing.notes ? ` — ملاحظات: ${existing.notes}` : ''}`,
        details: {
          'النوع': typeLabel,
          'الرقم': existing.number,
          'الجهة': partyLabel,
          'نوع الجهة': existing.partner
            ? existing.partner.type === 'SUPPLIER'
              ? 'مورد'
              : 'عميل'
            : existing.account
              ? existing.account.employee
                ? `حساب موظف (شجرة الحسابات — ${existing.account.employee.code})`
                : 'حساب مصروف (دليل الحسابات)'
              : 'بدون طرف',
          'المبلغ (ل.س)': auditMoney(existing.amount),
          'الطريقة': AR_METHOD[existing.method] ?? existing.method,
          'القيد المحاسبي': cancelledEntryNumber
            ? `أُلغي القيد ${cancelledEntryNumber} (POSTED ← CANCELLED)`
            : 'لا قيد مرتبط',
          'أثر الحذف': 'حذف السند وإلغاء قيده المحاسبي المرتبط',
          'وقت الحذف': fmtDateTime(new Date()),
        },
        amount: existing.amount,
      })
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/payments/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حذف السند' }, { status: 500 })
  }
}
