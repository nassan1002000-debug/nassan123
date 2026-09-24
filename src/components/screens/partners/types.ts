// أنواع شاشة العملاء والموردين

export interface PartnerStats {
  invoicesCount: number
  invoicesTotal: number
  invoicesPaid: number
  vouchersCount: number
  vouchersTotal: number
  /** الفواتير − المسدد ضمنها − السندات المستقلة (غير المرتبطة بفاتورة) */
  balance: number
}

export interface PartnerRow {
  id: string
  code: string
  name: string
  type: string // CUSTOMER | SUPPLIER
  phone: string | null
  address: string | null
  notes: string | null
  isActive: boolean
  createdAt: string
  /** رابط واتساب جاهز من رقم الهاتف — null إن كان الهاتف غائباً أو غير منطقي */
  whatsappUrl?: string | null
  /** تعدد الأدوار — كود الحساب المرتبط في الشجرة (إن وُجد) */
  accountCode?: string | null
  /** معرف الحساب المرتبط — لفتح كشف مستندات الطرف الموحد */
  accountId?: string | null
  stats: PartnerStats
}

export interface PartnerListStats {
  customersCount: number
  suppliersCount: number
  customersDebt: number
  suppliersDue: number
}

export interface PartnerDetail {
  partner: PartnerRow
  stats: PartnerStats
  invoices: Array<{
    id: string
    number: string
    date: string
    total: number
    paid: number
    status: string
  }>
  vouchers: Array<{
    id: string
    number: string
    date: string
    amount: number
    method: string
    notes: string | null
    invoice: { number: string } | null
  }>
}
