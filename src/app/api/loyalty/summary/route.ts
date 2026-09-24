// ملخص نقاط عميل واحد — مربع البيانات الصغير تحت اسم العميل في فاتورة المبيعات
// صمام الأمان: إن كان النظام غير منشط يعود isEnabled=false فتختفي الواجهة كلها من الفاتورة
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireApiSession } from '@/lib/api-guard'
import { getCustomerPoints, getLoyaltySettings } from '@/lib/loyalty-server'

export const dynamic = 'force-dynamic'

// GET /api/loyalty/summary?customerId=xxx
export async function GET(req: NextRequest) {
  const denied = await requireApiSession(req)
  if (denied) return denied
  try {
    const customerId = req.nextUrl.searchParams.get('customerId')?.trim() ?? ''
    const settings = await getLoyaltySettings()

    // النظام غير منشط — لا حاجة لأي قراءة نقاط: الواجهة ستعود لنموذجها الأصلي فوراً
    if (!settings.isEnabled || !customerId) {
      return NextResponse.json({
        isEnabled: settings.isEnabled,
        available: 0,
        redeemed: 0,
        earned: 0,
        pointPrice: settings.pointPrice,
        minInvoiceValue: settings.minInvoiceValue,
        basePoints: settings.basePoints,
        multiplicationFactor: settings.multiplicationFactor,
      })
    }

    const customer = await db.partner.findUnique({
      where: { id: customerId },
      select: { type: true },
    })
    if (!customer || customer.type !== 'CUSTOMER') {
      return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 })
    }

    const points = await getCustomerPoints(db, customerId)
    return NextResponse.json({
      isEnabled: true,
      available: points.available,
      redeemed: points.redeemed,
      earned: points.earned,
      pointPrice: settings.pointPrice,
      minInvoiceValue: settings.minInvoiceValue,
      basePoints: settings.basePoints,
      multiplicationFactor: settings.multiplicationFactor,
    })
  } catch (error) {
    console.error('GET /api/loyalty/summary error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب ملخص النقاط' }, { status: 500 })
  }
}
