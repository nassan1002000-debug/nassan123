'use client'

// شاشة السندات المشتركة (قبض/دفع) — KPIs + فلاتر + جدول + إنشاء/عرض/طباعة/حذف
// تُستخدم عبر غلافي receipts-screen و payments-screen مع type مختلف

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Coins,
  Eye,
  Inbox,
  Loader2,
  Plus,
  Printer,
  ScrollText,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { KpiCard } from '@/components/common/kpi-card'
import { SectionCard } from '@/components/common/section-card'
import { TableActions } from '@/components/screens/common/table-actions'
import { useToast } from '@/hooks/use-toast'
import { useActionBus } from '@/lib/action-bus'
import { useIsArchive } from '@/lib/store'
import { AR_METHOD, AR_MONTHS, fmtDate, fmtMoney, fmtNumber, fmtUSD } from '@/lib/format'
import { cn } from '@/lib/utils'
import { VoucherFormDialog } from './voucher-form-dialog'
import { VoucherViewDialog } from './voucher-view-dialog'
import { printVoucher } from './print-voucher'
import type { VoucherRow, VoucherTotals } from './types'

const PAGE_SIZE = 15

interface Filters {
  from: string
  to: string
  method: string
  q: string
}

const EMPTY_FILTERS: Filters = { from: '', to: '', method: 'ALL', q: '' }

export function VouchersScreen({ type }: { type: 'RECEIPT' | 'PAYMENT' }) {
  const { toast } = useToast()

  // وضع استعراض أرشيف فترة مقفلة — يخفي أزرار الكتابة (الشرط 4)
  const isArchive = useIsArchive()

  const isReceipt = type === 'RECEIPT'
  const accentIcon = isReceipt ? ArrowDownCircle : ArrowUpCircle

  // قيم الفلاتر (لم تُطبَّق بعد)
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [fMethod, setFMethod] = useState('ALL')
  const [fQ, setFQ] = useState('')
  // الفلاتر المطبَّقة فعلياً
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)

  const [vouchers, setVouchers] = useState<VoucherRow[]>([])
  /** صفوف الطباعة الكاملة — تُملأ قبل الطباعة بكل صفحات الخادم وتُفرَّغ بعدها */
  const [printRows, setPrintRows] = useState<VoucherRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [totals, setTotals] = useState<VoucherTotals>({ sum: 0, count: 0, avg: 0, thisMonth: 0 })
  const [nextNumber, setNextNumber] = useState('VCH-0001')
  const [loading, setLoading] = useState(true)

  const [formOpen, setFormOpen] = useState(false)
  const [viewVoucher, setViewVoucher] = useState<VoucherRow | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<VoucherRow | null>(null)
  const [acting, setActing] = useState(false)

  // Task 40 — استهلاك إشارة Alt+V / Alt+P: فتح نموذج سند جديد فوراً إن طابق نوع الشاشة
  const voucherSignal = useActionBus((s) => s.voucherFormSignal)
  const consumeVoucherSignal = useActionBus((s) => s.consumeVoucherFormSignal)
  useEffect(() => {
    if (!voucherSignal || voucherSignal.type !== type) return
    if (isArchive) {
      // وضع الأرشيف — تُستهلك الإشارة بلا فتح نموذج الكتابة
      consumeVoucherSignal()
      return
    }
    if (formOpen) {
      consumeVoucherSignal()
      return
    }
    setFormOpen(true)
    consumeVoucherSignal()
  }, [voucherSignal, consumeVoucherSignal, type, formOpen, isArchive])

  // ===== جلب السندات — عدّاد تسلسلي يمنع استجابة أقدم من طغيان الأحدث =====
  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('type', type)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      if (filters.method !== 'ALL') params.set('method', filters.method)
      if (filters.q) params.set('q', filters.q)
      params.set('page', String(page))
      params.set('pageSize', String(PAGE_SIZE))

      const res = await fetch(`/api/payments?${params.toString()}`)
      const data = await res.json().catch(() => null)
      if (seq !== loadSeq.current) return
      if (!res.ok || !data) {
        toast({
          title: 'تعذر جلب السندات',
          description: data?.error ?? 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        setVouchers([])
        setTotal(0)
        return
      }
      setVouchers(data.vouchers ?? [])
      setTotal(data.total ?? 0)
      setTotals(data.totals ?? { sum: 0, count: 0, avg: 0, thisMonth: 0 })
      setNextNumber(data.nextNumber ?? 'VCH-0001')
    } catch {
      // فشل الشبكة — رسالة واضحة بدل جدول فارغ صامت
      if (seq === loadSeq.current) {
        toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
        setVouchers([])
        setTotal(0)
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [type, filters, page, toast])

  useEffect(() => {
    void load()
  }, [load])

  // ===== جلب كل السندات المطابقة للفلاتر عبر كل صفحات الخادم (سقف 100/صفحة) — للطباعة والتصدير الكاملين =====
  const fetchAllVouchers = useCallback(async (): Promise<VoucherRow[]> => {
    const all: VoucherRow[] = []
    for (let p = 1; p < 100; p++) {
      const params = new URLSearchParams()
      params.set('type', type)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      if (filters.method !== 'ALL') params.set('method', filters.method)
      if (filters.q) params.set('q', filters.q)
      params.set('page', String(p))
      params.set('pageSize', '100')
      const res = await fetch(`/api/payments?${params.toString()}`)
      const data = (await res.json().catch(() => null)) as { vouchers?: VoucherRow[]; total?: number } | null
      if (!res.ok || !data) break
      const rows = data.vouchers ?? []
      all.push(...rows)
      if (rows.length === 0 || all.length >= (data.total ?? 0)) break
    }
    return all
  }, [type, filters])

  // إعادة الصفحة الأولى عند تغيير الفلاتر
  useEffect(() => {
    setPage(1)
  }, [filters])

  const applyFilters = useCallback(() => {
    setFilters({ from: fFrom, to: fTo, method: fMethod, q: fQ.trim() })
  }, [fFrom, fTo, fMethod, fQ])

  const clearFilters = useCallback(() => {
    setFFrom('')
    setFTo('')
    setFMethod('ALL')
    setFQ('')
    setFilters(EMPTY_FILTERS)
  }, [])

  // ===== الإجراءات =====
  const handlePrint = useCallback(
    (v: VoucherRow) => {
      const ok = printVoucher({
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
        accountIsEmployee: v.account?.isEmployee ?? false,
        invoiceNumber: v.invoiceNumber,
      })
      if (!ok) {
        toast({
          title: 'تعذر فتح نافذة الطباعة',
          description: 'يرجى السماح بالنوافذ المنبثقة لهذا الموقع ثم إعادة المحاولة',
          variant: 'destructive',
        })
      }
    },
    [toast],
  )

  const performDelete = useCallback(async () => {
    if (!confirmDelete || acting) return
    setActing(true)
    try {
      const res = await fetch(`/api/payments/${confirmDelete.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({
          title: 'تعذر حذف السند',
          description: data?.error ?? 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        return
      }
      toast({ title: 'تم حذف السند', description: `رقم السند: ${confirmDelete.number}` })
      void load()
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setActing(false)
      setConfirmDelete(null)
    }
  }, [acting, confirmDelete, load, toast])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const monthLabel = useMemo(() => AR_MONTHS[new Date().getMonth()], [])

  return (
    <div className="space-y-4">
      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          title={isReceipt ? 'إجمالي المقبوضات' : 'إجمالي المدفوعات'}
          value={fmtMoney(totals.sum)}
          hint={`≈ ${fmtUSD(totals.sum)}`}
          icon={accentIcon}
          tone={isReceipt ? 'emerald' : 'rose'}
          loading={loading}
        />
        <KpiCard
          title="عدد السندات"
          value={fmtNumber(total)}
          hint="نتائج الفلترة الحالية"
          icon={ScrollText}
          tone="slate"
          loading={loading}
        />
        <KpiCard
          title={`مخصص ${monthLabel}`}
          value={fmtMoney(totals.thisMonth)}
          hint={`≈ ${fmtUSD(totals.thisMonth)}`}
          icon={CalendarDays}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="متوسط السند"
          value={fmtMoney(totals.avg)}
          hint={totals.count > 0 ? `لعدد ${fmtNumber(totals.count)} سند` : 'لا توجد سندات'}
          icon={Coins}
          tone="amber"
          loading={loading}
        />
      </div>

      {/* شريط الفلاتر */}
      <SectionCard
        title="الفلاتر"
        description={
          isReceipt
            ? 'تصفية سندات القبض حسب الفترة الزمنية والطريقة والطرف'
            : 'تصفية سندات الدفع حسب الفترة الزمنية والطريقة والطرف'
        }
        icon={SlidersHorizontal}
        action={
          !isArchive && (
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" />
              سند {isReceipt ? 'قبض' : 'دفع'} جديد
            </Button>
          )
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">من تاريخ</Label>
            <Input
              type="date"
              value={fFrom}
              onChange={(e) => setFFrom(e.target.value)}
              className="num h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">إلى تاريخ</Label>
            <Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} className="num h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">الطريقة</Label>
            <Select value={fMethod} onValueChange={setFMethod}>
              <SelectTrigger className="h-9 w-full" aria-label="الطريقة">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">الكل</SelectItem>
                {Object.entries(AR_METHOD).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">بحث</Label>
            <Input
              value={fQ}
              onChange={(e) => setFQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFilters()
              }}
              placeholder="رقم السند أو اسم الطرف أو نص البيان…"
              className="h-9"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" onClick={applyFilters}>
            <Search className="h-4 w-4" />
            تصفية
          </Button>
          <Button size="sm" variant="outline" onClick={clearFilters}>
            <X className="h-4 w-4" />
            مسح الفلاتر
          </Button>
        </div>
      </SectionCard>

      {/* جدول السندات */}
      <SectionCard
        title={isReceipt ? 'قائمة سندات القبض' : 'قائمة سندات الدفع'}
        description="السندات مرتبة من الأحدث إلى الأقدم"
        icon={accentIcon}
        action={
          <Badge variant="outline" className="num gap-1">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {fmtNumber(total)} نتيجة
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title={isReceipt ? 'قائمة سندات القبض' : 'قائمة سندات الدفع'}
            filename={isReceipt ? 'receipt-vouchers' : 'payment-vouchers'}
            headers={['رقم السند', 'التاريخ', 'الطرف', 'كود الطرف', 'البيان', 'الطريقة', 'المبلغ']}
            onBeforePrint={async () => {
              setPrintRows(await fetchAllVouchers())
            }}
            onAfterPrint={() => setPrintRows(null)}
            rowsLoader={async () =>
              (await fetchAllVouchers()).map((v) => [
                v.number,
                v.date.slice(0, 10),
                v.partner?.name ?? v.account?.name ?? '',
                v.partner?.code ?? v.account?.code ?? '',
                v.notes ?? '',
                AR_METHOD[v.method] ?? v.method,
                v.amount,
              ])
            }
          />
          <div className="overflow-hidden rounded-lg border">
          {loading && vouchers.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جارٍ التحميل…
            </div>
          ) : vouchers.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <Inbox className="h-10 w-10 text-muted-foreground/50" />
              <p className="font-medium">لا توجد سندات مطابقة</p>
              <p className="text-xs text-muted-foreground">
                جرّب تعديل الفلاتر أو أنشئ سنداً جديداً
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[880px]">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-32">رقم السند</TableHead>
                    <TableHead className="w-28">التاريخ</TableHead>
                    <TableHead>الطرف</TableHead>
                    <TableHead>البيان</TableHead>
                    <TableHead className="w-24">الطريقة</TableHead>
                    <TableHead className="w-40">المبلغ</TableHead>
                    <TableHead className="no-print w-36">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(printRows ?? vouchers).map((v) => (
                    <TableRow
                      key={v.id}
                      className="cursor-pointer"
                      onClick={() => setViewVoucher(v)}
                    >
                      <TableCell>
                        <span className="num font-semibold text-primary">{v.number}</span>
                      </TableCell>
                      <TableCell>
                        <span className="num text-muted-foreground">{fmtDate(v.date)}</span>
                      </TableCell>
                      <TableCell>
                        {v.partner ? (
                          <span>
                            {v.partner.name}{' '}
                            <span className="num text-xs text-muted-foreground">({v.partner.code})</span>
                          </span>
                        ) : v.account ? (
                          <span className="inline-flex items-center gap-1.5">
                            {v.account.name}{' '}
                            <span className="num text-xs text-muted-foreground">({v.account.code})</span>
                            {v.account.isEmployee ? (
                              <Badge
                                variant="outline"
                                className="h-5 border-sky-300 px-1.5 text-[10px] text-sky-600 dark:border-sky-800"
                              >
                                موظف
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="h-5 border-rose-300 px-1.5 text-[10px] text-rose-600 dark:border-rose-800"
                              >
                                مصروف
                              </Badge>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        <span className="block truncate text-muted-foreground" title={v.notes ?? ''}>
                          {v.notes ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1">
                          <Banknote className="h-3 w-3" />
                          {AR_METHOD[v.method] ?? v.method}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        <span
                          className={cn(
                            'num font-bold',
                            isReceipt ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                          )}
                        >
                          {fmtMoney(v.amount)}
                        </span>
                      </TableCell>
                      <TableCell className="no-print" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`عرض السند ${v.number}`}
                            title="عرض"
                            onClick={() => setViewVoucher(v)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`طباعة السند ${v.number}`}
                            title="طباعة"
                            onClick={() => handlePrint(v)}
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
                          {!isArchive && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700"
                              aria-label={`حذف السند ${v.number}`}
                              title="حذف"
                              onClick={() => setConfirmDelete(v)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          </div>
        </div>

        {/* التقسيم */}
        <div className="no-print flex flex-wrap items-center justify-between gap-2 pt-3">
          <p className="text-xs text-muted-foreground">
            صفحة <span className="num font-semibold">{page}</span> من{' '}
            <span className="num font-semibold">{totalPages}</span> — عدد النتائج:{' '}
            <span className="num font-semibold">{fmtNumber(total)}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronRight className="h-4 w-4" />
              السابق
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              التالي
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* نموذج الإنشاء */}
      <VoucherFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        type={type}
        nextNumber={nextNumber}
        onCreated={() => void load()}
      />

      {/* نافذة العرض */}
      <VoucherViewDialog voucher={viewVoucher} onClose={() => setViewVoucher(null)} />

      {/* تأكيد الحذف */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف السند {confirmDelete?.number}</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف السند بمبلغ{' '}
              <span className="num font-semibold">{confirmDelete ? fmtMoney(confirmDelete.amount) : ''}</span>{' '}
              نهائياً، ولا يمكن التراجع عن هذا الإجراء. هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>تراجع</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={(e) => {
                e.preventDefault()
                void performDelete()
              }}
            >
              {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'حذف نهائياً'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
