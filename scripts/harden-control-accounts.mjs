// تحصين حسابات التحكم — تفعيل isSystem على الحسابات المذكورة في القسم 0 البند 8
// من SYSTEM_MASTER_SPECIFICATION.md التي فاتها العلم منذ البذر الأول — تشغيل لمرة واحدة (idempotent)
// ----------------------------------------------------------------------------
// الخلفية: البند 8 ينص «حسابات التحكم مقدسة: 1130 عملاء، 2110 موردون، 1150 سلف
// موظفين، 3100 رأس مال، 2120 ضريبة، 3200 أرباح محتجزة — لا يُمس تعريفها». لكن
// seed.ts لم يضع isSystem=true إلا على رؤوس المجموعات الخمس (1000/1100/1200/
// 2000/2100/3000/4000/5000) و1150 وحدها من الستة — فبقيت خمسة من الستة (1130،
// 2110، 3100، 2120، 3200) قابلة لتغيير الكود أو الحذف عبر PUT/DELETE
// /api/accounts/[id] بلا أي رفض، رغم أن الكود يعتمد على ثبات هذه الرموز في
// عشرات المواضع (invoice-journal، period-server، stock-journal، accounts-link).
//
// أُضيف 1140 (المخزون) إلى القائمة رغم أنه ليس من الستة المذكورة نصاً: الدفعة 3
// (المتوسط المرجح) ربطت avgCost على البطاقة بافتراض أن قيمة حساب 1140 الدفترية
// لا تتحرك إلا عبر حركات المخزون (فواتير/تلف/جرد/إقفال) — وتعديل كوده أو رصيده
// الافتتاحي يدوياً يكسر هذا الافتراض بصمت.
//
// الأثر: isSystem=true يفعّل حارسين موجودين أصلاً في accounts/[id]/route.ts (لا
// كود جديد هنا): منع تغيير الكود، ومنع الحذف. حارس منع تعديل الرصيد الافتتاحي
// وحارس منع الترحيل اليدوي المباشر (الدفعة 4) يعتمدان على نفس العلم مباشرة.
//
// التشغيل: node scripts/harden-control-accounts.mjs [--apply]
//          بلا --apply يعرض ما سيتغيّر دون أي كتابة.

import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'

const DB_PATH = 'db/custom.db'
const APPLY = process.argv.includes('--apply')

// الكود ← السبب (يُكتب في سجل التدقيق)
const TARGETS = {
  '1130': 'عملاء (ذمم مدينة) — القسم 0 البند 8',
  '2110': 'الموردون (ذمم دائنة) — القسم 0 البند 8',
  '3100': 'رأس المال — القسم 0 البند 8',
  '2120': 'ضريبة القيمة المضافة — القسم 0 البند 8',
  '3200': 'الأرباح المحتجزة — القسم 0 البند 8',
  '1140': 'المخزون — تحصين إضافي (الدفعة 4): يعتمد عليه محرك التكلفة الوسطية (الدفعة 3)',
}

if (!existsSync(DB_PATH)) {
  console.error(`القاعدة غير موجودة: ${DB_PATH}`)
  process.exit(1)
}

const db = new DatabaseSync(DB_PATH)

const codes = Object.keys(TARGETS)
const placeholders = codes.map(() => '?').join(',')
const rows = db
  .prepare(`select id, code, name, isSystem from Account where code in (${placeholders})`)
  .all(...codes)

const missing = codes.filter((c) => !rows.some((r) => r.code === c))
if (missing.length > 0) {
  console.error(`✗ حسابات مفقودة من دليل الحسابات: ${missing.join('، ')}`)
  db.close()
  process.exit(1)
}

const toFix = rows.filter((r) => !r.isSystem)
console.log(`حسابات التحكم المستهدفة: ${rows.length}`)
for (const r of rows) {
  const mark = r.isSystem ? '=' : '→'
  console.log(`   ${mark} ${r.code}  ${r.name.padEnd(28)} isSystem: ${r.isSystem ? 'true (لا تغيير)' : 'false → true'}`)
}

if (toFix.length === 0) {
  console.log('\nلا شيء ليُصلَح — كل الحسابات المستهدفة محصّنة أصلاً.')
  db.close()
  process.exit(0)
}

if (!APPLY) {
  console.log(`\n(عرض فقط — ${toFix.length} حساباً سيُحصَّن. أعد التشغيل بـ --apply للتنفيذ)`)
  db.close()
  process.exit(0)
}

const upd = db.prepare('update Account set isSystem = 1 where id = ?')
const ins = db.prepare(
  'insert into AuditLog (id, action, entity, entityId, entityNumber, title, summary, details, amount, createdAt) ' +
    'values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
)

db.exec('BEGIN')
try {
  for (const r of toFix) {
    upd.run(r.id)
    ins.run(
      `harden-account-${r.code}-${Date.now().toString(36)}`,
      'SYSTEM',
      'ACCOUNT',
      r.id,
      r.code,
      `تحصين حساب تحكم ${r.code} — ${r.name}`,
      `فُعِّل isSystem على حساب ${r.code} «${r.name}» (كان false) — ${TARGETS[r.code]}. ` +
        `يمنع من الآن: تغيير الكود، الحذف، تعديل الرصيد الافتتاحي، والترحيل اليدوي المباشر عليه من شاشة القيود.`,
      JSON.stringify({
        'الحساب': `${r.code} — ${r.name}`,
        'isSystem قبل': 'false',
        'isSystem بعد': 'true',
        'السبب': TARGETS[r.code],
        'وقت التحصين': new Date().toISOString(),
      }),
      null,
      Date.now(),
    )
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  console.error('فشل التحصين — أُرجعت القاعدة كما كانت:', error)
  db.close()
  process.exit(1)
}

console.log(`\n✓ حُصِّن ${toFix.length} حساباً: ${toFix.map((r) => r.code).join('، ')}`)
db.close()
