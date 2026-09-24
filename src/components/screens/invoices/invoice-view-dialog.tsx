'use client'

// بطاقة عرض فاتورة — قراءة فقط: البيانات + البنود + المجاميع + الدفعات

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Banknote, BookOpenCheck, Gift, Loader2, Package, Printer, ShoppingBasket, Sparkles, Target, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AR_METHOD, fmtDate, fmtMoney, fmtNumber, fmtUSD } from '@/lib/format'
import { round2 } from '@/lib/math'
import { tafqitSYP } from '@/lib/tafqit'
import { useActionBus, APP_EVENTS } from '@/lib/action-bus'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { groupBundleLines, type BundleGroup } from './bundle-groups'
import { printInvoice } from './print-invoice'
import type { InvoiceDetail, InvoiceKind } from './types'

const DOC_TITLE: Record<InvoiceKind, string> = {
  SALE: 'فاتورة مبيعات',
  SALES_RETURN: 'مردود مبيعات',
  PURCHASE: 'فاتورة مشتريات',
  PURCHASE_RETURN: 'مردود مشتريات',
}

const STATUS_BADGE: Record<string, string> = {
  PAID: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  PARTIAL: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  UNPAID: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
}

const AR_STATUS: Record<string, string> = {
  PAID: 'مدفوعة',
  PARTIAL: 'مدفوعة جزئياً',
  UNPAID: 'غير مدفوعة',
}

interface InvoiceViewDialogProps {
  invoiceId: string | null
  onClose: () => void
}

export function InvoiceViewDialog({ invoiceId, onClose }: InvoiceViewDialogProps) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  // أحدث نسخة من التفاصيل للاستجابة الفورية لـ Ctrl+P / F9 دون إعادة تسجيل المستمع
  const detailRef = useRef<InvoiceDetail | null>(null)
  const toastRef = useRef(toast)
  useEffect(() => {
    detailRef.current = detail
    toastRef.current = toast
  }, [detail, toast])

  useEffect(() => {
    if (!invoiceId) {
      useActionBus.getState().setActiveDoc(null)
      return
    }
    useActionBus.getState().setActiveDoc({ kind: 'invoice-view', label: 'بطاقة عرض الفاتورة' })
    const onPrint = () => {
      const d = detailRef.current
      if (!d) return
      const printed = printInvoice(d)
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
  }, [invoiceId])

  const load = useCallback(async () => {
    if (!invoiceId) return
    setLoading(true)
    setDetail(null)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`)
      if (!res.ok) throw new Error('failed')
      const d = (await res.json()) as InvoiceDetail
      setDetail(d)
    } catch {
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [invoiceId])

  useEffect(() => {
    if (!invoiceId) return
    void load()
  }, [invoiceId, load])

  const salesFamily = detail ? detail.type === 'SALE' || detail.type === 'SALES_RETURN' : true
  const remaining = detail ? Math.max(0, detail.total - detail.paid) : 0
  // عمود مركز التكلفة في جدول القيد — يظهر فقط إن نُسب القيد لمركز
  const journalHasCC = detail?.journal?.lines.some((l) => l.costCenterName) ?? false
  // نصيب السلال من الحسم الممنوح — لقطات محفوظة مع بنود الفاتورة
  const bundleDiscountSum = detail ? round2(detail.lines.reduce((s, l) => s + l.bundleDiscount, 0)) : 0
  // البنود مُجمّعة: كل سلة تظهر سطراً مجملاً واحداً «سلة عروض: [الاسم]» بعدد سلالها
  // والإجمالي بعد خصم حسم السلة — والتفصيل الكامل في ملحق السلال أسفل الجدول (Task 36)
  const groupedRows = useMemo(() => (detail ? groupBundleLines(detail.lines) : []), [detail])
  const hasBundleGroups = groupedRows.some((r) => r.kind === 'bundle')

  return (
    <Dialog open={!!invoiceId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent variant="preview" className="flex max-h-[92vh] w-[calc(100vw_-_var(--sidebar-w)_-_1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px]">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4 pl-14">
          <DialogHeader className="text-start">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {detail ? (
                <>
                  <span>{DOC_TITLE[detail.type]}</span>
                  <span className="num text-primary">{detail.number}</span>
                  <Badge variant="outline" className={STATUS_BADGE[detail.status] ?? ''}>
                    {AR_STATUS[detail.status] ?? detail.status}
                  </Badge>
                  {/* وسمان دائمان: سلة عروض / استرداد نقاط ولاء */}
                  {hasBundleGroups && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                    >
                      <ShoppingBasket className="h-3 w-3" />
                      سلة عروض
                    </Badge>
                  )}
                  {(detail.loyaltyPointsRedeemed ?? 0) > 0 && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400"
                      title={`استُردت ${fmtNumber(detail.loyaltyPointsRedeemed ?? 0)} نقطة ولاء بقيمة ${fmtMoney(detail.loyaltyRedeemValue ?? 0)} ل.س كحسم داخل الفاتورة`}
                    >
                      <Sparkles className="h-3 w-3" />
                      استرداد نقاط ولاء
                    </Badge>
                  )}
                </>
              ) : (
                'تفاصيل الفاتورة'
              )}
            </DialogTitle>
            <DialogDescription>
              {detail
                ? `بتاريخ ${fmtDate(detail.date)} — مُرحّلة فوراً في المخزون والسندات والقيود المحاسبية`
                : 'جارٍ التحميل…'}
            </DialogDescription>
          </DialogHeader>
          {/* طباعة الفاتورة — قسيمة كاملة بالشعار والتفقيط في نافذة مستقلة */}
          <Button
            size="sm"
            className="shrink-0"
            disabled={!detail}
            onClick={() => detail && printInvoice(detail)}
            title="طباعة الفاتورة كقسيمة كاملة"
            aria-label="طباعة الفاتورة"
          >
            <Printer className="h-4 w-4" />
            طباعة الفاتورة
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جارٍ تحميل الفاتورة…
            </div>
          )}

          {!loading && !detail && (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
              تعذر تحميل الفاتورة — أغلق النافذة وأعد المحاولة
            </div>
          )}

          {detail && (
            <>
              {/* الطرف + مركز التكلفة + الملاحظات */}
              <div className={cn('grid grid-cols-1 gap-3', detail.costCenter ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <User className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{detail.partner.name}</p>
                      <p className="num text-[11px] text-muted-foreground">
                        {detail.partner.code}
                        {detail.partner.phone ? ` · ${detail.partner.phone}` : ''}
                      </p>
                    </div>
                  </div>
                </div>

                {/* مركز التكلفة المختار — القيد المحاسبي التلقائي منسوب إليه كاملاً */}
                {detail.costCenter && (
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Target className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-muted-foreground">مركز التكلفة</p>
                        <p className="truncate text-sm font-bold">
                          <span className="num text-[10px] text-muted-foreground">{detail.costCenter.code}</span>{' '}
                          {detail.costCenter.name}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-[11px] font-semibold text-muted-foreground">ملاحظات الفاتورة</p>
                  <p className="mt-1 min-h-5 text-sm">{detail.notes || '—'}</p>
                </div>
              </div>

              {/* البنود — كل سلة تظهر سطراً مجملاً واحداً بعدد سلالها وإجماليها بعد الحسم (Task 36) */}
              <div className="overflow-x-auto rounded-lg border">
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="w-10 text-center">م</TableHead>
                      <TableHead>المادة</TableHead>
                      <TableHead>القسم المخزني</TableHead>
                      <TableHead className="w-20 text-center">الوحدة</TableHead>
                      <TableHead className="w-24 text-center">العدد</TableHead>
                      <TableHead className="w-32">سعر الوحدة</TableHead>
                      <TableHead className="w-36">الإجمالي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupedRows.map((row, i) => {
                      // ===== سطر السلة المُجملة — بند واحد مستقل: «سلة عروض: [الاسم]» =====
                      if (row.kind === 'bundle') {
                        const g = row.group
                        return (
                          <TableRow key={`bundle-${g.bundleId}`} className="border-s-4 border-s-amber-500/60 bg-amber-500/[0.045]">
                            <TableCell className="num text-center text-xs text-muted-foreground">{i + 1}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                                  <ShoppingBasket className="h-4 w-4" />
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-bold text-amber-800 dark:text-amber-300">
                                    سلة عروض: {g.name}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {fmtNumber(g.items.length)} مادة — تفاصيلها في ملحق السلال أسفل الجدول
                                  </p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">مواد السلة من أقسامها</TableCell>
                            <TableCell className="text-center text-sm font-semibold text-amber-800 dark:text-amber-300">
                              سلة
                            </TableCell>
                            <TableCell className="num text-center text-sm font-semibold">{fmtNumber(g.qty)}</TableCell>
                            <TableCell className="num text-end text-sm">
                              <span title="سعر السلة الواحدة بإجمالي موادها">{fmtMoney(g.grossPerUnit)}</span>
                            </TableCell>
                            <TableCell className="text-end">
                              <span className="num text-sm font-bold text-amber-800 dark:text-amber-300">
                                {fmtMoney(g.net)}
                              </span>
                              {g.discount > 0 && (
                                <p className="num text-[10px] text-muted-foreground">
                                  <span className="line-through">{fmtMoney(g.gross)}</span> — حسم السلة{' '}
                                  {fmtMoney(g.discount)}
                                </p>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      }
                      // ===== البنود العادية التقليدية =====
                      const l = row.line
                      return (
                        <TableRow key={l.id ?? `line-${i}`}>
                          <TableCell className="num text-center text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{l.itemName}</p>
                                <p className="num text-[10px] text-muted-foreground">{l.itemCode}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{l.warehouseName ?? '—'}</TableCell>
                          <TableCell className="text-center text-sm">
                            {l.unitName ?? '—'}
                            {l.unitFactor !== 1 && <span className="num text-[10px] text-muted-foreground"> ×{l.unitFactor}</span>}
                          </TableCell>
                          <TableCell className="num text-center text-sm font-semibold">{fmtNumber(l.quantity)}</TableCell>
                          <TableCell className="num text-end text-sm">{fmtMoney(l.unitPrice)}</TableCell>
                          <TableCell className="num text-end text-sm font-bold">{fmtMoney(l.total)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* ملحق تفاصيل سلال العروض المباعة — موجودات كل سلة وأصنافها ليراها العميل بوضوح (Task 36) */}
              {hasBundleGroups && (
                <div className="rounded-lg border border-amber-500/30">
                  <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-sm font-bold text-amber-800 dark:text-amber-300">
                    <ShoppingBasket className="h-4 w-4" />
                    ملحق سلال العروض — تفاصيل المواد المباعة
                  </div>
                  <div className="space-y-3 p-3">
                    {groupedRows
                      .filter((r): r is { kind: 'bundle'; group: BundleGroup } => r.kind === 'bundle')
                      .map((r) => {
                        const g = r.group
                        return (
                          <div key={`appx-${g.bundleId}`} className="overflow-hidden rounded-lg border">
                            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b bg-muted/30 px-3 py-2">
                              <p className="flex items-center gap-1.5 text-sm font-bold">
                                <Gift className="h-3.5 w-3.5 text-amber-500" />
                                سلة عروض: {g.name}
                              </p>
                              <p className="num text-[11px] text-muted-foreground">
                                عدد السلال: <span className="font-bold text-foreground">{fmtNumber(g.qty)}</span>
                                {' · '}سعر السلة الواحدة:{' '}
                                <span className="font-bold text-foreground">{fmtMoney(g.grossPerUnit)} ل.س</span>
                                {g.discount > 0 && (
                                  <>
                                    {' · '}حسم السلة:{' '}
                                    <span className="font-bold text-rose-600 dark:text-rose-400">
                                      {fmtMoney(g.discount)} ل.س
                                    </span>
                                    {' · '}الصافي:{' '}
                                    <span className="font-extrabold text-emerald-700 dark:text-emerald-400">
                                      {fmtMoney(g.net)} ل.س
                                    </span>
                                  </>
                                )}
                              </p>
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                  <TableHead className="w-8 text-center">م</TableHead>
                                  <TableHead>المادة</TableHead>
                                  <TableHead className="w-28">القسم المخزني</TableHead>
                                  <TableHead className="w-20 text-center">الوحدة</TableHead>
                                  <TableHead className="w-24 text-center">كمية السلة الواحدة</TableHead>
                                  <TableHead className="w-24 text-center">الكمية الكلية</TableHead>
                                  <TableHead className="w-28">سعر الوحدة</TableHead>
                                  <TableHead className="w-28">القيمة الكلية</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {g.items.map((it, k) => (
                                  <TableRow key={`${g.bundleId}-${it.itemId}-${k}`}>
                                    <TableCell className="num text-center text-xs text-muted-foreground">{k + 1}</TableCell>
                                    <TableCell>
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="text-sm font-semibold">{it.name}</span>
                                        {it.gift && (
                                          <Badge className="gap-1 border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                                            <Gift className="h-3 w-3" />
                                            هدية مجانية
                                          </Badge>
                                        )}
                                      </div>
                                      <p className="num text-[10px] text-muted-foreground">{it.code}</p>
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{it.warehouseName ?? '—'}</TableCell>
                                    <TableCell className="text-center text-xs">{it.unitName ?? '—'}</TableCell>
                                    <TableCell className="num text-center text-sm">{fmtNumber(it.qtyPerUnit)}</TableCell>
                                    <TableCell className="num text-center text-sm font-semibold">
                                      {fmtNumber(round2(it.qtyPerUnit * g.qty))}
                                    </TableCell>
                                    <TableCell className="num text-end text-sm">{fmtMoney(it.price)}</TableCell>
                                    <TableCell className="num text-end text-sm font-bold">{fmtMoney(it.lineTotal)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}

              {/* المجاميع */}
              <div className="ms-auto w-full max-w-sm space-y-1.5 rounded-lg border bg-muted/20 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">المجموع</span>
                  <span className="num font-semibold">{fmtMoney(detail.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    الضريبة {detail.taxRate > 0 ? <span className="num">({fmtNumber(detail.taxRate)}%)</span> : null}
                  </span>
                  <span className="num font-semibold">{fmtMoney(detail.tax)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{salesFamily ? 'الحسم الممنوح' : 'الحسم المكتسب'}</span>
                  <span className="num font-semibold">{fmtMoney(detail.discount)}</span>
                </div>
                {detail.type === 'SALE' && detail.discount > 0 && bundleDiscountSum > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">منها حسم السلال</span>
                    <span className="num font-semibold text-amber-600 dark:text-amber-400">{fmtMoney(bundleDiscountSum)} ل.س</span>
                  </div>
                )}
                {detail.type === 'SALE' && (detail.loyaltyRedeemValue ?? 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      حسم نقاط الولاء{' '}
                      <span className="num">({fmtNumber(detail.loyaltyPointsRedeemed ?? 0)} نقطة)</span>
                    </span>
                    <span className="num font-semibold text-primary">{fmtMoney(detail.loyaltyRedeemValue ?? 0)} ل.س</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t pt-1.5">
                  <span className="font-bold">الإجمالي</span>
                  <span className="num font-extrabold text-primary">
                    {fmtMoney(detail.total)} <span className="num ms-2 text-[11px] font-normal">≈ {fmtUSD(detail.total)}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">المسدد</span>
                  <span className="num font-semibold text-emerald-600 dark:text-emerald-400">{fmtMoney(detail.paid)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">المتبقي</span>
                  <span className="num font-semibold text-amber-600 dark:text-amber-400">{fmtMoney(remaining)}</span>
                </div>
                {/* تفقيط القيم — الإجمالي والمسدد والمتبقي بكلمات عربية فصيحة (Task 34) */}
                <div className="space-y-2 border-t pt-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">تفقيط القيم</p>
                  <div>
                    <p className="text-[11px] text-muted-foreground">الإجمالي</p>
                    <p className="text-[13px] font-medium leading-relaxed">{tafqitSYP(detail.total)}</p>
                  </div>
                  {detail.paid > 0 && (
                    <div>
                      <p className="text-[11px] text-muted-foreground">المسدد</p>
                      <p className="text-[13px] font-medium leading-relaxed">{tafqitSYP(detail.paid)}</p>
                    </div>
                  )}
                  {remaining > 0 && (
                    <div>
                      <p className="text-[11px] text-muted-foreground">المتبقي</p>
                      <p className="text-[13px] font-medium leading-relaxed">{tafqitSYP(remaining)}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* الدفعات — سندات VCH */}
              <div className="rounded-lg border">
                <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-sm font-semibold">
                  <Banknote className="h-4 w-4 text-primary" />
                  دفعات الفاتورة (سندات VCH)
                </div>
                {detail.payments.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground">
                    لا دفعات مسجلة — الفاتورة آجلة بالكامل على ذمة الطرف
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-28">السند</TableHead>
                        <TableHead className="w-28">التاريخ</TableHead>
                        <TableHead className="w-24">الطريقة</TableHead>
                        <TableHead>المبلغ</TableHead>
                        <TableHead>ملاحظة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="num font-semibold text-primary">{p.number}</TableCell>
                          <TableCell className="num text-sm">{fmtDate(p.date)}</TableCell>
                          <TableCell className="text-sm">{AR_METHOD[p.method] ?? p.method}</TableCell>
                          <TableCell className="num text-end text-sm font-bold">{fmtMoney(p.amount)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{p.notes ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              {/* القيد المحاسبي التلقائي — قيد مزدوج مُرحّل فوراً مع ترحيل الفاتورة */}
              {detail.journal && (
                <div className="rounded-lg border">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2 text-sm font-semibold">
                    <span className="flex items-center gap-2">
                      <BookOpenCheck className="h-4 w-4 text-primary" />
                      القيد المحاسبي التلقائي
                      <Badge variant="outline" className="num text-primary">
                        {detail.journal.number}
                      </Badge>
                    </span>
                    <span className="num text-[11px] font-normal text-muted-foreground">
                      مدين = دائن = {fmtMoney(detail.journal.totalDebit)}
                    </span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-24">الحساب</TableHead>
                        <TableHead>اسم الحساب</TableHead>
                        <TableHead className="w-36">مدين</TableHead>
                        <TableHead className="w-36">دائن</TableHead>
                        {journalHasCC && <TableHead className="w-28">مركز التكلفة</TableHead>}
                        <TableHead>البيان</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.journal.lines.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="num text-sm text-muted-foreground">{l.accountCode}</TableCell>
                          <TableCell className="text-sm font-medium">{l.accountName}</TableCell>
                          <TableCell className="num text-end text-sm text-emerald-600 dark:text-emerald-400">
                            {l.debit > 0 ? fmtMoney(l.debit) : '—'}
                          </TableCell>
                          <TableCell className="num text-end text-sm text-amber-600 dark:text-amber-400">
                            {l.credit > 0 ? fmtMoney(l.credit) : '—'}
                          </TableCell>
                          {journalHasCC && (
                            <TableCell className="text-xs text-muted-foreground">{l.costCenterName ?? '—'}</TableCell>
                          )}
                          <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground" title={l.description ?? ''}>
                            {l.description ?? '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
