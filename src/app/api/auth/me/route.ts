// GET /api/auth/me — هوية المستخدم الحالي من الكوكي (فحص كامل بالقاعدة: موجود وفعال)
// 401 عند غياب الجلسة — الواجهة تستخدمه كبوابة العرض (شاشة الدخول عند الفشل)
// يعيد أيضاً وضع استعراض الفترة السابقة إن كان كوكي الاستعراض صالحاً (فترة موجودة فعلاً)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth-server'
import { SESSION_COOKIE, VIEW_PERIOD_COOKIE } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser(req.cookies.get(SESSION_COOKIE)?.value)
    if (!user) {
      return NextResponse.json({ error: 'غير مسجل الدخول' }, { status: 401 })
    }

    // وضع الاستعراض: كوكي معرف فترة يجب أن يطابق إقفالاً موجوداً فعلاً — وإلا يُمسح شفائياً
    // (كوكي يتيم بعد تراجع/تفريغ لا يجعل المستخدم عالقاً في وضع قراءة بلا سبب)
    let viewPeriod: {
      id: string
      label: string
      closingDate: string
      openingDate: string
      openingEntryNumber: string
      closedBy: string
    } | null = null
    let staleViewCookie = false
    const vpId = req.cookies.get(VIEW_PERIOD_COOKIE)?.value
    if (vpId) {
      const period = await db.periodClose
        .findUnique({
          where: { id: vpId },
          select: {
            id: true,
            label: true,
            closingDate: true,
            openingDate: true,
            openingEntryNumber: true,
            closedBy: true,
          },
        })
        .catch(() => null)
      if (period) {
        viewPeriod = {
          id: period.id,
          label: period.label,
          closingDate: period.closingDate.toISOString().slice(0, 10),
          openingDate: period.openingDate.toISOString().slice(0, 10),
          openingEntryNumber: period.openingEntryNumber,
          closedBy: period.closedBy,
        }
      } else {
        staleViewCookie = true
      }
    }

    const res = NextResponse.json({ user, viewPeriod })
    if (staleViewCookie) {
      res.cookies.set(VIEW_PERIOD_COOKIE, '', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      })
    }
    return res
  } catch (error) {
    console.error('GET /api/auth/me error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء التحقق من الجلسة' }, { status: 500 })
  }
}
