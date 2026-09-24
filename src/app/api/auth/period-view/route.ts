// GET  /api/auth/period-view — الخروج من وضع استعراض الفترة السابقة والعودة للفترة الحالية
// GET عمداً: يعمل داخل وضع القراءة فقط (البوابة تحجب الكتابة أثناء الاستعراض) — والخروج إجراء آمن لا يغير بيانات
// POST /api/auth/period-view — الدخول لوضع الاستعراض أثناء جلسة قائمة (من الإعدادات أو شاشة الاستعراض)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit-server'
import { SESSION_COOKIE, VIEW_PERIOD_COOKIE } from '@/lib/session'

export const dynamic = 'force-dynamic'

const clearVp = (res: NextResponse): NextResponse => {
  res.cookies.set(VIEW_PERIOD_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return res
}

export async function GET(req: NextRequest) {
  try {
    const me = await getSessionUser(req.cookies.get(SESSION_COOKIE)?.value)
    if (me) {
      await logAudit(db, {
        action: 'SYSTEM',
        entity: 'USER',
        entityId: me.id,
        entityNumber: me.username,
        title: 'العودة إلى الفترة الحالية',
        summary: `خرج ${me.username} (${me.name}) من وضع استعراض الفترة السابقة وعاد إلى الفترة الحالية`,
        details: { 'وقت الخروج': new Date().toISOString() },
      }).catch(() => undefined) // التوثيق لا يحجب الخروج
    }
    return clearVp(NextResponse.json({ ok: true }))
  } catch (error) {
    console.error('GET /api/auth/period-view (exit) error:', error)
    return clearVp(NextResponse.json({ ok: true })) // الخروج لا يفشل أبداً
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await getSessionUser(req.cookies.get(SESSION_COOKIE)?.value)
    if (!me) {
      return NextResponse.json({ error: 'الجلسة منتهية — سجّل الدخول من جديد' }, { status: 401 })
    }
    const body = (await req.json().catch(() => null)) as { id?: unknown } | null
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    if (!id) return NextResponse.json({ error: 'حدد الفترة المطلوب استعراضها' }, { status: 400 })

    const p = await db.periodClose.findUnique({
      where: { id },
      select: {
        id: true,
        label: true,
        closingDate: true,
        openingDate: true,
        openingEntryNumber: true,
        closedBy: true,
      },
    })
    if (!p) return NextResponse.json({ error: 'الفترة المطلوبة غير موجودة' }, { status: 404 })

    if (me.mustChangePassword) {
      return NextResponse.json(
        { error: 'غيّر كلمة المرور الافتراضية أولاً قبل استعراض الفترات' },
        { status: 400 },
      )
    }

    const viewPeriod = {
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
      summary: `دخل ${me.username} (${me.name}) لاستعراض الفترة المقفلة «${viewPeriod.label}» — قراءة فقط`,
      details: { 'الفترة': viewPeriod.label, 'تاريخ الإقفال': viewPeriod.closingDate },
    })

    const res = NextResponse.json({ ok: true, viewPeriod })
    res.cookies.set(VIEW_PERIOD_COOKIE, viewPeriod.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })
    return res
  } catch (error) {
    console.error('POST /api/auth/period-view (enter) error:', error)
    return NextResponse.json({ error: 'تعذر الدخول لوضع الاستعراض' }, { status: 500 })
  }
}
