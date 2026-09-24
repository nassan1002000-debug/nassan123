// نسخ احتياطية متسقة من قاعدة البيانات — منطق داخل العملية عبر node:sqlite (DatabaseSync)
// بدل تفريغ عملية فرعية «bun scripts/backup-db.ts»: تلك العملية كانت تفشل بصمت (ENOENT)
// كل مرة يُشغَّل الخادم من بيئة لا تحوي bun على PATH — وعلى رأسها start-app.bat، المُشغِّل
// الرسمي على وندوز للمستخدم النهائي (نقرة مزدوجة تفتح cmd.exe بلا مجلد npm العام في PATH)،
// فكانت هذه الحقيقة الفعلية: كل نسخ الأمان قبل عمليات خطرة (استعادة/تصفير/تراجع إقفال)
// والنسخة التلقائية كل ساعة تفشل صامتة — لا مجرد زر «إنشاء نسخة الآن» في الإعدادات.
// node:sqlite مستقر ومُستخدم أصلاً في هذا المشروع (scripts/*.mjs) — بلا اعتماد خارجي إطلاقاً.
import { DatabaseSync } from 'node:sqlite'
import { chmodSync, copyFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'

export type BackupMode = 'auto' | 'manual' | 'pre-restore' | 'pre-reset' | 'period'

const ROOT = process.cwd()
const DB_PATH = path.join(ROOT, 'db', 'custom.db')
const BACKUPS_DIR = path.join(ROOT, 'db', 'backups')
const PERIODS_DIR = path.join(ROOT, 'db', 'periods')

const RETAIN: Record<string, number> = { auto: 24, manual: 30, 'pre-restore': 10, 'pre-reset': 10 }

function stamp(): string {
  // 2026-01-31T14:05:09 → 2026-01-31_14-05-09 (بالتوقيت المحلي) — طابع scripts/backup-db.ts بالحرف
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

function prune(dir: string, prefix: string, keep: number): void {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.db'))
    .sort() // التسمية الزمنية تجعل الترتيب الأبجدي ترتيباً زمنياً
  while (files.length > keep) {
    const oldest = files.shift()
    if (!oldest) break
    try {
      unlinkSync(path.join(dir, oldest))
    } catch {
      // ملف مقفول من عملية أخرى — يُحذف في دورة لاحقة
    }
  }
}

/**
 * إنشاء نسخة احتياطية متسقة عبر VACUUM INTO داخل العملية الحالية مباشرة —
 * بلا عملية فرعية خارجية، فلا يعتمد على وجود bun أو أي شيء آخر على PATH.
 * يُنشئ مجلد الوجهة تلقائياً إن غاب (mkdirSync recursive) ويُقلّم القديم بعد الإنشاء.
 */
export function createDbBackup(mode: BackupMode): string {
  const isPeriod = mode === 'period'
  const dir = isPeriod ? PERIODS_DIR : BACKUPS_DIR
  mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `${mode}-${stamp()}.db`)

  const conn = new DatabaseSync(DB_PATH)
  try {
    // انتظار قصير إن كان VACUUM آخر متأخراً أو الكتابة جارية — بدل فشل فوري
    conn.exec('PRAGMA busy_timeout = 15000;')
    conn.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`)
  } finally {
    conn.close()
  }
  if (!isPeriod) {
    prune(dir, mode, RETAIN[mode] ?? 24)
  } else {
    // النسخة الأرشيفية للفترة سجل للقراءة فقط — حماية إضافية من الكتابة أو الحذف العرضي
    try {
      chmodSync(out, 0o444)
    } catch {
      /* غير قاتل */
    }
  }
  return out
}

/**
 * التحقق من مسار حفظ إضافي اختاره المدير لنسخ Backup اليدوية (نفس حراسة
 * resolveArchiveCopyDir في period-server.ts للنسخة الأرشيفية بالحرف): مسار
 * مطلق أو نسبي يُعاد مطلقاً جاهزاً، ويُرفض الفارغ المُشكَّل أو الطويل جداً أو
 * جذر القرص أو ملف قائم مكان المسار. الفارغ/غير المحدد = بلا مسار إضافي (null).
 */
export function resolveCustomBackupDir(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') {
    throw new Error('مسار حفظ النسخ الاحتياطية غير صالح')
  }
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.length > 500 || trimmed.includes('\0')) {
    throw new Error('مسار حفظ النسخ الاحتياطية غير صالح — مسار طويل جداً أو يحوي محارف مرفوضة')
  }
  const abs = path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.join(ROOT, trimmed)
  if (abs === path.parse(abs).root) {
    throw new Error('لا يمكن اختيار جذر القرص مساراً لحفظ النسخ الاحتياطية')
  }
  try {
    if (statSync(abs).isFile()) {
      throw new Error(`المسار «${trimmed}» ملف موجود — اختر مسار مجلد لحفظ النسخ الاحتياطية`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('ملف موجود')) throw error
    // غير موجود — سيُنشأ كمجلد جديد عند أول نسخة
  }
  return abs
}

/** نسخ ملف نسخة احتياطية إلى المسار الإضافي المختار — بعد نجاح الإنشاء في db/backups فقط */
export function copyBackupToDir(srcAbs: string, dirAbs: string): string {
  mkdirSync(dirAbs, { recursive: true })
  const base = path.basename(srcAbs)
  let dest = path.join(dirAbs, base)
  try {
    if (statSync(dest).isFile()) {
      dest = path.join(dirAbs, base.replace(/\.db$/, `-${Date.now()}.db`))
    }
  } catch {
    /* لا ملف بهذا الاسم — الاسم الأصلي يكفي */
  }
  copyFileSync(srcAbs, dest)
  return dest
}
