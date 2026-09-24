// سجل الملفات الحرجة — درس كارثتي 2026-09-06 (Task 27/28)
// استعادة بيئة الاستضافة المتجمدة عند إعادة تشغيل الجهاز لا تفرغ القاعدة فحسب
// (يحرسها instrumentation عبر scripts/recover-db.ts) بل تمسح ملفات مصدر كاملة:
// مسار رفع الصور src/app/api/upload/route.ts اختفى مرتين ومجلد uploads معه،
// وحتى التزام git تلوّث بحذفها لأن git add -A جرى على قرص مجروح.
// القاعدة هنا: كل ملف في هذا السجل يجب أن يكون موجوداً عند الإقلاع —
// والمفقود منها (المتتبع في git) يُستعاد آلياً بـ git checkout HEAD -- فوراً
// مع توثيق صاخب، فلا يتكرر انكسار ميزة كاملة بصمت أبداً.
import { existsSync } from 'node:fs'
import path from 'node:path'

/** مسارات حيوية نسبةً لجذر المشروع — فقدان أي منها يكسر ميزة كاملة */
export const CRITICAL_FILES: string[] = [
  // رفع صور المواد وخدمتها (انهار مرتين — الأولوية القصوى)
  'src/app/api/upload/route.ts',
  'src/app/api/files/route.ts',
  'src/app/api/files/[...path]/route.ts',
  'src/lib/uploads.ts',
  'src/components/screens/items/item-images.tsx',
  'src/app/api/items/download/route.ts',
  // قلب النظام — بلاها لا إقلاع أصلاً لكن ضمانة زائدة لا تضر
  'src/lib/db.ts',
  'src/lib/auth-server.ts',
  'src/lib/session.ts',
  'src/lib/password.ts',
  'src/app/api/auth/login/route.ts',
  'prisma/schema.prisma',
  'package.json',
  // خطاف الإقلاع نفسه وحرسا القاعدة
  'src/instrumentation.ts',
  'src/instrumentation-nodejs.ts',
  'scripts/recover-db.ts',
  'scripts/backup-db.ts',
  // قالب الطباعة الموحد وهويته
  'src/lib/print-template.ts',
  'src/lib/company.ts',
  'src/app/api/settings/route.ts',
]

export interface CriticalFileIssue {
  path: string
  /** مفقود من القرص ومفقود من git أيضاً — يحتاج تدخلاً بشرياً */
  fatal: boolean
}

/**
 * فحص الملفات الحرجة عند الإقلاع — يستعيد المفقود المتتبع من git
 * ويعيد قائمة ما لم يمكن استعادته آلياً (للتوثيق والتنبيه)
 */
export async function ensureCriticalFiles(ROOT: string): Promise<{ restored: string[]; broken: CriticalFileIssue[] }> {
  const missing = CRITICAL_FILES.filter((p) => !existsSync(path.join(ROOT, p)))
  if (missing.length === 0) return { restored: [], broken: [] }

  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const exec = promisify(execFile)

  const restored: string[] = []
  const broken: CriticalFileIssue[] = []

  for (const p of missing) {
    try {
      await exec('git', ['checkout', 'HEAD', '--', p], { cwd: ROOT, timeout: 30_000 })
      if (existsSync(path.join(ROOT, p))) {
        restored.push(p)
        console.warn(`[critical-files] ⛑️ استُعيد الملف الحرج المفقود من git: ${p}`)
      } else {
        broken.push({ path: p, fatal: true })
        console.error(`[critical-files] ❌ الملف الحرج مفقود وغير متتبع في git — يلزم إعادة بنائه يدوياً: ${p}`)
      }
    } catch (error) {
      broken.push({ path: p, fatal: true })
      console.error(`[critical-files] ❌ فشل استعادة ${p} من git:`, error instanceof Error ? error.message : error)
    }
  }

  return { restored, broken }
}
