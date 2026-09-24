// أنواع شاشة الفواتير — مبيعات/مردود بيع/مشتريات/مردود شراء

export type InvoiceKind = 'SALE' | 'SALES_RETURN' | 'PURCHASE' | 'PURCHASE_RETURN'

export interface InvoicePartnerLite {
  code: string
  name: string
  type: string
}

export interface InvoiceRow {
  id: string
  number: string
  type: InvoiceKind
  date: string
  partner: InvoicePartnerLite | null
  /** مركز التكلفة المختار — يُنسب إليه القيد المحاسبي التلقائي */
  costCenter?: { code: string; name: string } | null
  subtotal: number
  discount: number
  taxRate: number
  tax: number
  total: number
  paid: number
  status: string
  notes: string | null
  linesCount: number
  /** صف شبحي — فاتورة محذوفة رقمها محجوز بلاحقة xx (يُعرض باهتاً بلا إجراءات) */
  isGhost?: boolean
  /** وسوم إلكترونية دائمة: تحمل الفاتورة بنود سلة عروض؟ */
  hasBundle?: boolean
  /** أسماء السلال المنزلة منها البنود — لقطة لكل بند */
  bundleNames?: string[]
  /** نقاط الولاء — الاسترداد كحسم داخل الفاتورة والمنح الآلي عليها */
  loyaltyPointsRedeemed?: number
  loyaltyPointsEarned?: number
}

export interface InvoiceStats {
  count: number
  total: number
  paid: number
  remaining: number
}

export interface InvoiceLineDetail {
  id: string
  itemId: string
  itemCode: string
  itemName: string
  warehouseId: string | null
  warehouseName: string | null
  unitName: string | null
  unitFactor: number
  quantity: number
  unitPrice: number
  total: number
  /** سلة العروض التي نزل هذا البند منها تلقائياً — لقطة محفوظة مع الفاتورة (null للبنود اليدوية) */
  bundleId: string | null
  bundleName: string | null
  /** نصيب هذا السطر من حسم السلة المحسوب خادمياً */
  bundleDiscount: number
  /** عدد السلال الذي يغطيه هذا السطر — العرض المجمل يقسم عليه (Task 36) */
  bundleQty: number
  /** هل كانت هذه المادة هدية السلة — لقطة للملحق المطبوع (Task 36) */
  bundleGift: boolean
}

export interface InvoicePaymentDetail {
  id: string
  number: string
  date: string
  amount: number
  method: string
  notes: string | null
}

/** القيد المحاسبي التلقائي المرتبط بالفاتورة */
export interface InvoiceJournalDetail {
  id: string
  number: string
  date: string
  description: string
  source: string
  totalDebit: number
  totalCredit: number
  lines: {
    id: string
    accountCode: string
    accountName: string
    costCenterName?: string | null
    debit: number
    credit: number
    description: string | null
  }[]
}

export interface InvoiceDetail {
  id: string
  number: string
  type: InvoiceKind
  date: string
  partner: {
    id: string
    code: string
    name: string
    type: string
    phone: string | null
    address: string | null
  }
  /** مركز التكلفة المختار — null إن لم يُختر */
  costCenter: { id: string; code: string; name: string } | null
  subtotal: number
  discount: number
  taxRate: number
  tax: number
  total: number
  paid: number
  status: string
  notes: string | null
  /** نقاط الولاء — لقطة أثر الفاتورة على نقاط العميل (الاسترداد كحسم) */
  loyaltyPointsEarned?: number
  loyaltyPointsRedeemed?: number
  loyaltyRedeemValue?: number
  lines: InvoiceLineDetail[]
  payments: InvoicePaymentDetail[]
  journal: InvoiceJournalDetail | null
}

/** المادة كما تصل من /api/items — مع الأرصدة والوحدات لسلوك الملء التلقائي */
export interface InvoiceItem {
  id: string
  code: string
  name: string
  barcode: string | null
  purchasePrice: number
  salePrice: number
  primaryImageUrl: string | null
  warehouseId: string | null
  warehouseName: string | null
  isActive: boolean
  units: { name: string; factor: number }[]
  balances: { warehouseId: string; quantity: number }[]
}

/** القسم النهائي (آخر مستوى) — هدف البند المخزني */
export interface LeafWarehouse {
  id: string
  code: string
  name: string
}

export interface PartnerOption {
  id: string
  code: string
  name: string
  type: string
  phone: string | null
  isActive: boolean
}

/** رصيد المادة في قسم معيّن (0 إن لم يوجد) */
export function balanceOf(item: InvoiceItem | null, warehouseId: string | null): number {
  if (!item || !warehouseId) return 0
  return item.balances.find((b) => b.warehouseId === warehouseId)?.quantity ?? 0
}
