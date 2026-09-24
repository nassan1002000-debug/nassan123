// العمليات اليدوية الفردية — إهداء نقاط أو خصم وحرمان لعميل واحد مع سبب إلزامي
// تُوثق الحركة فوراً في كشف حساب العميل داخل معاملة ذرية محكمة
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/api-guard'
import { applyLoyaltyMovement, getCustomerPoints, LoyaltyError } from '@/lib/loyalty-server'
import { logAudit } from '@/lib/audit-server'
import { fmtDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

// POST /api/loyalty/manual — { customerId, mode: 'GIFT' | 'DEDUCT', points, reason }
export async function POST(req: NextRequest) {
  const denied = await requireRole(req, 'ADMIN', 'ACCOUNTANT')
  if (denied) return denied
  try {
    const body = (await req.json().catch(() => null)) as {
      customerId?: string
      mode?: string
      points?: unknown
      reason?: string
    } | null
    if (!body) return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })

    const customerId = String(body.customerId ?? '').trim()
    if (!customerId) return NextResponse.json({ error: 'يجب اختيار العميل' }, { status: 400 })

    const mode = String(body.mode ?? '')
    if (!['GIFT', 'DEDUCT'].includes(mode)) {
      return NextResponse.json({ error: 'نوع العملية غير صالح — إهداء أو خصم' }, { status: 400 })
    }

    const points = Number(body.points)
    if (!Number.isInteger(points) || points <= 0) {
      return NextResponse.json({ error: 'عدد النقاط يجب أن يكون عدداً صحيحاً أكبر من صفر' }, { status: 400 })
    }
    if (points > 1_000_000) {
      return NextResponse.json({ error: 'عدد النقاط كبير جداً — الحد الأقصى مليون نقطة للعملية' }, { status: 400 })
    }

    const reason = String(body.reason ?? '').trim()
    if (!reason) {
      return NextResponse.json(
        { error: 'سبب العملية إلزامي — اكتب البيان الذي يظهر في كشف حساب العميل' },
        { status: 400 },
      )
    }
    if (reason.length > 400) {
      return NextResponse.json({ error: 'السبب طويل جداً — 400 خانة كحد أقصى' }, { status: 400 })
    }

    const customer = await db.partner.findUnique({
      where: { id: customerId },
      select: { id: true, name: true, code: true, type: true },
    })
    if (!customer) return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 })
    if (customer.type !== 'CUSTOMER') {
      return NextResponse.json({ error: `«${customer.name}» مورد — عمليات النقاط للعملاء حصراً` }, { status: 400 })
    }

    const result = await db.$transaction(async (tx) => {
      const balanceAfter = await applyLoyaltyMovement(tx, {
        customerId,
        points: mode === 'GIFT' ? points : -points,
        type: mode === 'GIFT' ? 'GIFT' : 'DEDUCT',
        reason,
        refType: 'MANUAL',
        refId: null,
        refNumber: null,
      })
      await logAudit(tx, {
        action: 'CREATE',
        entity: 'SYSTEM',
        entityId: `loyalty-${customerId}`,
        title: `نقاط ولاء — ${customer.name}`,
        summary:
          mode === 'GIFT'
            ? `إهداء ${points} نقطة ولاء للعميل ${customer.name} (${customer.code}) — السبب: ${reason}`
            : `خصم وحرمان ${points} نقطة ولاء من العميل ${customer.name} (${customer.code}) — السبب: ${reason}`,
        details: {
          'العميل': `${customer.name} (${customer.code})`,
          'نوع العملية': mode === 'GIFT' ? 'إهداء نقاط' : 'خصم وحرمان',
          'عدد النقاط': String(points),
          'الرصيد بعد الحركة': String(balanceAfter),
          'السبب': reason,
          'وقت العملية': fmtDateTime(new Date()),
        },
      })
      return balanceAfter
    })

    const after = await getCustomerPoints(db, customerId)
    return NextResponse.json({
      ok: true,
      balanceAfter: result,
      available: after.available,
      redeemed: after.redeemed,
    })
  } catch (error) {
    if (error instanceof LoyaltyError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('POST /api/loyalty/manual error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء تنفيذ عملية النقاط' }, { status: 500 })
  }
}
