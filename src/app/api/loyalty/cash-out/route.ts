// صرف الكاش المباشر — تحويل القيمة المالية لنقاط العميل إلى سند دفع نقدًا
// معاملة ذرية واحدة: خصم النقاط من الكشف + سند دفع VCH من الصندوق (1110) + قيد مزدوج
// (مدين: الحسم الممنوح 4110 — دائن: الصندوق 1110) وتُصفر النقاط المستبدلة فوراً
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/api-guard'
import { cashOutLoyaltyPoints, getCustomerPoints, LoyaltyError } from '@/lib/loyalty-server'
import { logAudit } from '@/lib/audit-server'
import { fmtDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

// POST /api/loyalty/cash-out — { customerId, points? } — الافتراضي: كامل الرصيد المتاح
export async function POST(req: NextRequest) {
  const denied = await requireRole(req, 'ADMIN', 'ACCOUNTANT')
  if (denied) return denied
  try {
    const body = (await req.json().catch(() => null)) as { customerId?: string; points?: unknown } | null
    if (!body) return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })

    const customerId = String(body.customerId ?? '').trim()
    if (!customerId) return NextResponse.json({ error: 'يجب اختيار العميل' }, { status: 400 })

    const customer = await db.partner.findUnique({
      where: { id: customerId },
      select: { id: true, name: true, code: true, type: true },
    })
    if (!customer) return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 })
    if (customer.type !== 'CUSTOMER') {
      return NextResponse.json({ error: `«${customer.name}» مورد — صرف النقاط للعملاء حصراً` }, { status: 400 })
    }

    const before = await getCustomerPoints(db, customerId)
    const requested = body.points === undefined || body.points === null ? before.available : Number(body.points)
    if (!Number.isInteger(requested) || requested <= 0) {
      return NextResponse.json(
        { error: 'عدد النقاط المطلوب صرفها يجب أن يكون عدداً صحيحاً أكبر من صفر' },
        { status: 400 },
      )
    }

    const result = await db.$transaction(async (tx) => {
      const out = await cashOutLoyaltyPoints(tx, {
        customerId,
        customerName: customer.name,
        points: requested,
      })
      await logAudit(tx, {
        action: 'CREATE',
        entity: 'PAYMENT',
        entityId: out.voucherNumber,
        entityNumber: out.voucherNumber,
        title: `صرف نقاط ولاء — ${customer.name}`,
        summary: `صرف نقدي لنقاط ولاء العميل ${customer.name} (${customer.code}) — ${out.points} نقطة بقيمة ${out.amount.toLocaleString('en-US')} ل.س — سند دفع ${out.voucherNumber} من الصندوق (1110) وقيد ${out.entryNumber} على الحسم الممنوح (4110)`,
        details: {
          'العميل': `${customer.name} (${customer.code})`,
          'النقاط المصروفة': String(out.points),
          'القيمة المصروفة (ل.س)': out.amount.toLocaleString('en-US'),
          'سند الدفع': out.voucherNumber,
          'القيد المحاسبي': `${out.entryNumber} — مدين: الحسم الممنوح 4110 / دائن: الصندوق 1110`,
          'الرصيد قبل الصرف': `${before.available} نقطة`,
          'وقت الصرف': fmtDateTime(new Date()),
        },
        amount: out.amount,
      })
      return out
    })

    const after = await getCustomerPoints(db, customerId)
    return NextResponse.json({
      ok: true,
      voucherNumber: result.voucherNumber,
      entryNumber: result.entryNumber,
      amount: result.amount,
      points: result.points,
      available: after.available,
      redeemed: after.redeemed,
    })
  } catch (error) {
    if (error instanceof LoyaltyError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('POST /api/loyalty/cash-out error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء صرف نقاط الولاء' }, { status: 500 })
  }
}
