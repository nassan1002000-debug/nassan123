// إصلاح السيولة النقدية + التحقق النهائي الشامل (بمجمّع الشجرة الفرعية)
// القصة المحاسبية: سنة تأسيس بتخزين كبير — سداد الموردين يؤجل (تُحذف سندات السداد المستقلة
// عدا سند S-001) فيعود الصندوق موجباً، وترتفع الدائنية للموردين — كل ذلك عبر آلية الحذف
// الرسمية التي تلغي قيد كل سند ذرياً فيبقى الميزان متوازناً
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const BASE = 'http://localhost:3000'
let COOKIE = ''
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

async function api(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(COOKIE ? { Cookie: COOKIE } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    /* غير JSON */
  }
  if (!res.ok) throw new Error(`API ${method} ${path} → ${res.status}: ${text.slice(0, 250)}`)
  return json
}

// رصيد شجرة فرعية كاملة (الحساب + كل أبنائه) بصيغة مدين-دائن
async function subtreeBalance(code: string): Promise<number> {
  const all = await db.account.findMany({ select: { id: true, code: true, parentId: true } })
  const root = all.find((a) => a.code === code)
  if (!root) return 0
  const ids = new Set<string>([root.id])
  let grew = true
  while (grew) {
    grew = false
    for (const a of all) {
      if (a.parentId && ids.has(a.parentId) && !ids.has(a.id)) {
        ids.add(a.id)
        grew = true
      }
    }
  }
  const agg = await db.journalEntryLine.aggregate({
    where: { accountId: { in: [...ids] }, entry: { status: 'POSTED' } },
    _sum: { debit: true, credit: true },
  })
  return round2((agg._sum.debit ?? 0) - (agg._sum.credit ?? 0))
}

async function typeBalance(type: string): Promise<number> {
  const list = await db.account.findMany({ where: { type }, select: { id: true } })
  if (list.length === 0) return 0
  const agg = await db.journalEntryLine.aggregate({
    where: { accountId: { in: list.map((a) => a.id) }, entry: { status: 'POSTED' } },
    _sum: { debit: true, credit: true },
  })
  return round2((agg._sum.debit ?? 0) - (agg._sum.credit ?? 0))
}

async function main(): Promise<void> {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  if (!login.ok) throw new Error('فشل الدخول')
  COOKIE = (login.headers.get('set-cookie') ?? '').split(';')[0]

  // ===== حذف سندات سداد الموردين المستقلة (إلا S-001) =====
  const keep = await db.partner.findUnique({ where: { code: 'S-001' }, select: { id: true } })
  const vouchers = await db.payment.findMany({
    where: { type: 'PAYMENT', invoiceId: null, partner: { type: 'SUPPLIER' } },
    select: { id: true, number: true, amount: true, partnerId: true, partner: { select: { code: true } } },
    orderBy: [{ date: 'asc' }],
  })
  let deletedCount = 0
  let deletedTotal = 0
  for (const v of vouchers) {
    if (keep && v.partnerId === keep.id) continue
    await api('DELETE', `/api/payments/${v.id}`)
    deletedCount++
    deletedTotal = round2(deletedTotal + v.amount)
  }
  console.log(`حُذفت ${deletedCount} سند سداد موردين بقيمة ${deletedTotal.toLocaleString('en-US')} (أُجل سدادها لسنة التأسيس) — وبقي سند S-001 ✓`)

  // ===== التحقق النهائي الشامل =====
  console.log('════ التحقق النهائي الشامل ════')
  const agg = await db.journalEntryLine.aggregate({ _sum: { debit: true, credit: true } })
  const d = round2(agg._sum.debit ?? 0)
  const c = round2(agg._sum.credit ?? 0)
  console.log(`ميزان المراجعة الكلي: مدين ${d.toLocaleString('en-US')} = دائن ${c.toLocaleString('en-US')} — ${Math.abs(d - c) < 0.01 ? 'متوازن ✓' : '✗✗✗'}`)

  for (const code of ['1000', '1110', '1120', '1130', '1140', '1150', '1200', '2000', '2110', '2120', '3000', '4000', '5000']) {
    const net = await subtreeBalance(code)
    console.log(`  ${code}: ${net.toLocaleString('en-US')}`)
  }

  const assets = await typeBalance('ASSET')
  const liabilities = await typeBalance('LIABILITY')
  const equity = await typeBalance('EQUITY')
  const revenue = await typeBalance('REVENUE')
  const expense = await typeBalance('EXPENSE')
  const netProfit = round2(-revenue - expense) // الإيرادات دائنة (سالبة بصيغة مدين) والمصروفات مدينة
  const lhs = assets
  const rhs = round2(-liabilities + -equity + netProfit)
  console.log(`الأصول ${assets.toLocaleString('en-US')} = الخصوم ${(-liabilities).toLocaleString('en-US')} + حقوق الملكية ${(-equity).toLocaleString('en-US')} + نتيجة الفترة ${netProfit.toLocaleString('en-US')} — ${Math.abs(lhs - rhs) < 0.01 ? 'الميزانية متوازنة ✓✓✓' : `فرق ${(lhs - rhs).toLocaleString('en-US')} ✗✗✗`}`)
  console.log(`صافي نتيجة يناير-أغسطس 2026: ${netProfit.toLocaleString('en-US')} ل.س`)
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error('✗ فشل:', e instanceof Error ? e.message : e)
    await db.$disconnect()
    process.exit(1)
  })
