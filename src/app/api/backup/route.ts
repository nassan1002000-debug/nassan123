// نقاط نهاية النسخ الاحتياطي (المرحلة الأولى P1-7) — للمدير فقط
// GET  /api/backup        — قائمة النسخ الموجودة في db/backups
// POST /api/backup        — إنشاء نسخة يدوية الآن (VACUUM INTO عبر سكربت bun)
import { NextResponse, type NextRequest } from 'next/server'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { requireAdmin } from '@/lib/api-guard'
import { logAudit } from '@/lib/audit-server'
import { SESSION_COOKIE } from '@/lib/session'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth-server'
import { rateLimit } from '@/lib/rate-limit'
import { backupStampMs, getBackupGuard } from '@/lib/period-server'
import { copyBackupToDir, createDbBackup, resolveCustomBackupDir } from '@/lib/backup-server'

export const dynamic = 'force-dynamic'

interface BackupRow {
  name: string
  sizeBytes: number
  createdAt: string
  kind: 'auto' | 'manual' | 'pre-restore' | 'other'
  /** محجوبة بحارس النسخ الاحتياطية — أقدم من سند القيد الافتتاحي للفترة الحالية */
  blocked: boolean
}

function kindOf(name: string): BackupRow['kind'] {
  if (name.startsWith('auto-')) return 'auto'
  if (name.startsWith('manual-')) return 'manual'
  if (name.startsWith('pre-restore-')) return 'pre-restore'
  return 'other'
}

function listBackups(guard: { thresholdMs: number } | null): BackupRow[] {
  const dir = path.join(process.cwd(), 'db', 'backups')
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const st = statSync(path.join(dir, f))
        return {
          name: f,
          sizeBytes: st.size,
          createdAt: st.mtime.toISOString(),
          kind: kindOf(f),
          blocked: !!guard && backupStampMs(f, path.join(dir, f)) < guard.thresholdMs,
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  const guard = await getBackupGuard()
  return NextResponse.json({ ok: true, backups: listBackups(guard), guard })
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied

  // حد التكرار: نسخة يدوية كل 30 ثانية على الأكثر
  const me = await getSessionUser(req.cookies.get(SESSION_COOKIE)?.value)
  const limit = await rateLimit(`backup:${me?.id ?? 'x'}`, 2, 30 * 1000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'أنشأت نسخة للتو — انتظر لحظات ثم حاول مجدداً' },
      { status: 429 },
    )
  }

  try {
    // داخل العملية عبر node:sqlite — لا تعتمد على وجود bun على PATH (كانت execFile
    // السابقة تفشل بصمت كل مرة يُشغَّل الخادم من بيئة بلا bun على PATH، وعلى رأسها
    // start-app.bat على وندوز — سبب خطأ «Command failed» الذي يظهر للمستخدم)
    const createdPath = createDbBackup('manual')
    const created = path.basename(createdPath)

    // نسخة إضافية إلى المسار المخصص إن حدّده المدير من الإعدادات — لا تُفشل العملية
    // الأساسية إطلاقاً؛ النسخة في db/backups مضمونة دائماً بصرف النظر عن نتيجة هذه الخطوة
    let customDirResult: { path: string; ok: boolean; error?: string } | null = null
    try {
      const customSetting = await db.setting.findUnique({ where: { key: 'backupCustomDir' } })
      const customDir = customSetting?.value ? resolveCustomBackupDir(customSetting.value) : null
      if (customDir) {
        const dest = copyBackupToDir(createdPath, customDir)
        customDirResult = { path: dest, ok: true }
      }
    } catch (copyError) {
      customDirResult = {
        path: '',
        ok: false,
        error: copyError instanceof Error ? copyError.message : 'فشل النسخ إلى المسار المخصص',
      }
    }

    await logAudit(db, {
      action: 'SYSTEM',
      entity: 'SYSTEM',
      entityId: null,
      entityNumber: null,
      title: 'نسخة احتياطية يدوية',
      summary: `أنشأ ${me?.name ?? 'المدير'} (${me?.username ?? '-'}) نسخة احتياطية متسقة من قاعدة البيانات: ${created}${
        customDirResult ? (customDirResult.ok ? ` — ونُسخت إلى المسار المخصص: ${customDirResult.path}` : ` — تعذّر نسخها إلى المسار المخصص: ${customDirResult.error}`) : ''
      }`,
      details: {
        'اسم النسخة': created,
        'وقت الإنشاء': new Date().toISOString(),
        ...(customDirResult ? { 'المسار المخصص': customDirResult.ok ? customDirResult.path : `فشل — ${customDirResult.error}` } : {}),
      },
    })
    const guard = await getBackupGuard()
    return NextResponse.json({
      ok: true,
      file: created,
      backups: listBackups(guard),
      guard,
      customDir: customDirResult,
    })
  } catch (error) {
    console.error('POST /api/backup error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'فشل إنشاء النسخة الاحتياطية' },
      { status: 500 },
    )
  }
}
