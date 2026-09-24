// أنواع «الطرف الموحد» — مشتركة بين الخادم والواجهة (بلا أي اعتماديات خادمية)
// ---------------------------------------------------------------------------------
// الطرف الموحد: شخص واحد يجمع أكثر من دور في منظومة الحسابات — شريك في رأس المال
// وعميل ومورد وموظف — وله حسابات متفرقة في الشجرة (310001 + 113007 مثلاً).
// هذا الملف عرف الأنواع فقط — منطق الخادم في unified-party-server.ts

export type UnifiedRoleKind = 'PARTNER' | 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE'

/** دور واحد داخل مجموعة الطرف الموحد */
export interface UnifiedRole {
  kind: UnifiedRoleKind
  label: string
  fileCode: string
  fileId: string
  fileActive: boolean
  accountId: string | null
  accountCode: string | null
  accountName: string | null
}

/** مدخل فهرس الأطراف الموحدة — الأشخاص ذوو الأدوار المتعددة (شخصان فأكثر = دوران فأكثر) */
export interface UnifiedPersonSummary {
  id: string // مفتاح الاسم المطبّع
  name: string // أطول صيغة اسم معروفة للشخص
  roles: UnifiedRole[]
  accountIds: string[]
  multiRole: boolean
}

/** بطاقة رصيد دور — موقّع بمصطلحات مدين: موجب = مدين لنا، سالب = دائن له */
export interface UnifiedRoleBalance {
  kind: UnifiedRoleKind
  label: string
  fileCode: string
  accountId: string | null
  accountCode: string | null
  accountName: string | null
  balance: number
}

/** سطر في كشف الحركة الموحد — مستندات الشخص كلها بغض النظر عن حسابها في الشجرة */
export interface UnifiedDocRow {
  date: string
  docType: string
  number: string
  description: string
  debit: number
  credit: number
  roleLabel: string
  fileCode: string
  accountCode: string | null
  /** الرصيد التراكمي الموحد عند هذه الحركة زمنياً (يجمع كل الأدوار) — مدين-موجب */
  balance: number
  balanceDirection: 'DEBIT' | 'CREDIT' | 'ZERO'
}

/** فاتورة ضمن الكشف الموحد — مع شارات السلة والولاء */
export interface UnifiedInvoiceRow {
  id: string
  number: string
  type: string
  typeLabel: string
  date: string
  total: number
  paid: number
  status: string
  partnerCode: string
  hasBundle: boolean
  bundleNames: string[]
  loyaltyPointsRedeemed: number
  loyaltyPointsEarned: number
}

/** ملخص نقاط الولاء لملف عميل ضمن المجموعة */
export interface UnifiedLoyaltySummary {
  fileCode: string
  customerName: string
  balance: number
  movements: number
  lastDate: string | null
}

/** سلفة موظف ضمن المجموعة */
export interface UnifiedAdvanceRow {
  date: string
  amount: number
  status: string
  reason: string | null
}

/** الكشف الموحد الكامل */
export interface UnifiedStatement {
  person: {
    name: string
    multiRole: boolean
    roles: UnifiedRoleBalance[]
    /** محصلة الحساب الموحدة — الصافي النهائي التراكمي لجميع أدوار الشخص معاً (موقّع، مدين-موجب — نفس مصطلح UnifiedRoleBalance.balance) */
    combinedBalance: number
  }
  docs: UnifiedDocRow[]
  totals: { debit: number; credit: number; count: number }
  invoices: UnifiedInvoiceRow[]
  invoicesTotals: { count: number; total: number; paid: number }
  hr: {
    isEmployee: boolean
    salaries: { count: number; totalPaid: number }
    advances: UnifiedAdvanceRow[]
  }
  loyalty: UnifiedLoyaltySummary[]
}
