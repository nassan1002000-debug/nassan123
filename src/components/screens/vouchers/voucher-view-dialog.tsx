'use client'

// عرض تفاصيل سند قبض/دفع

import { useEffect, useRef } from 'react'
import { ArrowDownLeft, ArrowUpRight, Printer } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { useActionBus, APP_EVENTS } from '@/lib/action-bus'
import { useToast } from '@/hooks/use-toast'
import { AR_METHOD, AR_PARTNER_TYPE, AR_PAYMENT_TYPE, fmtDate, fmtMoney, fmtUSD } from '@/lib/format'
import { tafqitSYP } from '@/lib/tafqit'
import { printVoucher } from './print-voucher'
import type { VoucherRow } from './types'

interface Props {
  voucher: VoucherRow | null
  onClose: () => void
}

export function VoucherViewDialog({ voucher, onClose }: Props) {
  const { toast } = useToast()

  // أحدث نسخة من السند للاستجابة الفورية لـ Ctrl+P / F9 دون إعادة تسجيل المستمع
  const voucherRef = useRef<VoucherRow | null>(null)
  const toastRef = useRef(toast)
  useEffect(() => {
    voucherRef.current = voucher
    toastRef.current = toast
  }, [voucher, toast])

  // Task 40 — تسجيل المستند النشط + طباعة مباشرة بالاختصار (Ctrl+P / F9)
  useEffect(() => {
    if (!voucher) {
      useActionBus.getState().setActiveDoc(null)
      return
    }
    useActionBus.getState().setActiveDoc({ kind: 'voucher-view', label: 'بطاقة عرض السند' })
    const onPrint = () => {
      const v = voucherRef.current
      if (!v) return
      const printed = printVoucher({
        number: v.number,
        type: v.type,
        date: v.date,
        amount: v.amount,
        method: v.method,
        notes: v.notes,
        partnerName: v.partner?.name ?? null,
        partnerCode: v.partner?.code ?? null,
        accountName: v.account?.name ?? null,
        accountCode: v.account?.code ?? null,
        invoiceNumber: v.invoiceNumber,
      })
      if (!printed) {
        toastRef.current({
          title: 'تعذر فتح نافذة الطباعة',
          description: 'فضلاً اسمح بالنوافذ المنبثقة في المتصفح ثم أعد المحاولة',
          variant: 'destructive',
        })
      }
    }
    window.addEventListener(APP_EVENTS.SAVE_PRINT_CURRENT, onPrint)
    return () => {
      useActionBus.getState().setActiveDoc(null)
      window.removeEventListener(APP_EVENTS.SAVE_PRINT_CURRENT, onPrint)
    }
  }, [voucher])

  if (!voucher) return null

  const isReceipt = voucher.type === 'RECEIPT'
  const Icon = isReceipt ? ArrowDownLeft : ArrowUpRight

  return (
    <Dialog open={!!voucher} onOpenChange={(v) => !v && onClose()}>
      <DialogContent variant="preview" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-lg p-1.5 ${
                isReceipt ? 'bg-emerald-500/12 text-emerald-600' : 'bg-rose-500/12 text-rose-600'
              }`}
            >
              <Icon className="h-4 w-4" />
            </span>
            {AR_PAYMENT_TYPE[voucher.type]}
            <span className="num text-sm font-normal text-muted-foreground">{voucher.number}</span>
          </DialogTitle>
          <DialogDescription>تفاصيل السند وكامل بياناته</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div
            className={`rounded-lg border-2 p-4 text-center ${
              isReceipt ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-rose-500/40 bg-rose-500/5'
            }`}
          >
            <p className="text-xs text-muted-foreground">المبلغ الإجمالي</p>
            <p className={`num mt-1 text-2xl font-extrabold ${isReceipt ? 'text-emerald-600' : 'text-rose-600'}`}>
              {fmtMoney(voucher.amount)}
            </p>
            <p className="num text-xs text-muted-foreground">≈ {fmtUSD(voucher.amount)}</p>
            {/* تفقيط المبلغ بكلمات عربية فصيحة (Task 34) */}
            <p className="mt-2 border-t pt-2 text-[12.5px] font-medium leading-relaxed">{tafqitSYP(voucher.amount)}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">التاريخ</p>
              <p className="num mt-0.5 font-semibold">{fmtDate(voucher.date)}</p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">الطريقة</p>
              <p className="mt-0.5 font-semibold">{AR_METHOD[voucher.method] ?? voucher.method}</p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">الجهة</p>
              {voucher.partner ? (
                <>
                  <p className="mt-0.5 font-semibold">
                    {voucher.partner.name}{' '}
                    <span className="num text-xs font-normal text-muted-foreground">({voucher.partner.code})</span>
                  </p>
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    {AR_PARTNER_TYPE[voucher.partner.type] ?? voucher.partner.type}
                  </Badge>
                </>
              ) : voucher.account ? (
                <>
                  <p className="mt-0.5 font-semibold">
                    {voucher.account.name}{' '}
                    <span className="num text-xs font-normal text-muted-foreground">({voucher.account.code})</span>
                  </p>
                  {voucher.account.isEmployee ? (
                    <Badge
                      variant="outline"
                      className="mt-1 border-sky-300 text-[10px] text-sky-600 dark:border-sky-800"
                    >
                      حساب موظف — شجرة الحسابات
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="mt-1 border-rose-300 text-[10px] text-rose-600 dark:border-rose-800"
                    >
                      حساب مصروف — دليل الحسابات
                    </Badge>
                  )}
                </>
              ) : (
                <p className="mt-0.5 text-muted-foreground">بدون طرف</p>
              )}
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">الفاتورة المرتبطة</p>
              <p className="num mt-0.5 font-semibold">{voucher.invoiceNumber ?? '—'}</p>
            </div>
          </div>

          <Separator />

          <div>
            <p className="text-xs font-semibold text-muted-foreground">البيان</p>
            <p className="mt-1 text-sm">{voucher.notes ?? '—'}</p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() =>
              printVoucher({
                number: voucher.number,
                type: voucher.type,
                date: voucher.date,
                amount: voucher.amount,
                method: voucher.method,
                notes: voucher.notes,
                partnerName: voucher.partner?.name ?? null,
                partnerCode: voucher.partner?.code ?? null,
                accountName: voucher.account?.name ?? null,
                accountCode: voucher.account?.code ?? null,
                accountIsEmployee: voucher.account?.isEmployee ?? false,
                invoiceNumber: voucher.invoiceNumber,
              })
            }
          >
            <Printer className="h-4 w-4" />
            طباعة
          </Button>
          <Button onClick={onClose}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
