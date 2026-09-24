// استعادة قاعدة البيانات من نسخة سليمة بعد كوارث إعادة تشغيل الاستضافة (كارثتا 2026-09-06)
// — الاستضافة تعيد عند إعادة تشغيل الجهاز نسخة متجمدة قديمة فتُفرغ custom.db من كل شيء (0 مستخدمين)
//
// الاستخدام:
//   bun scripts/recover-db.ts <مسار-النسخة.db>        استعادة من نسخة محددة
//   bun scripts/recover-db.ts --auto                   اختيار أفضل نسخة تلقائياً
//                                                      (db/backups ثم db/recovered-archive —
//                                                       الأغلب قيوداً محاسبياً ثم الأحدث)
//
// المنهج آمن بنيوياً:
//   1) يرفض العمل إن كان في القاعدة الحية مستخدمون (ليست حالة كارثة) إلا مع --force
//   2) نسخة أمان VACUUM INTO من الوضع الحالي إلى db/backups/pre-recovery-* قبل أي شيء
//   3) نسخ أعمدة مشتركة فقط (جدولات مشتركة فقط) — يتسامح مع فروق المخطط:
//      المصادر القديمة بلا PeriodClose/RateLimitEntry وبها periodId/type مسقطة من المخطط الحالي،
//      وUser الحالي فيه sessionVersion/mustChangePassword يأخذان افتراضيهما
//   4) تعطيل مفاتيح الأجانب أثناء النسخ ثم foreign_key_check للتحقق بعد الالتزام
//   5) يعمل بعملية ثانية متوازية مع الخادم الحي (WAL) — بلا إيقاف ولا إعادة تشغيل
import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DB_PATH = path.join(ROOT, 'db', 'custom.db')
const BACKUPS_DIR = path.join(ROOT, 'db', 'backups')
const ARCHIVE_DIR = path.join(ROOT, 'db', 'recovered-archive')
const SKIP_TABLES = new Set(['AccountingPeriod']) // جدولات المصدر المسقطة من المخطط الحالي

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

function tableNames(d: Database): string[] {
  return (
    d.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'").all() as { name: string }[]
  ).map((t) => t.name)
}

function columns(d: Database, t: string): string[] {
  return (d.query(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name)
}

/** جرد صحي: مستخدمون + قيود + رصيد شجري — لترجيح النسخ وعرض النتيجة */
function health(d: Database): { users: number; journal: number; balance: string } {
  const c = (sql: string): number => {
    try {
      return (d.query(sql).get() as { c: number } | undefined)?.c ?? 0
    } catch {
      return 0
    }
  }
  let balance = '—'
  try {
    const r = d.query('SELECT ROUND(SUM(debit),1) sd, ROUND(SUM(credit),1) sc FROM JournalEntryLine').get() as {
      sd: number | null
      sc: number | null
    }
    balance = `مدين=${r.sd ?? 0} دائن=${r.sc ?? 0}`
  } catch {
    /* قد لا يوجد الجدول */
  }
  return { users: c('SELECT COUNT(*) c FROM User'), journal: c('SELECT COUNT(*) c FROM JournalEntry'), balance }
}

/** كل نسخ .db المرشحة في مجلد — بترتيب الأحدث */
function candidatesIn(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => path.join(dir, f))
    .filter((p) => statSync(p).isFile())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
}

/** اختيار أفضل نسخة: الأكثر قيوداً محاسبياً ثم الأحدث — مع ضرورة وجود مستخدمين وقيود */
function pickAutoSource(): string | null {
  const scored: { p: string; journal: number; mtime: number }[] = []
  for (const dir of [BACKUPS_DIR, ARCHIVE_DIR]) {
    for (const p of candidatesIn(dir)) {
      try {
        const d = new Database(p, { readonly: true })
        const h = health(d)
        d.close()
        if (h.users > 0 && h.journal > 0) scored.push({ p, journal: h.journal, mtime: statSync(p).mtimeMs })
      } catch {
        /* ملف تالف — تجاهَل */
      }
    }
  }
  scored.sort((a, b) => b.journal - a.journal || b.mtime - a.mtime)
  return scored[0]?.p ?? null
}

// ===== المدخل =====
const args = process.argv.slice(2)
const force = args.includes('--force')
const auto = args.includes('--auto')
const srcArg = args.find((a) => !a.startsWith('--'))
const source = auto ? pickAutoSource() : (srcArg ?? '')

if (!source || !existsSync(source)) {
  console.error(`[recover-db] لا توجد نسخة مصدر صالحة${auto ? ' (لا مرشح بمستخدمين وقيود في backups/recovered-archive)' : `: ${source}`}`)
  process.exit(1)
}

const srcDb = new Database(source, { readonly: true })
const srcHealth = health(srcDb)
if (srcHealth.users === 0 || srcHealth.journal === 0) {
  console.error(`[recover-db] النسخة المصدر غير صالحة للاستعادة (users=${srcHealth.users}, journal=${srcHealth.journal}): ${source}`)
  process.exit(1)
}

const tgtDb = new Database(DB_PATH)
tgtDb.exec('PRAGMA busy_timeout = 15000')
// إرفاق المصدر باتصال الهدف — النسخ بـ INSERT...SELECT لا يعبر بين اتصالين منفصلين
const attachPath = source.replace(/'/g, "''")
tgtDb.exec(`ATTACH '${attachPath}' AS recover`)

const tgtHealth = health(tgtDb)
if (tgtHealth.users > 0 && !force) {
  console.error(`[recover-db] القاعدة الحية ليست في حالة كارثة (فيها ${tgtHealth.users} مستخدمين) — أضف --force للاستبدال المتعمد`)
  process.exit(1)
}

// 1) نسخة أمان من الوضع الحالي (حتى الفارغ — توثيقاً ولأي فحص لاحق)
mkdirSync(BACKUPS_DIR, { recursive: true })
const safetyPath = path.join(BACKUPS_DIR, `pre-recovery-${stamp()}.db`)
tgtDb.exec(`VACUUM INTO '${safetyPath}'`)

// 2) النسخ: أعمدة مشتركة من جدولات مشتركة فقط — ضمن معاملة واحدة
const srcTables = tableNames(srcDb)
const tgtTables = new Set(tableNames(tgtDb))
tgtDb.exec('PRAGMA foreign_keys = OFF')
tgtDb.exec('BEGIN IMMEDIATE')

const report: { table: string; rows: number }[] = []
try {
  for (const t of srcTables) {
    if (SKIP_TABLES.has(t) || !tgtTables.has(t)) continue
    const srcCols = columns(srcDb, t)
    const tgtCols = new Set(columns(tgtDb, t))
    const common = srcCols.filter((c) => tgtCols.has(c))
    if (common.length === 0) continue
    const colList = common.map((c) => `"${c}"`).join(', ')
    const nRows = (srcDb.query(`SELECT COUNT(*) c FROM "${t}"`).get() as { c: number }).c
    if (nRows === 0) continue
    tgtDb.exec(`DELETE FROM "${t}"`)
    // رفع سقف AUTOINCREMENT ليطابق أعلى معرف منسوخ (وقاية من تصادم المعرفات الجديدة)
    try {
      tgtDb.exec(`DELETE FROM sqlite_sequence WHERE name = '${t}'`)
    } catch {
      /* لا جدول تسلسل أصلاً — عادي */
    }
    tgtDb.exec(`INSERT INTO "${t}" (${colList}) SELECT ${colList} FROM recover."${t}"`)
    const after = (tgtDb.query(`SELECT COUNT(*) c FROM "${t}"`).get() as { c: number }).c
    report.push({ table: t, rows: after })
  }
  tgtDb.exec('COMMIT')
} catch (error) {
  tgtDb.exec('ROLLBACK')
  console.error('[recover-db] فشلت المعاملة وعُمل rollback — القاعدة كما كانت:', error)
  process.exit(1)
}

tgtDb.exec('PRAGMA foreign_keys = ON')
const fkIssues = tgtDb.query('PRAGMA foreign_key_check').all()
tgtDb.exec('PRAGMA wal_checkpoint(TRUNCATE)')

const after = health(tgtDb)
console.log(`[recover-db] ✅ استُعيدت القاعدة من: ${source}`)
console.log(`[recover-db] نسخة أمان من الوضع السابق: ${safetyPath}`)
console.log(`[recover-db] بعد الاستعادة: users=${after.users} journalEntries=${after.journal} | ${after.balance}`)
console.log(`[recover-db] فحص المفاتيح الأجنبية: ${fkIssues.length === 0 ? 'سليم — لا انتهاكات' : `⚠️ ${fkIssues.length} انتهاك!`}`)
for (const r of report) console.log(`  - ${r.table}: ${r.rows} صف`)
try {
  tgtDb.exec('DETACH recover')
} catch {
  /* غير قاتل */
}
srcDb.close()
tgtDb.close()
