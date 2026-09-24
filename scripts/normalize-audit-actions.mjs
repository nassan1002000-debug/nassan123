// تطبيع قيم action الشاذة في سجل التدقيق — تشغيل لمرة واحدة (idempotent)
// ----------------------------------------------------------------------------
// الخلفية: خمسة مسارات كانت تكتب action='POST' أو 'CANCEL' بدل القيم المعتمدة
// في المخطط (CREATE | UPDATE | DELETE | SYSTEM)، فبقيت أسطرها خارج قائمة
// ترشيح شاشة سجل التدقيق. أُصلحت المسارات في الدفعة 2، وهذا السكربت يطبّع
// الأسطر التاريخية.
//
// غير مُتلِف: القيمة الأصلية تُحفظ داخل details تحت مفتاح «القيمة الأصلية
// للإجراء» فلا تضيع المعلومة الدلالية (ترحيل/صرف/إلغاء) التي كانت تحملها.
// الأرشيف db/periods/*.db لا يُمس إطلاقاً — لقطة الفترة المقفلة للقراءة فقط.
//
// التشغيل: node scripts/normalize-audit-actions.mjs [--apply]
//          بلا --apply يعرض ما سيفعله دون أي كتابة.

import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'

const DB_PATH = 'db/custom.db'
const APPLY = process.argv.includes('--apply')

/** الإجراء المعتمد المقابل لكل قيمة شاذة — كلها انتقال حالة على سجل قائم */
const MAP = { POST: 'UPDATE', CANCEL: 'UPDATE' }
const CANONICAL = ['CREATE', 'UPDATE', 'DELETE', 'SYSTEM']

if (!existsSync(DB_PATH)) {
  console.error(`القاعدة غير موجودة: ${DB_PATH}`)
  process.exit(1)
}

const db = new DatabaseSync(DB_PATH)

const placeholders = CANONICAL.map(() => '?').join(',')
const rows = db
  .prepare(`select id, action, entity, title, details from AuditLog where action not in (${placeholders})`)
  .all(...CANONICAL)

if (rows.length === 0) {
  console.log('لا توجد أسطر شاذة — السجل مطبَّع أصلاً.')
  db.close()
  process.exit(0)
}

const tally = {}
for (const r of rows) {
  const key = `${r.action} → ${MAP[r.action] ?? '«بلا مقابل»'}  (${r.entity})`
  tally[key] = (tally[key] || 0) + 1
}
console.log(`أسطر شاذة: ${rows.length}`)
for (const [k, v] of Object.entries(tally).sort()) console.log(`   ${String(v).padStart(3)}  ${k}`)

const unmapped = rows.filter((r) => !MAP[r.action])
if (unmapped.length > 0) {
  console.error(`\n✗ ${unmapped.length} سطراً بقيمة action لا مقابل معتمداً لها — أضفها إلى MAP أولاً:`)
  for (const r of [...new Set(unmapped.map((r) => r.action))]) console.error(`   '${r}'`)
  db.close()
  process.exit(1)
}

if (!APPLY) {
  console.log('\n(عرض فقط — أعد التشغيل بـ --apply للتنفيذ)')
  db.close()
  process.exit(0)
}

const upd = db.prepare('update AuditLog set action = ?, details = ? where id = ?')
const ins = db.prepare(
  'insert into AuditLog (id, action, entity, entityId, entityNumber, title, summary, details, amount, createdAt) ' +
    'values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
)

db.exec('BEGIN')
try {
  for (const r of rows) {
    // حفظ القيمة الأصلية داخل details — التطبيع لا يمحو معلومة
    let details
    try {
      const parsed = r.details ? JSON.parse(r.details) : {}
      details = JSON.stringify({ ...parsed, 'القيمة الأصلية للإجراء': r.action })
    } catch {
      details = JSON.stringify({ 'التفاصيل الأصلية': r.details ?? '', 'القيمة الأصلية للإجراء': r.action })
    }
    upd.run(MAP[r.action], details, r.id)
  }

  // تصحيح السجل يُوثَّق في السجل نفسه
  ins.run(
    `audit-normalize-${Date.now().toString(36)}`,
    'SYSTEM',
    'SYSTEM',
    null,
    null,
    'تطبيع قيم الإجراء في سجل التدقيق',
    `طُبِّع ${rows.length} سطراً كانت تحمل قيم action خارج المعتمد (${[...new Set(rows.map((r) => r.action))].join('، ')}) ` +
      `إلى القيم المعتمدة في المخطط — القيمة الأصلية محفوظة في تفاصيل كل سطر. ` +
      `الأرشيف لم يُمس. (الدفعة 2 من خطة إصلاح تدقيق 2026-09-11)`,
    JSON.stringify({
      'عدد الأسطر المطبَّعة': String(rows.length),
      'التحويل': Object.entries(MAP).map(([k, v]) => `${k} ← ${v}`).join('، '),
      'الكيانات المتأثرة': [...new Set(rows.map((r) => r.entity))].join('، '),
      'وقت التطبيع': new Date().toISOString(),
    }),
    null,
    Date.now(),
  )
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  console.error('فشل التطبيع — أُرجعت القاعدة كما كانت:', error)
  db.close()
  process.exit(1)
}

const left = db.prepare(`select count(*) c from AuditLog where action not in (${placeholders})`).all(...CANONICAL)[0].c
console.log(`\n✓ طُبِّع ${rows.length} سطراً. أسطر شاذة متبقية: ${left}`)
console.log('  التوزيع بعد التطبيع:')
for (const r of db.prepare('select action, count(*) c from AuditLog group by action order by c desc').all()) {
  console.log(`   ${String(r.c).padStart(4)}  ${r.action}`)
}
db.close()
