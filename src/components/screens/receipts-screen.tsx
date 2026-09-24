'use client'

// شاشة سندات القبض — غلاف فوق المكوّن المشترك بنوع RECEIPT

import { VouchersScreen } from './vouchers/vouchers-screen'

export default function ReceiptsScreen() {
  return <VouchersScreen type="RECEIPT" />
}
