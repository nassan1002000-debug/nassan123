// أنواع سندات المقاصة المشتركة بين الشاشة والنوافذ (Task 101)

export interface ClearingRoleRow {
  kind: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE'
  label: string // عميل / مورد / موظف
  refId: string
  refCode: string
  refName: string
  accountId: string
  accountCode: string
  accountName: string
  /** رصيد موقّع بمصطلحات مدين: موجب = عليه (مدين لنا) — سالب = له (دائن) */
  balance: number
}

export interface ClearingSuggestionRow {
  debitAccountId: string
  debitAccountCode: string
  debitAccountName: string
  creditAccountId: string
  creditAccountCode: string
  creditAccountName: string
  amount: number
}

export interface ClearingPersonRow {
  key: string
  name: string
  roles: ClearingRoleRow[]
  suggestions: ClearingSuggestionRow[]
}

export interface ClearingLineRow {
  accountCode: string
  accountName: string
  debit: number
  credit: number
  description: string | null
}

export interface ClearingVoucherRow {
  id: string
  number: string
  date: string
  description: string
  status: string // POSTED | CANCELLED
  total: number
  lines: ClearingLineRow[]
}

export interface ClearingTotals {
  count: number
  sum: number
  thisMonth: number
}

/** زوج مقاصة قابل للتحرير داخل نموذج الإنشاء */
export interface EditablePair {
  debitAccountId: string
  creditAccountId: string
  amount: string
}
