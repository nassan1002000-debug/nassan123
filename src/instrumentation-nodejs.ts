// منطق الإقلاع لبيئة Node فقط — يُستورد ديناميكياً من instrumentation.ts (P1-7)
// 1) تطبيق استعادة نسخة احتياطية معلّقة (يكتبها /api/backup/restore قبل إعادة التشغيل)
//    — قبل أي اتصال بقاعدة: نسخة أمان ثم استبدال الملف ثم تنظيف WAL
// 2) نسخة تلقائية كل ساعة عبر backup-server.ts (احتفاظ بآخر 24 نسخة)
// 3) نبض القاعدة كل 3 دقائق: wal_checkpoint(TRUNCATE) يدمج كل ما في WAL في الملف الرئيسي
//    فلا تمر دقائق طويلة إلا والملف الرئيسي على القرص يحوي آخر حالة — الدرس المؤسس من
//    كارثة 2026-09-06 (استعادة بيئة الاستضافة نسخة متجمدة قديمة عند إعادة تشغيل الجهاز
//    فمُسحت بيانات حقيقية): الملف الرئيسي يجب ألا يبقى قديماً أبداً
// النسخة التلقائية داخل العملية عبر node:sqlite (backup-server.ts) — لا تعتمد على bun على
// PATH كما كانت execFile السابقة (كانت تفشل صامتة تحت start-app.bat على وندوز، انظر الشفاء
// الذاتي أدناه الذي لا يزال يعتمد على bun لسكربت الاستعادة recover-db.ts فقط)
import { execFile } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { createDbBackup } from '@/lib/backup-server'

const g = globalThis as unknown as {
  __amalBackupTimer?: ReturnType<typeof setInterval>
  __amalHeartbeatTimer?: ReturnType<typeof setInterval>
}

function stampName(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

export async function registerNodejs(): Promise<void> {
  const ROOT = process.cwd()
  const DB_PATH = path.join(ROOT, 'db', 'custom.db')
  const BACKUPS_DIR = path.join(ROOT, 'db', 'backups')
  const MARKER = path.join(ROOT, 'db', 'restore-pending.txt')

  // ===== 0) فحص الملفات الحرجة — قبل أي شيء (درس كارثتي 2026-09-06) =====
  // الاستعادة المتجمدة للاستضافة تمسح ملفات مصدر كاملة (مسار الرفع اختفى مرتين)
  // — المفقود المتتبع في git يُستعاد هنا آلياً فلا تنكسر ميزة كاملة بصمت
  try {
    const { ensureCriticalFiles } = await import('@/lib/critical-files')
    const { restored, broken } = await ensureCriticalFiles(ROOT)
    if (restored.length > 0) {
      console.warn(`[instrumentation] ⛑️ حرس الملفات الحرجة استعاد ${restored.length} ملفاً من git: ${restored.join('، ')}`)
    }
    if (broken.length > 0) {
      console.error(`[instrumentation] ❌ ملفات حرجة مفقودة بلا استعادة — تحتاج تدخلاً: ${broken.map((b) => b.path).join('، ')}`)
    }
  } catch (criticalError) {
    console.error('[instrumentation] فحص الملفات الحرجة أخفق (غير قاتل):', criticalError)
  }


  // ===== 1) استعادة معلّقة — تُطبق قبل أن يلمس النظام القاعدة =====
  if (existsSync(MARKER)) {
    let restoredFile = ''
    let undoPeriodLabel = ''
    try {
      const parsed = JSON.parse(readFileSync(MARKER, 'utf8')) as {
        file?: string
        srcDir?: string
        kind?: string
        periodLabel?: string
      }
      const name = typeof parsed.file === 'string' ? path.basename(parsed.file) : ''
      // مصدر الاستعادة: النسخ الاحتياطية افتراضياً، أو مجلد أرشيف الفترات (التراجع عن إقفال)
      const srcDirName = parsed.srcDir === 'periods' ? 'periods' : 'backups'
      const srcDir = path.join(ROOT, 'db', srcDirName)
      const src = path.join(srcDir, name)
      undoPeriodLabel = typeof parsed.periodLabel === 'string' ? parsed.periodLabel : ''
      if (name.endsWith('.db') && existsSync(src)) {
        // نسخة أمان من الوضع الحالي قبل الاستبدال (بأسماء pre-restore-*)
        mkdirSync(BACKUPS_DIR, { recursive: true })
        const safeBase = path.join(BACKUPS_DIR, `pre-restore-${stampName()}`)
        copyFileSync(DB_PATH, `${safeBase}.db`)
        for (const suffix of ['-wal', '-shm']) {
          if (existsSync(DB_PATH + suffix)) copyFileSync(DB_PATH + suffix, `${safeBase}${suffix}`)
        }
        // الاستعادة الفعلية + تنظيف ملفات WAL التابعة للنسخة القديمة
        copyFileSync(src, DB_PATH)
        // أرشيف الفترات بصلاحية قراءة فقط (0444) — الاستبدال يورث الصلاحية فيمنع كل كتابة لاحقة
        // فتُفرض صلاحية عادية على القاعدة الحية بعد كل استبدال بلا استثناء
        try {
          chmodSync(DB_PATH, 0o644)
        } catch {
          /* نادر — المالك نفسه */
        }
        for (const suffix of ['-wal', '-shm']) rmSync(DB_PATH + suffix, { force: true })
        restoredFile = name
        console.log(`[instrumentation] تمت استعادة القاعدة من ${srcDirName}/${name}`)
      } else {
        console.error(`[instrumentation] ملف الاستعادة غير موجود: ${srcDirName}/${name}`)
      }
    } catch (error) {
      console.error('[instrumentation] فشل تطبيق الاستعادة:', error)
    } finally {
      rmSync(MARKER, { force: true })
    }

    // التراجع عن إقفال فترة: ملف الأرشيف صار هو القاعدة — يُحذف حتى لا يبقى يتيم بعد استعادة
    // النسخة نفسها (سجل الفترة اختفى مع القاعدة المستعادة فلا يشير إليه شيء)
    if (restoredFile && undoPeriodLabel) {
      try {
        rmSync(path.join(ROOT, 'db', 'periods', restoredFile), { force: true })
      } catch {
        /* غير قاتل — ملف قراءة فقط قد يحتاج صلاحية */
      }
    }

    // توثيق الاستعادة في سجل التدقيق داخل القاعدة المستعادة نفسها
    if (restoredFile) {
      try {
        const { db } = await import('@/lib/db')
        const { logAudit } = await import('@/lib/audit-server')
        await logAudit(db, {
          action: 'SYSTEM',
          entity: 'SYSTEM',
          entityId: null,
          entityNumber: null,
          title: undoPeriodLabel ? 'التراجع عن إقفال فترة محاسبية' : 'استعادة نسخة احتياطية',
          summary: undoPeriodLabel
            ? `أُلغي إقفال الفترة «${undoPeriodLabel}» واستُعيدت القاعدة من نسختها الأرشيفية «${restoredFile}» عند إقلاع النظام — كل ما بعد الإقفال خُسر وحُذف ملف الأرشيف بعد تطبيقه`
            : `أُعيدت قاعدة البيانات من النسخة «${restoredFile}» عند إقلاع النظام — صُنعت نسخة أمان من الوضع السابق في db/backups`,
          details: {
            ...(undoPeriodLabel ? { 'الفترة الملغى إقفالها': undoPeriodLabel } : {}),
            'النسخة المستعادة': restoredFile,
            'وقت الاستعادة': new Date().toISOString(),
          },
        })
      } catch (error) {
        console.error('[instrumentation] تعذر توثيق الاستعادة في سجل التدقيق:', error)
      }
    }
  }

  // ===== 1.5) حرس الشفاء الذاتي — درس كارثتي 2026-09-06 =====
  // الاستضافة تعيد عند إعادة تشغيل الجهاز نسخة متجمدة قديمة فتقلع القاعدة مفروزة
  // (صفر مستخدمين — حالة لا يمكن فيها حتى تسجيل الدخول). إن أقلع النظام على قاعدة
  // بلا مستخدمين وبلا استعادة معلّقة: ابحث عن أفضل نسخة (backups ثم recovered-archive)
  // واستعد آلياً عبر scripts/recover-db.ts ثم وثّق الشفاء في سجل التدقيق
  try {
    const { db } = await import('@/lib/db')
    const usersAtBoot = await db.user.count()
    if (usersAtBoot === 0) {
      console.warn('[instrumentation] ⚠️ القاعدة أقلعت بلا أي مستخدمين — أرجح كارثة استعادة الاستضافة المتجمدة — محاولة شفاء ذاتي عبر scripts/recover-db.ts --auto')
      const healed = await new Promise<{ ok: boolean; out: string }>((resolve) => {
        execFile('bun', ['scripts/recover-db.ts', '--auto'], { cwd: ROOT, timeout: 120_000, shell: true }, (error, stdout, stderr) => {
          resolve({ ok: !error, out: `${stdout}\n${stderr}`.trim() })
        })
      })
      console.log(healed.out || '[instrumentation] لا مخرج من سكربت الشفاء')
      if (healed.ok) {
        try {
          const { logAudit } = await import('@/lib/audit-server')
          await logAudit(db, {
            action: 'SYSTEM',
            entity: 'SYSTEM',
            entityId: null,
            entityNumber: null,
            title: 'شفاء ذاتي للقاعدة عند الإقلاع',
            summary:
              'أقلع النظام على قاعدة مفروزة (صفر مستخدمين — كارثة استعادة الاستضافة المتجمدة عند إعادة تشغيل الجهاز) ' +
              'فاستُعيدت البيانات آلياً من أفضل نسخة متاحة عبر scripts/recover-db.ts — راجع تفاصيل المخرجات أدناه',
            details: { 'مخرجات الشفاء': healed.out.slice(0, 2000), 'وقت الشفاء': new Date().toISOString() },
          })
        } catch (auditError) {
          console.error('[instrumentation] تعذر توثيق الشفاء الذاتي في التدقيق:', auditError)
        }
      } else {
        console.error('[instrumentation] فشل الشفاء الذاتي — لا توجد نسخة صالحة في backups/recovered-archive — راجع scripts/recover-db.ts يدوياً')
      }
    }
  } catch (guardError) {
    console.error('[instrumentation] حرس الشفاء الذاتي أخطأ (غير قاتل):', guardError)
  }

  // ===== 2) نسخة تلقائية كل ساعة =====
  const runAutoBackup = (): void => {
    try {
      createDbBackup('auto')
    } catch (error) {
      console.error('[backup-auto]', error instanceof Error ? error.message : error)
    }
  }
  const firstRun = setTimeout(runAutoBackup, 5 * 60 * 1000)
  if (typeof firstRun.unref === 'function') firstRun.unref()
  if (g.__amalBackupTimer) clearInterval(g.__amalBackupTimer)
  g.__amalBackupTimer = setInterval(runAutoBackup, 60 * 60 * 1000)
  if (typeof g.__amalBackupTimer.unref === 'function') g.__amalBackupTimer.unref()

  // ===== 3) نبض القاعدة — دمج WAL في الملف الرئيسي كل 3 دقائق =====
  const heartbeat = async (): Promise<void> => {
    try {
      const { db } = await import('@/lib/db')
      const result = await db.$queryRawUnsafe<[{ busy?: number; log?: number; checkpointed?: number }]>(
        'PRAGMA wal_checkpoint(TRUNCATE);',
      )
      const row = result?.[0]
      if (row && (row.busy === 1 || (row.log ?? 0) > 0)) {
        // تفتيش فعلي حدث (كان في WAL ما يُدمج) — لا حاجة لضجيج في السجل عند الرطوات العادية
        console.log(`[db-heartbeat] checkpoint: log=${row.log} checkpointed=${row.checkpointed}`)
      }
    } catch (error) {
      // غير قاتل — المحاولة التالية بعد 3 دقائق
      console.error('[db-heartbeat] checkpoint failed:', error instanceof Error ? error.message : error)
    }
  }
  if (g.__amalHeartbeatTimer) clearInterval(g.__amalHeartbeatTimer)
  g.__amalHeartbeatTimer = setInterval(() => void heartbeat(), 3 * 60 * 1000)
  if (typeof g.__amalHeartbeatTimer.unref === 'function') g.__amalHeartbeatTimer.unref()
  void heartbeat()
}

export default registerNodejs
