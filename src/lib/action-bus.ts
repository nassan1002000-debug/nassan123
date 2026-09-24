'use client'

// Task 40 — ناقل الأحداث المركزي (Action Bus)
// جسر zustand صغير يربط منظومة الاختصارات والبحث المركزي بالشاشات والنوافذ:
//  - فتح البحث المركزي (Ctrl+K) ونافذة دليل الاختصارات (F1/Alt+H)
//  - إشارات فتح نموذج فاتورة مبيعات (Alt+I) أو سند قبض/دفع (Alt+V / Alt+P) — نمط «إشارة تُستهلك»
//    حتى لا تُطلق النافذة تلقائياً عند عودة المستخدم للشاشة لاحقاً بلا سبب
//  - فتح بطاقة مادة/طرف مباشرة من نتائج البحث المركزي (روابط عميقة)
//  - سجل «المستند النشط» المفتوح حالياً (نموذج فاتورة/سند أو بطاقة عرض) ليقرر مستمع
//    لوحة المفاتيح إلى أين تذهب Ctrl+S/F8 و Ctrl+P/F9 و Esc

import { create } from 'zustand'
import { useNav, type ScreenId } from '@/lib/store'

/** أنواع المستندات التي يمكن أن تكون مفتوحة أمام المستخدم الآن */
export type ActiveDocKind = 'invoice-form' | 'voucher-form' | 'invoice-view' | 'voucher-view'

export interface ActiveDoc {
  kind: ActiveDocKind
  /** عنوان قصير يظهر في التوستات — مثل «فاتورة مبيعات جديدة» */
  label?: string
}

/** إشارة فتح نموذج فاتورة جديدة — tab يحدد عائلة الفاتورة (المطلوب: مبيعات SALE) */
export interface InvoiceFormSignal {
  seq: number
  tab: 'SALE' | 'PURCHASE' | 'SALES_RETURN' | 'PURCHASE_RETURN'
}

/** إشارة فتح نموذج سند جديد */
export interface VoucherFormSignal {
  seq: number
  type: 'RECEIPT' | 'PAYMENT'
}

/** إشارة فتح بطاقة مادة من نتائج البحث — الكائن كما ورد من /api/items بنفس شكل ItemDTO */
export interface PendingItemSignal {
  seq: number
  // شكل ItemDTO دون استيراد مكوّن الواجهة هنا (طبقة lib مستقلة عن الشاشات)
  item: Record<string, unknown>
}

/** Task 46 — إشارة فتح تقرير محدد من نتائج البحث المركزي (مفتاح بطاقة في مركز التقارير) */
export interface PendingReportSignal {
  seq: number
  /** مفتاح التقرير من ReportKey — نصاً لإبقاء طبقة lib مستقلة عن شاشات التقارير */
  key: string
}

interface ActionBusState {
  // ===== البحث المركزي ودليل الاختصارات =====
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
  helpOpen: boolean
  setHelpOpen: (open: boolean) => void

  // ===== إشارات فتح النماذج =====
  invoiceFormSignal: InvoiceFormSignal | null
  requestInvoiceForm: (tab?: InvoiceFormSignal['tab']) => void
  consumeInvoiceFormSignal: () => void

  voucherFormSignal: VoucherFormSignal | null
  requestVoucherForm: (type: VoucherFormSignal['type']) => void
  consumeVoucherFormSignal: () => void

  // ===== روابط عميقة من البحث المركزي =====
  pendingItemSignal: PendingItemSignal | null
  requestItemProfile: (item: Record<string, unknown>) => void
  consumeItemProfileSignal: () => void

  /** معرف الطرف المطلوب فتح بطاقته — يُستهلك من شاشة العملاء والموردين */
  pendingPartnerId: string | null
  requestPartnerProfile: (id: string) => void
  consumePartnerProfileSignal: () => void

  /** Task 46 — مفتاح التقرير المطلوب فتحه مباشرة في مركز التقارير من نتائج البحث */
  pendingReportSignal: PendingReportSignal | null
  requestReport: (key: string) => void
  consumeReportSignal: () => void

  // ===== سجل المستند النشط =====
  activeDoc: ActiveDoc | null
  setActiveDoc: (doc: ActiveDoc | null) => void

  // ===== تنقل مختصر (يستخدمه مستمع الاختصارات) =====
  navigateTo: (screen: ScreenId) => void
}

let seqCounter = 0
const nextSeq = () => ++seqCounter

export const useActionBus = create<ActionBusState>((set) => ({
  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  helpOpen: false,
  setHelpOpen: (helpOpen) => set({ helpOpen }),

  invoiceFormSignal: null,
  requestInvoiceForm: (tab = 'SALE') => set({ invoiceFormSignal: { seq: nextSeq(), tab } }),
  consumeInvoiceFormSignal: () => set({ invoiceFormSignal: null }),

  voucherFormSignal: null,
  requestVoucherForm: (type) => set({ voucherFormSignal: { seq: nextSeq(), type } }),
  consumeVoucherFormSignal: () => set({ voucherFormSignal: null }),

  pendingItemSignal: null,
  requestItemProfile: (item) => set({ pendingItemSignal: { seq: nextSeq(), item } }),
  consumeItemProfileSignal: () => set({ pendingItemSignal: null }),

  pendingPartnerId: null,
  requestPartnerProfile: (pendingPartnerId) => set({ pendingPartnerId }),
  consumePartnerProfileSignal: () => set({ pendingPartnerId: null }),

  pendingReportSignal: null,
  requestReport: (key) => set({ pendingReportSignal: { seq: nextSeq(), key } }),
  consumeReportSignal: () => set({ pendingReportSignal: null }),

  activeDoc: null,
  setActiveDoc: (activeDoc) => set({ activeDoc }),

  navigateTo: (screen) => {
    useNav.getState().navigate(screen)
  },
}))

/** أحداث النوافذ المفتوحة — النماذج تستمع إليها وتنفذ في سياقها المحلي */
export const APP_EVENTS = {
  /** Ctrl+S / F8 — حفظ وترحيل المستند الحالي */
  SAVE_CURRENT: 'app:save-current',
  /** Ctrl+P / F9 — حفظ وطباعة المستند الحالي (في النماذج) أو طباعته (في بطاقات العرض) */
  SAVE_PRINT_CURRENT: 'app:save-print-current',
  /** Esc — إلغاء العملية الحالية (النموذج يطلب تأكيداً صريحاً قبل التطهير) */
  CANCEL_CURRENT: 'app:cancel-current',
} as const

export const dispatchAppEvent = (name: string) => {
  window.dispatchEvent(new CustomEvent(name))
}
