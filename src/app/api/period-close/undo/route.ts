// POST /api/period-close/undo — التراجع عن إقفال الفترة (المدير فقط)
// يعيد النسخة الأرشيفية الملتقطة لحظة الإقفال ويخسّر كل ما بعد الإقفال (سند الافتتاحي وما بعده)
// المنهج نفسه المعتمد في استعادة النسخ الاحتياطية: نسخة أمان → علامة restore-pending →
// إيقاف ذاتي (المدير يعيد التشغيل يدوياً) → instrumentation يطبق الاستبدال عند الإقلاع قبل أن يلمس النظام القاعدة
import { NextResponse, type NextRequest } from 'next/server'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { requireAdmin } from '@/lib/api-guard'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth-server'
import { SESSION_COOKIE, VIEW_PERIOD_COOKIE } from '@/lib/session'
import { logAudit } from '@/lib/audit-server'
import { assertManagerPassword, snapshotPath } from '@/lib/period-server'
import { createDbBackup } from '@/lib/backup-server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied

  const me = await getSessionUser(req.cookies.get(SESSION_COOKIE)?.value)

  const body = (await req.json().catch(() => null)) as { id?: unknown; confirm?: unknown; password?: unknown } | null
  if (body?.confirm !== 'yes' || typeof body.id !== 'string' || !body.id) {
    return NextResponse.json(
      { error: 'التراجع يخسّر كل ما بعد الإقفال — أرسل confirm=yes مع معرف الفترة للتأكيد الصريح' },
      { status: 400 },
    )
  }
  // شرط الأمان: كلمة سر المدير إلزامية مع التراجع — الجلسة وحدها لا تكفي
  try {
    await assertManagerPassword(body.password)
  } catch (error) {
    const status = error instanceof Error && 'status' in error ? (error as { status: number }).status : 400
    const message = error instanceof Error ? error.message : 'كلمة سر المدير مطلوبة للتراجع'
    return NextResponse.json({ error: message }, { status })
  }

  try {
    const period = await db.periodClose.findUnique({ where: { id: body.id } })
    if (!period) {
      return NextResponse.json({ error: 'الفترة المطلوبة غير موجودة' }, { status: 404 })
    }
    // التراجع ممكن عن الأحدث فقط — الأقدم يخسر الإقفالات الأحدث فوقه بلا معنى
    const newest = await db.periodClose.findFirst({ orderBy: { closingDate: 'desc' } })
    if (!newest || newest.id !== period.id) {
      return NextResponse.json(
        { error: 'يمكن التراجع عن آخر إقفال فقط — تراجع عن الإقفالات الأحدث أولاً إن وُجدت' },
        { status: 409 },
      )
    }
    const snapshot = snapshotPath(period.snapshotFile)
    if (!snapshot) {
      return NextResponse.json(
        { error: `ملف النسخة الأرشيفية (${period.snapshotFile}) غير موجود — لا يمكن التراجع` },
        { status: 409 },
      )
    }

    // 1) نسخة أمان من الوضع الحالي (كل ما سيُخسر يبقى قابلاً للاسترجاع اليدوي)
    // داخل العملية عبر node:sqlite — لا تعتمد على وجود bun على PATH
    const safetyFile = path.basename(createDbBackup('manual'))

    // 2) علامة الاستعادة المعلقة — مصدرها مجلد الأرشيف (periods) لا النسخ الاحتياطية
    writeFileSync(
      path.join(process.cwd(), 'db', 'restore-pending.txt'),
      JSON.stringify({
        file: period.snapshotFile,
        srcDir: 'periods',
        kind: 'period-undo',
        periodLabel: period.label,
        periodId: period.id,
        requestedBy: me?.username ?? '-',
        at: new Date().toISOString(),
      }),
      { mode: 0o600 },
    )

    await logAudit(db, {
      action: 'SYSTEM',
      entity: 'PERIOD_CLOSE',
      entityId: period.id,
      entityNumber: period.label,
      title: 'طلب التراجع عن إقفال فترة',
      summary:
        `طلب ${me?.name ?? 'المدير'} (${me?.username ?? '-'}) التراجع عن إقفال الفترة «${period.label}» — ` +
        `ستُستعاد النسخة الأرشيفية «${period.snapshotFile}» ويُخسّر كل ما بعد الإقفال — نسخة أمان: ${safetyFile || 'فشل تسميتها'}`,
      details: {
        'الفترة': period.label,
        'تاريخ الإقفال': period.closingDate.toISOString().slice(0, 10),
        'النسخة الأرشيفية': period.snapshotFile,
        'نسخة الأمان': safetyFile,
        'وقت الطلب': new Date().toISOString(),
      },
    })

    // 3) الرد أولاً ثم إيقاف الخادم — كان هنا سكربت bash يفترض بيئة استضافة قديمة
    // (مسار /home/z/my-project وأدوات pkill/setsid) لا وجود لها على هذا الجهاز؛
    // فشل صامتاً دائماً منذ الانتقال إلى Windows: العلامة تُكتب والتدقيق يوثّق
    // «جارٍ التراجع» بينما لا شيء يُعاد تشغيله فعلياً — أخطر ما في الأمر أن
    // instrumentation.ts (تطبيق الاستعادة عند الإقلاع) سليم تماماً؛ العطل في
    // خطوة إعادة التشغيل وحدها. الإصلاح: إيقاف ذاتي موثوق (يُحرّر المنفذ 3000
    // بيقين) بدل محاولة إعادة تشغيل تلقائية هشة تختلف بين الأنظمة — وrestart-app.bat
    // (تشغيل بنقرة واحدة) هو أداة إعادة التشغيل المُعتمدة فعلياً على هذا الجهاز
    setTimeout(() => process.exit(0), 1200)

    const res = NextResponse.json({
      ok: true,
      message: `جارٍ التراجع عن إقفال «${period.label}» — سيتوقف الخادم الآن. شغّل start-app.bat (أو npm run dev) لإتمام التراجع؛ الاستعادة تُطبَّق تلقائياً عند الإقلاع القادم قبل أن يلمس النظام القاعدة. سُجّلت نسخة أمان من الوضع الحالي (${safetyFile}) قبل التراجع`,
      safetyFile,
    })
    // مسح كوكي استعراض الأرشيف — إن كان عالقاً من دخول سابق للاستعراض (7 أيام صلاحيته)
    // فسيبقى يشير لفترة قد تغيّرت هويتها بعد التراجع، فيعلق المستخدم بعد إعادة التشغيل
    // في وضع «استعراض قراءة فقط» ظاهرياً رغم عودة النظام فعلياً للفترة الحالية الحية
    res.cookies.set(VIEW_PERIOD_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
    return res
  } catch (error) {
    console.error('POST /api/period-close/undo error:', error)
    return NextResponse.json(
      { ok: false, error: 'فشل التحضير للتراجع — لم يُمس أي بيانات، حاول مجدداً' },
      { status: 500 },
    )
  }
}
