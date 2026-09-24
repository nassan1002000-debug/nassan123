import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/math'
import { getOpeningLinesByAccount } from '@/lib/period-server'
import { INVOICE_ACCOUNTS } from '@/lib/invoice-journal'

export const dynamic = 'force-dynamic'

// ==================== مركز التقارير — GET /api/reports ====================
// التقارير المالية الثلاثة (توافق خلفي حرفي — نفس الاستجابات السابقة):
// 1) trial-balance     — ميزان المراجعة: حركة الفترة للحسابات الورقية (بلا أبناء)
// 2) income-statement  — قائمة الدخل: الإيرادات والمصروفات وصافي الربح خلال الفترة
// 3) balance-sheet     — الميزانية العمومية: أصول/خصوم/حقوق ملكية تراكمياً حتى «إلى»
//
// التقارير الإضافية:
// 4)  monthly-pnl         — أرباح وخسائر شهرية خلال سنة (قيود POSTED لإيرادات/مصروفات)
// 5)  inventory           — المخزون: كميات وقيم وأصناف تحت الحد الأدنى (مع فلتر مستودع)
// 6)  sales               — تفاصيل فواتير البيع والمردودات وإحصائياتها
// 7)  purchases           — تفاصيل فواتير الشراء والمردودات وإحصائياتها
// 8)  partner-statement   — كشف حساب عميل/مورد: فواتير وسندات برصيد متحرك وافتتاحي
// 9)  treasury            — حركات الصندوق: سندات قبض/دفع برصيد متحرك وتوزيع بالطريقة
// 10) expenses            — المصروفات حسب التصنيف من القيود + آخر 100 حركة
// 11) item-profitability  — ربحية الأصناف: إيراد/تكلفة/ربح/هامش لكل صنف
// 12) receivables-aging   — أعمار الذمم: أرصدة الأطراف على فئات عمر الفواتير (0-30/31-60/61-90/+90)
// 13) profitability        — ربحية العملاء أو المستودعات (?by=customer|warehouse): من يربحني فعلاً
// 14) period-comparison    — مقارنة فترتين متتاليتين (افتراضياً هذا الشهر حتى اليوم مقابل الماضي)
// 15) inventory-turnover   — دوران المخزون: معدل دورة كل صنف وأيام التغطية والأصناف الراكدة
//
// الفترة الافتراضية: 1 يناير للسنة الحالية ← اليوم. كل المبالغ مقربة بـ round2
// تقرير قراءة فقط — لا يوثَّق في سجل التدقيق

const REPORT_TYPES = [
  'trial-balance',
  'income-statement',
  'balance-sheet',
  'monthly-pnl',
  'inventory',
  'sales',
  'purchases',
  'partner-statement',
  'treasury',
  'expenses',
  'item-profitability',
  'receivables-aging',
  'profitability',
  'period-comparison',
  'inventory-turnover',
] as const
type ReportType = (typeof REPORT_TYPES)[number]

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

// ==================== واجهات الاستجابة — التقارير المالية (كما هي) ====================

interface TrialBalanceRow {
  accountId: string
  code: string
  name: string
  type: string
  totalDebit: number
  totalCredit: number
  balance: number
}

interface TrialBalanceTotals {
  totalDebit: number
  totalCredit: number
  balance: number
}

interface TrialBalanceResponse {
  type: 'trial-balance'
  from: string
  to: string
  rows: TrialBalanceRow[]
  totals: TrialBalanceTotals
  count: number
  balanced: boolean
}

interface StatementRow {
  accountId: string
  code: string
  name: string
  amount: number
}

interface StatementSection {
  rows: StatementRow[]
  total: number
}

interface IncomeStatementResponse {
  type: 'income-statement'
  from: string
  to: string
  revenues: StatementSection
  expenses: StatementSection
  netProfit: number
  count: number
}

interface BalanceSheetRow {
  accountId: string
  code: string
  name: string
  amount: number
  /** سطر النتيجة (ربح/خسارة) التراكمية — صف مستقل داخل حقوق الملكية بلا حساب فعلي */
  isResult: boolean
}

interface BalanceSheetSection {
  rows: BalanceSheetRow[]
  total: number
}

interface BalanceSheetResponse {
  type: 'balance-sheet'
  to: string
  assets: BalanceSheetSection
  liabilities: BalanceSheetSection
  equity: BalanceSheetSection
  result: number
  totals: {
    assets: number
    liabilities: number
    equity: number
    liabilitiesAndEquity: number
  }
  balanced: boolean
  count: number
}

// ==================== واجهات الاستجابة — التقارير الإضافية ====================

// ---- أرباح وخسائر شهرية ----
interface MonthlyPnlMonth {
  month: string // 'YYYY-MM'
  revenue: number
  expenses: number
  profit: number
}

/** شهر بارز (أفضل/أسوأ) — null إن لم توجد أي حركة بالسنة */
interface MonthHighlight {
  month: string
  profit: number
}

interface MonthlyPnlResponse {
  type: 'monthly-pnl'
  year: number
  months: MonthlyPnlMonth[] // 12 شهراً دائماً — الأشهر الخالية أصفار
  totals: { revenue: number; expenses: number; profit: number }
  bestMonth: MonthHighlight | null
  worstMonth: MonthHighlight | null
}

// ---- المخزون ----
interface InventoryRow {
  code: string
  name: string
  unit: string | null
  quantity: number
  purchasePrice: number
  stockValue: number // الكمية × سعر التكلفة
  saleValue: number // الكمية × سعر البيع
  minStock: number
  underMin: boolean // الكمية دون الحد الأدنى
}

interface InventoryResponse {
  type: 'inventory'
  warehouse: { id: string; name: string } | null // null = كل المستودعات
  rows: InventoryRow[]
  kpis: {
    itemsCount: number
    stockValueCost: number
    stockValueSale: number
    underMinCount: number
  }
  totals: { stockValueCost: number; stockValueSale: number }
}

// ---- المبيعات / المشتريات ----
interface InvoiceReportRow {
  id: string
  number: string
  type: string
  date: string // ISO
  partnerName: string
  subtotal: number
  discount: number
  tax: number
  total: number
  paid: number
  remaining: number
  status: string
}

interface InvoiceReportStats {
  invoicesCount: number
  invoicesTotal: number
  returnsCount: number
  returnsTotal: number
  net: number
  taxTotal: number
  discountTotal: number
  avgInvoice: number
}

interface SalesPurchasesResponse {
  type: 'sales' | 'purchases'
  from: string
  to: string
  rows: InvoiceReportRow[] // مرتبة تاريخاً تنازلياً
  stats: InvoiceReportStats
}

// ---- كشف حساب طرف ----
interface StatementPartner {
  id: string
  code: string
  name: string
  type: string
  phone: string | null
}

interface PartnerStatementRow {
  date: string // ISO
  docType: string // نص عربي جاهز (فاتورة مبيعات/سند قبض/…)
  number: string
  description: string
  debit: number
  credit: number
  balance: number // رصيد متحرك
}

interface PartnerStatementResponse {
  type: 'partner-statement'
  partner: StatementPartner
  from: string | null
  to: string | null
  opening: number
  rows: PartnerStatementRow[] // تصاعدياً بالتاريخ برصيد متحرك
  totals: { debit: number; credit: number; closing: number }
  count: number
}

// ---- تقرير الصندوق ----
interface TreasuryRow {
  number: string
  type: string // RECEIPT | PAYMENT
  date: string // ISO
  partnerName: string | null
  method: string
  notes: string | null
  incoming: number // سند قبض
  outgoing: number // سند دفع
  balance: number // رصيد متحرك
}

interface TreasuryResponse {
  type: 'treasury'
  from: string
  to: string
  opening: number // تراكمي قبل «من» إن حُدد وإلا صفر
  rows: TreasuryRow[]
  totals: { incoming: number; outgoing: number; net: number }
  closing: number
  byMethod: { method: string; incoming: number; outgoing: number }[]
}

// ---- المصروفات ----
interface ExpenseCategoryRow {
  code: string
  name: string
  total: number
  entriesCount: number
  share: number // النسبة من الإجمالي %
}

interface ExpenseDetailRow {
  date: string // ISO
  entryNumber: string
  accountName: string
  description: string
  amount: number
}

interface ExpensesResponse {
  type: 'expenses'
  from: string
  to: string
  rows: ExpenseCategoryRow[]
  totals: { total: number }
  details: ExpenseDetailRow[] // آخر 100 حركة مصروف بالفترة
  kpis: {
    total: number
    entriesCount: number // عدد القيود المميزة
    topCategory: string | null
    avgEntry: number // متوسط قيمة القيد
  }
}

// ---- ربحية الأصناف ----
interface ItemProfitRow {
  code: string
  name: string
  qtySold: number // المبيع ناقص المردود
  revenue: number
  cost: number
  profit: number
  margin: number // الهامش % من الإيراد
}

interface ItemProfitabilityResponse {
  type: 'item-profitability'
  from: string
  to: string
  rows: ItemProfitRow[] // مرتبة بالربح تنازلياً
  kpis: {
    revenue: number
    cost: number
    profit: number
    bestItem: { code: string; name: string; profit: number } | null
  }
}

// ==================== أدوات مساعدة ====================

function todayYMD(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

function isValidYMD(s: string): boolean {
  if (!YMD_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00.000`)
  if (Number.isNaN(d.getTime())) return false
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}` === s
}

const dayStart = (ymd: string): Date => new Date(`${ymd}T00:00:00.000`)
const dayEnd = (ymd: string): Date => new Date(`${ymd}T23:59:59.999`)

/** إزاحة تاريخ YMD بعدد أيام — حساب محلي دون toISOString تفادياً لإزاحة المنطقة الزمنية */
function shiftDaysYMD(ymd: string, days: number): string {
  const dt = new Date(dayStart(ymd).getTime() + days * 86_400_000)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** عدد أيام فترة شاملة الطرفين */
function daysBetweenYMD(from: string, to: string): number {
  return Math.round((dayStart(to).getTime() - dayStart(from).getTime()) / 86_400_000) + 1
}

/** إزاحة تاريخ YMD بعدد شهور تقويمية مع قصر يوم الشهر على آخر يوم فعلي (31 → 28/29) */
function addMonthsYMD(ymd: string, months: number): string {
  const y = Number(ymd.slice(0, 4))
  const m = Number(ymd.slice(5, 7)) - 1 + months
  const d = Number(ymd.slice(8, 10))
  const ny = y + Math.floor(m / 12)
  const nm = ((m % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  const nd = Math.min(d, lastDay)
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
}

/** آخر يوم فعلي في شهر تاريخ YMD */
function lastDayOfMonthYMD(ymd: string): number {
  return new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0)).getUTCDate()
}

/**
 * الفترة السابقة المماثلة لفترة معطاة:
 * - شهر تقويمي كامل (أو عدة أشهر) ← الشهر/الشهور التقويمية السابقة (سبتمبر كامل ← أغسطس كامل)
 * - فترة جزئية ← نفس عدد الأيام السابقة مباشرة (أول الشهر حتى اليوم ← المثل لها بالشهر الماضي)
 */
function previousPeriodYMD(from: string, to: string): { from: string; to: string } {
  const isFullMonths = from.slice(8, 10) === '01' && Number(to.slice(8, 10)) === lastDayOfMonthYMD(to)
  if (isFullMonths) {
    const months =
      (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
      (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) +
      1
    return { from: addMonthsYMD(from, -months), to: addMonthsYMD(to, -months) }
  }
  const len = daysBetweenYMD(from, to)
  const prevTo = shiftDaysYMD(from, -1)
  return { from: shiftDaysYMD(prevTo, -(len - 1)), to: prevTo }
}

interface AccDelta {
  d: number
  c: number
}

const byCode = (a: { code: string }, b: { code: string }): number =>
  a.code.localeCompare(b.code, 'en', { numeric: true })

const badRequest = (error: string): NextResponse => NextResponse.json({ error }, { status: 400 })
const notFound = (error: string): NextResponse => NextResponse.json({ error }, { status: 404 })

/** نتيجة قراءة فترة from/to — إما قيم صالحة أو رسالة خطأ عربية */
type PeriodResult = { from: string; to: string } | { message: string }

/**
 * قراءة فترة from/to القياسية — الافتراضي 1 يناير للسنة الحالية ← اليوم.
 * تتحقق من الصيغة YYYY-MM-DD ومن أن «من» قبل «إلى» أو مساوية له.
 */
function parsePeriod(sp: URLSearchParams): PeriodResult {
  let toYMD = todayYMD()
  const toParam = sp.get('to')
  if (toParam) {
    if (!isValidYMD(toParam)) return { message: 'تاريخ «إلى» غير صالح — الصيغة المطلوبة YYYY-MM-DD' }
    toYMD = toParam
  }

  let fromYMD = `${new Date().getFullYear()}-01-01`
  const fromParam = sp.get('from')
  if (fromParam) {
    if (!isValidYMD(fromParam)) return { message: 'تاريخ «من» غير صالح — الصيغة المطلوبة YYYY-MM-DD' }
    fromYMD = fromParam
  }

  if (dayStart(fromYMD).getTime() > dayStart(toYMD).getTime()) {
    return { message: 'تاريخ «من» يجب أن يكون قبلاً أو مساوياً لتاريخ «إلى»' }
  }
  return { from: fromYMD, to: toYMD }
}

/** قراءة سنة التقرير (monthly-pnl) — افتراضياً السنة الحالية، مقبولة 2000..2100 */
function parseYear(sp: URLSearchParams): { year: number } | { message: string } {
  const raw = sp.get('year')
  if (!raw) return { year: new Date().getFullYear() }
  const y = Number.parseInt(raw, 10)
  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    return { message: 'السنة غير صالحة — يجب أن تكون رقماً بين 2000 و 2100' }
  }
  return { year: y }
}

// ==================== التقارير المالية الثلاثة (تنفيذ أصلي دون تغيير) ====================

type FinancialType = 'trial-balance' | 'income-statement' | 'balance-sheet'

async function financialReport(type: FinancialType, sp: URLSearchParams): Promise<NextResponse> {
  // ===== تحقق صارم من «إلى» (افتراضي اليوم) =====
  let toYMD = todayYMD()
  const toParam = sp.get('to')
  if (toParam) {
    if (!isValidYMD(toParam)) {
      return NextResponse.json(
        { error: 'تاريخ «إلى» غير صالح — الصيغة المطلوبة YYYY-MM-DD' },
        { status: 400 },
      )
    }
    toYMD = toParam
  }

  // ===== تحقق صارم من «من» (افتراضي 1 يناير للسنة الحالية — ولا يُستخدم في الميزانية) =====
  let fromYMD = ''
  if (type !== 'balance-sheet') {
    fromYMD = `${new Date().getFullYear()}-01-01`
    const fromParam = sp.get('from')
    if (fromParam) {
      if (!isValidYMD(fromParam)) {
        return NextResponse.json(
          { error: 'تاريخ «من» غير صالح — الصيغة المطلوبة YYYY-MM-DD' },
          { status: 400 },
        )
      }
      fromYMD = fromParam
    }
    if (dayStart(fromYMD).getTime() > dayStart(toYMD).getTime()) {
      return NextResponse.json(
        { error: 'تاريخ «من» يجب أن يكون قبلاً أو مساوياً لتاريخ «إلى»' },
        { status: 400 },
      )
    }
  }

  // ===== الحسابات + حركة القيود المُرحّلة ضمن الفترة (أو التراكمي حتى «إلى») =====
  const [accounts, lines] = await Promise.all([
    db.account.findMany({
      select: { id: true, code: true, name: true, type: true, openingBalance: true, parentId: true },
      orderBy: { code: 'asc' },
    }),
    db.journalEntryLine.findMany({
      where: {
        entry: {
          status: 'POSTED',
          date:
            type === 'balance-sheet'
              ? { lte: dayEnd(toYMD) }
              : { gte: dayStart(fromYMD), lte: dayEnd(toYMD) },
        },
      },
      select: { accountId: true, debit: true, credit: true },
    }),
  ])

  const deltas = new Map<string, AccDelta>()
  for (const l of lines) {
    const cur = deltas.get(l.accountId) ?? { d: 0, c: 0 }
    cur.d += l.debit
    cur.c += l.credit
    deltas.set(l.accountId, cur)
  }

  // ===== القاعدة الذهبية لترحيل الفترات: سند القيد الافتتاحي أساس أرصدة الفترة الجديدة =====
  // الإقفال بتاريخ D ينشئ سند الافتتاحي بتاريخ D+1 (أول يوم من الفترة الجديدة) — فأي تقرير
  // غايته داخل نافذة [D، D+1) — كتقرير «حتى اليوم» في يوم تنفيذ الإقفال نفسه — لا يجد القيد
  // ضمن مداه التاريخي فيظهر أصفاراً رغم سلامة الترحيل. هنا تُدمج أسطر الافتتاحي (JE الافتتاحي)
  // في حركة التقرير كأساس للأرصدة المدوّرة: الأصول والخصوم والأرباح المحتجزة تظهر فوراً.
  // خارج النافذة لا مساس: قبل الإقفال (تاريخي — من أرشيف فترته) أو من يوم الافتتاح فصاعداً
  // (يدخل القيد طبيعياً ضمن مدى التقرير فلا ازدواج).
  {
    const latestClose = await db.periodClose.findFirst({ orderBy: { closingDate: 'desc' } })
    if (latestClose) {
      const closeYMD = latestClose.closingDate.toISOString().slice(0, 10)
      const openYMD = latestClose.openingDate.toISOString().slice(0, 10)
      if (toYMD >= closeYMD && toYMD < openYMD) {
        const openLines = await db.journalEntryLine.findMany({
          where: { entryId: latestClose.openingEntryId, entry: { status: 'POSTED' } },
          select: { accountId: true, debit: true, credit: true },
        })
        for (const l of openLines) {
          const cur = deltas.get(l.accountId) ?? { d: 0, c: 0 }
          cur.d += l.debit
          cur.c += l.credit
          deltas.set(l.accountId, cur)
        }
      }
    }
  }

  // ==================== ميزان المراجعة ====================
  if (type === 'trial-balance') {
    // الحسابات ذات الحركة المباشرة في الفترة — عملياً الورقية (بلا أبناء).
    // أي أب نادر يحمل حركة مباشرة يُدرج بحركته المباشرة فقط (دون تجميع أبنائه)
    // حتى تبقى إجماليات المدين والدائن مطابقة لمجموع البنود المرحّلة ومتوازنة.
    const rows: TrialBalanceRow[] = accounts
      .filter((a) => deltas.has(a.id))
      .map((a) => {
        const dv = deltas.get(a.id) as AccDelta
        return {
          accountId: a.id,
          code: a.code,
          name: a.name,
          type: a.type,
          totalDebit: round2(dv.d),
          totalCredit: round2(dv.c),
          balance: round2(dv.d - dv.c),
        }
      })
      .sort(byCode)

    const totalDebit = round2(rows.reduce((s, r) => s + r.totalDebit, 0))
    const totalCredit = round2(rows.reduce((s, r) => s + r.totalCredit, 0))
    const balance = round2(totalDebit - totalCredit)
    const payload: TrialBalanceResponse = {
      type: 'trial-balance',
      from: fromYMD,
      to: toYMD,
      rows,
      totals: { totalDebit, totalCredit, balance },
      count: rows.length,
      balanced: Math.abs(balance) <= 0.01,
    }
    return NextResponse.json(payload)
  }

  // ==================== قائمة الدخل ====================
  if (type === 'income-statement') {
    const revenues: StatementRow[] = []
    const expenses: StatementRow[] = []
    for (const a of accounts) {
      const dv = deltas.get(a.id)
      if (!dv) continue
      if (a.type === 'REVENUE') {
        revenues.push({ accountId: a.id, code: a.code, name: a.name, amount: round2(dv.c - dv.d) })
      } else if (a.type === 'EXPENSE') {
        expenses.push({ accountId: a.id, code: a.code, name: a.name, amount: round2(dv.d - dv.c) })
      }
    }
    revenues.sort(byCode)
    expenses.sort(byCode)

    const totalRevenue = round2(revenues.reduce((s, r) => s + r.amount, 0))
    const totalExpense = round2(expenses.reduce((s, r) => s + r.amount, 0))
    const payload: IncomeStatementResponse = {
      type: 'income-statement',
      from: fromYMD,
      to: toYMD,
      revenues: { rows: revenues, total: totalRevenue },
      expenses: { rows: expenses, total: totalExpense },
      netProfit: round2(totalRevenue - totalExpense),
      count: revenues.length + expenses.length,
    }
    return NextResponse.json(payload)
  }

  // ==================== الميزانية العمومية (تراكمي حتى «إلى») ====================
  const sectionRows = (t: string, debitSign: 1 | -1): BalanceSheetRow[] =>
    accounts
      .filter((a) => a.type === t && (a.openingBalance !== 0 || deltas.has(a.id)))
      .map((a) => {
        const dv = deltas.get(a.id) ?? { d: 0, c: 0 }
        const movement = debitSign === 1 ? dv.d - dv.c : dv.c - dv.d
        return {
          accountId: a.id,
          code: a.code,
          name: a.name,
          amount: round2(a.openingBalance + movement),
          isResult: false,
        }
      })
      .sort(byCode)

  const assets = sectionRows('ASSET', 1)
  const liabilities = sectionRows('LIABILITY', -1)
  const equityAccounts = sectionRows('EQUITY', -1)

  // النتيجة التراكمية (ربح/خسارة) = الإيرادات التراكمية - المصروفات التراكمية (قد تكون سالبة)
  let revCum = 0
  let expCum = 0
  for (const a of accounts) {
    const dv = deltas.get(a.id)
    if (!dv) continue
    if (a.type === 'REVENUE') revCum += dv.c - dv.d
    else if (a.type === 'EXPENSE') expCum += dv.d - dv.c
  }
  const result = round2(revCum - expCum)

  const equity: BalanceSheetRow[] = [
    ...equityAccounts,
    {
      accountId: '',
      code: '',
      name: 'النتيجة (ربح/خسارة) الفترة حتى التاريخ',
      amount: result,
      isResult: true,
    },
  ]

  const assetsTotal = round2(assets.reduce((s, r) => s + r.amount, 0))
  const liabilitiesTotal = round2(liabilities.reduce((s, r) => s + r.amount, 0))
  const equityTotal = round2(equity.reduce((s, r) => s + r.amount, 0))
  const liabilitiesAndEquity = round2(liabilitiesTotal + equityTotal)

  const payload: BalanceSheetResponse = {
    type: 'balance-sheet',
    to: toYMD,
    assets: { rows: assets, total: assetsTotal },
    liabilities: { rows: liabilities, total: liabilitiesTotal },
    equity: { rows: equity, total: equityTotal },
    result,
    totals: { assets: assetsTotal, liabilities: liabilitiesTotal, equity: equityTotal, liabilitiesAndEquity },
    balanced: Math.abs(round2(assetsTotal - liabilitiesAndEquity)) <= 0.01,
    count: assets.length + liabilities.length + equity.length,
  }
  return NextResponse.json(payload)
}

// ==================== أرباح وخسائر شهرية ====================

async function monthlyPnlReport(sp: URLSearchParams): Promise<NextResponse> {
  const parsed = parseYear(sp)
  if ('message' in parsed) return badRequest(parsed.message)
  const year = parsed.year

  // 12 شهراً مهيأة مسبقاً — الأشهر الخالية تبقى أصفاراً
  const months: MonthlyPnlMonth[] = Array.from({ length: 12 }, (_, i) => ({
    month: `${year}-${String(i + 1).padStart(2, '0')}`,
    revenue: 0,
    expenses: 0,
    profit: 0,
  }))

  // أسطر حسابات الإيراد والمصروف من القيود المُرحّلة فقط خلال السنة
  const lines = await db.journalEntryLine.findMany({
    where: {
      entry: {
        status: 'POSTED',
        date: { gte: new Date(`${year}-01-01T00:00:00.000`), lte: new Date(`${year}-12-31T23:59:59.999`) },
      },
      account: { type: { in: ['REVENUE', 'EXPENSE'] } },
    },
    select: {
      debit: true,
      credit: true,
      account: { select: { type: true } },
      entry: { select: { date: true } },
    },
  })

  for (const l of lines) {
    // الشهر من التاريخ المحلي — مطابق لطريقة إنشاء تواريخ القيود (بلا إزاحة UTC)
    const slot = months[l.entry.date.getMonth()]
    if (!slot) continue
    if (l.account.type === 'REVENUE') slot.revenue += l.credit - l.debit
    else slot.expenses += l.debit - l.credit
  }

  for (const m of months) {
    m.revenue = round2(m.revenue)
    m.expenses = round2(m.expenses)
    m.profit = round2(m.revenue - m.expenses)
  }

  const totals = {
    revenue: round2(months.reduce((s, m) => s + m.revenue, 0)),
    expenses: round2(months.reduce((s, m) => s + m.expenses, 0)),
    profit: round2(months.reduce((s, m) => s + m.profit, 0)),
  }

  // أفضل/أسوأ شهر — بين الشهور ذات الحركة فقط
  const active = months.filter((m) => m.revenue !== 0 || m.expenses !== 0)
  let bestMonth: MonthHighlight | null = null
  let worstMonth: MonthHighlight | null = null
  if (active.length > 0) {
    let best = active[0]
    let worst = active[0]
    for (const m of active) {
      if (m.profit > best.profit) best = m
      if (m.profit < worst.profit) worst = m
    }
    bestMonth = { month: best.month, profit: best.profit }
    worstMonth = { month: worst.month, profit: worst.profit }
  }

  const payload: MonthlyPnlResponse = { type: 'monthly-pnl', year, months, totals, bestMonth, worstMonth }
  return NextResponse.json(payload)
}

// ==================== تقرير المخزون ====================

interface InventoryAcc {
  code: string
  name: string
  unit: string | null
  quantity: number
  purchasePrice: number
  salePrice: number
  minStock: number
}

async function inventoryReport(sp: URLSearchParams): Promise<NextResponse> {
  const warehouseId = sp.get('warehouseId') || null

  // التحقق من وجود المستودع إن حُدد
  let warehouseName: string | null = null
  if (warehouseId) {
    const w = await db.warehouse.findUnique({ where: { id: warehouseId }, select: { name: true } })
    if (!w) return notFound('المستودع المحدد غير موجود')
    warehouseName = w.name
  }

  // أرصدة الأصناف — تُجمع حسب الصنف (قد تتوزع عبر عدة مستودعات عند «الكل»)
  const balances = await db.itemBalance.findMany({
    where: warehouseId ? { warehouseId } : undefined,
    select: {
      quantity: true,
      item: {
        select: { code: true, name: true, unit: true, purchasePrice: true, salePrice: true, minStock: true },
      },
    },
  })

  const acc = new Map<string, InventoryAcc>()
  for (const b of balances) {
    const cur = acc.get(b.item.code) ?? {
      code: b.item.code,
      name: b.item.name,
      unit: b.item.unit,
      quantity: 0,
      purchasePrice: b.item.purchasePrice,
      salePrice: b.item.salePrice,
      minStock: b.item.minStock,
    }
    cur.quantity += b.quantity
    acc.set(b.item.code, cur)
  }

  // الأصناف ذات كمية أو حد أدنى فقط
  const rows: InventoryRow[] = [...acc.values()]
    .filter((r) => r.quantity !== 0 || r.minStock > 0)
    .map((r) => ({
      code: r.code,
      name: r.name,
      unit: r.unit,
      quantity: round2(r.quantity),
      purchasePrice: round2(r.purchasePrice),
      stockValue: round2(r.quantity * r.purchasePrice),
      saleValue: round2(r.quantity * r.salePrice),
      minStock: round2(r.minStock),
      underMin: r.quantity < r.minStock,
    }))
    .sort(byCode)

  const stockValueCost = round2(rows.reduce((s, r) => s + r.stockValue, 0))
  const stockValueSale = round2(rows.reduce((s, r) => s + r.saleValue, 0))

  const payload: InventoryResponse = {
    type: 'inventory',
    warehouse: warehouseId && warehouseName ? { id: warehouseId, name: warehouseName } : null,
    rows,
    kpis: {
      itemsCount: rows.length,
      stockValueCost,
      stockValueSale,
      underMinCount: rows.filter((r) => r.underMin).length,
    },
    totals: { stockValueCost, stockValueSale },
  }
  return NextResponse.json(payload)
}

// ==================== تقرير المبيعات / المشتريات ====================

async function invoicesReport(type: 'sales' | 'purchases', sp: URLSearchParams): Promise<NextResponse> {
  const parsed = parsePeriod(sp)
  if ('message' in parsed) return badRequest(parsed.message)
  const { from, to } = parsed

  const normalType = type === 'sales' ? 'SALE' : 'PURCHASE'
  const returnType = type === 'sales' ? 'SALES_RETURN' : 'PURCHASE_RETURN'

  const invoices = await db.invoice.findMany({
    where: {
      isDeleted: false,
      type: { in: [normalType, returnType] },
      date: { gte: dayStart(from), lte: dayEnd(to) },
    },
    orderBy: [{ date: 'desc' }, { number: 'desc' }],
    select: {
      id: true,
      number: true,
      type: true,
      date: true,
      subtotal: true,
      discount: true,
      tax: true,
      total: true,
      paid: true,
      status: true,
      partner: { select: { name: true } },
    },
  })

  const rows: InvoiceReportRow[] = invoices.map((r) => ({
    id: r.id,
    number: r.number,
    type: r.type,
    date: r.date.toISOString(),
    partnerName: r.partner?.name ?? '—',
    subtotal: round2(r.subtotal),
    discount: round2(r.discount),
    tax: round2(r.tax),
    total: round2(r.total),
    paid: round2(r.paid),
    remaining: round2(Math.max(0, r.total - r.paid)),
    status: r.status,
  }))

  // الإحصاءات — الفواتير الأصلية والمردودات منفصلة، والصافي = الفواتير − المردودات
  // (الضريبة والحسم صافية أيضاً: مردود الفاتورة يبطل ضريبتها وحسمها)
  let invoicesTotal = 0
  let returnsTotal = 0
  let taxTotal = 0
  let discountTotal = 0
  let invoicesCount = 0
  let returnsCount = 0
  for (const r of rows) {
    const sign = r.type === returnType ? -1 : 1
    if (sign === 1) invoicesCount++
    else returnsCount++
    if (sign === 1) invoicesTotal += r.total
    else returnsTotal += r.total
    taxTotal += sign * r.tax
    discountTotal += sign * r.discount
  }

  const payload: SalesPurchasesResponse = {
    type,
    from,
    to,
    rows,
    stats: {
      invoicesCount,
      invoicesTotal: round2(invoicesTotal),
      returnsCount,
      returnsTotal: round2(returnsTotal),
      net: round2(invoicesTotal - returnsTotal),
      taxTotal: round2(taxTotal),
      discountTotal: round2(discountTotal),
      avgInvoice: invoicesCount > 0 ? round2(invoicesTotal / invoicesCount) : 0,
    },
  }
  return NextResponse.json(payload)
}

// ==================== كشف حساب طرف (عميل/مورد) ====================

interface StatementDoc {
  date: Date
  docType: string
  number: string
  description: string
  debit: number
  credit: number
  /** أولوية الترتيب عند تساوي التاريخ — أسطر الافتتاحي (−1) تسبق مستندات الفترة الجديدة */
  priority?: number
}

/** نص بيان جاهز — الملاحظة إن وُجدت وإلا «بدون بيان» */
const docDescription = (notes: string | null): string =>
  notes && notes.trim() ? notes.trim() : 'بدون بيان'

async function partnerStatementReport(sp: URLSearchParams): Promise<NextResponse> {
  const partnerId = sp.get('partnerId')
  if (!partnerId) return badRequest('معرف الطرف (partnerId) مطلوب لكشف الحساب')

  // from/to اختيارية هنا — عند تمريرها تتحقق الصيغة والترتيب
  let fromYMD: string | null = null
  let toYMD: string | null = null
  const fromParam = sp.get('from')
  const toParam = sp.get('to')
  if (fromParam) {
    if (!isValidYMD(fromParam)) return badRequest('تاريخ «من» غير صالح — الصيغة المطلوبة YYYY-MM-DD')
    fromYMD = fromParam
  }
  if (toParam) {
    if (!isValidYMD(toParam)) return badRequest('تاريخ «إلى» غير صالح — الصيغة المطلوبة YYYY-MM-DD')
    toYMD = toParam
  }
  if (fromYMD && toYMD && dayStart(fromYMD).getTime() > dayStart(toYMD).getTime()) {
    return badRequest('تاريخ «من» يجب أن يكون قبلاً أو مساوياً لتاريخ «إلى»')
  }

  const partner = await db.partner.findUnique({
    where: { id: partnerId },
    select: { id: true, code: true, name: true, type: true, phone: true, accountId: true },
  })
  if (!partner) return notFound('ملف الطرف غير موجود')

  const isCustomer = partner.type === 'CUSTOMER'

  // حركة العميل: فواتير بيع ومردوداته وسندات قبضه
  // حركة المورد: فواتير شراء ومردوده وسندات دفعه
  const [invoices, vouchers, clearingLines] = await Promise.all([
    db.invoice.findMany({
      where: {
        partnerId: partner.id,
        isDeleted: false,
        type: { in: isCustomer ? ['SALE', 'SALES_RETURN'] : ['PURCHASE', 'PURCHASE_RETURN'] },
      },
      select: { number: true, type: true, date: true, total: true, notes: true },
    }),
    db.payment.findMany({
      where: { partnerId: partner.id, type: isCustomer ? 'RECEIPT' : 'PAYMENT' },
      select: { number: true, type: true, date: true, amount: true, notes: true },
    }),
    // سندات المقاصة المرحّلة على الحساب الفرعي للطرف — بالاتجاه المثبت فعلياً في القيد
    partner.accountId
      ? db.journalEntryLine.findMany({
          where: { accountId: partner.accountId, entry: { source: 'CLEARING', status: 'POSTED' } },
          select: {
            debit: true,
            credit: true,
            description: true,
            entry: { select: { number: true, date: true, description: true } },
          },
        })
      : Promise.resolve([] as never[]),
  ])

  const DOCTYPE_LABELS: Record<string, string> = {
    SALE: 'فاتورة مبيعات',
    SALES_RETURN: 'مردود مبيعات',
    PURCHASE: 'فاتورة مشتريات',
    PURCHASE_RETURN: 'مردود مشتريات',
    RECEIPT: 'سند قبض',
    PAYMENT: 'سند دفع',
    CLEARING: 'سند مقاصة',
    OPENING: 'قيد افتتاحي (ترحيل)',
  }

  // الرصيد الافتتاحي المرحّل بسند القيد الافتتاحي — المصدر الوحيد لرصيد الطرف في الفترة
  // الجديدة بعد تدوير مستنداتها التفصيلية (شرط عزل الفترات): أول سطر في الكشف دائماً
  const openingLine = partner.accountId
    ? (await getOpeningLinesByAccount(db)).get(partner.accountId) ?? null
    : null

  const docs: StatementDoc[] = []
  if (openingLine) {
    docs.push({
      date: openingLine.entryDate,
      docType: DOCTYPE_LABELS.OPENING,
      number: openingLine.entryNumber,
      description: openingLine.description ?? `رصيد افتتاحي مرحّل بسند ${openingLine.entryNumber}`,
      debit: round2(openingLine.debit),
      credit: round2(openingLine.credit),
      priority: -1,
    })
  }
  for (const inv of invoices) {
    // العميل: فاتورة بيع تزيده مديناً ومردودها دائن — المورد: فاتورة شراء تزيده دائناً ومردودها مدين
    const isReturn = inv.type === 'SALES_RETURN' || inv.type === 'PURCHASE_RETURN'
    const debit = (isCustomer ? !isReturn : isReturn) ? round2(inv.total) : 0
    const credit = (isCustomer ? isReturn : !isReturn) ? round2(inv.total) : 0
    docs.push({
      date: inv.date,
      docType: DOCTYPE_LABELS[inv.type] ?? inv.type,
      number: inv.number,
      description: docDescription(inv.notes),
      debit,
      credit,
    })
  }
  for (const v of vouchers) {
    // سند قبض (عميل) يزيده دائناً — سند دفع (مورد) يزيده مديناً
    const debit = !isCustomer ? round2(v.amount) : 0
    const credit = isCustomer ? round2(v.amount) : 0
    docs.push({
      date: v.date,
      docType: DOCTYPE_LABELS[v.type] ?? v.type,
      number: v.number,
      description: docDescription(v.notes),
      debit,
      credit,
    })
  }
  for (const l of clearingLines) {
    // سند المقاصة: الاتجاه كما رُحّل فعلياً في القيد — مدين يزيده مديناً ودائن يزيده دائناً
    docs.push({
      date: l.entry.date,
      docType: DOCTYPE_LABELS.CLEARING ?? 'سند مقاصة',
      number: l.entry.number,
      description: docDescription(l.description ?? l.entry.description),
      debit: round2(l.debit),
      credit: round2(l.credit),
    })
  }

  // تصاعدياً بالتاريخ ثم الأولوية (الافتتاحي أولاً) ثم الرقم — ليبقى الرصيد المتحرك مستقراً
  docs.sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      (a.priority ?? 0) - (b.priority ?? 0) ||
      a.number.localeCompare(b.number, 'en', { numeric: true }),
  )

  const fromTime = fromYMD ? dayStart(fromYMD).getTime() : null
  const toTime = toYMD ? dayEnd(toYMD).getTime() : null

  // الرصيد الافتتاحي = تجميع كل الحركة قبل «من»
  let opening = 0
  for (const d of docs) {
    if (fromTime !== null && d.date.getTime() < fromTime) opening += d.debit - d.credit
  }
  opening = round2(opening)

  let running = opening
  let totalDebit = 0
  let totalCredit = 0
  const rows: PartnerStatementRow[] = []
  for (const d of docs) {
    const t = d.date.getTime()
    if (fromTime !== null && t < fromTime) continue
    if (toTime !== null && t > toTime) continue
    running = round2(running + d.debit - d.credit)
    totalDebit += d.debit
    totalCredit += d.credit
    rows.push({
      date: d.date.toISOString(),
      docType: d.docType,
      number: d.number,
      description: d.description,
      debit: d.debit,
      credit: d.credit,
      balance: running,
    })
  }

  const payload: PartnerStatementResponse = {
    type: 'partner-statement',
    partner: { id: partner.id, code: partner.code, name: partner.name, type: partner.type, phone: partner.phone },
    from: fromYMD,
    to: toYMD,
    opening,
    rows,
    totals: { debit: round2(totalDebit), credit: round2(totalCredit), closing: running },
    count: rows.length,
  }
  return NextResponse.json(payload)
}

// ==================== تقرير الصندوق ====================

async function treasuryReport(sp: URLSearchParams): Promise<NextResponse> {
  const parsed = parsePeriod(sp)
  if ('message' in parsed) return badRequest(parsed.message)
  const { from, to } = parsed
  const hasExplicitFrom = sp.get('from') !== null

  // التراكمي قبل «من» (وارد − صادر) — يُحسب فقط عند تحديد «من» صراحة
  const [vouchers, openingInAgg, openingOutAgg] = await Promise.all([
    db.payment.findMany({
      where: { date: { gte: dayStart(from), lte: dayEnd(to) } },
      orderBy: [{ date: 'asc' }, { number: 'asc' }],
      select: {
        number: true,
        type: true,
        date: true,
        amount: true,
        method: true,
        notes: true,
        partner: { select: { name: true } },
      },
    }),
    hasExplicitFrom
      ? db.payment.aggregate({
          where: { date: { lt: dayStart(from) }, type: 'RECEIPT' },
          _sum: { amount: true },
        })
      : Promise.resolve(null),
    hasExplicitFrom
      ? db.payment.aggregate({
          where: { date: { lt: dayStart(from) }, type: 'PAYMENT' },
          _sum: { amount: true },
        })
      : Promise.resolve(null),
  ])

  let opening = hasExplicitFrom
    ? round2((openingInAgg?._sum.amount ?? 0) - (openingOutAgg?._sum.amount ?? 0))
    : 0

  // ===== القاعدة الذهبية لترحيل الفترات: رصيد الصندوق/البنك الافتتاحي من سند القيد الافتتاحي =====
  // الخزينة تجمع سندات القبض/الدفع فقط، وبعد تدوير مستندات الفترة المغلقة يصبح مجموعها صفراً
  // بينما حقيقة النقد المدوّرة تعيش في سطرَي الصندوق (1110) والبنك (1120) في سند القيد الافتتاحي
  // حصراً. أي تقرير خزينة يلامس الفترة الجديدة (إلى ≥ تاريخ الإقفال) يبدأ رصيده الافتتاحي من
  // أسطر السند الافتتاحي، وتُضاف فوقه حركة سندات الفترة الجديدة كما هي. المدى التاريخي الكامل
  // (إلى < تاريخ الإقفال) لا مساس فيه — يُقرأ من أرشيف فترته عبر شاشة الفترة المقفلة.
  {
    const latestClose = await db.periodClose.findFirst({ orderBy: { closingDate: 'desc' } })
    if (latestClose && to >= latestClose.closingDate.toISOString().slice(0, 10)) {
      const cashLines = await db.journalEntryLine.findMany({
        where: {
          entryId: latestClose.openingEntryId,
          entry: { status: 'POSTED' },
          account: { code: { in: [INVOICE_ACCOUNTS.CASH.code, INVOICE_ACCOUNTS.BANK.code] } },
        },
        select: { debit: true, credit: true },
      })
      opening = round2(opening + cashLines.reduce((s, l) => s + l.debit - l.credit, 0))
    }
  }

  let running = opening
  let incoming = 0
  let outgoing = 0
  const rows: TreasuryRow[] = []
  for (const v of vouchers) {
    const isIn = v.type === 'RECEIPT'
    const amount = round2(v.amount)
    if (isIn) {
      incoming += amount
      running = round2(running + amount)
    } else {
      outgoing += amount
      running = round2(running - amount)
    }
    rows.push({
      number: v.number,
      type: v.type,
      date: v.date.toISOString(),
      partnerName: v.partner?.name ?? null,
      method: v.method,
      notes: v.notes,
      incoming: isIn ? amount : 0,
      outgoing: isIn ? 0 : amount,
      balance: running,
    })
  }

  const net = round2(incoming - outgoing)

  // التوزيع حسب طريقة الدفع — الطرق ذات الحركة فقط
  const methodAcc = new Map<string, { incoming: number; outgoing: number }>()
  for (const r of rows) {
    const cur = methodAcc.get(r.method) ?? { incoming: 0, outgoing: 0 }
    cur.incoming += r.incoming
    cur.outgoing += r.outgoing
    methodAcc.set(r.method, cur)
  }
  const byMethod = ['CASH', 'BANK', 'CHEQUE']
    .map((method) => {
      const m = methodAcc.get(method) ?? { incoming: 0, outgoing: 0 }
      return { method, incoming: round2(m.incoming), outgoing: round2(m.outgoing) }
    })
    .filter((m) => m.incoming !== 0 || m.outgoing !== 0)

  const payload: TreasuryResponse = {
    type: 'treasury',
    from,
    to,
    opening,
    rows,
    totals: { incoming: round2(incoming), outgoing: round2(outgoing), net },
    closing: round2(opening + net),
    byMethod,
  }
  return NextResponse.json(payload)
}

// ==================== تقرير المصروفات ====================

async function expensesReport(sp: URLSearchParams): Promise<NextResponse> {
  const parsed = parsePeriod(sp)
  if ('message' in parsed) return badRequest(parsed.message)
  const { from, to } = parsed

  // أسطر حسابات المصروفات (الجانب المدين) من القيود المُرحّلة خلال الفترة
  const lines = await db.journalEntryLine.findMany({
    where: {
      entry: { status: 'POSTED', date: { gte: dayStart(from), lte: dayEnd(to) } },
      account: { type: 'EXPENSE' },
    },
    select: {
      debit: true,
      credit: true,
      description: true,
      accountId: true,
      account: { select: { code: true, name: true } },
      entry: { select: { id: true, number: true, date: true, description: true } },
    },
  })

  // التجميع حسب الحساب
  const acc = new Map<string, { code: string; name: string; total: number; entryIds: Set<string> }>()
  for (const l of lines) {
    const cur = acc.get(l.accountId) ?? {
      code: l.account.code,
      name: l.account.name,
      total: 0,
      entryIds: new Set<string>(),
    }
    cur.total += l.debit - l.credit
    cur.entryIds.add(l.entry.id)
    acc.set(l.accountId, cur)
  }

  const grandTotal = round2([...acc.values()].reduce((s, a) => s + a.total, 0))
  const rows: ExpenseCategoryRow[] = [...acc.values()]
    .map((a) => ({
      code: a.code,
      name: a.name,
      total: round2(a.total),
      entriesCount: a.entryIds.size,
      share: grandTotal > 0 ? round2((a.total / grandTotal) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total || byCode(a, b))

  // آخر 100 حركة مصروف (البنود المدينة) — الأحدث أولاً
  const details: ExpenseDetailRow[] = lines
    .filter((l) => l.debit > 0)
    .sort(
      (a, b) =>
        b.entry.date.getTime() - a.entry.date.getTime() ||
        b.entry.number.localeCompare(a.entry.number, 'en', { numeric: true }),
    )
    .slice(0, 100)
    .map((l) => ({
      date: l.entry.date.toISOString(),
      entryNumber: l.entry.number,
      accountName: l.account.name,
      description: l.description?.trim() || l.entry.description?.trim() || 'بدون بيان',
      amount: round2(l.debit),
    }))

  // عدد القيود المميزة عبر كل الحسابات
  const allEntryIds = new Set<string>()
  for (const a of acc.values()) for (const id of a.entryIds) allEntryIds.add(id)

  const payload: ExpensesResponse = {
    type: 'expenses',
    from,
    to,
    rows,
    totals: { total: grandTotal },
    details,
    kpis: {
      total: grandTotal,
      entriesCount: allEntryIds.size,
      topCategory: rows.length > 0 ? rows[0].name : null,
      avgEntry: allEntryIds.size > 0 ? round2(grandTotal / allEntryIds.size) : 0,
    },
  }
  return NextResponse.json(payload)
}

// ==================== مصدر التكلفة المحاسبي الموحد لتقارير الربحية والدوران ====================
// مطابق لمنطق effectiveItemCosts في invoice-journal.ts — المصدر الذي تُرحَّل به قيود التكلفة فعلياً:
// آخر سعر شراء لكل صنف من بنود فواتير المشتريات (الأحدث أولاً) وإلا سعر بطاقة الصنف.
// تنبيه جوهري موثق: حركة المخزون لفاتورة البيع تخزّن سعر البيع نفسه في unitCost (لا تكلفة)،
// فلا تصلح أساساً لحساب الربحية — الاعتماد عليها كان يجعل التكلفة = الإيراد والربح صفراً دائماً.
async function lastPurchaseCostMap(itemIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(itemIds)].filter(Boolean)
  const map = new Map<string, number>()
  if (ids.length === 0) return map

  const lines = await db.invoiceLine.findMany({
    where: { invoice: { type: 'PURCHASE' }, itemId: { in: ids } },
    select: { itemId: true, unitPrice: true },
    orderBy: [{ invoice: { date: 'desc' } }, { id: 'desc' }],
  })
  for (const ln of lines) {
    if (!map.has(ln.itemId) && ln.unitPrice > 0) map.set(ln.itemId, ln.unitPrice)
  }

  const missing = ids.filter((id) => !map.has(id))
  if (missing.length > 0) {
    const items = await db.item.findMany({
      where: { id: { in: missing } },
      select: { id: true, purchasePrice: true },
    })
    for (const it of items) {
      if (it.purchasePrice > 0) map.set(it.id, it.purchasePrice)
    }
  }
  return map
}

// ==================== تقرير ربحية الأصناف ====================
// التكلفة من المصدر المحاسبي نفسه (lastPurchaseCostMap أعلاه) — إيراد البنود مقابل تكلفة آخر شراء

async function itemProfitabilityReport(sp: URLSearchParams): Promise<NextResponse> {
  const parsed = parsePeriod(sp)
  if ('message' in parsed) return badRequest(parsed.message)
  const { from, to } = parsed

  // فواتير البيع ومردوداته غير المحذوفة خلال الفترة مع بنودها
  const invoices = await db.invoice.findMany({
    where: {
      isDeleted: false,
      type: { in: ['SALE', 'SALES_RETURN'] },
      date: { gte: dayStart(from), lte: dayEnd(to) },
    },
    select: {
      type: true,
      lines: {
        select: {
          itemId: true,
          quantity: true,
          total: true,
          item: { select: { code: true, name: true } },
        },
      },
    },
  })

  const costMap = await lastPurchaseCostMap(invoices.flatMap((i) => i.lines.map((l) => l.itemId)))

  interface ItemAcc {
    code: string
    name: string
    qty: number
    revenue: number
    cost: number
  }
  const acc = new Map<string, ItemAcc>()

  for (const inv of invoices) {
    const sign = inv.type === 'SALES_RETURN' ? -1 : 1
    for (const line of inv.lines) {
      const cur = acc.get(line.itemId) ?? {
        code: line.item.code,
        name: line.item.name,
        qty: 0,
        revenue: 0,
        cost: 0,
      }
      cur.qty += sign * line.quantity
      cur.revenue += sign * line.total
      cur.cost += sign * line.quantity * (costMap.get(line.itemId) ?? 0)
      acc.set(line.itemId, cur)
    }
  }

  const rows: ItemProfitRow[] = [...acc.values()]
    .map((a) => {
      const revenue = round2(a.revenue)
      const cost = round2(a.cost)
      const profit = round2(revenue - cost)
      return {
        code: a.code,
        name: a.name,
        qtySold: round2(a.qty),
        revenue,
        cost,
        profit,
        margin: revenue !== 0 ? round2((profit / revenue) * 100) : 0,
      }
    })
    .sort((a, b) => b.profit - a.profit || byCode(a, b))

  const payload: ItemProfitabilityResponse = {
    type: 'item-profitability',
    from,
    to,
    rows,
    kpis: {
      revenue: round2(rows.reduce((s, r) => s + r.revenue, 0)),
      cost: round2(rows.reduce((s, r) => s + r.cost, 0)),
      profit: round2(rows.reduce((s, r) => s + r.profit, 0)),
      bestItem: rows.length > 0 ? { code: rows[0].code, name: rows[0].name, profit: rows[0].profit } : null,
    },
  }
  return NextResponse.json(payload)
}

// ==================== 12) أعمار الذمم — توزيع أرصدة الأطراف على فئات عمر الفواتير ====================
// مصدر الحقيقة = حساب رصيد الطرف الرسمي نفسه: Σ(total فواتير النوع غير المحذوفة) − Σ(paid عليها)
// − Σ(سندات غير مخصصة لفاتورة invoiceId=null). الفئات بعمر تاريخ الفاتورة حتى اليوم:
// 0-30 / 31-60 / 61-90 / +90 يوماً. الدفعات غير المخصصة والفواتير المدفوعة زيادة (مبلغ سالب)
// تُخمد من الأقدم أولاً (ممارسة أعمار قياسية) — وإجمالي كل طرف موجب يطابق رصيده في شاشة
// الأطراف ومجموع customersDebt/suppliersDue فيها تماماً (كلاهما يحصر الأرصدة الموجبة فقط).

async function receivablesAgingReport(sp: URLSearchParams) {
  const side = sp.get('side') === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER'
  const isCustomer = side === 'CUSTOMER'
  const invoiceType = isCustomer ? 'SALE' : 'PURCHASE'
  const voucherType = isCustomer ? 'RECEIPT' : 'PAYMENT'

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [partners, invoices, unallocated] = await Promise.all([
    db.partner.findMany({
      where: { type: side },
      select: { id: true, code: true, name: true, phone: true, accountId: true },
      orderBy: { code: 'asc' },
    }),
    db.invoice.findMany({
      where: { partner: { type: side }, type: invoiceType, isDeleted: false },
      select: { partnerId: true, date: true, total: true, paid: true },
    }),
    db.payment.groupBy({
      by: ['partnerId'],
      where: { partner: { type: side }, type: voucherType, invoiceId: null },
      _sum: { amount: true },
    }),
  ])

  const unallocMap = new Map(unallocated.map((u) => [u.partnerId, u._sum.amount ?? 0]))

  // القاعدة الذهبية لترحيل الفترات: أرصدة الأطراف المدوّرة تعيش في سطر كل طرف ضمن سند
  // القيد الافتتاحي حصراً (فواتير الفترة المغلقة دُوّرت للأرشيف) — تظهر هنا في عمود
  // «مرحَّل» مستقلة عن فئات عمر الفواتير الحية: عمرها الحقيقي في الأرشيف ولا يُختلَق.
  // الرصيد المعاكس (سلفة/دفع مقدماً) يُعامل ائتماناً يُخمد من الأقدم أولاً.
  const openingMap = await getOpeningLinesByAccount(db)

  interface PartnerAcc {
    buckets: [number, number, number, number] // 0-30 / 31-60 / 61-90 / +90
    carried: number // رصيد مرحَّل من سند القيد الافتتاحي للفترة المقفلة — بلا عمر معروف
    invoicesCount: number
    oldestDays: number | null
    credit: number // دفعات غير مخصصة + دفع زائد + مرحَّل معاكس — يُخمد من الأقدم أولاً
  }
  const acc = new Map<string, PartnerAcc>()
  for (const p of partners) {
    const line = p.accountId ? openingMap.get(p.accountId) : undefined
    const carriedRaw = line ? (isCustomer ? line.debit - line.credit : line.credit - line.debit) : 0
    acc.set(p.id, {
      buckets: [0, 0, 0, 0],
      carried: carriedRaw > 0.005 ? round2(carriedRaw) : 0,
      invoicesCount: 0,
      oldestDays: null,
      credit: unallocMap.get(p.id) ?? 0,
    })
    if (carriedRaw < -0.005) {
      const a = acc.get(p.id)
      if (a) a.credit = round2(a.credit + -carriedRaw)
    }
  }
  for (const inv of invoices) {
    const a = acc.get(inv.partnerId)
    if (!a) continue
    a.invoicesCount += 1
    const remaining = round2(inv.total - inv.paid)
    const invYMD = inv.date.toISOString().slice(0, 10)
    const days = Math.floor((today.getTime() - dayStart(invYMD).getTime()) / 86_400_000)
    const age = days < 0 ? 0 : days // فاتورة مؤرخة مستقبلاً — تعامل كجديدة
    if (a.oldestDays === null || days > a.oldestDays) a.oldestDays = days
    if (remaining > 0) {
      const slot = age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3
      a.buckets[slot] += remaining
    } else if (remaining < 0) {
      a.credit += -remaining // دفع زائد على الفاتورة — ائتمان يُخمد كالدفعات غير المخصصة
    }
  }

  interface AgingPartnerRow {
    id: string
    code: string
    name: string
    phone: string | null
    carried: number
    b0_30: number
    b31_60: number
    b61_90: number
    b90plus: number
    total: number
    invoicesCount: number
    oldestDays: number | null
  }

  const rows: AgingPartnerRow[] = []
  for (const p of partners) {
    const a = acc.get(p.id)
    if (!a) continue
    // الخمد من الأقدم أولاً: المرحَّل (فترة مقفلة) ← +90 ← 61-90 ← 31-60 ← 0-30
    if (a.carried > 0.005 && a.credit > 0.005) {
      const takeCarried = Math.min(a.carried, a.credit)
      a.carried = round2(a.carried - takeCarried)
      a.credit = round2(a.credit - takeCarried)
    }
    for (let i = 3; i >= 0 && a.credit > 0.005; i--) {
      const take = Math.min(a.buckets[i], a.credit)
      a.buckets[i] = round2(a.buckets[i] - take)
      a.credit = round2(a.credit - take)
    }
    const total = round2(a.carried + a.buckets[0] + a.buckets[1] + a.buckets[2] + a.buckets[3])
    // حصر الأطراف المدينة (رصيد موجب) — مطابقة لمنطق customersDebt/suppliersDue في شاشة الأطراف
    if (total < 0.005) continue
    rows.push({
      id: p.id,
      code: p.code,
      name: p.name,
      phone: p.phone,
      carried: round2(a.carried),
      b0_30: round2(a.buckets[0]),
      b31_60: round2(a.buckets[1]),
      b61_90: round2(a.buckets[2]),
      b90plus: round2(a.buckets[3]),
      total,
      invoicesCount: a.invoicesCount,
      oldestDays: a.oldestDays,
    })
  }
  rows.sort((x, y) => y.total - x.total || x.code.localeCompare(y.code))

  const totals = {
    carried: round2(rows.reduce((s, r) => s + r.carried, 0)),
    b0_30: round2(rows.reduce((s, r) => s + r.b0_30, 0)),
    b31_60: round2(rows.reduce((s, r) => s + r.b31_60, 0)),
    b61_90: round2(rows.reduce((s, r) => s + r.b61_90, 0)),
    b90plus: round2(rows.reduce((s, r) => s + r.b90plus, 0)),
    total: round2(rows.reduce((s, r) => s + r.total, 0)),
  }

  return NextResponse.json({
    type: 'receivables-aging',
    side,
    asOf: new Date().toISOString(),
    rows,
    totals,
    kpis: {
      partnersCount: rows.length,
      overdue90: totals.b90plus,
      oldestDays: rows.reduce<number | null>(
        (m, r) => (r.oldestDays !== null && (m === null || r.oldestDays > m) ? r.oldestDays : m),
        null,
      ),
      topPartner: rows.length > 0 ? { code: rows[0].code, name: rows[0].name, total: rows[0].total } : null,
    },
  })
}

// ==================== 13) ربحية العملاء والمستودعات ====================
// نفس أساس ربحية الأصناف (بنود فواتير البيع ومردوداتها) لكن التجميع:
// by=customer ← حسب طرف الفاتورة — by=warehouse ← حسب مستودع كل بند (بنود الفاتورة قد تتوزع)

async function profitabilityReport(sp: URLSearchParams): Promise<NextResponse> {
  const by = sp.get('by') === 'warehouse' ? 'warehouse' : 'customer'
  const parsed = parsePeriod(sp)
  if ('message' in parsed) return badRequest(parsed.message)
  const { from, to } = parsed

  const invoices = await db.invoice.findMany({
    where: {
      isDeleted: false,
      type: { in: ['SALE', 'SALES_RETURN'] },
      date: { gte: dayStart(from), lte: dayEnd(to) },
    },
    select: {
      id: true,
      type: true,
      partner: { select: { id: true, code: true, name: true } },
      lines: {
        select: {
          itemId: true,
          warehouseId: true,
          quantity: true,
          total: true,
        },
      },
    },
  })

  const costMap = await lastPurchaseCostMap(invoices.flatMap((i) => i.lines.map((l) => l.itemId)))

  // أسماء وأكواد المستودعات المشاركة (وضع by=warehouse)
  const warehouseIds = [...new Set(invoices.flatMap((i) => i.lines.map((l) => l.warehouseId).filter(Boolean)))] as string[]
  const warehouses = warehouseIds.length > 0
    ? await db.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, code: true, name: true } })
    : []
  const whMap = new Map(warehouses.map((w) => [w.id, w]))

  interface EntityAcc {
    code: string
    name: string
    docs: Set<string>
    qty: number
    revenue: number
    cost: number
  }
  const acc = new Map<string, EntityAcc>()

  for (const inv of invoices) {
    const sign = inv.type === 'SALES_RETURN' ? -1 : 1
    for (const line of inv.lines) {
      const key = by === 'customer' ? inv.partner.id : line.warehouseId ?? 'none'
      const label =
        by === 'customer'
          ? { code: inv.partner.code, name: inv.partner.name }
          : line.warehouseId && whMap.has(line.warehouseId)
            ? { code: whMap.get(line.warehouseId)!.code, name: whMap.get(line.warehouseId)!.name }
            : { code: '—', name: 'غير محدد' }
      const cur = acc.get(key) ?? { code: label.code, name: label.name, docs: new Set<string>(), qty: 0, revenue: 0, cost: 0 }
      cur.docs.add(inv.id)
      cur.qty += sign * line.quantity
      cur.revenue += sign * line.total
      cur.cost += sign * line.quantity * (costMap.get(line.itemId) ?? 0)
      acc.set(key, cur)
    }
  }

  interface ProfitEntityRow {
    id: string
    code: string
    name: string
    docsCount: number
    qtySold: number
    revenue: number
    cost: number
    profit: number
    margin: number
    share: number
  }

  const rows: ProfitEntityRow[] = [...acc.entries()]
    .map(([id, a]) => {
      const revenue = round2(a.revenue)
      const cost = round2(a.cost)
      const profit = round2(revenue - cost)
      return {
        id,
        code: a.code,
        name: a.name,
        docsCount: a.docs.size,
        qtySold: round2(a.qty),
        revenue,
        cost,
        profit,
        margin: revenue !== 0 ? round2((profit / revenue) * 100) : 0,
        share: 0,
      }
    })
    .sort((x, y) => y.profit - x.profit || byCode(x, y))

  const totalRevenue = round2(rows.reduce((s, r) => s + r.revenue, 0))
  for (const r of rows) r.share = totalRevenue !== 0 ? round2((r.revenue / totalRevenue) * 100) : 0

  const totalCost = round2(rows.reduce((s, r) => s + r.cost, 0))
  const totalProfit = round2(rows.reduce((s, r) => s + r.profit, 0))

  return NextResponse.json({
    type: 'profitability',
    by,
    from,
    to,
    rows,
    kpis: {
      revenue: totalRevenue,
      cost: totalCost,
      profit: totalProfit,
      margin: totalRevenue !== 0 ? round2((totalProfit / totalRevenue) * 100) : 0,
      best: rows.length > 0 ? { code: rows[0].code, name: rows[0].name, profit: rows[0].profit } : null,
    },
  })
}

// ==================== 14) مقارنة الفترات ====================
// الفترة الحالية: from/to (الافتراضي أول الشهر الحالي حتى اليوم) والسابقة تلقائياً بنفس الطول
// (شهور تقويمية كاملة ← الشهور السابقة، جزئية ← نفس عدد الأيام السابقة مباشرة).
// المؤشرات التشغيلية من الفواتير والسندات، والمحاسبية من قيود POSTED بحسابات الإيراد/المصروف
// (نفس مصدر قائمة الدخل) — وكل صف يعرض الفرق ونسبة التغير.

async function periodComparisonReport(sp: URLSearchParams): Promise<NextResponse> {
  const today = todayYMD()
  const rawFrom = sp.get('from') ?? `${today.slice(0, 7)}-01`
  const rawTo = sp.get('to') ?? today
  if (!isValidYMD(rawFrom) || !isValidYMD(rawTo)) {
    return badRequest('صيغة التاريخ يجب أن تكون YYYY-MM-DD')
  }
  if (rawFrom > rawTo) return badRequest('تاريخ «من» يجب أن يكون قبلاً أو مساوياً لتاريخ «إلى»')
  const current = { from: rawFrom, to: rawTo }
  const previous = previousPeriodYMD(rawFrom, rawTo)

  interface PeriodMetrics {
    salesNet: number
    salesCount: number
    avgSale: number
    purchasesNet: number
    receipts: number
    payments: number
    accRevenue: number
    accExpense: number
    accProfit: number
  }

  const metricsOf = async (f: string, t: string): Promise<PeriodMetrics> => {
    const dateWhere = { gte: dayStart(f), lte: dayEnd(t) }
    const [invGroups, receipts, payments, equityLineEntries] = await Promise.all([
      db.invoice.groupBy({
        by: ['type'],
        where: {
          isDeleted: false,
          type: { in: ['SALE', 'SALES_RETURN', 'PURCHASE', 'PURCHASE_RETURN'] },
          date: dateWhere,
        },
        _sum: { total: true },
        _count: { _all: true },
      }),
      db.payment.aggregate({ where: { type: 'RECEIPT', date: dateWhere }, _sum: { amount: true } }),
      db.payment.aggregate({ where: { type: 'PAYMENT', date: dateWhere }, _sum: { amount: true } }),
      // تحديد قيود الإقفال/الافتتاحية في الفترة — وحدها تلمس حسابات حقوق الملكية
      db.journalEntryLine.findMany({
        where: { entry: { status: 'POSTED', date: dateWhere }, account: { type: 'EQUITY' } },
        select: { entryId: true },
      }),
    ])

    // الإيرادات والمصروفات من قيود POSTED بالفترة **باستثناء قيود الإقفال والافتتاحية**:
    // قيد الإقفال يوجّه نتيجة الفترة للأرباح المحتجزة فيعكس أرصدة الإيراد/المصروف،
    // وضمّه في المقارنة يصفّر الحركة التشغيلية للفترة الحية (وهو ما ظهر حياً بقيد
    // إقفال الفترة الأولى بتاريخه داخل سبتمبر) — الاستبعاد يظهر الحركة الفعلية.
    const excludedIds = [...new Set(equityLineEntries.map((l) => l.entryId))]
    const jeLines = await db.journalEntryLine.findMany({
      where: {
        entry: { status: 'POSTED', date: dateWhere },
        account: { type: { in: ['REVENUE', 'EXPENSE'] } },
        ...(excludedIds.length > 0 ? { entryId: { notIn: excludedIds } } : {}),
      },
      select: { debit: true, credit: true, account: { select: { type: true } } },
    })

    const sumOf = (t: string) => invGroups.find((g) => g.type === t)
    const saleTotal = sumOf('SALE')?._sum.total ?? 0
    const saleReturn = sumOf('SALES_RETURN')?._sum.total ?? 0
    const saleCount = sumOf('SALE')?._count._all ?? 0
    const purchTotal = sumOf('PURCHASE')?._sum.total ?? 0
    const purchReturn = sumOf('PURCHASE_RETURN')?._sum.total ?? 0

    let accRevenue = 0
    let accExpense = 0
    for (const l of jeLines) {
      if (l.account.type === 'REVENUE') accRevenue += l.credit - l.debit
      else accExpense += l.debit - l.credit
    }

    const salesNet = round2(saleTotal - saleReturn)
    return {
      salesNet,
      salesCount: saleCount,
      avgSale: saleCount > 0 ? round2(salesNet / saleCount) : 0,
      purchasesNet: round2(purchTotal - purchReturn),
      receipts: round2(receipts._sum.amount ?? 0),
      payments: round2(payments._sum.amount ?? 0),
      accRevenue: round2(accRevenue),
      accExpense: round2(accExpense),
      accProfit: round2(accRevenue - accExpense),
    }
  }

  const [cur, prev] = await Promise.all([
    metricsOf(current.from, current.to),
    metricsOf(previous.from, previous.to),
  ])

  interface CompareRow {
    label: string
    group: 'sales' | 'purchases' | 'cash' | 'pnl'
    kind: 'money' | 'count'
    current: number
    previous: number
    delta: number
    deltaPct: number | null
    goodWhen: 'up' | 'down' | 'neutral'
  }

  const rows: CompareRow[] = []
  const push = (
    label: string,
    group: CompareRow['group'],
    kind: CompareRow['kind'],
    c: number,
    p: number,
    goodWhen: CompareRow['goodWhen'],
  ) => {
    const delta = round2(c - p)
    rows.push({
      label,
      group,
      kind,
      current: round2(c),
      previous: round2(p),
      delta,
      deltaPct: p !== 0 ? round2((delta / Math.abs(p)) * 100) : null,
      goodWhen,
    })
  }

  push('صافي المبيعات', 'sales', 'money', cur.salesNet, prev.salesNet, 'up')
  push('عدد فواتير البيع', 'sales', 'count', cur.salesCount, prev.salesCount, 'up')
  push('متوسط قيمة فاتورة البيع', 'sales', 'money', cur.avgSale, prev.avgSale, 'up')
  push('صافي المشتريات', 'purchases', 'money', cur.purchasesNet, prev.purchasesNet, 'neutral')
  push('التحصيلات النقدية (سندات القبض)', 'cash', 'money', cur.receipts, prev.receipts, 'up')
  push('المدفوعات النقدية (سندات الدفع)', 'cash', 'money', cur.payments, prev.payments, 'neutral')
  push('الإيرادات المحاسبية', 'pnl', 'money', cur.accRevenue, prev.accRevenue, 'up')
  push('المصروفات المحاسبية', 'pnl', 'money', cur.accExpense, prev.accExpense, 'down')
  push('صافي الربح المحاسبي', 'pnl', 'money', cur.accProfit, prev.accProfit, 'up')

  const salesRow = rows[0]
  const profitRow = rows[rows.length - 1]
  const verdict = profitRow.delta > 0.005 ? 'up' : profitRow.delta < -0.005 ? 'down' : 'flat'

  return NextResponse.json({
    type: 'period-comparison',
    current,
    previous,
    rows,
    kpis: {
      salesDelta: salesRow.delta,
      salesDeltaPct: salesRow.deltaPct,
      profitDelta: profitRow.delta,
      profitDeltaPct: profitRow.deltaPct,
      verdict,
    },
  })
}

// ==================== 15) دوران المخزون والأصناف الراكدة ====================
// لكل صنف نشط: المبيع خلال الفترة وتكلفتها (المصدر المحاسبي نفسه) ومتوسط المخزون
// (بإعادة تشغيل حركات الفترة على الرصيد الحالي: الرصيد عند «إلى» = الحالي − ما بعده،
// وعند «من» = سالبه ناقص حركات الفترة) فمعدل الدوران = التكلفة ÷ متوسط قيمة المخزون،
// وأيام التغطية = أيام الفترة ÷ معدل الدوران. الركود بأيام منذ آخر فاتورة بيع (تاريخياً)،
// والصنف الذي لم يُبع قط وله رصيد راكد بالتعريف — بقيمة رأس مال معطل.

async function inventoryTurnoverReport(sp: URLSearchParams): Promise<NextResponse> {
  const parsed = parsePeriod(sp)
  if ('message' in parsed) return badRequest(parsed.message)
  const { from, to } = parsed
  const warehouseId = sp.get('warehouseId') || null
  const stagnantThreshold = Math.max(7, Math.min(365, Number(sp.get('stagnantDays')) || 60))

  let warehouseName: string | null = null
  if (warehouseId) {
    const w = await db.warehouse.findUnique({ where: { id: warehouseId }, select: { name: true } })
    if (!w) return notFound('المستودع المحدد غير موجود')
    warehouseName = w.name
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const periodDays = daysBetweenYMD(from, to)
  const moveWhere = warehouseId ? { warehouseId } : {}

  const [items, balances, saleLines, lastSaleLines, movesAfter, movesIn] = await Promise.all([
    db.item.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, purchasePrice: true },
      orderBy: { code: 'asc' },
    }),
    db.itemBalance.findMany({
      where: moveWhere,
      select: { itemId: true, quantity: true },
    }),
    db.invoiceLine.findMany({
      where: {
        invoice: { isDeleted: false, type: { in: ['SALE', 'SALES_RETURN'] }, date: { gte: dayStart(from), lte: dayEnd(to) } },
        ...(warehouseId ? { warehouseId } : {}),
      },
      select: { itemId: true, quantity: true, invoice: { select: { type: true } } },
    }),
    db.invoiceLine.findMany({
      where: { invoice: { isDeleted: false, type: 'SALE' } },
      select: { itemId: true, invoice: { select: { date: true } } },
      orderBy: [{ invoice: { date: 'desc' } }, { id: 'desc' }],
    }),
    db.stockMovement.findMany({
      where: { date: { gt: dayEnd(to) }, ...moveWhere },
      select: { itemId: true, type: true, quantity: true },
    }),
    db.stockMovement.findMany({
      where: { date: { gte: dayStart(from), lte: dayEnd(to) }, ...moveWhere },
      select: { itemId: true, type: true, quantity: true },
    }),
  ])

  const costMap = await lastPurchaseCostMap(items.map((i) => i.id))

  const balMap = new Map<string, number>()
  for (const b of balances) balMap.set(b.itemId, (balMap.get(b.itemId) ?? 0) + b.quantity)

  // صافي الحركات (IN موجب / OUT سالب) بعد «إلى» وخلال الفترة — لإعادة تشغيل الأرصدة
  const sumSigned = (list: { itemId: string; type: string; quantity: number }[]): Map<string, number> => {
    const m = new Map<string, number>()
    for (const mv of list) {
      m.set(mv.itemId, (m.get(mv.itemId) ?? 0) + (mv.type === 'OUT' ? -mv.quantity : mv.quantity))
    }
    return m
  }
  const afterMap = sumSigned(movesAfter)
  const inMap = sumSigned(movesIn)

  // الكميات المباعة صافية المردودات وتكلفتها خلال الفترة
  const soldQty = new Map<string, number>()
  const soldCogs = new Map<string, number>()
  for (const ln of saleLines) {
    const sign = ln.invoice.type === 'SALES_RETURN' ? -1 : 1
    soldQty.set(ln.itemId, (soldQty.get(ln.itemId) ?? 0) + sign * ln.quantity)
    soldCogs.set(ln.itemId, (soldCogs.get(ln.itemId) ?? 0) + sign * ln.quantity * (costMap.get(ln.itemId) ?? 0))
  }

  // آخر بيع تاريخياً (أول ظهور في قائمة مرتبة بالأحدث) — YMD
  const lastSale = new Map<string, string>()
  for (const ln of lastSaleLines) {
    if (!lastSale.has(ln.itemId)) lastSale.set(ln.itemId, ln.invoice.date.toISOString().slice(0, 10))
  }

  interface TurnoverRow {
    id: string
    code: string
    name: string
    qtySold: number
    cogs: number
    openingQty: number
    closingQty: number
    avgInventoryValue: number
    turnover: number | null
    daysOnHand: number | null
    currentQty: number
    stockValue: number
    lastSaleDate: string | null
    stagnantDays: number | null
    isStagnant: boolean
  }

  const rows: TurnoverRow[] = items.map((item) => {
    // تقييم المخزون بمصدر التكلفة الموحد نفسه (آخر سعر شراء فعلي) وسقوطاً لسعر البطاقة —
    // بطاقات بلا سعر مخزن (صفر) تُقيّم بسعر شرائها الفعلي من فواتير الشراء
    const unitValuation = costMap.get(item.id) ?? item.purchasePrice
    const currentQty = balMap.get(item.id) ?? 0
    const closingQty = currentQty - (afterMap.get(item.id) ?? 0)
    const openingQty = closingQty - (inMap.get(item.id) ?? 0)
    const avgQty = (openingQty + closingQty) / 2
    const avgInventoryValue = round2(Math.max(0, avgQty) * unitValuation)
    const cogs = round2(soldCogs.get(item.id) ?? 0)
    const turnover = avgInventoryValue > 0.005 && cogs > 0 ? round2(cogs / avgInventoryValue) : null
    const daysOnHand =
      turnover !== null && turnover > 0 ? Math.round(periodDays / turnover) : null
    const lastSaleDate = lastSale.get(item.id) ?? null
    const stagnantDays = lastSaleDate
      ? Math.floor((today.getTime() - dayStart(lastSaleDate).getTime()) / 86_400_000)
      : null
    const stockValue = round2(currentQty * unitValuation)
    const isStagnant =
      (stagnantDays === null && currentQty > 0.005) || (stagnantDays !== null && stagnantDays >= stagnantThreshold)
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      qtySold: round2(soldQty.get(item.id) ?? 0),
      cogs,
      openingQty: round2(openingQty),
      closingQty: round2(closingQty),
      avgInventoryValue,
      turnover,
      daysOnHand,
      currentQty: round2(currentQty),
      stockValue,
      lastSaleDate,
      stagnantDays,
      isStagnant,
    }
  })

  // الراكدة أولاً (لم يُبع قط ← راكد بأطول مدة) ثم بقيمة رأس المال المعلق، ثم الأبطأ دوراناً
  const rank = (r: TurnoverRow): number => (r.isStagnant ? (r.lastSaleDate === null ? 2 : 1) : 0)
  rows.sort((x, y) => {
    const rx = rank(x)
    const ry = rank(y)
    if (rx !== ry) return ry - rx
    if (rx > 0) return y.stockValue - x.stockValue || byCode(x, y)
    const tx = x.turnover ?? Number.POSITIVE_INFINITY
    const ty = y.turnover ?? Number.POSITIVE_INFINITY
    return tx - ty || byCode(x, y)
  })

  const stagnantRows = rows.filter((r) => r.isStagnant)
  const sumAvgValue = rows.reduce((s, r) => s + Math.max(0, r.avgInventoryValue), 0)
  const totalCogs = round2(rows.reduce((s, r) => s + r.cogs, 0))

  return NextResponse.json({
    type: 'inventory-turnover',
    from,
    to,
    stagnantDays: stagnantThreshold,
    warehouse: warehouseId && warehouseName ? { id: warehouseId, name: warehouseName } : null,
    rows,
    totals: {
      qtySold: round2(rows.reduce((s, r) => s + r.qtySold, 0)),
      cogs: totalCogs,
      stockValue: round2(rows.reduce((s, r) => s + r.stockValue, 0)),
    },
    kpis: {
      itemsCount: rows.length,
      stagnantCount: stagnantRows.length,
      stagnantValue: round2(stagnantRows.reduce((s, r) => s + r.stockValue, 0)),
      avgTurnover: sumAvgValue > 0.005 && totalCogs > 0 ? round2(totalCogs / sumAvgValue) : null,
      topStagnant:
        stagnantRows.length > 0
          ? { code: stagnantRows[0].code, name: stagnantRows[0].name, stockValue: stagnantRows[0].stockValue }
          : null,
    },
  })
}

// ==================== GET /api/reports ====================
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams

    // ===== تحقق صارم من النوع =====
    const typeParam = sp.get('type')
    if (!typeParam || !(REPORT_TYPES as readonly string[]).includes(typeParam)) {
      return badRequest(
        `نوع التقرير مطلوب ويجب أن يكون واحداً من: ${REPORT_TYPES.join('، ')}`,
      )
    }
    const type = typeParam as ReportType

    switch (type) {
      case 'trial-balance':
      case 'income-statement':
      case 'balance-sheet':
        return await financialReport(type, sp)
      case 'monthly-pnl':
        return await monthlyPnlReport(sp)
      case 'inventory':
        return await inventoryReport(sp)
      case 'sales':
      case 'purchases':
        return await invoicesReport(type, sp)
      case 'partner-statement':
        return await partnerStatementReport(sp)
      case 'treasury':
        return await treasuryReport(sp)
      case 'expenses':
        return await expensesReport(sp)
      case 'item-profitability':
        return await itemProfitabilityReport(sp)
      case 'receivables-aging':
        return await receivablesAgingReport(sp)
      case 'profitability':
        return await profitabilityReport(sp)
      case 'period-comparison':
        return await periodComparisonReport(sp)
      case 'inventory-turnover':
        return await inventoryTurnoverReport(sp)
    }
  } catch (error) {
    console.error('GET /api/reports error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء توليد التقرير' }, { status: 500 })
  }
}
