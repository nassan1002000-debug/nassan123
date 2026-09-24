'use client'

// شاشة سندات الدفع — غلاف فوق المكوّن المشترك بنوع PAYMENT

import { VouchersScreen } from './vouchers/vouchers-screen'

export default function PaymentsScreen() {
  return <VouchersScreen type="PAYMENT" />
}
