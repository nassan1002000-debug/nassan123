// توكيدات التحقق الذاتي A1–A12 (القسم 10.4 من SYSTEM_MASTER_SPECIFICATION.md)
// ----------------------------------------------------------------------------
// يُشغَّل بعد كل دفعة إصلاح للتأكد أن الدفاتر لم تُمس:
//     node --env-file=.env scripts/golden-assertions.mjs
// يخرج بالرمز 0 عند نجاح كل التوكيدات، و1 عند فشل أيٍّ منها (صالح لبوابة CI).
// يقرأ عبر Prisma — أي من القاعدة نفسها التي يعمل عليها التطبيق، لا من مسار مفروض.
//
// تحديث 2026-09-16 (الدفعة 7): التراجع الحقيقي عن إقفال الفترة استعاد القاعدة
// إلى حالة الفترة المفتوحة (بلا سند افتتاحي وبلا أرضيات ترقيم مدوَّرة) — فالقيم
// المرجعية القديمة (JE-0462 وأرضيات 258/326/2/1) لم تعد تصف الحالة الحقيقية.
// A2 وA10 استُبدلا بما يصف الفترة المفتوحة بدقة (عدد القيود الكلي/المُرحّل وأعلى
// رقم مستند فعلي حالياً) — لا سند افتتاحي ولا أرضيات ترقيم في فترة مفتوحة أصلاً.
// البقية (A3–A9, A11, A12) قيمها الفعلية فقط تغيّرت مع رجوع الفترة لحالتها
// المفتوحة؛ منطق التوكيد نفسه لم يتغيّر.
//
// تحديث 2026-09-16 (الدفعة 7 تكملة — بند 3، اختبار حي لملاحظة استرداد نقاط
// الولاء): فاتورة اختبار حية على C-001 (استرداد 100 نقطة) أُنشئت ثم حُذفت
// عبر مسار النظام الرسمي — الحذف ناعم يحجز رقمها للأبد (INV-0259xx لا يُعاد)
// واسترداد النقاط يُعكس بحركة تعويضية جديدة لا بحذف الأصل (سجل تدقيق دائم)،
// فصار أعلى رقم فواتير فعلي INV-0259xx وعدد حركات الولاء 179 بلا أي تغيير في
// الرصيد الصافي (بقي 15,664) — هذا هو التصميم الصحيح، لا انحراف في الدفاتر.

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const r2 = (n) => Math.round(n * 100) / 100

const results = []
function assert(id, label, got, want) {
  const ok = String(got) === String(want)
  results.push({ id, label, got, want, ok })
  return ok
}

const lines = await db.journalEntryLine.findMany({
  where: { entry: { status: 'POSTED' } },
  select: { debit: true, credit: true, account: { select: { code: true, type: true } } },
})
// رصيد الحساب بمنطق مدين-موجب — الموجب مدين والسالب دائن
const bal = (code) => r2(lines.filter((l) => l.account.code === code).reduce((s, l) => s + l.debit - l.credit, 0))

const totalDebit = r2(lines.reduce((s, l) => s + l.debit, 0))
const totalCredit = r2(lines.reduce((s, l) => s + l.credit, 0))
const postedAccounts = new Set(lines.map((l) => l.account.code)).size
const revenue = r2(lines.filter((l) => l.account.type === 'REVENUE').reduce((s, l) => s + l.credit - l.debit, 0))
const expense = r2(lines.filter((l) => l.account.type === 'EXPENSE').reduce((s, l) => s + l.debit - l.credit, 0))

const entryCounts = await db.journalEntry.groupBy({ by: ['status'], _count: { _all: true } })
const totalEntries = entryCounts.reduce((s, g) => s + g._count._all, 0)
const postedEntries = entryCounts.find((g) => g.status === 'POSTED')?._count._all ?? 0
const periodCloseCount = await db.periodClose.count()
const balances = await db.itemBalance.findMany({ select: { quantity: true } })
const loyalty = await db.loyaltyTransaction.aggregate({ _sum: { points: true }, _count: true })
const maxNumber = async (model, prefix, field = 'number') => {
  const rows = await db[model].findMany({ where: { [field]: { startsWith: prefix } }, select: { [field]: true } })
  return rows.map((r) => r[field]).sort().pop() ?? null
}
const [maxInv, maxVch, maxSt, maxMc] = await Promise.all([
  maxNumber('invoice', 'INV-'),
  maxNumber('payment', 'VCH-'),
  maxNumber('stocktaking', 'ST-'),
  maxNumber('journalEntry', 'MC-'),
])
const accountCount = await db.account.count()

assert('A2', 'فترة مقفلة واحدة قائمة؟ (يجب: لا)', periodCloseCount, 0)
assert('A2', 'إجمالي القيود / المُرحّل منها', `${totalEntries} / ${postedEntries}`, '449 / 427')
assert('A3', 'معادلة الميزانية (مدين − دائن)', r2(totalDebit - totalCredit), 0)
assert('A4', 'السيولة 1110 + 1120', r2(bal('1110') + bal('1120')), 42594067.94)
assert('A5', 'كمية المخزون', r2(balances.reduce((s, b) => s + b.quantity, 0)), 12483.28)
assert('A5', 'عدد أرصدة المخزون', balances.length, 60)
assert('A6', 'إيرادات الفترة الحية (مفتوحة)', revenue, 84082033.66)
assert('A6', 'مصروفات الفترة الحية (مفتوحة)', expense, 122710554.26)
assert('A7', 'رأس المال 310001 + 310002 (دائن)', r2(-(bal('310001') + bal('310002'))), 100000000)
assert('A8', 'الأرباح المحتجزة 3200 (مدين — صفر: بلا تصفية فترة بعد)', bal('3200'), 0)
assert('A9', 'نقاط الولاء الحية', loyalty._sum.points, 15664)
assert('A9', 'عدد حركات الولاء', loyalty._count, 179)
assert('A10', 'أعلى رقم فعلي INV/VCH/ST/MC', `${maxInv}/${maxVch}/${maxSt}/${maxMc}`, 'INV-0259xx/VCH-0326/ST-002/MC-0001')
assert('A11', 'رصيد 113006 بعد المقاصة MC-0001', bal('113006'), 0)
assert('A12', 'الميزان الحي — عدد الحسابات', postedAccounts, 34)
assert('—', 'عدد الحسابات في الشجرة', accountCount, 59)

const width = Math.max(...results.map((r) => r.label.length))
for (const r of results) {
  const mark = r.ok ? '✓' : '✗'
  const tail = r.ok ? '' : `   ≠ المتوقع ${r.want}`
  console.log(`${mark} ${r.id.padEnd(4)} ${r.label.padEnd(width)} ${String(r.got).padStart(18)}${tail}`)
}

const failed = results.filter((r) => !r.ok)
console.log(
  failed.length === 0
    ? `\n✓ كل التوكيدات ناجحة (${results.length}/${results.length}) — الدفاتر سليمة`
    : `\n✗ فشل ${failed.length} من ${results.length}: ${failed.map((r) => r.id).join('، ')}`,
)

await db.$disconnect()
process.exit(failed.length === 0 ? 0 : 1)
