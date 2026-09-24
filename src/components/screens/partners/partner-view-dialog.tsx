'use client'

// بطاقة الطرف — البيانات الكاملة + الرصيد + أحدث الفواتير والسندات + طباعة
import { useCallback, useEffect, useState } from 'react'
import {
  BadgeCheck,
  BadgeDollarSign,
  Ban,
  Building2,
  Eye,
  FileText,
  Loader2,
  MapPin,
  Phone,
  Printer,
  Receipt,
  StickyNote,
} from 'lucide-react'
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
import { useToast } from '@/hooks/use-toast'
import {
  AR_INVOICE_STATUS,
  AR_INVOICE_TYPE,
  AR_METHOD,
  AR_PARTNER_TYPE,
  fmtDate,
  fmtMoney,
  fmtNumber,
  fmtUSD,
} from '@/lib/format'
import { printPartner } from './print-partner'
import type { PartnerDetail } from './types'

interface Props {
  partnerId: string | null
  onClose: () => void
}

export function PartnerViewDialog({ partnerId, onClose }: Props) {
  const { toast } = useToast()
  const [detail, setDetail] = useState<PartnerDetail | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!partnerId) return
    setLoading(true)
    setDetail(null)
    try {
      const res = await fetch(`/api/partners/${partnerId}`)
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) {
        toast({
          title: 'تعذر جلب بطاقة الطرف',
          description: data?.error ?? 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        return
      }
      setDetail(data)
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [partnerId, toast])

  useEffect(() => {
    if (partnerId) void load()
  }, [partnerId, load])

  const isCustomer = detail?.partner.type === 'CUSTOMER'
  const balance = detail?.stats.balance ?? 0

  const handlePrint = () => {
    if (!detail) return
    const ok = printPartner({
      code: detail.partner.code,
      name: detail.partner.name,
      type: detail.partner.type,
      phone: detail.partner.phone,
      address: detail.partner.address,
      notes: detail.partner.notes,
      isActive: detail.partner.isActive,
      createdAt: detail.partner.createdAt,
      balance,
      invoices: detail.invoices,
      vouchers: detail.vouchers,
    })
    if (!ok) {
      toast({
        title: 'تعذر فتح نافذة الطباعة',
        description: 'يرجى السماح بالنوافذ المنبثقة لهذا الموقع ثم إعادة المحاولة',
        variant: 'destructive',
      })
    }
  }

  return (
    <Dialog open={!!partnerId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" />
            {loading ? 'جارٍ التحميل…' : detail ? `${detail.partner.name}` : 'بطاقة الطرف'}
          </DialogTitle>
          <DialogDescription>
            {detail
              ? `${AR_PARTNER_TYPE[detail.partner.type] ?? detail.partner.type} — كود ${detail.partner.code}`
              : 'بيانات الملف والأرصدة والمستندات الأخيرة'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            جارٍ التحميل…
          </div>
        ) : detail ? (
          <div className="space-y-4">
            {/* صندوق الرصيد */}
            <div
              className={`rounded-xl border-2 p-4 ${
                balance > 0
                  ? isCustomer
                    ? 'border-emerald-500/40 bg-emerald-500/5'
                    : 'border-rose-500/40 bg-rose-500/5'
                  : 'border-muted bg-muted/30'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {balance > 0
                    ? isCustomer
                      ? 'الرصيد المدين — يجب على العميل لنا'
                      : 'الرصيد الدائن — علينا للمورد'
                    : balance < 0
                      ? 'دفعات مقدم تفوق الفواتير'
                      : 'الحساب مسدد بالكامل'}
                </p>
                <Badge variant="outline" className="num gap-1">
                  ≈ {fmtUSD(balance)}
                </Badge>
              </div>
              <p
                className={`num mt-1 text-2xl font-bold ${
                  balance > 0
                    ? isCustomer
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                    : 'text-muted-foreground'
                }`}
              >
                {fmtMoney(balance)}
              </p>
            </div>

            {/* شبكة البيانات */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <InfoRow icon={Building2} label="الكود" value={detail.partner.code} mono />
              <InfoRow
                icon={BadgeCheck}
                label="النوع"
                value={AR_PARTNER_TYPE[detail.partner.type] ?? detail.partner.type}
              />
              <InfoRow
                icon={Phone}
                label="الهاتف"
                value={detail.partner.phone ?? '—'}
                mono
                ltr={!!detail.partner.phone}
              />
              <InfoRow icon={MapPin} label="العنوان" value={detail.partner.address ?? '—'} />
              <InfoRow
                icon={detail.partner.isActive ? BadgeCheck : Ban}
                label="الحالة"
                value={detail.partner.isActive ? 'نشط' : 'موقوف'}
              />
              <InfoRow
                icon={FileText}
                label="تاريخ الإنشاء"
                value={fmtDate(detail.partner.createdAt)}
                mono
              />
            </div>

            {/* ملخص المستندات */}
            <div className="grid grid-cols-3 gap-2">
              <MiniStat
                icon={FileText}
                label={isCustomer ? 'فواتير البيع' : 'فواتير الشراء'}
                value={fmtNumber(detail.stats.invoicesCount)}
                sub={fmtMoney(detail.stats.invoicesTotal)}
              />
              <MiniStat
                icon={Receipt}
                label={isCustomer ? 'سندات القبض' : 'سندات الدفع'}
                value={fmtNumber(detail.stats.vouchersCount)}
                sub={fmtMoney(detail.stats.vouchersTotal)}
              />
              <MiniStat
                icon={BadgeDollarSign}
                label="المسدد ضمن الفواتير"
                value={detail.stats.invoicesPaid > 0 ? 'موجود' : 'لا يوجد'}
                sub={fmtMoney(detail.stats.invoicesPaid)}
              />
            </div>

            {detail.partner.notes ? (
              <div className="flex gap-2 rounded-lg border border-dashed bg-muted/30 p-3">
                <StickyNote className="h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{detail.partner.notes}</p>
              </div>
            ) : null}

            {/* أحدث الفواتير */}
            <div>
              <p className="mb-2 text-sm font-semibold">
                {isCustomer ? 'أحدث فواتير البيع' : 'أحدث فواتير الشراء'}{' '}
                <span className="num text-xs text-muted-foreground">(آخر 10)</span>
              </p>
              {detail.invoices.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  لا توجد فواتير — ستظهر هنا بعد إنشائها من شاشة الفواتير
                </p>
              ) : (
                <div className="max-h-56 space-y-1.5 overflow-y-auto pe-1">
                  {detail.invoices.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="num font-semibold text-primary">{inv.number}</span>
                        <span className="num mr-2 text-xs text-muted-foreground">
                          {fmtDate(inv.date)}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            inv.status === 'PAID'
                              ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                              : inv.status === 'PARTIAL'
                                ? 'border-amber-500/40 text-amber-600 dark:text-amber-400'
                                : 'border-rose-500/40 text-rose-600 dark:text-rose-400'
                          }
                        >
                          {AR_INVOICE_STATUS[inv.status] ?? inv.status}
                        </Badge>
                        <span className="num font-bold">{fmtMoney(inv.total)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* أحدث السندات */}
            <div>
              <p className="mb-2 text-sm font-semibold">
                {isCustomer ? 'أحدث سندات القبض' : 'أحدث سندات الدفع'}{' '}
                <span className="num text-xs text-muted-foreground">(آخر 10)</span>
              </p>
              {detail.vouchers.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  لا توجد سندات — تُسجل من شاشتي القبض والدفع
                </p>
              ) : (
                <div className="max-h-56 space-y-1.5 overflow-y-auto pe-1">
                  {detail.vouchers.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="num font-semibold text-primary">{v.number}</span>
                        <span className="num mr-2 text-xs text-muted-foreground">
                          {fmtDate(v.date)}
                        </span>
                        {v.notes ? (
                          <span className="ms-2 hidden truncate text-xs text-muted-foreground sm:inline">
                            {v.notes}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="outline">{AR_METHOD[v.method] ?? v.method}</Badge>
                        <span className="num font-bold text-emerald-600 dark:text-emerald-400">
                          {fmtMoney(v.amount)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
          <Button onClick={handlePrint} disabled={!detail}>
            <Printer className="h-4 w-4" />
            طباعة البطاقة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
  mono,
  ltr,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  mono?: boolean
  ltr?: boolean
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p
          className={`truncate text-sm font-medium ${mono ? 'num' : ''}`}
          dir={ltr ? 'ltr' : undefined}
          title={value}
        >
          {value}
        </p>
      </div>
    </div>
  )
}

function MiniStat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub: string
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <p className="text-[11px] leading-tight">{label}</p>
      </div>
      <p className="num mt-1.5 text-lg font-bold leading-tight">{value}</p>
      <p className="num mt-0.5 text-[11px] text-muted-foreground" title={sub}>
        {sub}
      </p>
    </div>
  )
}
