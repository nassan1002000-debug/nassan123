// التحقق من هوية المستخدم الحالي — المصدر الوحيد لقراءة الجلسة في كل النظام
// ----------------------------------------------------------------------------
// الجلسة توكن موقّع HMAC-SHA256 (src/lib/session.ts) لا معرّف مستخدم خام:
//   1) يُتحقق من التوقيع والصلاحية تشفيرياً قبل أي لمس للقاعدة
//   2) ثم يُطابَق المستخدم بالقاعدة: موجود + فعّال + sessionVersion مطابق
//      (رفع sessionVersion يُبطل كل الجلسات القديمة فوراً — القسم 1.3)
//
// تستخدم dbLive عمداً لا وكيل db: فحص الهوية لا يجوز أن يتأثر بسياق استعراض
// الأرشيف إطلاقاً — المستخدم يُقرأ من القاعدة الحية دائماً.

import { cookies } from 'next/headers'
import { dbLive } from '@/lib/db'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'

export interface SessionUser {
  id: string
  username: string
  name: string
  role: string
  mustChangePassword: boolean
}

/**
 * هوية المستخدم الحالي، أو null إن لم تكن هناك جلسة صالحة.
 *
 * @param token توكن الجلسة إن توفّر لدى المنادي (مسارات API تقرأه من `req.cookies`).
 *              عند إغفاله يُقرأ من كوكيز الطلب الجارية — فتعمل الدالة في الحالتين.
 */
export async function getSessionUser(token?: string | null): Promise<SessionUser | null> {
  try {
    let raw = token
    if (raw === undefined) {
      const cookieStore = await cookies()
      raw = cookieStore.get(SESSION_COOKIE)?.value ?? null
    }
    if (!raw) return null

    // 1) حرس تشفيري: توقيع صالح + غير منتهٍ — قبل أي استعلام
    const payload = verifySessionToken(raw)
    if (!payload) return null

    // 2) حرس قاعدي: المستخدم ما زال موجوداً وفعّالاً
    const user = await dbLive.user.findUnique({
      where: { id: payload.uid },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        isActive: true,
        sessionVersion: true,
        mustChangePassword: true,
      },
    })
    if (!user || !user.isActive) return null

    // 3) إبطال الجلسات القديمة: أي تغيير كلمة مرور أو إيقاف يرفع sessionVersion
    if ((payload.v ?? 1) !== user.sessionVersion) return null

    return {
      id: user.id,
      username: user.username,
      name: user.name || user.username,
      role: user.role,
      mustChangePassword: Boolean(user.mustChangePassword),
    }
  } catch {
    // أي عطل في القراءة يعني «لا جلسة» — الرفض دائماً وليس انهياراً
    return null
  }
}
