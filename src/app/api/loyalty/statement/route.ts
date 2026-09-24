// كشف الحساب التفصيلي لنقاط عميل — كل الحركات مؤرخة مع الرصيد المتبقي بعد كل حركة
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireApiSession } from '@/lib/api-guard'
import { getCustomerPoints, getLoyaltySettings, LoyaltyError } from '@/lib/loyalty-server'
import { AR_LOYALTY_TX_TYPE, type LoyaltyTxType } from '@/lib/loyalty'

export const dynamic = 'force-dynamic'

// GET /api/loyalty/statement?customerId=xxx
export async function GET(req: NextRequest) {
  const denied = await requireApiSession(req)
  if (denied) return denied
  try {
    const customerId = req.nextUrl.searchParams.get('customerId')?.trim() ?? ''
    if (!customerId) return NextResponse.json({ error: 'معرّف العميل مطلوب' }, { status: 400 })

    const customer = await db.partner.findUnique({
      where: { id: customerId },
      select: { id: true, code: true, name: true, phone: true, type: true, isActive: true },
    })
    if (!customer) return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 })
    if (customer.type !== 'CUSTOMER') {
      return NextResponse.json({ error: 'كشوف نقاط الولاء للعملاء حصراً' }, { status: 400 })
    }

    const [rows, points, settings] = await Promise.all([
      db.loyaltyTransaction.findMany({
        where: { customerId },
        orderBy: [{ createdAt: 'asc' }],
        select: {
          id: true,
          type: true,
          points: true,
          balanceAfter: true,
          reason: true,
          refNumber: true,
          createdAt: true,
        },
      }),
      getCustomerPoints(db, customerId),
      getLoyaltySettings(),
    ])

    return NextResponse.json({
      customer,
      settings,
      points,
      rows: rows.map((r) => ({
        id: r.id,
        type: r.type as LoyaltyTxType,
        typeLabel: AR_LOYALTY_TX_TYPE[r.type as LoyaltyTxType] ?? r.type,
        points: r.points,
        balanceAfter: r.balanceAfter,
        reason: r.reason,
        refNumber: r.refNumber,
        createdAt: r.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    if (error instanceof LoyaltyError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('GET /api/loyalty/statement error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب كشف حساب النقاط' }, { status: 500 })
  }
}
