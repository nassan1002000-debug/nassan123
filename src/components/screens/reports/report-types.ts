// أنواع استجابات /api/reports — التقارير الإضافية (مطابقة للخادم حرفياً)
// التقارير المالية الثلاثة (trial-balance/income-statement/balance-sheet)
// معرّفة داخل financial-views.tsx لأنها خاصية عرضها

// ---- أرباح وخسائر شهرية ----
export interface MonthlyPnlMonth {
  month: string // 'YYYY-MM'
  revenue: number
  expenses: number
  profit: number
}

export interface MonthHighlight {
  month: string
  profit: number
}

export interface MonthlyPnlResponse {
  type: 'monthly-pnl'
  year: number
  months: MonthlyPnlMonth[]
  totals: { revenue: number; expenses: number; profit: number }
  bestMonth: MonthHighlight | null
  worstMonth: MonthHighlight | null
}

// ---- المخزون ----
export interface InventoryRow {
  code: string
  name: string
  unit: string | null
  quantity: number
  purchasePrice: number
  stockValue: number
  saleValue: number
  minStock: number
  underMin: boolean
}

export interface InventoryResponse {
  type: 'inventory'
  warehouse: { id: string; name: string } | null
  rows: InventoryRow[]
  kpis: { itemsCount: number; stockValueCost: number; stockValueSale: number; underMinCount: number }
  totals: { stockValueCost: number; stockValueSale: number }
}

// ---- المبيعات / المشتريات ----
export interface InvoiceReportRow {
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

export interface InvoiceReportStats {
  invoicesCount: number
  invoicesTotal: number
  returnsCount: number
  returnsTotal: number
  net: number
  taxTotal: number
  discountTotal: number
  avgInvoice: number
}

export interface SalesPurchasesResponse {
  type: 'sales' | 'purchases'
  from: string
  to: string
  rows: InvoiceReportRow[]
  stats: InvoiceReportStats
}

// ---- كشف حساب طرف ----
export interface StatementPartner {
  id: string
  code: string
  name: string
  type: string
  phone: string | null
}

export interface PartnerStatementRow {
  date: string // ISO
  docType: string
  number: string
  description: string
  debit: number
  credit: number
  balance: number
}

export interface PartnerStatementResponse {
  type: 'partner-statement'
  partner: StatementPartner
  from: string | null
  to: string | null
  opening: number
  rows: PartnerStatementRow[]
  totals: { debit: number; credit: number; closing: number }
  count: number
}

// ---- تقرير الصندوق ----
export interface TreasuryRow {
  number: string
  type: string
  date: string // ISO
  partnerName: string | null
  method: string
  notes: string | null
  incoming: number
  outgoing: number
  balance: number
}

export interface TreasuryResponse {
  type: 'treasury'
  from: string
  to: string
  opening: number
  rows: TreasuryRow[]
  totals: { incoming: number; outgoing: number; net: number }
  closing: number
  byMethod: { method: string; incoming: number; outgoing: number }[]
}

// ---- المصروفات ----
export interface ExpenseCategoryRow {
  code: string
  name: string
  total: number
  entriesCount: number
  share: number
}

export interface ExpenseDetailRow {
  date: string // ISO
  entryNumber: string
  accountName: string
  description: string
  amount: number
}

export interface ExpensesResponse {
  type: 'expenses'
  from: string
  to: string
  rows: ExpenseCategoryRow[]
  totals: { total: number }
  details: ExpenseDetailRow[]
  kpis: { total: number; entriesCount: number; topCategory: string | null; avgEntry: number }
}

// ---- ربحية الأصناف ----
export interface ItemProfitRow {
  code: string
  name: string
  qtySold: number
  revenue: number
  cost: number
  profit: number
  margin: number
}

export interface ItemProfitabilityResponse {
  type: 'item-profitability'
  from: string
  to: string
  rows: ItemProfitRow[]
  kpis: {
    revenue: number
    cost: number
    profit: number
    bestItem: { code: string; name: string; profit: number } | null
  }
}

// ---- ربحية العملاء / المستودعات ----
export interface ProfitEntityRow {
  id: string
  code: string
  name: string
  docsCount: number
  qtySold: number
  revenue: number
  cost: number
  profit: number
  margin: number
  /** الحصة من إجمالي الإيراد % */
  share: number
}

export interface ProfitabilityResponse {
  type: 'profitability'
  by: 'customer' | 'warehouse'
  from: string
  to: string
  rows: ProfitEntityRow[]
  kpis: {
    revenue: number
    cost: number
    profit: number
    margin: number
    best: { code: string; name: string; profit: number } | null
  }
}

// ---- مقارنة الفترات ----
export interface CompareRow {
  label: string
  group: 'sales' | 'purchases' | 'cash' | 'pnl'
  kind: 'money' | 'count'
  current: number
  previous: number
  delta: number
  deltaPct: number | null
  /** اتجاه الجودة — «up» الزيادة فيه حسنة، «down» النقصان فيها حسن، «neutral» محايد */
  goodWhen: 'up' | 'down' | 'neutral'
}

export interface PeriodComparisonResponse {
  type: 'period-comparison'
  current: { from: string; to: string }
  previous: { from: string; to: string }
  rows: CompareRow[]
  kpis: {
    salesDelta: number
    salesDeltaPct: number | null
    profitDelta: number
    profitDeltaPct: number | null
    verdict: 'up' | 'down' | 'flat'
  }
}

// ---- دوران المخزون والأصناف الراكدة ----
export interface TurnoverRow {
  id: string
  code: string
  name: string
  qtySold: number
  cogs: number
  openingQty: number
  closingQty: number
  avgInventoryValue: number
  /** معدل الدوران = التكلفة ÷ متوسط قيمة المخزون (null إن لم يوجد مخزون أو مبيعات) */
  turnover: number | null
  /** أيام التغطية = أيام الفترة ÷ معدل الدوران */
  daysOnHand: number | null
  currentQty: number
  stockValue: number
  /** تاريخ آخر فاتورة بيع تاريخياً (كل الأزمنة) — null لم يُبع قط */
  lastSaleDate: string | null
  stagnantDays: number | null
  isStagnant: boolean
}

export interface InventoryTurnoverResponse {
  type: 'inventory-turnover'
  from: string
  to: string
  stagnantDays: number
  warehouse: { id: string; name: string } | null
  rows: TurnoverRow[]
  totals: { qtySold: number; cogs: number; stockValue: number }
  kpis: {
    itemsCount: number
    stagnantCount: number
    stagnantValue: number
    avgTurnover: number | null
    topStagnant: { code: string; name: string; stockValue: number } | null
  }
}

// ---- أعمار الذمم ----
export interface AgingPartnerRow {
  id: string
  code: string
  name: string
  phone: string | null
  /** رصيد مرحّل من سند القيد الافتتاحي للفترة المقفلة — عمره الحقيقي في الأرشيف */
  carried: number
  b0_30: number
  b31_60: number
  b61_90: number
  b90plus: number
  total: number
  invoicesCount: number
  oldestDays: number | null
}

export interface ReceivablesAgingResponse {
  type: 'receivables-aging'
  side: 'CUSTOMER' | 'SUPPLIER'
  asOf: string
  rows: AgingPartnerRow[]
  totals: { carried: number; b0_30: number; b31_60: number; b61_90: number; b90plus: number; total: number }
  kpis: {
    partnersCount: number
    overdue90: number
    oldestDays: number | null
    topPartner: { code: string; name: string; total: number } | null
  }
}
