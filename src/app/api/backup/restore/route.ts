// POST /api/backup/restore — استعادة نسخة احتياطية (المرحلة الأولى P1-7) — للمدير فقط
// المنهج الآمن بلا استثناء:
//  1) نسخة أمان VACUUM INTO من الوضع الحالي (تمسك كل ما في WAL) قبل أي شيء
//  2) كتابة علامة db/restore-pending.txt باسم النسخة المختارة (تحقق basename + .db)
//  3) الرد للمتصفح أولاً ثم إيقاف الخادم ذاتياً — يعيده المدير يدوياً (start-app.bat)
//     وعند الإقلاع يطبق instrumentation.ts الاستعادة قبل أن يلمس النظام القاعدة ويوثقها في سجل التدقيق
import { NextResponse, type NextRequest } from 'next/server'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { requireAdmin } from '@/lib/api-guard'
import { SESSION_COOKIE, VIEW_PERIOD_COOKIE } from '@/lib/session'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit-server'
import { backupGuardMessage, backupStampMs, getBackupGuard } from '@/lib/period-server'
import { createDbBackup } from '@/lib/backup-server'

export const dynamic = 'force-dynamic'

/**
 * طابع زمني النسخة — نُقل إلى period-server.ts (backupStampMs) ليتقاسمه حرس الاسترجاع والتحميل والقائمة
 */

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied

  const me = await getSessionUser(req.cookies.get(SESSION_COOKIE)?.value)

  const body = (await req.json().catch(() => null)) as { file?: unknown; confirm?: unknown } | null
  const rawFile = typeof body?.file === 'string' ? body.file : ''
  const name = path.basename(rawFile)

  if (body?.confirm !== 'yes') {
    return NextResponse.json(
      { ok: false, error: 'استعادة النسخة تستبدل كل البيانات الحالية — أرسل confirm=yes للتأكيد الصريح' },
      { status: 400 },
    )
  }
  if (!name.endsWith('.db') || name !== rawFile || rawFile.includes('\\')) {
    return NextResponse.json({ ok: false, error: 'اسم النسخة غير صالح' }, { status: 400 })
  }
  const filePath = path.join(process.cwd(), 'db', 'backups', name)
  if (!filePath.startsWith(path.join(process.cwd(), 'db', 'backups') + path.sep) || !existsSync(filePath)) {
    return NextResponse.json({ ok: false, error: 'النسخة المطلوبة غير موجودة' }, { status: 404 })
  }

  try {
    // حارس النسخ الاحتياطية (الشرط الحاكم 6): يُمنع منعاً باتاً استرجاع أي نسخة مؤرّخة
    // قبل تاريخ سند القيد الافتتاحي للفترة الحالية — لمنع إفساد التوازن المالي أو خلط
    // بيانات الفترات. لاستعادة ما قبل الإقفال نفسه استخدم «التراجع عن الإقفال»
    const guard = await getBackupGuard()
    if (guard && backupStampMs(name, filePath) < guard.thresholdMs) {
      await logAudit(db, {
        action: 'SYSTEM',
        entity: 'SYSTEM',
        entityId: null,
        entityNumber: null,
        title: 'حجب استعادة نسخة قديمة — حارس النسخ الاحتياطية',
        summary: `حاول ${me?.name ?? 'مستخدم'} (${me?.username ?? '-'}) استرجاع النسخة «${name}» فحجبها الحارس — نسخة أقدم من سند القيد الافتتاحي ${guard.openingEntryNumber} (${guard.openingDateISO}) للفترة «${guard.label}»`,
        details: {
          'النسخة المحجوبة': name,
          'سند الافتتاحي': guard.openingEntryNumber,
          'تاريخ الافتتاحي': guard.openingDateISO,
          'الفترة الحالية': guard.label,
        },
      })
      return NextResponse.json({ ok: false, error: backupGuardMessage(guard, 'استرجاع') }, { status: 409 })
    }

    // 1) نسخة أمان من الوضع الحالي — قبل أي استبدال (داخل العملية عبر node:sqlite —
    // لا تعتمد على وجود bun على PATH كما كانت execFile السابقة)
    const safetyFile = path.basename(createDbBackup('manual'))

    // 2) علامة الاستعادة المعلقة — يقرؤها instrumentation عند الإقلاع القادم
    writeFileSync(
      path.join(process.cwd(), 'db', 'restore-pending.txt'),
      JSON.stringify({ file: name, requestedBy: me?.username ?? '-', at: new Date().toISOString() }),
      { mode: 0o600 },
    )

    // توثيق الطلب في التدقيق الحالي (قد يضيع مع استبدال القاعدة — التوثيق النهائي بعد الاستعادة)
    await logAudit(db, {
      action: 'SYSTEM',
      entity: 'SYSTEM',
      entityId: null,
      entityNumber: null,
      title: 'طلب استعادة نسخة احتياطية',
      summary: `طلب ${me?.name ?? 'المدير'} (${me?.username ?? '-'}) استعادة النسخة «${name}» — نسخة أمان: ${safetyFile || 'فشل تسميتها'} — يُعاد تشغيل النظام الآن لتطبيقها`,
      details: {
        'النسخة المختارة': name,
        'نسخة الأمان': safetyFile,
        'وقت الطلب': new Date().toISOString(),
      },
    })

    // 3) الرد يُرسل أولاً — ثم إيقاف الخادم. كان هنا سكربت bash يفترض بيئة استضافة
    // قديمة (مسار /home/z/my-project وأدوات pkill/setsid) لا وجود لها على هذا
    // الجهاز؛ فشل صامتاً دائماً منذ الانتقال إلى Windows — العلامة تُكتب والرد
    // يَعِد بإعادة تشغيل تلقائية لا تحدث أبداً. instrumentation.ts (تطبيق
    // الاستعادة عند الإقلاع) سليم تماماً؛ العطل كان في خطوة إعادة التشغيل وحدها.
    // الإصلاح: إيقاف ذاتي موثوق (يُحرّر المنفذ 3000 بيقين) بدل إعادة تشغيل
    // تلقائية هشة تختلف بين الأنظمة — start-app.bat هو أداة إعادة التشغيل
    // المُعتمدة فعلياً على هذا الجهاز
    setTimeout(() => process.exit(0), 1200)

    const res = NextResponse.json({
      ok: true,
      message: `جارٍ استعادة النسخة «${name}» — سيتوقف الخادم الآن. شغّل start-app.bat (أو npm run dev) لإتمام الاستعادة؛ تُطبَّق تلقائياً عند الإقلاع القادم قبل أن يلمس النظام القاعدة (حدثت نسخة أمان من الوضع الحالي: ${safetyFile})`,
      safetyFile,
    })
    // مسح كوكي استعراض الأرشيف — إن كان عالقاً من دخول سابق للاستعراض (7 أيام صلاحيته)
    // فسيبقى يشير لفترة قد تغيّرت هويتها بعد الاستعادة، فيعلق المستخدم بعد إعادة التشغيل
    // في وضع «استعراض قراءة فقط» ظاهرياً رغم عودة النظام فعلياً للفترة الحالية الحية
    res.cookies.set(VIEW_PERIOD_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
    return res
  } catch (error) {
    console.error('POST /api/backup/restore error:', error)
    // فشل قبل كتابة العلامة = لا شيء تغير — آمن تماماً
    return NextResponse.json(
      { ok: false, error: 'فشل التحضير للاستعادة — لم يُمس أي بيانات، حاول مجدداً' },
      { status: 500 },
    )
  }
}
