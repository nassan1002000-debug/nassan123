import { NextResponse, type NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { PAYMENT_METHODS, PAYMENT_TYPES, nextPaymentNumber, validatePaymentBody } from '@/lib/payments-server'
import { postPaymentJournal } from '@/lib/payment-journal'
import { PeriodClosedError } from '@/lib/period-server'
import { logAudit, auditMoney } from '@/lib/audit-server'
import { AR_METHOD, AR_PAYMENT_TYPE, fmtDateTime } from '@/lib/format'

// GET /api/payments?type=RECEIPT|PAYMENT — قائمة السندات مع الفلترة والتقسيم + إحصاءات
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const type = sp.get('type') === 'PAYMENT' ? 'PAYMENT' : 'RECEIPT'
    const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(sp.get('pageSize') ?? '15', 10) || 15))

    const where: Prisma.PaymentWhereInput = { type }

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

    // فلترة الطريقة
    const method = sp.get('method')
    if (method && (PAYMENT_METHODS as readonly string[]).includes(method)) where.method = method

    // البحث النصي: رقم السند أو البيان أو اسم الطرف أو اسم حساب المصروف
    const q = sp.get('q')?.trim()
    if (q) {
      where.OR = [
        { number: { contains: q } },
        { notes: { contains: q } },
        { partner: { name: { contains: q } } },
        { account: { name: { contains: q } } },
      ]
    }

    // بداية الشهر الحالي (لإحصاء مستقلة عن الفلترة)
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)

    const [rows, total, aggregate, monthAgg, nextNumber] = await Promise.all([
      db.payment.findMany({
        where,
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          partner: { select: { code: true, name: true, type: true } },
          account: { select: { code: true, name: true, employee: { select: { code: true } } } },
          invoice: { select: { number: true } },
        },
      }),
      db.payment.count({ where }),
      db.payment.aggregate({ where, _sum: { amount: true }, _max: { amount: true } }),
      db.payment.aggregate({
        where: { type, date: { gte: monthStart, lt: monthEnd } },
        _sum: { amount: true },
      }),
      nextPaymentNumber(),
    ])

    const vouchers = rows.map((r) => ({
      id: r.id,
      number: r.number,
      type: r.type,
      date: r.date.toISOString(),
      amount: r.amount,
      method: r.method,
      notes: r.notes,
      partner: r.partner ? { code: r.partner.code, name: r.partner.name, type: r.partner.type } : null,
      account: r.account
        ? { code: r.account.code, name: r.account.name, isEmployee: !!r.account.employee }
        : null,
      invoiceNumber: r.invoice?.number ?? null,
    }))

    const sum = aggregate._sum.amount ?? 0
    const count = total

    return NextResponse.json({
      vouchers,
      total,
      page,
      pageSize,
      nextNumber,
      totals: {
        sum,
        count,
        avg: count > 0 ? sum / count : 0,
        thisMonth: monthAgg._sum.amount ?? 0,
      },
    })
  } catch (error) {
    console.error('GET /api/payments error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب السندات' }, { status: 500 })
  }
}

// POST /api/payments — إنشاء سند قبض أو دفع جديد
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const result = await validatePaymentBody(body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    const data = result.data

    // Task 102/104 — بيانات الحساب المُقيَّد عليه السند: مصروف (5xxx) أو حساب موظف شخصي (115xxx)
    const account = data.accountId
      ? await db.account.findUnique({
          where: { id: data.accountId },
          select: {
            code: true,
            name: true,
            type: true,
            nature: true,
            employee: { select: { code: true, name: true } },
          },
        })
      : null
    const accountKind = account?.employee ? 'EMPLOYEE' : 'EXPENSE'

    let created: { id: string } | null = null
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await db.$transaction(async (tx) => {
          const number = await nextPaymentNumber(tx)
          const payment = await tx.payment.create({
            data: { ...data, number },
            select: { id: true },
          })

          const partner = data.partnerId
            ? await tx.partner.findUnique({
                where: { id: data.partnerId },
                select: { name: true, type: true, account: { select: { code: true } } },
              })
            : null
          const partnerName = partner?.name ?? ''
          const typeLabel = AR_PAYMENT_TYPE[data.type] ?? data.type
          // اسم الجهة في التوثيق: الطرف أو حساب المصروف (Task 102)
          const partyLabel = partnerName || account?.name || 'بدون طرف'

          // القيد المحاسبي التلقائي للسند المستقل — داخل المعاملة نفسها (نمط الفواتير)
          // الشيك/بلا طرف وبلا حساب/مرتبط بفاتورة → بلا قيد (يرجع null)
          const journalNumber = await postPaymentJournal(tx, {
            paymentId: payment.id,
            type: data.type,
            date: data.date,
            number,
            amount: data.amount,
            method: data.method,
            partnerId: data.partnerId,
            partnerName,
            partnerAccountCode: partner?.account?.code ?? null,
            accountId: data.accountId,
            accountCode: account?.code ?? null,
            accountName: account?.name ?? null,
            accountType: account?.type ?? null,
            accountNature: account?.nature ?? null,
            accountKind,
            invoiceId: data.invoiceId,
          })

          // التوثيق في سجل التدقيق — داخل المعاملة نفسها (نمط الفواتير)
          await logAudit(tx, {
            action: 'CREATE',
            entity: 'PAYMENT',
            entityId: payment.id,
            entityNumber: number,
            title: `${typeLabel} ${number}`,
            summary: `إنشاء ${typeLabel} ${number} — الجهة: ${partyLabel} — المبلغ ${auditMoney(data.amount)} ل.س — ${AR_METHOD[data.method] ?? data.method} — ${journalNumber ? `رُحّل تلقائياً بالقيد ${journalNumber}` : 'بلا قيد محاسبي'}${data.notes ? ` — ملاحظات: ${data.notes}` : ''}`,
            details: {
              'النوع': typeLabel,
              'الرقم': number,
              'الجهة': partyLabel,
              'نوع الجهة': partner
                ? partner.type === 'SUPPLIER'
                  ? 'مورد'
                  : 'عميل'
                : account
                  ? account.employee
                    ? `حساب موظف (شجرة الحسابات — ${account.employee.code})`
                    : 'حساب مصروف (دليل الحسابات)'
                  : 'بدون طرف',
              'المبلغ (ل.س)': auditMoney(data.amount),
              'الطريقة': AR_METHOD[data.method] ?? data.method,
              'الارتباط': data.invoiceId ? 'سند فاتورة' : 'سند مستقل',
              'القيد المحاسبي': journalNumber
                ? `رُحّل تلقائياً — القيد ${journalNumber}`
                : data.method === 'CHEQUE'
                  ? 'بدون — شيك على ذمة الطرف حتى الصرف'
                  : data.partnerId
                    ? 'بدون — سند مرتبط بفاتورة (قيد الفاتورة يغطيه)'
                    : 'بدون — بلا طرف لا يوجد حساب مقابل',
              'وقت الإنشاء': fmtDateTime(new Date()),
            },
            amount: data.amount,
          })

          return payment
        })
      } catch (e) {
        const code = (e as { code?: string })?.code
        if (code === 'P2002' && attempt < 2) continue
        throw e
      }
    }
    if (!created) {
      return NextResponse.json({ error: 'تعذر توليد رقم السند — حاول مجدداً' }, { status: 500 })
    }

    const full = await db.payment.findUnique({
      where: { id: created.id },
      include: {
        partner: { select: { code: true, name: true, type: true } },
        account: { select: { code: true, name: true, employee: { select: { code: true } } } },
        invoice: { select: { number: true } },
      },
    })
    return NextResponse.json(
      full
        ? {
            ...full,
            account: full.account
              ? {
                  code: full.account.code,
                  name: full.account.name,
                  isEmployee: !!full.account.employee,
                }
              : null,
          }
        : null,
      { status: 201 },
    )
  } catch (error) {
    if (error instanceof PeriodClosedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('POST /api/payments error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء إنشاء السند' }, { status: 500 })
  }
}
