// بذر التكلفة الوسطية المرجحة من فواتير الشراء الحية — تشغيل لمرة واحدة (idempotent)
// ----------------------------------------------------------------------------
// الخلفية: التراجع عن إقفال الفترة (batch6) استعاد db/custom.db من نسخة أرشيفية
// أقدم من الدفعة 3 (إضافة عمود avgCost) — فعاد ملف القاعدة بمخطط لا يحوي العمود.
// npx prisma db push زامن المخطط (العمود أُضيف بقيمة افتراضية 0 لكل الأصناف)، لكن
// avgCost و purchasePrice كلاهما صفر فعلياً الآن رغم وجود 359 بند فاتورة شراء حية
// حقيقية — لأن الكود القديم (زمن إنشاء هذه الفواتير) لم يكن يكتب أياً منهما إطلاقاً
// (نفس عطل ما قبل الدفعة 3، لكن هنا المصدر فواتير الشراء الحية لا الأرشيف).
//
// الحل هنا مطابق منهجياً لـseed-avg-cost.mjs (الدفعة 3) لكن المصدر فواتير الشراء
// الحية في db/custom.db مباشرة — لا أرشيف فترة، لأن الفترة مفتوحة الآن فعلاً.
//
// التشغيل: node scripts/backfill-avgcost-live.mjs [--apply]
//          بلا --apply يعرض النتيجة والمطابقة دون أي كتابة.

import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'

const LIVE_PATH = 'db/custom.db'
const APPLY = process.argv.includes('--apply')
const r2 = (n) => Math.round(n * 100) / 100

if (!existsSync(LIVE_PATH)) {
  console.error(`القاعدة الحية غير موجودة: ${LIVE_PATH}`)
  process.exit(1)
}

const live = new DatabaseSync(LIVE_PATH)

// ==================== احتساب المتوسط المرجح من فواتير الشراء الحية ====================
const pool = new Map() // itemId -> { qty, value, last, lastDate }
const rows = live
  .prepare(
    `select il.itemId, il.quantity, il.unitPrice, inv.type, inv.date
     from InvoiceLine il join Invoice inv on inv.id = il.invoiceId
     where inv.type in ('PURCHASE','PURCHASE_RETURN') and inv.isDeleted = 0
     order by inv.date asc, il.id asc`,
  )
  .all()
for (const r of rows) {
  const p = pool.get(r.itemId) ?? { qty: 0, value: 0, last: 0, lastDate: 0 }
  const sign = r.type === 'PURCHASE' ? 1 : -1
  p.qty += sign * r.quantity
  p.value += sign * r.quantity * r.unitPrice
  if (r.type === 'PURCHASE' && r.date >= p.lastDate) {
    p.last = r.unitPrice
    p.lastDate = r.date
  }
  pool.set(r.itemId, p)
}

// ==================== المطابقة مع الدفاتر قبل أي كتابة ====================
const items = live.prepare('select id, code, name, avgCost, purchasePrice from Item').all()
const balances = live.prepare('select itemId, sum(quantity) q from ItemBalance group by itemId').all()
const qtyById = new Map(balances.map((b) => [b.itemId, b.q]))

const bookValue = live
  .prepare(
    `select round(sum(l.debit) - sum(l.credit), 2) v
     from JournalEntryLine l join JournalEntry e on e.id = l.entryId join Account a on a.id = l.accountId
     where a.code = '1140' and e.status = 'POSTED'`,
  )
  .get().v

const plan = []
let seededValue = 0
const missing = []
for (const it of items) {
  const p = pool.get(it.id)
  const avg = p && p.qty > 0 ? p.value / p.qty : 0
  const qty = qtyById.get(it.id) ?? 0
  if (avg > 0) {
    plan.push({ id: it.id, code: it.code, name: it.name, avg, last: p.last, qty, before: it.avgCost })
    seededValue += qty * avg
  } else if (qty !== 0) {
    missing.push(`${it.code} ${it.name} (كمية ${qty})`)
  }
}

console.log(`مواد لها تكلفة من فواتير الشراء الحية : ${plan.length} من ${items.length}`)
console.log(`مواد برصيد بلا تكلفة                  : ${missing.length}`)
for (const m of missing.slice(0, 10)) console.log(`   - ${m}`)

const diff = r2(seededValue - bookValue)
console.log('')
console.log(`قيمة المخزون بالتكلفة المبذورة : ${r2(seededValue).toLocaleString('en-US')} ل.س`)
console.log(`القيمة الدفترية (حساب 1140)     : ${bookValue.toLocaleString('en-US')} ل.س`)
console.log(`الفرق                            : ${diff.toLocaleString('en-US')} ل.س`)

if (Math.abs(diff) > 0.01) {
  console.log('')
  console.log('⚠ الفرق غير صفري — راجع قبل الاعتماد (لا يمنع البذر إن كان صغيراً ومفهوم السبب).')
}
if (missing.length > 0) {
  console.error('')
  console.error('✗ لا يمكن البذر: مواد ذات رصيد بلا تكلفة معروفة — ستُرحَّل مبيعاتها بتكلفة صفر.')
  console.error('  أدخل لها فاتورة مشتريات أو صحّح تكلفتها يدوياً أولاً.')
  live.close()
  process.exit(1)
}

if (!APPLY) {
  console.log('\n(عرض فقط — أعد التشغيل بـ --apply للتنفيذ)')
  console.log('عيّنة أول 5 مواد:')
  for (const p of plan.slice(0, 5)) {
    console.log(`   ${p.code} ${p.name.padEnd(30)} متوسط ${p.avg.toFixed(2)}  آخر ${p.last.toFixed(2)}  كمية ${p.qty}`)
  }
  live.close()
  process.exit(0)
}

// ==================== التنفيذ ====================
const upd = live.prepare('update Item set avgCost = ?, purchasePrice = ? where id = ?')
const ins = live.prepare(
  'insert into AuditLog (id, action, entity, entityId, entityNumber, title, summary, details, amount, createdAt) ' +
    'values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
)

live.exec('BEGIN')
try {
  for (const p of plan) upd.run(p.avg, p.last, p.id)
  ins.run(
    `backfill-avgcost-live-${Date.now().toString(36)}`,
    'SYSTEM',
    'SYSTEM',
    null,
    null,
    'بذر التكلفة الوسطية المرجحة من فواتير الشراء الحية',
    `بُذرت التكلفة الوسطية المرجحة لـ${plan.length} مادة من فواتير الشراء الحية (359 بند) بعد أن أعاد ` +
      `التراجع عن إقفال الفترة القاعدة إلى نسخة أقدم من الدفعة 3 بلا عمود avgCost — ` +
      `قيمة المخزون بالتكلفة المبذورة ${r2(seededValue).toLocaleString('en-US')} ل.س ` +
      `مقابل قيمة دفترية ${bookValue.toLocaleString('en-US')} ل.س (فرق ${diff}). (الدفعة 7)`,
    JSON.stringify({
      'عدد المواد': String(plan.length),
      'قيمة المخزون بالتكلفة': r2(seededValue).toLocaleString('en-US'),
      'القيمة الدفترية 1140': bookValue.toLocaleString('en-US'),
      'الفرق': String(diff),
      'المصدر': 'فواتير الشراء الحية (359 بند)',
      'وقت البذر': new Date().toISOString(),
    }),
    r2(seededValue),
    Date.now(),
  )
  live.exec('COMMIT')
} catch (error) {
  live.exec('ROLLBACK')
  console.error('فشل البذر — أُرجعت القاعدة كما كانت:', error)
  live.close()
  process.exit(1)
}

const after = live.prepare('select count(*) c from Item where avgCost > 0').get().c
const check = live
  .prepare('select round(sum(b.quantity * i.avgCost), 2) v from ItemBalance b join Item i on i.id = b.itemId')
  .get().v
console.log(`\n✓ بُذرت ${plan.length} مادة — مواد بتكلفة موجبة الآن: ${after} من ${items.length}`)
console.log(`  قيمة المخزون المقاسة من القاعدة: ${check.toLocaleString('en-US')} ل.س`)
console.log(`  القيمة الدفترية                 : ${bookValue.toLocaleString('en-US')} ل.س`)
console.log(`  الفرق                            : ${r2(check - bookValue)}`)
live.close()
