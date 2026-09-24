// ============================================================================
// سكربت إدخال دورة التشغيل الشاملة 2026 — شركة الأمل التجارية
// البنود الـ 12 المعتمدة من المالك — كل الإدخال عبر API النظام نفسه (لا كتابة خام)
// بحيث يمر كل مستند بكل منطق النظام: الترقيم + القيد الآلي + المخزون + السلال
// + نقاط الولاء + سجل التدقيق + إنفاذ الفترات.
// الاستثناءان الموثقان (آليات النظام تُؤرّخ الصرف بتاريخ اليوم حصراً):
//  • صرف الرواتب الشهري: قيد SALARY شهري مؤرّخ نهاية الشهر عبر /api/journal
//    (نفس دليل صرف الراتب: مدين 5200 — دائن 1110/1120) مع تحديث حالة سجلات
//    الرواتب إلى PAID مباشرة + سطر توثيق في سجل التدقيق.
//  • صرف السلفة: قيد PAYMENT مؤرّخ (نفس دليل صرف السلفة: مدين 115xxx — دائن 1110)
//    مع تحديث حالة السلفة + توثيق. واستقطاعها عبر حسم (DEDUCTION) يلتقطه توليد الرواتب آلياً.
// ============================================================================
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const BASE = 'http://localhost:3000'
let COOKIE = ''

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
const pad = (n: number): string => String(n).padStart(2, '0')
const D = (m: number, d: number): string => `2026-${pad(m)}-${pad(d)}`
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
    /* غير JSON */
  }
  if (!res.ok) throw new Error(`API ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`)
  return json as T
}

async function auditDirect(data: {
  entity: string
  entityId: string | null
  entityNumber: string | null
  title: string
  summary: string
  details: Record<string, string>
}): Promise<void> {
  await db.auditLog.create({
    data: {
      action: 'SYSTEM',
      entity: data.entity,
      entityId: data.entityId,
      entityNumber: data.entityNumber,
      title: data.title,
      summary: data.summary,
      details: JSON.stringify(data.details),
    },
  })
}

const accId = new Map<string, string>()
const itemId = new Map<string, string>()
const codeByItemId = new Map<string, string>()
let C_BRK_CUST = 'C-007'
let C_NSAN_CUST = 'C-008'
let S_BRK_SUP = 'S-006'
const itemWh = new Map<string, string>()
const itemSale = new Map<string, number>()
const whLeaf = new Map<string, string>() // كود القسم النهائي → id
let PARTNERS: Record<string, { id: string; code: string; name: string; acc: string }> = {}
const EMP: Record<string, { id: string; name: string; base: number; acc: string }> = {}

async function loadStructures(): Promise<void> {
  const accounts = await db.account.findMany({ select: { id: true, code: true } })
  for (const a of accounts) accId.set(a.code, a.id)
  const items = await db.item.findMany({ select: { id: true, code: true, warehouseId: true, salePrice: true } })
  for (const i of items) {
    itemId.set(i.code, i.id)
    codeByItemId.set(i.id, i.code)
    if (i.warehouseId) itemWh.set(i.code, i.warehouseId)
    itemSale.set(i.code, i.salePrice)
  }
  const whs = await db.warehouse.findMany({ select: { id: true, code: true, _count: { select: { children: true } } } })
  for (const w of whs) if (w._count.children === 0) whLeaf.set(w.code, w.id)
  const partners = await db.partner.findMany({ select: { id: true, code: true, name: true, type: true, accountId: true } })
  for (const p of partners) PARTNERS[p.code] = { id: p.id, code: p.code, name: p.name, acc: p.accountId ?? '' }
  const employees = await db.employee.findMany({ include: { account: { select: { id: true } } } })
  for (const e of employees) EMP[e.code] = { id: e.id, name: e.name, base: e.baseSalary, acc: e.accountId ?? '' }
}

// مجمع أرصدة حساب من سطور القيود (مدين − دائن)
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

// رصيد المخزون الافتراضي الحي لمادة في قسمها (من القاعدة — أرصدة فعلية)
async function stockOf(itemCode: string): Promise<number> {
  const b = await db.itemBalance.findUnique({
    where: { itemId_warehouseId: { itemId: itemId.get(itemCode)!, warehouseId: itemWh.get(itemCode)! } },
    select: { quantity: true },
  })
  return b?.quantity ?? 0
}

// ==================== قاموس الهيكل الثابت للدورة ====================
const KG_ITEMS = new Set(['I-001', 'I-002', 'I-003', 'I-004', 'I-011', 'I-019', 'I-024', 'I-025', 'I-022', 'I-036'])
const BUNDLE_ITEM_CODES = ['I-008', 'I-010', 'I-011', 'I-024', 'I-025', 'I-031', 'I-038']
const REGULAR_POOL = Array.from({ length: 60 }, (_, i) => `I-${String(i + 1).padStart(3, '0')}`).filter((c) => !BUNDLE_ITEM_CODES.includes(c))
const REGULAR_CUSTOMERS = ['C-001', 'C-002', 'C-003', 'C-004', 'C-005']
const REGULAR_SUPPLIERS = ['S-001', 'S-002', 'S-003', 'S-004', 'S-005']

// سعر شراء عشري محدد لكل بند (≈82% من البيع + كسور .25) — ثابت عبر السنة
function purchasePriceOf(code: string): number {
  const sale = itemSale.get(code) ?? 1000
  const tail = ((code.charCodeAt(code.length - 1) * 7) % 40) / 100 + 0.25
  return round2(Math.max(round2(sale * 0.8), tail))
}

let purchaseSeqBySupplier: Record<string, number> = {}

// ==================== بناة المستندات ====================
interface InvLine {
  itemId: string
  warehouseId: string
  quantity: number
  unitPrice: number
  bundleId?: string
  bundleQty?: number
}
interface InvPayment {
  amount: number
  method: string
  date?: string
  notes?: string
}

async function createInvoice(payload: {
  type: string
  date: string
  partnerId: string
  number?: string
  taxRate?: number
  notes?: string | null
  lines: InvLine[]
  payments?: InvPayment[]
  redeemPoints?: number
}): Promise<{ id: string; number: string }> {
  const res = await api<{ id: string; number: string }>('POST', '/api/invoices', payload)
  return res
}

async function createVoucher(payload: {
  type: string
  date: string
  amount: number
  method: string
  partnerId?: string
  accountId?: string
  notes?: string
}): Promise<void> {
  await api('POST', '/api/payments', payload)
}

async function createJournal(payload: {
  date: string
  description: string
  source: string
  status?: string
  lines: { accountId: string; debit?: number; credit?: number; description?: string }[]
}): Promise<string> {
  const lines = payload.lines.map((l) => ({
    accountId: l.accountId,
    debit: l.debit ?? 0,
    credit: l.credit ?? 0,
    description: l.description ?? null,
  }))
  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0))
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0))
  const res = await api<{ id: string; entry?: { number?: string }; number?: string }>('POST', '/api/journal', {
    date: payload.date,
    description: payload.description,
    source: payload.source,
    status: payload.status ?? 'POSTED',
    lines,
    totalDebit,
    totalCredit,
  })
  return (res.number ?? res.entry?.number ?? '?') as string
}

// ==================== المراحل ====================

// هل القيد مُنشأ سابقاً؟ (للاستئناف الآمن بعد فشل جزئي — لا تكرار أبداً)
async function entryExists(descPrefix: string): Promise<boolean> {
  const e = await db.journalEntry.findFirst({ where: { description: { startsWith: descPrefix } }, select: { id: true } })
  return !!e
}

// المرحلة 0: الهياكل الجديدة (حسابان + 4 ملفات أطراف) — قابلة للاستئناف
async function phase0_setup(): Promise<void> {
  console.log('── المرحلة 0: الهياكل (حسابات + أطراف)')
  // حساب رأس المال للشريك الثاني
  if (!accId.has('310002')) {
    const cap = await api<{ id?: string }>('POST', '/api/accounts', {
      code: '310002',
      name: 'عبد الرحمن بركات',
      type: 'EQUITY',
      nature: 'CREDIT',
      parentId: accId.get('3100'),
      openingBalance: 0,
    })
    accId.set('310002', cap.id!)
    console.log('   حساب 310002 أُنشئ')
  }
  // حساب أقساط السيارات المستحقة
  if (!accId.has('211007')) {
    const inst = await api<{ id?: string }>('POST', '/api/accounts', {
      code: '211007',
      name: 'أقساط سيارات مستحقة الدفع',
      type: 'LIABILITY',
      nature: 'CREDIT',
      parentId: accId.get('2110'),
      openingBalance: 0,
    })
    accId.set('211007', inst.id!)
    console.log('   حساب 211007 أُنشئ')
  }

  // ملف مورد «عبد الرحمن بركات» (معمل المنظفات) — حساب فرعي آلي تحت 2110
  let s6p = { id: '', code: S_BRK_SUP, accountId: '' }
  const existS = await db.partner.findFirst({ where: { name: 'عبد الرحمن بركات', type: 'SUPPLIER' } })
  if (existS) {
    s6p = { id: existS.id, code: existS.code, accountId: existS.accountId ?? '' }
  } else {
    const s6 = await api<{ partner?: { id: string; code: string; accountId: string | null } }>('POST', '/api/partners', {
      name: 'عبد الرحمن بركات',
      type: 'SUPPLIER',
      phone: '0993111006',
      address: 'المصنع — المنطقة الصناعية',
      notes: 'معمل منظفات الشريك عبد الرحمن بركات — شريك رأس المال (50%)',
    })
    const r = (s6.partner ?? s6) as { id: string; code: string; accountId: string | null }
    s6p = { id: r.id, code: r.code, accountId: r.accountId ?? '' }
  }
  PARTNERS[s6p.code] = { id: s6p.id, code: s6p.code, name: 'عبد الرحمن بركات', acc: s6p.accountId }
  S_BRK_SUP = s6p.code

  // ملف عميل «عبد الرحمن بركات» (محله التجاري) — حساب فرعي آلي تحت 1130
  let c7p = { id: '', code: C_BRK_CUST, accountId: '' }
  const existC7 = await db.partner.findFirst({ where: { name: 'عبد الرحمن بركات', type: 'CUSTOMER' } })
  if (existC7) {
    c7p = { id: existC7.id, code: existC7.code, accountId: existC7.accountId ?? '' }
  } else {
    const c7 = await api<{ partner?: { id: string; code: string; accountId: string | null } }>('POST', '/api/partners', {
      name: 'عبد الرحمن بركات',
      type: 'CUSTOMER',
      phone: '0993111007',
      address: 'محل المنظفات — شارع بغداد',
      notes: 'محل الشريك عبد الرحمن بركات — يبيع منه معمله',
    })
    const r = (c7.partner ?? c7) as { id: string; code: string; accountId: string | null }
    c7p = { id: r.id, code: r.code, accountId: r.accountId ?? '' }
  }
  PARTNERS[c7p.code] = { id: c7p.id, code: c7p.code, name: 'عبد الرحمن بركات', acc: c7p.accountId }
  C_BRK_CUST = c7p.code

  // ملف عميل «محمد نعسان» (محل الشريك) — حساب فرعي آلي تحت 1130
  let c8p = { id: '', code: C_NSAN_CUST, accountId: '' }
  const existC8 = await db.partner.findFirst({ where: { name: 'محمد نعسان', type: 'CUSTOMER' } })
  if (existC8) {
    c8p = { id: existC8.id, code: existC8.code, accountId: existC8.accountId ?? '' }
  } else {
    const c8 = await api<{ partner?: { id: string; code: string; accountId: string | null } }>('POST', '/api/partners', {
      name: 'محمد نعسان',
      type: 'CUSTOMER',
      phone: '0993222008',
      address: 'محل الشريك محمد نعسان',
      notes: 'محل الشريك محمد نعسان (رأس مال 50%)',
    })
    const r = (c8.partner ?? c8) as { id: string; code: string; accountId: string | null }
    c8p = { id: r.id, code: r.code, accountId: r.accountId ?? '' }
  }
  PARTNERS[c8p.code] = { id: c8p.id, code: c8p.code, name: 'محمد نعسان', acc: c8p.accountId }
  C_NSAN_CUST = c8p.code

  // ملف الشريك عبد الرحمن بركات برأس المال — مطابق نمط P-001 (نوع PARTNER خارج أنواع الـ API)
  const existing = await db.partner.findFirst({ where: { name: 'عبد الرحمن بركات', type: 'PARTNER' } })
  if (!existing) {
    const maxCode = await db.partner.findFirst({ where: { code: { startsWith: 'P-' } }, orderBy: [{ code: 'desc' }] })
    const nextNum = maxCode ? parseInt(maxCode.code.slice(2), 10) + 1 : 1
    const p2 = await db.partner.create({
      data: {
        code: `P-${String(nextNum).padStart(3, '0')}`,
        name: 'عبد الرحمن بركات',
        type: 'PARTNER',
        phone: '0993111006',
        notes: 'شريك رأس المال — 50% (50,000,000 ل.س)',
        accountId: accId.get('310002'),
      },
    })
    await auditDirect({
      entity: 'PARTNER',
      entityId: p2.id,
      entityNumber: p2.code,
      title: `ملف شريك ${p2.code}`,
      summary: `إنشاء ملف الشريك ${p2.code} — عبد الرحمن بركات — شريك رأس المال 50% مرتبط بحساب 310002 — ضمن تجهيز دورة 2026`,
      details: { 'النوع': 'شريك رأس المال', 'الحساب': '310002', 'السياق': 'دورة التشغيل 2026' },
    })
  }

  console.log(`   أُنشئت: 310002 + 211007 + ${s6p.code} (مورد) + ${c7p.code} (عميل) + ${c8p.code} (عميل) + ملف شريك P`)
}

// البند 1: تأسيس رأس المال 01/01/2026 — قابل للاستئناف
async function phase1_capital(): Promise<void> {
  if (await entryExists('تأسيس شركة الأمل التجارية — رأس مال')) {
    console.log('── البند 1: قيد التأسيس موجود مسبقاً — تخطٍ ✓')
    return
  }
  console.log('── البند 1: قيد تأسيس رأس المال (01/01)')
  const num = await createJournal({
    date: D(1, 1),
    description:
      'تأسيس شركة الأمل التجارية — رأس مال 100,000,000 ل.س مناصفة بين الشريكين محمد نعسان (50,000,000) وعبد الرحمن بركات (50,000,000) — مودع 60,000,000 نقداً بالصندوق و40,000,000 بالبنك — المعادل بالدولار 6,666.67$ بسعر الصرف الافتتاحي 15,000 ل.س/$',
    source: 'MANUAL',
    lines: [
      { accountId: accId.get('1110')!, debit: 60_000_000, description: 'إيداع نقدية في الصندوق من رأس المال' },
      { accountId: accId.get('1120')!, debit: 40_000_000, description: 'إيداع في البنك - مصرف الشام من رأس المال' },
      { accountId: accId.get('310001')!, credit: 50_000_000, description: 'حصة الشريك محمد نعسان 50% — معادل 3,333.33$' },
      { accountId: accId.get('310002')!, credit: 50_000_000, description: 'حصة الشريك عبد الرحمن بركات 50% — معادل 3,333.33$' },
    ],
  })
  console.log(`   قيد التأسيس ${num}: 100,000,000 مدين = 100,000,000 دائن`)
}

// البند 2: شراء السيارة 01/03 + 3 أقساط شهرية — قابل للاستئناف
async function phase2_car(): Promise<void> {
  if (await entryExists('شراء سيارة نقل (أصل ثابت)')) {
    console.log('── البند 2: قيد السيارة والأقساط موجودة مسبقاً — تخطٍ ✓')
    return
  }
  console.log('── البند 2: شراء سيارة النقل (01/03) + الأقساط')
  const num = await createJournal({
    date: D(3, 1),
    description:
      'شراء سيارة نقل (أصل ثابت) بقيمة 30,000,000 ل.س + ضريبة قيمة مضافة 5% على أصل ثابت 1,500,000 ل.س — سداد 10,000,000 نقداً والباقي 21,500,000 على 3 أقساط شهرية — المعادل 2,100$ بسعر الصرف 15,000',
    source: 'MANUAL',
    lines: [
      { accountId: accId.get('1220')!, debit: 30_000_000, description: 'تكلفة سيارة النقل — أصل ثابت' },
      { accountId: accId.get('2120')!, debit: 1_500_000, description: 'ضريبة المدخلات على أصل ثابت 5%' },
      { accountId: accId.get('1110')!, credit: 10_000_000, description: 'الدفعة الأولى نقداً عند الشراء' },
      { accountId: accId.get('211007')!, credit: 21_500_000, description: 'أقساط مستحقة — 3 دفعات شهرية' },
    ],
  })
  console.log(`   قيد الشراء ${num}: 31,500,000 = 31,500,000`)
  const parts = [7_166_666.67, 7_166_666.67, 7_166_666.66]
  const months = [4, 5, 6]
  for (let i = 0; i < 3; i++) {
    const n = await createJournal({
      date: D(months[i], 1),
      description: `سداد القسط ${i + 1} من 3 لقسط سيارة النقل — ${parts[i].toLocaleString('en-US')} ل.س نقداً`,
      source: 'MANUAL',
      lines: [
        { accountId: accId.get('211007')!, debit: parts[i], description: `قسط السيارة ${i + 1}/3` },
        { accountId: accId.get('1110')!, credit: parts[i], description: 'سداد نقدي من الصندوق' },
      ],
    })
    console.log(`   قسط ${i + 1}: ${n} — ${parts[i]}`)
  }
}

// شراء عادي (فاتورة مشتريات برقم يدوي)
async function makePurchase(opts: {
  month: number
  day: number
  supplierCode: string
  lines: { code: string; qty: number; price: number }[]
  cashRatio?: number // 0 = آجل بالكامل
  manualRef: string
  extraNote?: string
}): Promise<void> {
  const sup = PARTNERS[opts.supplierCode]
  const lines: InvLine[] = opts.lines.map((l) => ({
    itemId: itemId.get(l.code)!,
    warehouseId: itemWh.get(l.code)!,
    quantity: l.qty,
    unitPrice: l.price,
  }))
  const subtotal = round2(opts.lines.reduce((s, l) => s + l.qty * l.price, 0))
  const total = round2(subtotal * 1.05)
  const cash = round2(total * (opts.cashRatio ?? 0))
  const payments: InvPayment[] =
    cash > 0
      ? [
          {
            amount: cash,
            method: 'CASH',
            date: D(opts.month, opts.day),
            notes: `سداد جزئي مع فاتورة التوريد — ${RATE_NOTE}`,
          },
        ]
      : []
  await createInvoice({
    type: 'PURCHASE',
    date: D(opts.month, opts.day),
    partnerId: sup.id,
    number: opts.manualRef,
    taxRate: 5,
    notes: `${opts.extraNote ?? 'توريد بضاعة'} — ${RATE_NOTE}`,
    lines,
    payments,
  })
}

// اختيار بنود شراء عشوائي محدد (بدون مواد السلال)
function purchaseLines(seed: number, count: number): { code: string; qty: number; price: number }[] {
  const out: { code: string; qty: number; price: number }[] = []
  for (let k = 0; k < count; k++) {
    const code = REGULAR_POOL[(seed * 13 + k * 7) % REGULAR_POOL.length]
    const kg = KG_ITEMS.has(code)
    const qty = kg ? round2(30 + ((seed * 11 + k * 5) % 40) + 0.5) : 40 + ((seed * 9 + k * 3) % 60)
    out.push({ code, qty, price: purchasePriceOf(code) })
  }
  return out
}

// بيع عادي مع حارس رصيد حي
async function makeSale(opts: {
  month: number
  day: number
  customerCode: string
  lineCount: number
  seed: number
  payMode: 'CASH' | 'PARTIAL' | 'CREDIT'
  bundleId?: string
  redeemPoints?: number
  notePrefix?: string
}): Promise<void> {
  const cust = PARTNERS[opts.customerCode]
  const lines: InvLine[] = []
  if (opts.bundleId) {
    // بنود السلة بكميات القالب وسعر البيع الأصلي — الحسم يُحسب خادمياً
    const bundles = await db.bundle.findMany({ where: { id: opts.bundleId }, include: { items: true } })
    const b = bundles[0]
    for (const bi of b.items) {
      const code = codeByItemId.get(bi.itemId)!      
      lines.push({
        itemId: bi.itemId,
        warehouseId: itemWh.get(code)!,
        quantity: bi.quantity,
        unitPrice: itemSale.get(code)!,
        bundleId: b.id,
        bundleQty: 1,
      })
    }
  } else {
    for (let k = 0; k < opts.lineCount; k++) {
      const code = REGULAR_POOL[(opts.seed * 17 + k * 11) % REGULAR_POOL.length]
      const whId = itemWh.get(code)!
      const avail = await stockOf(code)
      const kg = KG_ITEMS.has(code)
      let want = kg ? round2(5 + ((opts.seed * 7 + k * 3) % 20) + (k % 2 === 0 ? 0.5 : 0.25)) : 3 + ((opts.seed * 5 + k * 7) % 15)
      const maxAvail = Math.floor(avail * 0.7 * 100) / 100
      if (maxAvail <= 0.5) continue
      if (want > maxAvail) want = maxAvail
      const listPrice = itemSale.get(code) ?? 1000
      const price = k === 1 && opts.seed % 3 === 0 ? round2(listPrice + 0.75) : listPrice
      lines.push({ itemId: itemId.get(code)!, warehouseId: whId, quantity: want, unitPrice: price })
    }
  }
  if (lines.length === 0) return
  const subtotal = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0))
  const total = round2(subtotal * 1.05)
  const payments: InvPayment[] = []
  if (opts.payMode === 'CASH') {
    payments.push({ amount: total, method: 'CASH', date: D(opts.month, opts.day), notes: `تحصيل كامل مع الفاتورة — ${RATE_NOTE}` })
  } else if (opts.payMode === 'PARTIAL') {
    payments.push({ amount: round2(total * 0.5), method: 'CASH', date: D(opts.month, opts.day), notes: `دفعة أولى 50% — ${RATE_NOTE}` })
  }
  await createInvoice({
    type: 'SALE',
    date: D(opts.month, opts.day),
    partnerId: cust.id,
    taxRate: 5,
    notes: `${opts.notePrefix ?? 'بيع جملة'} — ${RATE_NOTE}`,
    lines,
    payments,
    redeemPoints: opts.redeemPoints,
  })
}

async function resolveBundleIdByName(name: string): Promise<string> {
  const b = await db.bundle.findFirst({ where: { name }, select: { id: true } })
  if (!b) throw new Error(`السلة غير موجودة: ${name}`)
  return b.id
}

// البنود 3+5+6: الدورة الشهرية 8 أشهر
async function phase3_monthlyCycle(): Promise<void> {
  const B_PERCENT = await resolveBundleIdByName('سلة التوفير العائلية 2026')
  const B_PRICE = await resolveBundleIdByName('سلة السعر المخفض المزدوج')
  const B_GIFT = await resolveBundleIdByName('سلة الهدية المجانية')
  const bundleByMonth: Record<number, { id: string; name: string }> = {
    3: { id: B_PERCENT, name: 'التوفير' },
    4: { id: B_PRICE, name: 'المخفض' },
    5: { id: B_GIFT, name: 'الهدية' },
    6: { id: B_PERCENT, name: 'التوفير' },
    7: { id: B_PRICE, name: 'المخفض' },
  }

  for (let m = 1; m <= 8; m++) {
    console.log(`════ الشهر ${m} / 2026 ════`)

    // (أ) 10 فواتير مشتريات شهرية — مورد دوّار + سداد جزئي/آجل
    for (let i = 0; i < 10; i++) {
      const supCode = REGULAR_SUPPLIERS[(i + m) % 5]
      const seq = (purchaseSeqBySupplier[supCode] ?? 0) + 1
      purchaseSeqBySupplier[supCode] = seq
      await makePurchase({
        month: m,
        day: 3 + i * 2,
        supplierCode: supCode,
        lines: purchaseLines(m * 31 + i, 3 + (i % 3)),
        cashRatio: i % 3 === 2 ? 0 : 0.5,
        manualRef: `PINV-${supCode}-${String(seq).padStart(3, '0')}`,
        extraNote: 'توريد شهري ضمن دورة 2026',
      })
    }
    console.log('   10 مشتريات شهرية ✓')

    // (ب) حقن مخزون السلال — فبراير ومارس (كميات كبيرة عشرية الأسعار)
    if (m === 2) {
      await makePurchase({
        month: 2, day: 6, supplierCode: 'S-003',
        lines: [
          { code: 'I-008', qty: 130, price: 23600.5 }, { code: 'I-038', qty: 90, price: 19600.25 },
          { code: 'I-011', qty: 70, price: 19600.0 }, { code: 'I-024', qty: 20, price: 10560.0 },
        ],
        cashRatio: 0.3, manualRef: 'PINV-BULK-001', extraNote: 'توريد مخزون سلال العروض — دفعة أولى',
      })
      console.log('   حقن مخزون السلال (فبراير) ✓')
    }
    if (m === 3) {
      await makePurchase({
        month: 3, day: 4, supplierCode: 'S-005',
        lines: [
          { code: 'I-031', qty: 180, price: 16800.75 }, { code: 'I-010', qty: 190, price: 15840.5 },
          { code: 'I-025', qty: 50, price: 11040.25 }, { code: 'I-038', qty: 60, price: 19600.25 },
          { code: 'I-011', qty: 50, price: 19600.0 },
        ],
        cashRatio: 0.3, manualRef: 'PINV-BULK-002', extraNote: 'توريد مخزون سلال العروض — دفعة ثانية',
      })
      console.log('   حقن مخزون السلال (مارس) ✓')
    }

    // (ج) 10 فواتير منظفات آجلة من معمل الشريك عبد الرحمن بركات — جدول 2/2/1/2/1/1/1 من فبراير
    const brkPlan: Record<number, number> = { 2: 2, 3: 2, 4: 1, 5: 2, 6: 1, 7: 1, 8: 1 }
    if (brkPlan[m]) {
      for (let i = 0; i < (brkPlan[m] ?? 0); i++) {
        const seq = (purchaseSeqBySupplier['S-006'] ?? 0) + 1
        purchaseSeqBySupplier['S-006'] = seq
        const det = ['I-041', 'I-046', 'I-051', 'I-056', 'I-049', 'I-057', 'I-052', 'I-044']
        const lines = [0, 1, 2].map((k) => {
          const code = det[(m * 3 + i * 2 + k) % det.length]
          const kg = false
          const qty = kg ? 10.5 : 30 + ((m * 7 + i * 5 + k * 3) % 50)
          return { code, qty, price: purchasePriceOf(code) }
        })
        await makePurchase({
          month: m, day: 8 + i * 6, supplierCode: 'S-006', lines, cashRatio: 0,
          manualRef: `PINV-S006-${String(seq).padStart(3, '0')}`,
          extraNote: 'توريد منظفات آجل من معمل الشريك عبد الرحمن بركات',
        })
      }
      console.log(`   منظفات الشريك بركات (${brkPlan[m]} آجلة) ✓`)
    }

    // (د) 3 مشتريات نقدية عبر الموظف يوسف الحمصي — مارس/أبريل/مايو
    if (m === 3 || m === 4 || m === 5) {
      const seq = (purchaseSeqBySupplier['S-001'] ?? 0) + 1
      purchaseSeqBySupplier['S-001'] = seq
      await makePurchase({
        month: m, day: 14, supplierCode: 'S-001',
        lines: purchaseLines(m * 17 + 5, 2 + (m % 2)),
        cashRatio: 1, manualRef: `PINV-CASH-00${m - 2}`,
        extraNote: 'توريد عن طريق الموظف يوسف الحمصي (EMP-002) — سداد نقدي فوري',
      })
      console.log('   مشتريات نقدية عبر الموظف ✓')
    }

    // (هـ) 30 فاتورة مبيعات: عادية + سلال + آجلة خاصة
    const special: { code: string; payMode: 'CREDIT' }[] = []
    const bundle = bundleByMonth[m]
    if (bundle) special.push({ code: 'BUNDLE', payMode: 'CREDIT' })
    if (m >= 3 && m <= 7) special.push({ code: 'C-006', payMode: 'CREDIT' }) // محل الموظف أحمد
    if (m >= 4) special.push({ code: C_NSAN_CUST, payMode: 'CREDIT' }) // محل نعسان
    if (m >= 4) special.push({ code: C_BRK_CUST, payMode: 'CREDIT' }, { code: C_BRK_CUST, payMode: 'CREDIT' }) // محل بركات
    const regularCount = 30 - special.length
    let done = 0
    for (let i = 0; i < regularCount; i++) {
      const cust = REGULAR_CUSTOMERS[(i + m) % 5]
      const payMode = i % 5 <= 2 ? 'CASH' : i % 5 === 3 ? 'PARTIAL' : 'CREDIT'
      await makeSale({
        month: m, day: 2 + ((i * 3) % 26), customerCode: cust,
        lineCount: 2 + (i % 3), seed: m * 100 + i, payMode,
      })
      done++
      if (done % 10 === 0) console.log(`   مبيعات: ${done}/${regularCount} عادية`)
    }
    for (let i = 0; i < special.length; i++) {
      const sp = special[i]
      if (sp.code === 'BUNDLE') {
        await makeSale({ month: m, day: 12 + i, customerCode: REGULAR_CUSTOMERS[m % 5], lineCount: 0, seed: m * 777, payMode: 'PARTIAL', bundleId: bundle.id, notePrefix: `بيع ضمن سلة العرض (${bundle.name})` })
      } else {
        await makeSale({ month: m, day: 18 + i, customerCode: sp.code, lineCount: 3 + (i % 2), seed: m * 555 + i, payMode: 'CREDIT', notePrefix: 'بيع آجل' })
      }
    }
    console.log(`   30 مبيعات ✓ (عادية ${regularCount} + خاصة ${special.length})`)

    // (و) مصاريف تشغيلية: إيجار + كهرباء + ماء + هاتف
    await createVoucher({ type: 'PAYMENT', date: D(m, 1), amount: 1_500_000, method: 'CASH', accountId: accId.get('5300')!, notes: `إيجار المستودع الشهر ${m}/2026 — ${RATE_NOTE}` })
    await createVoucher({ type: 'PAYMENT', date: D(m, 10), amount: round2(420_000 + m * 12_500.25), method: 'CASH', accountId: accId.get('5400')!, notes: `فاتورة كهرباء الشهر ${m}/2026 — ${RATE_NOTE}` })
    await createVoucher({ type: 'PAYMENT', date: D(m, 10), amount: round2(85_000 + m * 3_750.5), method: 'CASH', accountId: accId.get('5400')!, notes: `فاتورة ماء الشهر ${m}/2026 — ${RATE_NOTE}` })
    await createVoucher({ type: 'PAYMENT', date: D(m, 12), amount: round2(65_000 + m * 2_250.75), method: 'CASH', accountId: accId.get('5500')!, notes: `هاتف وإنترنت الشهر ${m}/2026 — ${RATE_NOTE}` })
    console.log('   المصاريف الأربعة ✓')

    // (ز) المكافأة والحسم (مايو مكافأة — أبريل استقطاع السلفة)
    if (m === 4) {
      await api('POST', '/api/bonuses', { employeeId: EMP['EMP-001'].id, type: 'DEDUCTION', date: D(4, 25), amount: 800_000, reason: 'استقطاع السلفة الشخصية المصروفة في 16/02/2026 من راتب أبريل' })
      console.log('   استقطاع السلفة من راتب أبريل ✓')
    }
    if (m === 5) {
      await api('POST', '/api/bonuses', { employeeId: EMP['EMP-006'].id, type: 'BONUS', date: D(5, 25), amount: 150_000, reason: 'مكافأة تحصيل ممتاز — مايو 2026' })
      console.log('   مكافأة مايو ✓')
    }

    // (ح) الرواتب: توليد السجلات + قيد الصرف بنهاية الشهر + تعليم PAID
    await api('POST', '/api/salaries/generate', { month: `2026-${pad(m)}` })
    const salList = await api<{ salaries?: { id: string; net: number; employee?: { name: string } }[] }>('GET', `/api/salaries?month=2026-${pad(m)}`)
    const rows = salList.salaries ?? []
    const totalNet = round2(rows.reduce((s, r) => s + r.net, 0))
    const method = m <= 5 ? 'نقداً من الصندوق' : 'تحويل بنكي'
    const cashOrBank = m <= 5 ? '1110' : '1120'
    const jeNum = await createJournal({
      date: D(m, 28),
      description: `صرف رواتب الموظفين السبعة لشهر ${m}/2026 — ${method} — إجمالي الصافي ${totalNet.toLocaleString('en-US')} ل.س${m === 4 ? ' (مع استقطاع سلفة أحمد المحمود 800,000)' : ''}`,
      source: 'SALARY',
      lines: [
        { accountId: accId.get('5200')!, debit: totalNet, description: `مصروف رواتب شهر ${m}/2026` },
        { accountId: accId.get(cashOrBank)!, credit: totalNet, description: `صرف ${method}` },
      ],
    })
    await db.salary.updateMany({ where: { month: `2026-${pad(m)}` }, data: { status: 'PAID', paidAt: new Date(`${D(m, 28)}T12:00:00.000Z`) } })
    await auditDirect({
      entity: 'SALARY', entityId: null, entityNumber: `2026-${pad(m)}`,
      title: `صرف رواتب ${m}/2026`,
      summary: `صرف رواتب شهر ${m}/2026 بقيد ${jeNum} — ${rows.length} موظفين — صافي ${totalNet.toLocaleString('en-US')} ل.س — ${method} — عُلّمت سجلات الرواتب PAID`,
      details: { 'الشهر': `2026-${pad(m)}`, 'القيد': jeNum, 'الصافي': String(totalNet) },
    })
    console.log(`   رواتب ${m}: ${rows.length} موظفين — صافي ${totalNet.toLocaleString('en-US')} — قيد ${jeNum} ✓`)

    // (ط) السلفة: إنشاء فبراير + صرفها بقيد + تعليم PAID
    if (m === 2) {
      await api('POST', '/api/advances', { employeeId: EMP['EMP-001'].id, amount: 800_000, date: D(2, 15), reason: 'سلفة شخصية — صيانة سيارة عائلية' })
      const adv = await db.advance.findFirst({ where: { employeeId: EMP['EMP-001'].id, amount: 800_000, status: 'UNPAID' } })
      if (adv) {
        const n = await createJournal({
          date: D(2, 16),
          description: 'صرف سلفة الموظف أحمد المحمود (EMP-001) — 800,000 ل.س نقداً — تُستقطع من راتب أبريل',
          source: 'PAYMENT',
          lines: [
            { accountId: accId.get('115001')!, debit: 800_000, description: 'سلفة الموظف أحمد المحمود' },
            { accountId: accId.get('1110')!, credit: 800_000, description: 'صرف نقدي من الصندوق' },
          ],
        })
        await db.advance.update({ where: { id: adv.id }, data: { status: 'PAID' } })
        await auditDirect({
          entity: 'ADVANCE', entityId: adv.id, entityNumber: 'EMP-001',
          title: 'صرف سلفة — أحمد المحمود',
          summary: `صرف سلفة 800,000 ل.س للموظف أحمد المحمود بقيد ${n} بتاريخ 16/02/2026 — مدين 115001 / دائن 1110 — تُستقطع من راتب أبريل`,
          details: { 'الموظف': 'أحمد المحمود EMP-001', 'القيد': n, 'المبلغ': '800000' },
        })
        console.log(`   سلفة أحمد المحمود 800,000 — قيد ${n} ✓`)
      }
    }
    if (m === 4) {
      const adv = await db.advance.findFirst({ where: { employeeId: EMP['EMP-001'].id, status: 'PAID' } })
      if (adv) {
        await db.advance.update({ where: { id: adv.id }, data: { status: 'SETTLED' } })
        await auditDirect({
          entity: 'ADVANCE', entityId: adv.id, entityNumber: 'EMP-001',
          title: 'تسوية سلفة — أحمد المحمود',
          summary: 'استقطاعت سلفة أحمد المحمود (800,000 ل.س) كاملة من راتب أبريل 2026 عبر حسم مسجل — عُلّمت السلفة SETTLED',
          details: { 'الحالة': 'SETTLED', 'طريقة الاستقطاع': 'حسم راتب أبريل 2026' },
        })
        console.log('   تسوية السلفة (SETTLED) ✓')
      }
    }

    // (ي) تحصيلات من العملاء — أعلى 3 أرصدة
    const custBalances: { code: string; bal: number; acc: string }[] = []
    for (const c of [...REGULAR_CUSTOMERS, 'C-006', C_BRK_CUST, C_NSAN_CUST]) {
      const p = PARTNERS[c]
      if (!p?.acc) continue
      const id = (await db.account.findUnique({ where: { id: p.acc }, select: { code: true } }))?.code
      if (!id) continue
      const bal = await accountBalance(id)
      if (bal.net > 50_000) custBalances.push({ code: c, bal: bal.net, acc: id })
    }
    custBalances.sort((a, b) => b.bal - a.bal)
    for (let i = 0; i < Math.min(3, custBalances.length); i++) {
      const c = custBalances[i]
      const amount = round2(c.bal * (i === 0 ? 0.7 : 0.65))
      await createVoucher({
        type: 'RECEIPT', date: D(m, 26 + i), amount,
        method: i === 0 ? 'BANK' : 'CASH', partnerId: PARTNERS[c.code].id,
        notes: `تحصيل دفعة من حساب ${PARTNERS[c.code].name} — ${RATE_NOTE}`,
      })
    }
    console.log(`   تحصيلات: ${Math.min(3, custBalances.length)} سندات ✓`)

    // (ك) سداد للموردين — أعلى 2 دائنية
    const supBalances: { code: string; bal: number }[] = []
    for (const s of [...REGULAR_SUPPLIERS, S_BRK_SUP]) {
      const p = PARTNERS[s]
      if (!p?.acc) continue
      const id = (await db.account.findUnique({ where: { id: p.acc }, select: { code: true } }))?.code
      if (!id) continue
      const bal = await accountBalance(id)
      if (bal.net < -50_000) supBalances.push({ code: s, bal: -bal.net })
    }
    supBalances.sort((a, b) => b.bal - a.bal)
    for (let i = 0; i < Math.min(2, supBalances.length); i++) {
      const s = supBalances[i]
      const amount = round2(s.bal * 0.6)
      await createVoucher({
        type: 'PAYMENT', date: D(m, 27 + i), amount,
        method: i === 0 ? 'BANK' : 'CASH', partnerId: PARTNERS[s.code].id,
        notes: `سداد دفعة للمورد ${PARTNERS[s.code].name} — ${RATE_NOTE}`,
      })
    }
    console.log(`   مدفوعات موردين: ${Math.min(2, supBalances.length)} سندات ✓`)
  }
}

// البند 8: استبدال نقاط الولاء بنسبة 75% داخل فواتير أواخر أغسطس
async function phase4_loyaltyRedeem(): Promise<void> {
  console.log('── البند 8: استبدال نقاط الولاء (75%)')
  const customers = await db.partner.findMany({ where: { type: 'CUSTOMER', isActive: true }, select: { id: true, code: true, name: true } })
  const withPoints: { id: string; code: string; name: string; points: number }[] = []
  for (const c of customers) {
    const agg = await db.loyaltyTransaction.aggregate({ where: { customerId: c.id }, _sum: { points: true } })
    const pts = agg._sum.points ?? 0
    if (pts > 0) withPoints.push({ id: c.id, code: c.code, name: c.name, points: pts })
  }
  withPoints.sort((a, b) => b.points - a.points)
  const top = withPoints.slice(0, 3)
  for (let i = 0; i < top.length; i++) {
    const c = top[i]
    let redeem = Math.floor(c.points * 0.75)
    if (redeem <= 0) continue
    // فاتورة كبيرة تحتمل قيمة الاسترداد (نقطة = 1000 ل.س) — مع سقف أمان يمنع تجاوز 80% من الفاتورة
    const eff = await makeSaleBigWithRedeem({
      month: 8, day: 29 + (i === 2 ? 1 : 0), customerCode: c.code, seed: 900 + i, redeemPoints: redeem,
    })
    if (eff.adjustedRedeem !== redeem) {
      console.log(`   ${c.name}: خُفّض الاسترداد من ${redeem} إلى ${eff.adjustedRedeem} نقطة ليبقى ضمن حدود الفاتورة`)
      redeem = eff.adjustedRedeem
    }
    console.log(`   ${c.name} (${c.code}): استرداد ${redeem} من ${c.points} نقطة (75%) داخل فاتورة أغسطس ✓`)
  }
}

async function makeSaleBigWithRedeem(opts: { month: number; day: number; customerCode: string; seed: number; redeemPoints: number }): Promise<{ adjustedRedeem: number }> {
  const cust = PARTNERS[opts.customerCode]
  const picks = ['I-007', 'I-009', 'I-012', 'I-015', 'I-027', 'I-034']
  let redeem = opts.redeemPoints
  for (const factor of [1, 1.8]) {
    const lines: InvLine[] = []
    for (let k = 0; k < picks.length; k++) {
      const code = picks[k]
      const avail = await stockOf(code)
      const want = Math.min(Math.floor(avail * 0.5 * factor), Math.floor((30 + k * 5) * factor))
      if (want <= 0) continue
      lines.push({ itemId: itemId.get(code)!, warehouseId: itemWh.get(code)!, quantity: want, unitPrice: itemSale.get(code)! })
    }
    if (lines.length === 0) throw new Error('لا مخزون لفاتورة الاسترداد')
    const subtotal = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0))
    const total = round2(subtotal * 1.05)
    const redeemValue = round2(redeem * 1000)
    if (redeemValue >= total * 0.8) {
      // سقف أمان: لا يجوز أن يلتهم الاسترداد الفاتورة — خفّض النقاط إلى 75% من الحد الممكن
      const capped = Math.max(Math.floor(((total * 0.7) / 1000) | 0), 0)
      if (capped <= 0) throw new Error(`قيمة الاسترداد ${redeemValue} تتجاوز الفاتورة ${total} وبلا بديل`)
      redeem = capped
    }
    await createInvoice({
      type: 'SALE',
      date: D(opts.month, opts.day),
      partnerId: cust.id,
      taxRate: 5,
      notes: `تسوية نقاط الولاء — استرداد ${redeem} نقطة (75% من الرصيد) كحسم داخل الفاتورة — ${RATE_NOTE}`,
      lines,
      payments: [],
      redeemPoints: redeem,
    })
    return { adjustedRedeem: redeem }
  }
  throw new Error('غير reachable')
}

// البند 9: الإهلاك + البند 10: الجرد
async function phase5_depreciation(): Promise<void> {
  console.log('── البند 9: قيد إهلاك السيارة (31/08)')
  const num = await createJournal({
    date: D(8, 31),
    description:
      'إهلاك سيارة النقل عن يناير-أغسطس 2026 — طريقة القسط الثابت: 30,000,000 ÷ 60 شهراً = 500,000 ل.س شهرياً × 8 أشهر',
    source: 'MANUAL',
    lines: [
      { accountId: accId.get('5900')!, debit: 4_000_000, description: 'مصروف إهلاك السيارة 8 أشهر' },
      { accountId: accId.get('1221')!, credit: 4_000_000, description: 'مجمع إهلاك السيارات' },
    ],
  })
  console.log(`   قيد الإهلاك ${num}: 4,000,000 ✓`)
}

async function phase6_stocktaking(): Promise<void> {
  console.log('── البند 10: الجرد الفعلي بالأرقام العشرية (31/08)')
  const plans: { whCode: string; tweaks: Record<string, number> }[] = [
    { whCode: 'MKT-N', tweaks: { 'I-001': 1.5, 'I-003': -2.25, 'I-005': 0.75, 'I-006': -1 } },
    { whCode: 'DET-D', tweaks: { 'I-046': 2.5, 'I-048': -3.25, 'I-050': 1.75 } },
  ]
  for (const plan of plans) {
    const whId = whLeaf.get(plan.whCode)!
    const balances = await db.itemBalance.findMany({ where: { warehouseId: whId }, select: { itemId: true, quantity: true } })
    const idToCode = new Map([...itemId.entries()].map(([code, id]) => [id, code]))
    const lines = balances.map((b) => {
      const code = idToCode.get(b.itemId) ?? ''
      const tweak = plan.tweaks[code]
      return { itemId: b.itemId, countedQty: tweak === undefined ? b.quantity : round2(b.quantity + tweak) }
    })
    if (lines.length === 0) continue
    const created = await api<{ order?: { id: string; number: string }; id?: string; number?: string }>('POST', '/api/stocktaking', {
      warehouseId: whId,
      date: D(8, 31),
      notes: `جرد فعلي نهاية أغسطس 2026 — كميات عشرية — فروق مسموحة ضمن حدود الإتلاف والفرق الجردي — ${RATE_NOTE}`,
      lines,
    })
    const stId = created.order?.id ?? created.id
    const stNum = created.order?.number ?? created.number
    await api('POST', `/api/stocktaking/${stId}`)
    console.log(`   جرد ${stNum} (${plan.whCode}): ${lines.length} مادة — رُحّل بفروقه ✓`)
  }
}

// البند 11: مقاصة MC للشريك عبد الرحمن بركات
async function phase7_mc(): Promise<void> {
  console.log('── البند 11: سند مقاصة MC لعبد الرحمن بركات')
  const supAcc = PARTNERS[S_BRK_SUP]?.acc
  const custAcc = PARTNERS[C_BRK_CUST]?.acc
  if (!supAcc || !custAcc) throw new Error('ملفات عبد الرحمن بركات غير مكتملة')
  const supCode = (await db.account.findUnique({ where: { id: supAcc }, select: { code: true } }))?.code
  const custCode = (await db.account.findUnique({ where: { id: custAcc }, select: { code: true } }))?.code
  const supBal = await accountBalance(supCode!) // دائن (سالب)
  const custBal = await accountBalance(custCode!) // مدين (موجب)
  const amount = round2(Math.min(custBal.net, -supBal.net))
  if (amount <= 0) throw new Error(`لا رصيد متقابل للمقاصة: عميل ${custBal.net} / مورد ${supBal.net}`)
  const num = await api<{ voucher?: { number: string } }>('POST', '/api/clearings', {
    date: D(8, 31),
    notes: 'مقاصة ذمم متبادلة للشريك عبد الرحمن بركات — تسوية رصيده كمورد (معمل المنظفات) مع رصيده كعميل (محله التجاري)',
    pairs: [
      {
        debitAccountId: supAcc,
        creditAccountId: custAcc,
        amount,
        description: 'تصفية الذمم المتبادلة — مقاصة مورد/عميل للشريك عبد الرحمن بركات',
      },
    ],
  })
  console.log(`   مقاصة ${num.voucher?.number}: ${amount.toLocaleString('en-US')} ل.س (مدين مورد ${supCode} ↔ دائن عميل ${custCode}) ✓`)
}

// البند 9-ب: تصفية ضريبة القيمة المضافة
async function phase8_vatSettlement(): Promise<void> {
  console.log('── البند 9-ب: تصفية أمانات الضريبة (31/08)')
  const vat = await accountBalance('2120') // دائن موجب = مستحق السداد
  const payable = round2(-vat.net)
  if (payable <= 0) throw new Error(`لا ضريبة مستحقة للسداد: ${vat.net}`)
  const num = await createJournal({
    date: D(8, 31),
    description: `تصفية حساب ضريبة القيمة المضافة حتى 31/08/2026 — ضريبة المخرجات (المبيعات) مقابل ضريبة المدخلات (المشتريات والأصل الثابت) — صافي المسدد نقداً ${payable.toLocaleString('en-US')} ل.س`,
    source: 'MANUAL',
    lines: [
      { accountId: accId.get('2120')!, debit: payable, description: 'تسوية أمانات الضريبة — المدخلات مقابل المخرجات' },
      { accountId: accId.get('1110')!, credit: payable, description: 'سداد نقدي من الصندوق' },
    ],
  })
  console.log(`   تصفية الضريبة ${num}: ${payable.toLocaleString('en-US')} ✓`)
}

// ==================== التحقق النهائي ====================
async function finalVerify(): Promise<void> {
  console.log('════ التحقق النهائي ════')
  const agg = await db.journalEntryLine.aggregate({ _sum: { debit: true, credit: true } })
  const d = round2(agg._sum.debit ?? 0)
  const c = round2(agg._sum.credit ?? 0)
  console.log(`ميزان المراجعة: مدين ${d.toLocaleString('en-US')} / دائن ${c.toLocaleString('en-US')} — ${Math.abs(d - c) < 0.01 ? 'متوازن ✓' : 'غير متوازن ✗✗✗'}`)
  const counts = {
    entries: await db.journalEntry.count(),
    invoices: await db.invoice.count(),
    sales: await db.invoice.count({ where: { type: 'SALE' } }),
    purchases: await db.invoice.count({ where: { type: 'PURCHASE' } }),
    payments: await db.payment.count(),
    salaries: await db.salary.count(),
    loyaltyTx: await db.loyaltyTransaction.count(),
    stocktaking: await db.stocktaking.count(),
  }
  console.log('العدّادات:', JSON.stringify(counts))
  for (const code of ['1110', '1120', '1130', '1140', '1220', '2110', '2120', '3100', '4100', '5000']) {
    const b = await accountBalance(code)
    console.log(`  ${code}: مدين ${b.debit.toLocaleString('en-US')} — دائن ${b.credit.toLocaleString('en-US')} — الصافي ${b.net.toLocaleString('en-US')}`)
  }
  const bundle = await db.bundle.findMany({ select: { name: true, totalSales: true, saleCount: true, totalDiscount: true } })
  console.log('السلال:', bundle.map((b) => `${b.name}: ${b.saleCount} مبيعات/${b.totalSales.toLocaleString('en-US')}`).join(' | '))
  // توازن المحاسبة: الأصول = الخصوم + حقوق الملكية + (الإيرادات − المصروفات)
  const sumType = async (type: string): Promise<number> => {
    const accounts = await db.account.findMany({ where: { type }, select: { id: true } })
    if (accounts.length === 0) return 0
    const agg2 = await db.journalEntryLine.aggregate({
      where: { accountId: { in: accounts.map((a) => a.id) }, entry: { status: 'POSTED' } },
      _sum: { debit: true, credit: true },
    })
    return round2((agg2._sum.debit ?? 0) - (agg2._sum.credit ?? 0))
  }
  const assets = await sumType('ASSET')
  const liabilities = await sumType('LIABILITY')
  const equity = await sumType('EQUITY')
  const revenue = await sumType('REVENUE')
  const expense = await sumType('EXPENSE')
  const netProfit = round2(revenue - expense)
  const lhs = round2(assets)
  const rhs = round2(liabilities + equity + netProfit)
  console.log(`الأصول ${lhs.toLocaleString('en-US')} = خصوم ${round2(liabilities).toLocaleString('en-US')} + حقوق ${round2(equity + netProfit).toLocaleString('en-US')} (منها نتيجة الفترة ${netProfit.toLocaleString('en-US')}) — ${Math.abs(lhs - rhs) < 0.01 ? 'متوازنة ✓' : 'غير متوازنة ✗✗✗'}`)
}

// ==================== التنفيذ ====================
async function main(): Promise<void> {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  if (!login.ok) throw new Error(`فشل تسجيل الدخول: ${login.status}`)
  const setCookie = login.headers.get('set-cookie')
  COOKIE = (setCookie ?? '').split(';')[0]
  console.log('✓ دخول المدير')

  await loadStructures()
  console.log(`✓ الهياكل: ${accId.size} حساب، ${Object.keys(PARTNERS).length} طرف، ${Object.keys(EMP).length} موظف`)

  await phase0_setup()
  await phase1_capital()
  await phase2_car()
  await phase3_monthlyCycle()
  await phase4_loyaltyRedeem()
  await phase5_depreciation()
  await phase6_stocktaking()
  await phase7_mc()
  await phase8_vatSettlement()
  await finalVerify()
  console.log('✓✓ اكتملت دورة 2026 بالكامل')
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error('✗ فشل:', e instanceof Error ? e.message : e)
    await db.$disconnect()
    process.exit(1)
  })
