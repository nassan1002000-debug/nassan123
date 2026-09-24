import { NextResponse, type NextRequest } from 'next/server'
import path from 'node:path'
import { db } from '@/lib/db'
import { resetEnteredData, financialResetKeepStructures } from '@/lib/seed'
import { requireApiSession } from '@/lib/api-guard'
import { getSessionUser } from '@/lib/auth-server'
import { verifyPassword } from '@/lib/password'
import { rateLimit } from '@/lib/rate-limit'
import { logAudit } from '@/lib/audit-server'
import { SESSION_COOKIE } from '@/lib/session'
import { createDbBackup } from '@/lib/backup-server'

export const dynamic = 'force-dynamic'

/** أوضاع حذف البيانات — FULL تفريغ شامل كامل، FINANCIAL تصفير مالي مع الاحتفاظ بالهياكل */
type ResetMode = 'FULL' | 'FINANCIAL'

const MODES: readonly ResetMode[] = ['FULL', 'FINANCIAL']

function isResetMode(v: unknown): v is ResetMode {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v)
}

// POST /api/reset?confirm=yes — حذف البيانات بوضعين (جسم الطلب JSON):
// { mode: 'FULL' }      → تفريغ شامل كامل: كل البيانات والهياكل (يبقى حسابات الدخول والإعدادات فقط)
// { mode: 'FINANCIAL' } → تصفير مالي مع الاحتفاظ بالهياكل: الفواتير والقيود والسندات وحركات المخزون
//                         والمالية فقط — تبقى الأطراف وبطاقات المواد وشجرة الحسابات والمستودعات
//                         مفرغة الأرصدة جاهزة للعمل الفعلي
// حرس ثلاثي: جلسة سارية + دور مدير + كلمة مرور المدير (تحقق سدسي بتوقيت ثابت)
// + حد محاولات: 5 طلبات كل 10 دقائق ضد التجربة العنيفة على كلمة المرور
export async function POST(req: NextRequest) {
  const denied = await requireApiSession(req)
  if (denied) return denied

  const me = await getSessionUser(req.cookies.get(SESSION_COOKIE)?.value)
  if (!me || me.role !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'هذه العملية متاحة للمدير فقط' }, { status: 403 })
  }

  if (req.nextUrl.searchParams.get('confirm') !== 'yes') {
    return NextResponse.json(
      { ok: false, error: 'عملية خطرة غير قابلة للتراجع: أضف ?confirm=yes للتأكيد الصريح' },
      { status: 400 },
    )
  }

  // الجسم: الوضع + كلمة مرور المدير (إلزامية — «الأهم» كما طلب المستخدم)
  const body = (await req.json().catch(() => null)) as
    | { mode?: unknown; adminPassword?: unknown }
    | null
  if (!isResetMode(body?.mode)) {
    return NextResponse.json(
      { ok: false, error: 'حدد وضع الحذف: FULL للتفريغ الشامل الكامل أو FINANCIAL للتصفير المالي' },
      { status: 400 },
    )
  }
  const mode: ResetMode = body.mode
  const adminPassword = typeof body?.adminPassword === 'string' ? body.adminPassword : ''
  if (!adminPassword) {
    return NextResponse.json(
      { ok: false, error: 'كلمة مرور المدير مطلوبة لتأكيد هذه العملية الخطرة' },
      { status: 400 },
    )
  }

  // حد محاولات كلمة المرور — 5 طلبات كل 10 دقائق لكل مدير (حماية من التجربة العنيفة)
  const limited = await rateLimit(`reset:${me.id}`, 5, 10 * 60 * 1000)
  if (!limited.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `محاولات كثيرة — أعد المحاولة بعد ${limited.retryAfterSec} ثانية`,
      },
      { status: 429 },
    )
  }

  // 🔐 حماية المدير: التحقق من كلمة المرور مقابل هاش المستخدم الحالي (scrypt بتوقيت ثابت)
  const row = await db.user.findUnique({ where: { id: me.id }, select: { passwordHash: true } })
  if (!row?.passwordHash || !verifyPassword(adminPassword, row.passwordHash)) {
    await logAudit(db, {
      action: 'SYSTEM',
      entity: 'SYSTEM',
      entityId: null,
      entityNumber: null,
      title: 'محاولة حذف بيانات — كلمة مرور خاطئة',
      summary: `رفض محاولة ${mode === 'FULL' ? 'تفريغ شامل' : 'تصفير مالي'} لكلمة مرور مدير غير صحيحة — ${me.name} (${me.username})`,
      details: { 'الوضع': mode, 'بواسطة': `${me.name} (${me.username})` },
    })
    return NextResponse.json(
      { ok: false, error: 'كلمة مرور المدير غير صحيحة — لم يُحذف أي بيانات' },
      { status: 403 },
    )
  }

  try {
    // درع إلزامي: نسخة أمان pre-reset قبل أي مسح — فشل إنشائها يُلغي العملية كلياً
    // (درس موثق: تفريغ صيانة سابق مسح بيانات حقيقية دون نسخة سابقة — لا تكرار أبداً)
    let safetyFile = ''
    try {
      // داخل العملية عبر node:sqlite — لا تعتمد على وجود bun على PATH
      safetyFile = path.basename(createDbBackup('pre-reset'))
    } catch (backupError) {
      console.error('Pre-reset backup failed:', backupError)
      return NextResponse.json(
        {
          ok: false,
          error: 'فشل إنشاء نسخة الأمان قبل الحذف — أُلغيت العملية بالكامل ولم يُمس أي بيانات. تحقق من القرص ثم أعد المحاولة',
        },
        { status: 500 },
      )
    }

    const counts =
      mode === 'FULL' ? await resetEnteredData() : await financialResetKeepStructures()

    const isFull = mode === 'FULL'
    await logAudit(db, {
      action: 'SYSTEM',
      entity: 'SYSTEM',
      entityId: null,
      entityNumber: null,
      title: isFull ? 'تفريغ شامل كامل' : 'تصفير مالي مع الاحتفاظ بالهياكل',
      summary: isFull
        ? `تفريغ شامل كامل بواسطة ${me.name} (${me.username}) — مُسحت كل البيانات والهياكل وأعيد بناء دليل الحسابات الأساسي وبقيت حسابات الدخول والإعدادات — بعد تحقق كلمة مرور المدير — نسخة أمان: ${safetyFile}`
        : `تصفير مالي مع الاحتفاظ بالهياكل بواسطة ${me.name} (${me.username}) — مُسحت الفواتير والسندات والقيود وحركات المخزون والجرد والحركات المالية للموظفين وصُفّرت الأرصدة — تبقى الأطراف وبطاقات المواد وشجرة الحسابات وهيكل المستودعات والموظفون ومراكز التكلفة كما هي — بعد تحقق كلمة مرور المدير — نسخة أمان: ${safetyFile}`,
      details: {
        'الوضع': isFull ? 'تفريغ شامل كامل' : 'تصفير مالي مع الاحتفاظ بالهياكل',
        'المسوحون': counts,
        'بواسطة': `${me.name} (${me.username})`,
        'نسخة الأمان': safetyFile,
      },
    })
    return NextResponse.json({ ok: true, mode, counts, safetyFile })
  } catch (error) {
    console.error('Reset error:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'فشل حذف البيانات' },
      { status: 500 },
    )
  }
}
