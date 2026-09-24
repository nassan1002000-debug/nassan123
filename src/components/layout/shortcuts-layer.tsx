'use client'

// Task 40 — منظومة اختصارات لوحة المفاتيح المركزية
// طبقة واحدة تُركَّب أعلى التطبيق (فقط بعد تسجيل الدخول وبخارج وضع استعراض الفترة)
// وتدير كل الاختصارات من أي مكان في النظام:
//   Ctrl+K        فتح البحث المركزي الذكي
//   Alt+I         فاتورة مبيعات جديدة فوراً
//   Alt+V / Alt+P سند قبض / سند دفع جديد فوراً
//   Alt+C         شاشة الصندوق (+ باقي مفاتيح التنقل Alt)
//   Ctrl+S / F8   حفظ وترحيل الفاتورة/السند الحالي
//   Ctrl+P / F9   حفظ وطباعة الفاتورة/السند الحالي (وفي بطاقة العرض: طباعة مباشرة)
//   Esc           إلغاء العملية الحالية — عبر نافذة تأكيد صريحة (لا تطهير بالخطأ)
//   F1 / Alt+H    دليل الاختصارات

import * as React from 'react'
import { useActionBus, dispatchAppEvent, APP_EVENTS } from '@/lib/action-bus'
import { useToast } from '@/hooks/use-toast'
import { GlobalSearchDialog } from './global-search'
import { ShortcutsHelpDialog } from './shortcuts-help'

/** هل توجد نافذة منبثقة مفتوحة الآن؟ (حوار/تأكيد/لوح) */
function anyModalOpen(): boolean {
  return Boolean(
    document.querySelector(
      '[data-slot="dialog-content"][data-state="open"], [data-slot="alert-dialog-content"][data-state="open"], [data-slot="sheet-content"][data-state="open"]',
    ),
  )
}

/** عدد الحوارات المفتوحة (دون التأكيدات والألواح) — لتحديد Esc عندما يكون النموذج هو النافذة العليا */
function openDialogCount(): number {
  return document.querySelectorAll('[data-slot="dialog-content"][data-state="open"]').length
}

function anyAlertDialogOpen(): boolean {
  return Boolean(document.querySelector('[data-slot="alert-dialog-content"][data-state="open"]'))
}

export function ShortcutsLayer() {
  const { toast } = useToast()
  const toastRef = React.useRef(toast)
  React.useEffect(() => {
    toastRef.current = toast
  }, [toast])

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.code
      const ctrl = e.ctrlKey || e.metaKey
      const alt = e.altKey && !e.ctrlKey && !e.metaKey
      const bus = useActionBus.getState()

      // ===== Ctrl+K — البحث المركزي من أي مكان =====
      if (ctrl && !alt && code === 'KeyK') {
        e.preventDefault()
        bus.setSearchOpen(true)
        return
      }

      // ===== F1 / Alt+H — دليل الاختصارات =====
      if (e.key === 'F1' || (alt && code === 'KeyH')) {
        e.preventDefault()
        bus.setHelpOpen(!bus.helpOpen)
        return
      }

      // ===== Ctrl+S / F8 — حفظ وترحيل المستند الحالي =====
      if ((ctrl && !alt && code === 'KeyS') || e.key === 'F8') {
        e.preventDefault()
        const doc = bus.activeDoc
        if (doc && (doc.kind === 'invoice-form' || doc.kind === 'voucher-form')) {
          dispatchAppEvent(APP_EVENTS.SAVE_CURRENT)
        } else {
          toastRef.current({
            title: 'لا يوجد مستند مفتوح للحفظ',
            description: 'افتح نموذج فاتورة أو سند أولاً ثم اضغط Ctrl+S أو F8',
          })
        }
        return
      }

      // ===== Ctrl+P / F9 — حفظ وطباعة / طباعة المستند الحالي =====
      if ((ctrl && !alt && code === 'KeyP') || e.key === 'F9') {
        e.preventDefault()
        const doc = bus.activeDoc
        if (doc) {
          dispatchAppEvent(APP_EVENTS.SAVE_PRINT_CURRENT)
        } else {
          toastRef.current({
            title: 'لا يوجد مستند مفتوح للطباعة',
            description: 'افتح فاتورة أو سنداً (نموذجاً أو بطاقة عرض) ثم اضغط Ctrl+P أو F9',
          })
        }
        return
      }

      // ===== Esc — إلغاء العملية الحالية (بتأكيد صريح داخل النموذج) =====
      if (e.key === 'Escape' && !ctrl && !alt) {
        const doc = bus.activeDoc
        const isForm = doc?.kind === 'invoice-form' || doc?.kind === 'voucher-form'
        // نُطلق الإلغاء فقط إذا كان نموذج الفاتورة/السند هو النافذة العليا الوحيدة —
        // (الحماية من الإغلاق تبقى فعالة؛ Esc هنا يفتح تأكيداً صريحاً بدل الإغلاق الصامت)
        if (isForm && openDialogCount() === 1 && !anyAlertDialogOpen()) {
          e.preventDefault()
          dispatchAppEvent(APP_EVENTS.CANCEL_CURRENT)
        }
        return
      }

      // ===== مفاتيح التنقل Alt — لا تعمل خلف نوافذ مفتوحة لتجنب الالتباس =====
      if (alt && !ctrl) {
        if (anyModalOpen()) return
        e.preventDefault()
        switch (code) {
          case 'KeyI':
            bus.requestInvoiceForm('SALE')
            bus.navigateTo('invoices')
            return
          case 'KeyV':
            bus.requestVoucherForm('RECEIPT')
            bus.navigateTo('receipts')
            return
          case 'KeyP':
            bus.requestVoucherForm('PAYMENT')
            bus.navigateTo('payments')
            return
          case 'KeyC':
            bus.navigateTo('treasury')
            return
          case 'KeyM':
            bus.navigateTo('items')
            return
          case 'KeyA':
            bus.navigateTo('partners')
            return
          case 'KeyG':
            bus.navigateTo('accounts')
            return
          case 'KeyJ':
            bus.navigateTo('journal')
            return
          case 'KeyB':
            bus.navigateTo('bundles')
            return
          case 'KeyL':
            bus.navigateTo('loyalty')
            return
          case 'KeyR':
            bus.navigateTo('reports')
            return
          default:
            return
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <GlobalSearchDialog />
      <ShortcutsHelpDialog />
    </>
  )
}
