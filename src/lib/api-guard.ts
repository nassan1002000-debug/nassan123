// حراسة الجلسة لمسارات الـAPI — تستخدم في المسارات التي تمر من البوابة بوضع استثنائي
// (users في وضع التهيئة الأولى) — ترجع 401 عربية عند غياب الجلسة أو توقف الحساب
import { NextResponse, type NextRequest } from 'next/server'
import { dbLive } from '@/lib/db'
import { getSessionUser } from '@/lib/auth-server'
import { SESSION_COOKIE } from '@/lib/session'

/** رسالة 401 الموحدة لكل المسارات المحمية */
export const UNAUTHENTICATED_MESSAGE = 'الجلسة منتهية أو غير مسجل الدخول — سجّل الدخول من جديد'

/** رسالة 403 الموحدة للمسارات الإدارية */
export const ADMIN_ONLY_MESSAGE = 'لا تملك صلاحية هذه العملية — متاحة للمدير فقط'

/**
 * يفحص كوكي الجلسة بالكامل (توقيع + صلاحية + حساب موجود وفعال بالقاعدة)
 * — يرجع استجابة 401 عند الرفض أو null عند السماح بمرور الطلب
 */
export async function requireApiSession(req: NextRequest): Promise<NextResponse | null> {
  const user = await getSessionUser(req.cookies.get(SESSION_COOKIE)?.value)
  if (!user) {
    return NextResponse.json({ error: UNAUTHENTICATED_MESSAGE }, { status: 401 })
  }
  return null
}

/**
 * حرس المسارات الإدارية (مرحلة صفر P0-4): جلسة كاملة بالقاعدة + دور ADMIN إلزامي
 * — يُستخدم في: المستخدمين (إضافة/تعديل/حذف) والإعدادات الحساسة والتفريغ
 */
export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const user = await getSessionUser(req.cookies.get(SESSION_COOKIE)?.value)
  if (!user) {
    return NextResponse.json({ error: UNAUTHENTICATED_MESSAGE }, { status: 401 })
  }
  if (user.role !== 'ADMIN') {
    return NextResponse.json({ error: ADMIN_ONLY_MESSAGE }, { status: 403 })
  }
  return null
}

/**
 * حرس أدوار مرن: جلسة كاملة + دور ضمن القائمة المسموحة
 * — يُستخدم في الفترات المحاسبية (الإنشاء/الإقفال للمدير والمحاسب، والتراجع للمدير فقط)
 */
export async function requireRole(
  req: NextRequest,
  ...roles: string[]
): Promise<NextResponse | null> {
  const user = await getSessionUser(req.cookies.get(SESSION_COOKIE)?.value)
  if (!user) {
    return NextResponse.json({ error: UNAUTHENTICATED_MESSAGE }, { status: 401 })
  }
  if (!roles.includes(user.role)) {
    return NextResponse.json(
      { error: 'لا تملك صلاحية هذه العملية' },
      { status: 403 },
    )
  }
  return null
}

/**
 * حرس مزدوج لإنشاء المستخدمين: يسمح بلا جلسة فقط في وضع التهيئة الأولى (جدول فارغ —
 * إنشاء أول مدير) — وإلا فهو مسار إداري خالص يتطلب دور ADMIN
 */
export async function adminOrBootstrap(req: NextRequest): Promise<NextResponse | null> {
  const users = await dbUserCount()
  if (users === 0) return null
  return requireAdmin(req)
}

async function dbUserCount(): Promise<number> {
  try {
    return await dbLive.user.count()
  } catch {
    // فشل الوصول للقاعدة — نتعامل معه كوضع تهيئة (القاعدة فارغة/غير مهيأة)
    return 0
  }
}

/**
 * حرس التهيئة الأولى: المسار يُسمح به بلا جلسة **فقط حين لا يوجد أي مستخدم في القاعدة**
 * (وضع ما قبل أول دخول — وإلا فالنظام يصبح مستحيلاً الدخول) — وعند وجود مستخدمين تُطبق الحماية الكاملة
 */
export async function bootstrapOrSession(req: NextRequest): Promise<NextResponse | null> {
  const users = await dbUserCount()
  if (users === 0) return null
  return requireApiSession(req)
}
