// الجدول الرئيسي الشامل لنقاط الولاء — كل العملاء مع رصيد المتاح وإجمالي المسترد سابقاً
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireApiSession } from '@/lib/api-guard'
import { getLoyaltySettings } from '@/lib/loyalty-server'
import { calculateAwardPoints } from '@/lib/loyalty'
import { toWhatsappUrl } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

// GET /api/loyalty — صف لكل عميل: (اسم | الرصيد المتاح | إجمالي المسترد سابقاً | إجمالي المكتسب)
export async function GET(req: NextRequest) {
  const denied = await requireApiSession(req)
  if (denied) return denied
  try {
    const sp = req.nextUrl.searchParams
    const q = sp.get('q')?.trim() ?? ''

    const settings = await getLoyaltySettings()

    const [customers, balances, redeemed, earned] = await Promise.all([
      db.partner.findMany({
        where: {
          type: 'CUSTOMER',
          ...(q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }, { phone: { contains: q } }] } : {}),
        },
        select: { id: true, code: true, name: true, phone: true, isActive: true },
        orderBy: { name: 'asc' },
      }),
      // الرصيد المتاح = مجموع النقاط الموقعة لكل عميل
      db.loyaltyTransaction.groupBy({ by: ['customerId'], _sum: { points: true } }),
      // إجمالي المسترد سابقاً = الاسترداد داخل الفواتير + الصرف النقدي (قيم مطلقة)
      db.loyaltyTransaction.groupBy({
        by: ['customerId'],
        where: { type: { in: ['REDEEM', 'CASHOUT'] }, points: { lt: 0 } },
        _sum: { points: true },
      }),
      db.loyaltyTransaction.groupBy({
        by: ['customerId'],
        where: { type: 'EARN', points: { gt: 0 } },
        _sum: { points: true },
      }),
    ])

    const balanceOf = new Map(balances.map((b) => [b.customerId, b._sum.points ?? 0]))
    const redeemedOf = new Map(redeemed.map((b) => [b.customerId, Math.abs(b._sum.points ?? 0)]))
    const earnedOf = new Map(earned.map((b) => [b.customerId, b._sum.points ?? 0]))

    const customersOut = customers.map((c) => ({
      ...c,
      whatsappUrl: toWhatsappUrl(c.phone),
      available: balanceOf.get(c.id) ?? 0,
      redeemed: redeemedOf.get(c.id) ?? 0,
      earned: earnedOf.get(c.id) ?? 0,
      redeemValue: Math.round((balanceOf.get(c.id) ?? 0) * settings.pointPrice),
    }))

    const totals = {
      customers: customersOut.length,
      withBalance: customersOut.filter((c) => c.available > 0).length,
      availablePoints: customersOut.reduce((s, c) => s + Math.max(0, c.available), 0),
      redeemedPoints: customersOut.reduce((s, c) => s + c.redeemed, 0),
      redeemValue: customersOut.reduce((s, c) => s + Math.max(0, c.redeemValue), 0),
    }

    return NextResponse.json({
      settings,
      customers: customersOut,
      totals,
      // آخر فاتورة مؤهلة — معلومة توضيحية لواجهة الإعدادات (جدول المضاعفات الحي)
      lastRowExample: calculateAwardPoints(settings.minInvoiceValue * 4, settings),
    })
  } catch (error) {
    console.error('GET /api/loyalty error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب جدول نقاط الولاء' }, { status: 500 })
  }
}
