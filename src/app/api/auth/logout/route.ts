// POST /api/auth/logout — إنهاء الجلسة ومسح الكوكي
// التوثيق يعتمد الهوية المتحقَّقة من التوكن لا قيمة الكوكي الخام — فلا يُكتب في
// سجل التدقيق اسم مستخدم لم يُثبت أحدٌ أنه هو. والكوكي يُمسح في كل الأحوال.

import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { SESSION_COOKIE, VIEW_PERIOD_COOKIE } from '@/lib/session'
import { getSessionUser } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit-server'

export async function POST(req: NextRequest) {
  const response = NextResponse.json({ success: true })
  // مسح كوكي الجلسة وكوكي استعراض الأرشيف معاً — لا تبقى جلسة معلّقة في وضع قراءة
  for (const name of [SESSION_COOKIE, VIEW_PERIOD_COOKIE]) {
    response.cookies.set(name, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  }

  try {
    const me = await getSessionUser(req.cookies.get(SESSION_COOKIE)?.value)
    if (me) {
      await logAudit(db, {
        action: 'SYSTEM',
        entity: 'USER',
        entityId: me.id,
        entityNumber: me.username,
        title: 'تسجيل خروج',
        summary: `خروج المستخدم ${me.username} (${me.name}) من النظام`,
        details: { 'الدور': me.role },
      })
    }
  } catch (error) {
    // فشل التوثيق لا يمنع الخروج — الكوكي مُمسوح في الاستجابة أعلاه على كل حال
    console.error('POST /api/auth/logout audit error:', error)
  }

  return response
}
