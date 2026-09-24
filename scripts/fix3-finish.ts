// سكربت الإنهاء: إيقاف الشبح + المقاصة MC + تصفية الضريبة + التحقق النهائي
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const BASE = 'http://localhost:3000'
let COOKIE = ''
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

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
    /* غير JSON */
  }
  if (!res.ok) throw new Error(`API ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`)
  return json as T
}

const accId = new Map<string, string>()

async function accountBalance(code: string): Promise<{ debit: number; credit: number; net: number }> {
  const id = accId.get(code)
  if (!id) return { debit: 0, credit: 0, net: 0 }
  const agg = await db.journalEntryLine.aggregate({
    where: { accountId: id, entry: { status: 'POSTED' } },
    _sum: { debit: true, credit: true },
  })
  const debit = round2(agg._sum.debit ?? 0)
  const credit = round2(agg._sum.credit ?? 0)
  return { debit, credit, net: round2(debit - credit) }
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

  // ===== 0) إيقاف المورد الشبح S-006 (الطريقة الصحيحة PUT) =====
  const phantom = await db.partner.findUnique({ where: { code: 'S-006' }, select: { id: true, isActive: true } })
  if (phantom?.isActive) {
    await api('PUT', `/api/partners/${phantom.id}`, { name: 'أقساط سيارات مستحقة الدفع', type: 'SUPPLIER', isActive: false })
    console.log('أُوقف ملف المورد الشبح S-006 (يحمل أرقاماً محجوزة xx فلا يُحذف) ✓')
  } else {
    console.log('الشبح S-006 موقوف مسبقاً ✓')
  }

  // ===== 1) المقاصة MC مورد↔عميل لعبد الرحمن بركات =====
  const realSup = await db.partner.findFirst({ where: { name: 'عبد الرحمن بركات', type: 'SUPPLIER' } })
  const brkCust = await db.partner.findFirst({ where: { name: 'عبد الرحمن بركات', type: 'CUSTOMER' } })
  if (!realSup?.accountId || !brkCust?.accountId) throw new Error('ملفات بركات ناقصة')
  const supAccId = realSup.accountId
  const custAccId = brkCust.accountId
  const supCode = (await db.account.findUnique({ where: { id: supAccId }, select: { code: true } }))?.code
  const custCode = (await db.account.findUnique({ where: { id: custAccId }, select: { code: true } }))?.code
  const supBal = await accountBalance(supCode!)
  const custBal = await accountBalance(custCode!)
  const amount = round2(Math.min(custBal.net, -supBal.net))
  const existingMc = await db.journalEntry.findFirst({ where: { number: { startsWith: 'MC-' } } })
  if (existingMc) {
    console.log(`المقاصة موجودة مسبقاً ${existingMc.number} (${existingMc.totalDebit.toLocaleString('en-US')} ل.س) ✓`)
  } else {
    console.log(`قبل المقاصة: مورد ${supCode} = ${supBal.net.toLocaleString('en-US')} — عميل ${custCode} = ${custBal.net.toLocaleString('en-US')}`)
    if (amount <= 0) throw new Error('لا رصيد متقابل للمقاصة')
    const mc = await api<{ voucher?: { number: string } }>('POST', '/api/clearings', {
      date: '2026-08-31',
      notes: 'مقاصة ذمم متبادلة للشريك عبد الرحمن بركات — تسوية رصيده كمورد (معمل المنظفات) مع رصيده كعميل (محله التجاري)',
      pairs: [
        {
          debitAccountId: supAccId,
          creditAccountId: custAccId,
          amount,
          description: 'تصفية الذمم المتبادلة — مقاصة مورد/عميل للشريك عبد الرحمن بركات',
        },
      ],
    })
    console.log(`مقاصة ${mc.voucher?.number}: ${amount.toLocaleString('en-US')} ل.س — مدين ${supCode} ↔ دائن ${custCode} ✓`)
  }

  // ===== 2) تصفية ضريبة القيمة المضافة — بالاتجاهين (مستحقة لنا ندفعها / لصالحنا نستردها) =====
  const vatEntry = await db.journalEntry.findFirst({ where: { description: { startsWith: 'تصفية حساب ضريبة القيمة المضافة' } } })
  if (!vatEntry) {
    const vat = await accountBalance('2120')
    if (vat.net < -0.005) {
      // دائنة = مستحقة السداد للدولة من الصندوق
      const payable = round2(-vat.net)
      const je = await api<{ entry?: { number?: string }; number?: string }>('POST', '/api/journal', {
        date: '2026-08-31',
        description: `تصفية حساب ضريبة القيمة المضافة حتى 31/08/2026 — ضريبة المخرجات مقابل المدخلات — صافي المسدد نقداً ${payable.toLocaleString('en-US')} ل.س`,
        source: 'MANUAL',
        status: 'POSTED',
        lines: [
          { accountId: accId.get('2120')!, debit: payable, description: 'تسوية أمانات الضريبة — المدخلات مقابل المخرجات' },
          { accountId: accId.get('1110')!, credit: payable, description: 'سداد نقدي من الصندوق' },
        ],
        totalDebit: payable,
        totalCredit: payable,
      })
      console.log(`تصفية الضريبة (مسددة للدولة): ${payable.toLocaleString('en-US')} — قيد ${je.number ?? je.entry?.number} ✓`)
    } else if (vat.net > 0.005) {
      // مدينة = فائض مدخلات فوق مخرجات (سنة تأسيس بمخزون كبير) — مستردة نقداً
      const refund = vat.net
      const je = await api<{ entry?: { number?: string }; number?: string }>('POST', '/api/journal', {
        date: '2026-08-31',
        description: `تصفية حساب ضريبة القيمة المضافة حتى 31/08/2026 — فائض ضريبة المدخلات (سنة تأسيس بتخزين كبير) عن المخرجات — استرداد نقدي ${refund.toLocaleString('en-US')} ل.س`,
        source: 'MANUAL',
        status: 'POSTED',
        lines: [
          { accountId: accId.get('1110')!, debit: refund, description: 'قبض استرداد فارق الضريبة من الخزينة الدولة' },
          { accountId: accId.get('2120')!, credit: refund, description: 'تسوية أمانات الضريبة — إقفال الحساب إلى الصفر' },
        ],
        totalDebit: refund,
        totalCredit: refund,
      })
      console.log(`تصفية الضريبة (مستردة لصالح الشركة): ${refund.toLocaleString('en-US')} — قيد ${je.number ?? je.entry?.number} ✓`)
    } else {
      console.log('ضريبة القيمة المضافة صفر — لا تصفية مطلوبة')
    }
  } else {
    console.log(`تصفية الضريبة موجودة مسبقاً ${vatEntry.number} ✓`)
  }

  // ===== 3) التحقق النهائي الشامل =====
  console.log('════ التحقق النهائي ════')
  const agg = await db.journalEntryLine.aggregate({ _sum: { debit: true, credit: true } })
  const d = round2(agg._sum.debit ?? 0)
  const c = round2(agg._sum.credit ?? 0)
  console.log(`ميزان المراجعة: مدين ${d.toLocaleString('en-US')} / دائن ${c.toLocaleString('en-US')} — ${Math.abs(d - c) < 0.01 ? 'متوازن ✓' : 'غير متوازن ✗✗✗'}`)
  for (const code of ['1110', '1120', '1130', '1140', '1150', '1220', '1221', '2110', '2120', '3100', '3200', '4100', '4110', '5000', '211007']) {
    const b = await accountBalance(code)
    console.log(`  ${code}: مدين ${b.debit.toLocaleString('en-US')} — دائن ${b.credit.toLocaleString('en-US')} — الصافي ${b.net.toLocaleString('en-US')}`)
  }
  const counts = {
    entries: await db.journalEntry.count(),
    invoices: await db.invoice.count(),
    sales: await db.invoice.count({ where: { type: 'SALE' } }),
    purchases: await db.invoice.count({ where: { type: 'PURCHASE' } }),
    payments: await db.payment.count(),
    salariesPaid: await db.salary.count({ where: { status: 'PAID' } }),
    loyaltyTx: await db.loyaltyTransaction.count(),
    stocktakingsPosted: await db.stocktaking.count({ where: { status: 'POSTED' } }),
    clearings: await db.journalEntry.count({ where: { number: { startsWith: 'MC-' } } }),
  }
  console.log('العدّادات:', JSON.stringify(counts))
  const sumType = async (type: string): Promise<number> => {
    const list = await db.account.findMany({ where: { type }, select: { id: true } })
    if (list.length === 0) return 0
    const a2 = await db.journalEntryLine.aggregate({
      where: { accountId: { in: list.map((a) => a.id) }, entry: { status: 'POSTED' } },
      _sum: { debit: true, credit: true },
    })
    return round2((a2._sum.debit ?? 0) - (a2._sum.credit ?? 0))
  }
  const assets = await sumType('ASSET')
  const liabilities = await sumType('LIABILITY')
  const equity = await sumType('EQUITY')
  const revenue = await sumType('REVENUE')
  const expense = await sumType('EXPENSE')
  const netProfit = round2(revenue - expense)
  const lhs = round2(assets)
  const rhs = round2(liabilities + equity + netProfit)
  console.log(`الأصول ${lhs.toLocaleString('en-US')} = خصوم ${round2(liabilities).toLocaleString('en-US')} + حقوق ${round2(equity + netProfit).toLocaleString('en-US')} — نتيجة الفترة ${netProfit.toLocaleString('en-US')} — ${Math.abs(lhs - rhs) < 0.01 ? 'الميزانية متوازنة ✓✓✓' : 'غير متوازنة ✗✗✗'}`)
  console.log('✓✓ اكتملت دورة 2026 بالكامل')
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error('✗ فشل:', e instanceof Error ? e.message : e)
    await db.$disconnect()
    process.exit(1)
  })
