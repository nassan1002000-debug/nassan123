// بوابة الطلبات — حرس الجلسة والأدوار وحظر الكتابة في وضع الأرشيف
// ----------------------------------------------------------------------------
// خط الدفاع الأول أمام كل مسارات API (القسم 1.3 و القسم 8.3). لا يلغي حرس
// المسارات نفسها (src/lib/api-guard.ts) بل يسبقه: مسار يُنسى حارسه يبقى محمياً
// هنا، فالحماية لا تعتمد على أن يتذكّرها كاتب كل مسار جديد.
//
// يعتمد على أن ملف البوابة في Next.js 16 يعمل ببيئة Node دائماً (لا Edge) — وهو
// شرط لازم هنا: التحقق من التوقيع يحتاج createHmac وقراءة ملف السر
// db/auth-secret.txt، وكلاهما غير متاح في بيئة Edge. ولهذا لا يُصرَّح بـ
// `export const runtime` في هذا الملف — Next يرفضه صراحةً لأن البيئة مفروضة أصلاً.
//
// ترتيب الفحص: مسار عام ← جلسة صالحة ← وضع الأرشيف ← دور VIEWER ← مسارات المدير.

import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, VIEW_PERIOD_COOKIE, verifySessionToken } from '@/lib/session'

/** طرق الكتابة — كل ما عداها (GET/HEAD/OPTIONS) قراءة */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * مسارات لا تتطلب جلسة إطلاقاً — تسجيل الدخول، وقائمة الفترات المقفلة المبسّطة
 * التي تعرضها شاشة الدخول قبل المصادقة (بلا جلسة عمداً حسب تعليق المسار نفسه) —
 * كانت مفقودة من هذه المجموعة فيُحجب المسار بـ401 قبل أن يصل الطلب إليه أصلاً
 */
const PUBLIC_API = new Set(['/api/auth/login', '/api/period-close/public'])

/**
 * مسارات إدارة الجلسة نفسها — تُستثنى من حظر الكتابة (الأرشيف/VIEWER) لأنها لا
 * تمس بيانات مالية: الخروج، وتبديل وضع استعراض الفترة، وتغيير كلمة المرور.
 * بدون هذا الاستثناء يعلق المستخدم داخل وضع الأرشيف بلا مخرج.
 */
const SESSION_API_PREFIX = '/api/auth/'

/**
 * التهيئة الأولى: حين لا توجد جلسة ويكون الهدف /api/users، يُمرَّر الطلب إلى
 * حارس المسار نفسه (adminOrBootstrap / bootstrapOrSession) — فهو وحده يعرف إن
 * كان جدول المستخدمين فارغاً (إنشاء أول مدير) أم أنه يتطلب دور ADMIN.
 */
const BOOTSTRAP_DELEGATED = '/api/users'

/** مسارات المدير الحصرية بكل الطرق — الإقفال العكسي والتصفير والنسخ الاحتياطي */
const ADMIN_ONLY = ['/api/backup', '/api/reset', '/api/period-close/undo']

/** مسارات لا يكتب فيها إلا المدير — القراءة متروكة لحرس المسار */
const ADMIN_ONLY_WRITES = ['/api/users']

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

function deny(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // الصفحات وملفات العرض تمر كما هي — الواجهة تعرض شاشة الدخول عند غياب الجلسة
  if (!pathname.startsWith('/api/')) return NextResponse.next()
  if (PUBLIC_API.has(pathname)) return NextResponse.next()

  const session = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)

  if (!session) {
    if (pathname === BOOTSTRAP_DELEGATED) return NextResponse.next()
    return deny('الجلسة منتهية أو غير مسجل الدخول — سجّل الدخول من جديد', 401)
  }

  const isWrite = WRITE_METHODS.has(req.method.toUpperCase())
  const isSessionRoute = pathname.startsWith(SESSION_API_PREFIX)

  // وضع استعراض فترة مقفلة — النسخة الأرشيفية للقراءة فقط (القسم 8.3)
  if (isWrite && !isSessionRoute && req.cookies.get(VIEW_PERIOD_COOKIE)?.value) {
    return deny(
      'أنت في وضع استعراض فترة محاسبية مقفلة — النسخة الأرشيفية للقراءة فقط ولا تقبل أي إضافة أو تعديل أو حذف. عُد إلى الفترة الحالية أولاً.',
      403,
    )
  }

  // VIEWER — قراءة حصراً
  if (isWrite && !isSessionRoute && session.role === 'VIEWER') {
    return deny('صلاحيتك «مشاهد التقارير» — قراءة فقط بلا أي إضافة أو تعديل أو حذف', 403)
  }

  // مسارات المدير الحصرية
  if (session.role !== 'ADMIN') {
    if (matches(pathname, ADMIN_ONLY)) {
      return deny('لا تملك صلاحية هذه العملية — متاحة للمدير فقط', 403)
    }
    if (isWrite && matches(pathname, ADMIN_ONLY_WRITES)) {
      return deny('إدارة المستخدمين متاحة للمدير فقط', 403)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
