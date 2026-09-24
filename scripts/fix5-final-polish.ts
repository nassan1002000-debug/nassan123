// اللمسة الأخيرة على دورة 2026:
// 1) تخفيف الإيجار إلى 600,000/شهر (كان 1.5M غير متناسب مع اقتصاد المحاكاة)
//    — حذف سندات الإيجار الثمانية وإعادة إنشائها بالقيمة الواقعية (آليات النظام)
// 2) سحب نقدي من البنك 8,000,000 لتغطية المصروفات النقدية (قيد MANAUL)
// 3) دفعة مبيعات جملة كبيرة (14 فاتورة — فبراير-أغسطس) من المخزون المتوفر
//    بتسعيرة جملة محدثة (قائمة + 10%) — ترفع الإيراد والسيولة معاً
// 4) تحقق نهائي شامل
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const BASE = 'http://localhost:3000'
let COOKIE = ''
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
const RATE_NOTE = 'سعر الصرف: 15,000 ل.س/دولار أمريكي'

async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
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
    json = {}
  }
  if (!res.ok) throw new Error(`API ${method} ${path} → ${res.status}: ${text.slice(0, 250)}`)
  return json as T
}

const accId = new Map<string, string>()
const itemId = new Map<string, string>()
const itemWh = new Map<string, string>()
const itemSale = new Map<string, number>()
const codeByItemId = new Map<string, string>()

async function cash(): Promise<number> {
  const agg = await db.journalEntryLine.aggregate({ where: { accountId: accId.get('1110')! }, _sum: { debit: true, credit: true } })
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

  const accounts = await db.account.findMany({ select: { id: true, code: true } })
  for (const a of accounts) accId.set(a.code, a.id)
  const items = await db.item.findMany({ select: { id: true, code: true, warehouseId: true, salePrice: true } })
  for (const i of items) {
    itemId.set(i.code, i.id)
    codeByItemId.set(i.id, i.code)
    if (i.warehouseId) itemWh.set(i.code, i.warehouseId)
    itemSale.set(i.code, i.salePrice)
  }

  console.log('الصندوق قبل:', (await cash()).toLocaleString('en-US'))

  // ===== 1) الإيجار: حذف ثم إعادة إنشاء بـ600,000 =====
  const rentVouchers = await db.payment.findMany({
    where: { accountId: accId.get('5300')!, invoiceId: null, notes: { contains: 'إيجار' } },
    select: { id: true, number: true, date: true, amount: true },
    orderBy: [{ date: 'asc' }],
  })
  console.log(`سندات الإيجار: ${rentVouchers.length}`)
  const rentDates = rentVouchers.map((v) => v.date.toISOString().slice(0, 10))
  for (const v of rentVouchers) await api('DELETE', `/api/payments/${v.id}`)
  for (const d of rentDates) {
    await api('POST', '/api/payments', {
      type: 'PAYMENT',
      date: d,
      amount: 600_000,
      method: 'CASH',
      accountId: accId.get('5300')!,
      notes: `إيجار المستودع — ${d.slice(0, 7)} — ${RATE_NOTE}`,
    })
  }
  console.log(`أُعيد إنشاء ${rentDates.length} سند إيجار بـ600,000 ✓`)

  // ===== 2) سحب نقدي من البنك =====
  const existingWithdraw = await db.journalEntry.findFirst({ where: { description: { startsWith: 'سحب نقدي من البنك' } } })
  if (!existingWithdraw) {
    await api('POST', '/api/journal', {
      date: '2026-08-20',
      description: 'سحب نقدي من البنك - مصرف الشام لتغطية المصروفات النقدية التشغيلية — 8,000,000 ل.س',
      source: 'MANUAL',
      status: 'POSTED',
      lines: [
        { accountId: accId.get('1110')!, debit: 8_000_000, description: 'قبض نقدي من البنك إلى الصندوق' },
        { accountId: accId.get('1120')!, credit: 8_000_000, description: 'سحب من الحساب البنكي' },
      ],
      totalDebit: 8_000_000,
      totalCredit: 8_000_000,
    })
    console.log('سحب بنكي 8,000,000 إلى الصندوق ✓')
  }

  // ===== 3) دفعة مبيعات الجملة الكبيرة =====
  const BUNDLE = new Set(['I-008', 'I-010', 'I-011', 'I-024', 'I-025', 'I-031', 'I-038'])
  const customers = await db.partner.findMany({ where: { code: { in: ['C-001', 'C-002', 'C-003', 'C-004', 'C-005'] } }, select: { id: true, code: true } })
  let seq = 0
  for (let m = 2; m <= 8; m++) {
    for (const day of [21, 26]) {
      if (m === 8 && day === 26) continue // 13 فاتورة تكفي
      const cust = customers[seq % customers.length]
      // أعلى المواد مخزوناً (غير السلال)
      const balances = await db.itemBalance.findMany({ where: { warehouseId: { not: undefined } }, select: { itemId: true, warehouseId: true, quantity: true }, orderBy: [{ quantity: 'desc' }], take: 200 })
      const idToCode = codeByItemId
      const pool = balances.filter((b) => b.quantity >= 20 && !BUNDLE.has(idToCode.get(b.itemId) ?? ''))
      const lines: { itemId: string; warehouseId: string; quantity: number; unitPrice: number }[] = []
      const used = new Set<string>()
      for (const b of pool) {
        if (lines.length >= 5) break
        if (used.has(b.itemId)) continue
        const list = itemSale.get(idToCode.get(b.itemId)!) ?? 0
        if (list <= 0) continue
        const qty = Math.min(Math.floor(b.quantity * 0.35), 20 + ((seq * 7 + lines.length * 3) % 45))
        if (qty < 5) continue
        used.add(b.itemId)
        lines.push({ itemId: b.itemId, warehouseId: b.warehouseId, quantity: qty, unitPrice: round2(list * 1.1 + 0.5) })
      }
      if (lines.length === 0) continue
      const subtotal = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0))
      const total = round2(subtotal * 1.05)
      const payMode = seq % 5
      const payments: { amount: number; method: string; date: string; notes: string }[] = []
      const dateStr = `2026-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      if (payMode <= 1) payments.push({ amount: total, method: payMode === 0 ? 'CASH' : 'BANK', date: dateStr, notes: `تحصيل كامل — تسعيرة جملة 2026 — ${RATE_NOTE}` })
      else if (payMode <= 3) payments.push({ amount: round2(total * 0.4), method: 'CASH', date: dateStr, notes: `دفعة أولى 40% — تسعيرة جملة 2026 — ${RATE_NOTE}` })
      await api('POST', '/api/invoices', {
        type: 'SALE',
        date: dateStr,
        partnerId: cust.id,
        taxRate: 5,
        notes: `توزيع جملة كبير — تسعيرة جملة 2026 المحدثة — ${RATE_NOTE}`,
        lines,
        payments,
      })
      seq++
      console.log(`   بيع جملة ${seq} (${dateStr}): ${cust.code} — ${lines.length} بنود — ${total.toLocaleString('en-US')} ${payments.length ? '— مدفوع جزئياً/كاملاً' : '— آجل'}`)
    }
  }

  console.log('الصندوق بعد:', (await cash()).toLocaleString('en-US'))

  // ===== 4) التحقق النهائي =====
  const agg = await db.journalEntryLine.aggregate({ _sum: { debit: true, credit: true } })
  const d = round2(agg._sum.debit ?? 0)
  const c = round2(agg._sum.credit ?? 0)
  console.log(`ميزان المراجعة: ${d.toLocaleString('en-US')} = ${c.toLocaleString('en-US')} — ${Math.abs(d - c) < 0.01 ? 'متوازن ✓' : '✗'}`)
  const typeBalance = async (type: string): Promise<number> => {
    const list = await db.account.findMany({ where: { type }, select: { id: true } })
    const a2 = await db.journalEntryLine.aggregate({ where: { accountId: { in: list.map((a) => a.id) }, entry: { status: 'POSTED' } }, _sum: { debit: true, credit: true } })
    return round2((a2._sum.debit ?? 0) - (a2._sum.credit ?? 0))
  }
  const assets = await typeBalance('ASSET')
  const liabilities = await typeBalance('LIABILITY')
  const equity = await typeBalance('EQUITY')
  const revenue = await typeBalance('REVENUE')
  const expense = await typeBalance('EXPENSE')
  const netProfit = round2(-revenue - expense)
  const lhs = assets
  const rhs = round2(-liabilities + -equity + netProfit)
  console.log(`الأصول ${assets.toLocaleString('en-US')} = خصوم ${(-liabilities).toLocaleString('en-US')} + حقوق ${(-equity).toLocaleString('en-US')} + نتيجة ${netProfit.toLocaleString('en-US')} — ${Math.abs(lhs - rhs) < 0.01 ? 'متوازنة ✓✓✓' : '✗'}`)
  console.log(`صافي نتيجة الفترة الآن: ${netProfit.toLocaleString('en-US')}`)
  console.log('✓ اكتملت اللمسة الأخيرة')
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error('✗ فشل:', e instanceof Error ? e.message : e)
    await db.$disconnect()
    process.exit(1)
  })
