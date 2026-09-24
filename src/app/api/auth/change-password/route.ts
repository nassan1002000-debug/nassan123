// POST /api/auth/change-password — تغيير كلمة المرور الذاتي (المرحلة الأولى P1-3)
// لأي مستخدم مسجل: يتحقق من كلمة المرور الحالية ثم يثبت الجديدة ويرفع شارة
// mustChangePassword ويزيد إصدار الجلسة — فتسقط كل الجلسات الأخرى فوراً،
// بينما يبقى هذا الجهاز مسجلاً (توكن جديد بإصدار الأعلى يُثبت في الكوكي بالرد نفسه)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { getSessionUser } from '@/lib/auth-server'
import { hashPassword, verifyPassword } from '@/lib/password'
import { SESSION_COOKIE, signSession } from '@/lib/session'
import { rateLimit, requestIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const me = await getSessionUser(req.cookies.get(SESSION_COOKIE)?.value)
    if (!me) {
      return NextResponse.json({ error: 'الجلسة منتهية — سجّل الدخول من جديد' }, { status: 401 })
    }

    // حد من التكرار: 5 تغييرات كل 10 دقائق لكل جهاز — يكفي لأي استخدام مشروع
    const limit = await rateLimit(`chgpass:${requestIp(req)}`, 5, 10 * 60 * 1000)
    if (!limit.ok) {
      const mins = Math.max(1, Math.ceil(limit.retryAfterSec / 60))
      return NextResponse.json({ error: `محاولات كثيرة — جرّب مجدداً بعد ${mins} دقيقة` }, { status: 429 })
    }

    const body = (await req.json().catch(() => null)) as {
      currentPassword?: unknown
      newPassword?: unknown
    } | null
    // محص الفراغات الطرفية في الحالين — الاتساق مع تسجيل الدخول (فراغ لصق لا يصير قفلاً دائماً)
    const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword.trim() : ''
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword.trim() : ''

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'أدخل كلمة المرور الحالية والجديدة' }, { status: 400 })
    }
    if (newPassword.length < 6 || newPassword.length > 128) {
      return NextResponse.json(
        { error: 'كلمة المرور الجديدة يجب أن تكون من 6 إلى 128 حرفاً' },
        { status: 400 },
      )
    }
    if (newPassword === currentPassword) {
      return NextResponse.json(
        { error: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية' },
        { status: 400 },
      )
    }

    const user = await db.user.findUnique({ where: { id: me.id } })
    if (!user || !user.passwordHash || !verifyPassword(currentPassword, user.passwordHash)) {
      return NextResponse.json({ error: 'كلمة المرور الحالية غير صحيحة' }, { status: 400 })
    }

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: me.id },
        data: {
          passwordHash: hashPassword(newPassword),
          mustChangePassword: false, // P1-3: انتهت إجبارية التغيير
          sessionVersion: { increment: 1 }, // P1-1: تسقط كل الجلسات الأخرى فوراً
        },
      })
      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'USER',
        entityId: u.id,
        entityNumber: u.username,
        title: `تغيير كلمة المرور — ${u.username}`,
        summary: `غيّر المستخدم ${u.username} (${u.name}) كلمة مروره بنفسه${
          user.mustChangePassword ? ' — بعد إجبار التغيير لكلمة المرور الافتراضية' : ''
        } — وسقطت بقية جلساته النشطة`,
        details: {
          'اسم المستخدم': u.username,
          'الإصدار الجديد للجلسة': String(u.sessionVersion),
          'وقت التغيير': new Date().toISOString(),
        },
      })
      return u
    })

    // توكن جديد بإصدار الأعلى — هذا الجهاز يبقى مسجلاً والبقية تسقط
    const isHttps = (req.headers.get('x-forwarded-proto') ?? '').split(',')[0]?.trim() === 'https'
    const res = NextResponse.json({
      ok: true,
      message: 'تم تغيير كلمة المرور',
      user: {
        id: updated.id,
        username: updated.username,
        name: updated.name,
        role: updated.role,
        mustChangePassword: updated.mustChangePassword,
      },
    })
    res.cookies.set(SESSION_COOKIE, signSession(updated), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
      secure: isHttps,
    })
    return res
  } catch (error) {
    console.error('POST /api/auth/change-password error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء تغيير كلمة المرور' }, { status: 500 })
  }
}
