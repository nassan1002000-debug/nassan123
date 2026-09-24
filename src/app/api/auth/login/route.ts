// POST /api/auth/login — تسجيل الدخول
// ----------------------------------------------------------------------------
// التحقق بـ scrypt حصراً (src/lib/password.ts) والجلسة توكن موقّع HMAC
// (src/lib/session.ts). لا كلمة مرور محروقة في الكود، ولا معرّف مستخدم خام في
// الكوكي، ولا هاش يغادر الخادم في أي استجابة.
//
// حماية التجربة العنيفة: 5 فشلات لاسم المستخدم ⇒ قفل 10 دقائق (RateLimitEntry).
// رسالة الفشل موحّدة عمداً في كل الحالات فلا يُستدل على وجود اسم المستخدم من ردّها.

import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { SESSION_COOKIE, SESSION_MAX_AGE, VIEW_PERIOD_COOKIE, signSession } from '@/lib/session'
import { verifyPassword } from '@/lib/password'
import { clearLoginFailures, loginLocked, recordLoginFailure } from '@/lib/rate-limit'
import { logAudit } from '@/lib/audit-server'

/** رسالة واحدة لكل أسباب الفشل — لا تكشف أي اسم مستخدم موجود من غيره */
const INVALID_CREDENTIALS = 'اسم المستخدم أو كلمة المرور غير صحيحة'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { username?: unknown; password?: unknown; viewPeriod?: unknown }
      | null

    // فراغات الطرفية تُمحى فقط — الوسطية جزء أصيل من كلمة المرور (القسم 1.3)
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const password = typeof body?.password === 'string' ? body.password.trim() : ''
    // معرف فترة مقفلة اختياري — دخول مباشر لوضع الاستعراض من شاشة الدخول (نفس آلية
    // POST /api/auth/period-view لاحقاً، لكن هنا ضمن نفس طلب الدخول الأول)
    const viewPeriodId = typeof body?.viewPeriod === 'string' ? body.viewPeriod.trim() : ''

    if (!username || !password) {
      return NextResponse.json(
        { error: 'يرجى إدخال اسم المستخدم وكلمة المرور' },
        { status: 400 },
      )
    }

    // حد المحاولات قبل أي عمل — القفل يسبق حتى البحث عن المستخدم
    const lock = await loginLocked(username)
    if (!lock.ok) {
      const minutes = Math.max(1, Math.ceil(lock.retryAfterSec / 60))
      return NextResponse.json(
        {
          error: `تم إيقاف المحاولات مؤقتاً بعد تكرار الفشل — أعد المحاولة بعد ${minutes} دقيقة`,
        },
        { status: 429, headers: { 'Retry-After': String(lock.retryAfterSec) } },
      )
    }

    const user = await db.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        passwordHash: true,
        isActive: true,
        sessionVersion: true,
        mustChangePassword: true,
      },
    })

    // التحقق بـ scrypt — ومقابل هاش وهمي عند غياب المستخدم ليبقى زمن الردّ متقارباً
    const stored = user?.passwordHash ?? ''
    const passwordOk = stored ? verifyPassword(password, stored) : false

    if (!user || !user.isActive || !passwordOk) {
      await recordLoginFailure(username)
      return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 })
    }

    await clearLoginFailures(username)

    // الاستجابة تحمل الحقول الآمنة حصراً — passwordHash لا يغادر الخادم أبداً
    const safeUser = {
      id: user.id,
      username: user.username,
      name: user.name || user.username,
      role: user.role,
      mustChangePassword: Boolean(user.mustChangePassword),
    }

    await logAudit(db, {
      action: 'SYSTEM',
      entity: 'USER',
      entityId: user.id,
      entityNumber: user.username,
      title: 'تسجيل دخول',
      summary: `دخول المستخدم ${user.username} (${safeUser.name}) إلى النظام`,
      details: { 'الدور': user.role, 'اسم المستخدم': user.username },
    })

    // وضع الاستعراض المباشر عند الدخول — فترة مقفلة اختيارية، تُتجاهَل بصمت إن كانت
    // غير موجودة أو غير صالحة (لا تُفشل تسجيل الدخول نفسه)، وتُهمَل أيضاً إن كانت
    // كلمة المرور افتراضية إلزامية التغيير — تلك الشاشة تسبق أي استعراض أرشيف
    let viewPeriod: {
      id: string
      label: string
      closingDate: string
      openingDate: string
      openingEntryNumber: string
      closedBy: string
    } | null = null
    if (viewPeriodId && !safeUser.mustChangePassword) {
      const p = await db.periodClose.findUnique({
        where: { id: viewPeriodId },
        select: {
          id: true,
          label: true,
          closingDate: true,
          openingDate: true,
          openingEntryNumber: true,
          closedBy: true,
        },
      })
      if (p) {
        viewPeriod = {
          id: p.id,
          label: p.label,
          closingDate: p.closingDate.toISOString().slice(0, 10),
          openingDate: p.openingDate.toISOString().slice(0, 10),
          openingEntryNumber: p.openingEntryNumber,
          closedBy: p.closedBy,
        }
        await logAudit(db, {
          action: 'SYSTEM',
          entity: 'PERIOD_CLOSE',
          entityId: viewPeriod.id,
          entityNumber: viewPeriod.label,
          title: 'دخول لاستعراض فترة سابقة',
          summary: `دخل ${user.username} (${safeUser.name}) لاستعراض الفترة المقفلة «${viewPeriod.label}» — قراءة فقط`,
          details: { 'الفترة': viewPeriod.label, 'تاريخ الإقفال': viewPeriod.closingDate },
        })
      }
    }

    const response = NextResponse.json({ success: true, user: safeUser, viewPeriod })
    response.cookies.set(SESSION_COOKIE, signSession(user), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    })
    if (viewPeriod) {
      response.cookies.set(VIEW_PERIOD_COOKIE, viewPeriod.id, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60,
      })
    }
    return response
  } catch (error) {
    console.error('POST /api/auth/login error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء تسجيل الدخول' }, { status: 500 })
  }
}
