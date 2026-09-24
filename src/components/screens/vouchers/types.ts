// أنواع مشتركة لشاشات السندات (قبض/دفع)

export interface VoucherRow {
  id: string
  number: string
  type: string
  date: string
  amount: number
  method: string
  notes: string | null
  partner: { code: string; name: string; type: string } | null
  // سندات على حساب من الدليل: مصروف (Task 102) أو حساب موظف شخصي (Task 104)
  account: { code: string; name: string; isEmployee: boolean } | null
  invoiceNumber: string | null
}

export interface VoucherTotals {
  sum: number
  count: number
  avg: number
  thisMonth: number
}
