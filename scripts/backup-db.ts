/// <reference types="bun-types" />
// نسخة احتياطية متسقة من قاعدة البيانات عبر VACUUM INTO (المرحلة الأولى P1-7)
// الاستخدام: bun scripts/backup-db.ts [auto|manual|pre-reset|period]
//   auto      = نسخة دورية تلقائية (كل ساعة من instrumentation) — تُحفظ آخر 24 نسخة
//   manual    = نسخة يدوية من الإعدادات أو قبل عملية خطرة — تُحفظ آخر 30 نسخة
//   pre-reset = نسخة إلزامية قبل أي تفريغ للبيانات — تُحفظ آخر 10 نسخ (درع ضد فقدان البيانات)
//   period    = النسخة الأرشيفية لإقفال فترة محاسبية — تُكتب في db/periods بلا تقليم أبداً
// VACUUM INTO ينتج ملفاً متسقاً كاملاً (يشمل ما في WAL) دون قفل طويل على القاعدة الحية
import { Database } from 'bun:sqlite'
import { chmodSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const DB_PATH = path.join(ROOT, 'db', 'custom.db')
const BACKUPS_DIR = path.join(ROOT, 'db', 'backups')
const PERIODS_DIR = path.join(ROOT, 'db', 'periods')

const RETAIN: Record<string, number> = { auto: 24, manual: 30, 'pre-restore': 10, 'pre-reset': 10 }

function stamp(): string {
  // 2026-01-31T14:05:09 → 2026-01-31_14-05-09 (بالتوقيت المحلي)
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

const arg = process.argv[2] ?? ''
const isPeriod = arg === 'period'
const mode = isPeriod || ['manual', 'pre-reset'].includes(arg) ? arg : 'auto'
const dir = isPeriod ? PERIODS_DIR : BACKUPS_DIR
mkdirSync(dir, { recursive: true })
const out = path.join(dir, `${mode}-${stamp()}.db`)

const conn = new Database(DB_PATH)
try {
  // انتظار قصير إن كان VACUUM آخر متأخراً أو الكتابة جارية — بدل فشل فوري
  conn.exec('PRAGMA busy_timeout = 15000;')
  conn.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`)
} finally {
  conn.close()
}
if (!isPeriod) prune(dir, mode, RETAIN[mode] ?? 24)
else {
  // النسخة الأرشيفية للفترة سجل للقراءة فقط — حماية إضافية من الكتابة أو الحذف العرضي
  try {
    chmodSync(out, 0o444)
  } catch {
    /* غير قاتل */
  }
}
console.log(`backup-ok ${out}`)
