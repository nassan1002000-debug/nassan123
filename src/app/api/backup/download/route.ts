// GET /api/backup/download?file=<name> — تنزيل نسخة احتياطية (المرحلة الأولى P1-7) — للمدير فقط
// حارس اجتياز مسار صارم: basename فقط + امتداد .db + وجود داخل مجلد db/backups حصراً
// حارس النسخ الاحتياطية: يُمنع تحميل أي نسخة مؤرّخة قبل سند القيد الافتتاحي للفترة الحالية
import { NextResponse, type NextRequest } from 'next/server'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { requireAdmin } from '@/lib/api-guard'
import { backupGuardMessage, backupStampMs, getBackupGuard } from '@/lib/period-server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth-server'
import { SESSION_COOKIE } from '@/lib/session'
import { logAudit } from '@/lib/audit-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied

  const requested = req.nextUrl.searchParams.get('file') ?? ''
  const name = path.basename(requested)
  if (!name.endsWith('.db') || name !== requested || requested.includes('\\')) {
    return NextResponse.json({ error: 'اسم الملف غير صالح' }, { status: 400 })
  }

  const dir = path.join(process.cwd(), 'db', 'backups')
  const filePath = path.join(dir, name)
  if (!filePath.startsWith(dir + path.sep) || !existsSync(filePath)) {
    return NextResponse.json({ error: 'النسخة المطلوبة غير موجودة' }, { status: 404 })
  }

  // حارس النسخ الاحتياطية: تحميل نسخة أقدم من سند القيد الافتتاحي محجوب —
  // تاريخ الفترات يُستعرض من الأرشيف، وأي خلط ببيانات قديمة يهدد التوازن المالي
  const guard = await getBackupGuard()
  if (guard && backupStampMs(name, filePath) < guard.thresholdMs) {
    const me = await getSessionUser(req.cookies.get(SESSION_COOKIE)?.value)
    await logAudit(db, {
      action: 'SYSTEM',
      entity: 'SYSTEM',
      entityId: null,
      entityNumber: null,
      title: 'حجب تحميل نسخة قديمة — حارس النسخ الاحتياطية',
      summary: `حاول ${me?.name ?? 'مستخدم'} (${me?.username ?? '-'}) تحميل النسخة «${name}» فحجبها الحارس — نسخة أقدم من سند القيد الافتتاحي ${guard.openingEntryNumber} (${guard.openingDateISO}) للفترة «${guard.label}»`,
      details: {
        'النسخة المحجوبة': name,
        'سند الافتتاحي': guard.openingEntryNumber,
        'تاريخ الافتتاحي': guard.openingDateISO,
        'الفترة الحالية': guard.label,
      },
    })
    return NextResponse.json({ error: backupGuardMessage(guard, 'تحميل') }, { status: 409 })
  }

  const size = statSync(filePath).size
  const stream = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
