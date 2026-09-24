'use client'

// التقارير التشغيلية — أرباح وخسائر شهرية / المخزون / المبيعات والمشتريات / ربحية الأصناف
// + ربحية العملاء والمستودعات + دوران المخزون والأصناف الراكدة
// نمط موحد: KPIs أعلى + فلاتر + جدول بمنطقة طباعة (TableActions + .print-area)

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BarChart3,
  Coins,
  FileBarChart,
  Handshake,
  Package,
  PackageCheck,
  PackageX,
  Receipt,
  Repeat,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { KpiCard } from '@/components/common/kpi-card'
import { SectionCard } from '@/components/common/section-card'
import { StatusBadge } from '@/components/common/status-badge'
import { TableActions } from '@/components/screens/common/table-actions'
import { useToast } from '@/hooks/use-toast'
import { NEG_CLS, PeriodFields, ReportEmpty, ReportLoading, TOTAL_ROW_CLS, fmtYMD, useReportFetch } from './report-shared'
import type {
  InventoryResponse,
  InventoryTurnoverResponse,
  ItemProfitabilityResponse,
  MonthlyPnlResponse,
  ProfitabilityResponse,
  SalesPurchasesResponse,
  TurnoverRow,
} from './report-types'
import { AR_INVOICE_STATUS, AR_INVOICE_TYPE, AR_MONTHS, fmtDate, fmtMoney, fmtNumber, fmtQty, fmtUSD, todayYMD } from '@/lib/format'
import type { ExportCell } from '@/lib/export'
import { cn } from '@/lib/utils'

// ==================== أدوات مشتركة صغيرة ====================

/** اسم الشهر العربي من مفتاح YYYY-MM */
function monthLabel(month: string): string {
  const idx = Number.parseInt(month.slice(5, 7), 10) - 1
  return `${AR_MONTHS[idx] ?? month} ${month.slice(0, 4)}`
}

interface PeriodState {
  from: string
  to: string
}

/** خطاف الفترة القياسية — قيم الحقول + الفترة المطبَّقة + التحقق من الترتيب */
function usePeriodFilters() {
  const { toast } = useToast()
  const currentYear = new Date().getFullYear()
  const [fFrom, setFFrom] = useState(`${currentYear}-01-01`)
  const [fTo, setFTo] = useState(todayYMD())
  const [applied, setApplied] = useState<PeriodState>({ from: `${currentYear}-01-01`, to: todayYMD() })

  const apply = useCallback(() => {
    if (fFrom && fTo && fFrom > fTo) {
      toast({
        title: 'فترة غير صحيحة',
        description: 'تاريخ «من» يجب أن يكون قبلاً أو مساوياً لتاريخ «إلى»',
        variant: 'destructive',
      })
      return
    }
    setApplied({ from: fFrom, to: fTo })
  }, [fFrom, fTo, toast])

  return { fFrom, fTo, setFFrom, setFTo, applied, apply }
}

// ==================== أرباح وخسائر شهرية ====================

export function MonthlyPnlView() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const { data, loading, run } = useReportFetch<MonthlyPnlResponse>()

  // تغيير السنة يطبّق فوراً — لا فترة فرعية هنا
  useEffect(() => {
    void run(`/api/reports?type=monthly-pnl&year=${year}`)
  }, [run, year])

  const years = Array.from({ length: 7 }, (_, i) => currentYear + 1 - i)

  const months = data?.months ?? []
  const isEmpty = !loading && (!!data && data.totals.revenue === 0 && data.totals.expenses === 0)

  const exportRows = (): ExportCell[][] => {
    if (!data) return []
    const rows: ExportCell[][] = data.months.map((m) => [m.month, m.revenue, m.expenses, m.profit])
    rows.push(['الإجمالي', data.totals.revenue, data.totals.expenses, data.totals.profit])
    return rows
  }

  const bestHint =
    data?.bestMonth
      ? `أفضل شهر: ${monthLabel(data.bestMonth.month)} — ${data.worstMonth ? `وأداه: ${monthLabel(data.worstMonth.month)}` : ''}`
      : 'أفضل شهر بالربح خلال السنة'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          title="إجمالي الإيرادات"
          value={fmtMoney(data?.totals.revenue ?? 0)}
          hint={`≈ ${fmtUSD(data?.totals.revenue ?? 0)}`}
          icon={ArrowUpCircle}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="إجمالي المصروفات"
          value={fmtMoney(data?.totals.expenses ?? 0)}
          hint={`≈ ${fmtUSD(data?.totals.expenses ?? 0)}`}
          icon={ArrowDownCircle}
          tone="amber"
          loading={loading}
        />
        <KpiCard
          title={(data?.totals.profit ?? 0) >= 0 ? 'صافي الربح' : 'صافي الخسارة'}
          value={fmtMoney(Math.abs(data?.totals.profit ?? 0))}
          hint={`≈ ${fmtUSD(Math.abs(data?.totals.profit ?? 0))}${(data?.totals.profit ?? 0) < 0 ? ' — خسارة' : ''}`}
          icon={(data?.totals.profit ?? 0) >= 0 ? TrendingUp : TrendingDown}
          tone={(data?.totals.profit ?? 0) >= 0 ? 'gold' : 'rose'}
          loading={loading}
          className={cn((data?.totals.profit ?? 0) < 0 && NEG_CLS)}
        />
        <KpiCard
          title="أفضل شهر"
          value={data?.bestMonth ? monthLabel(data.bestMonth.month) : '—'}
          hint={bestHint}
          icon={BarChart3}
          tone="emerald"
          loading={loading}
        />
      </div>

      <SectionCard title="فلترة التقرير" description="اختر السنة لعرض تحليل الإيرادات والمصروفات والربح شهرياً" icon={BarChart3}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <span className="text-xs">السنة</span>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="num h-9 w-[130px]" aria-label="سنة التقرير">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)} className="num">
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={`الأرباح والخسائر الشهرية — سنة ${data?.year ?? year}`}
        description="من القيود المُرحّلة (POSTED) لحسابات الإيرادات والمصروفات"
        icon={FileBarChart}
        action={
          <Badge variant="outline" className="num gap-1">
            {loading ? <BarChart3 className="h-3 w-3" /> : null}
            {fmtNumber(months.filter((m) => m.revenue !== 0 || m.expenses !== 0).length)} شهر بحركة
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title={`الأرباح والخسائر الشهرية — سنة ${data?.year ?? year}`}
            filename="monthly-pnl"
            headers={['الشهر', 'الإيرادات', 'المصروفات', 'صافي الربح']}
            rowsLoader={exportRows}
          />
          {loading ? (
            <ReportLoading />
          ) : isEmpty ? (
            <ReportEmpty message="لا توجد حركات إيراد أو مصروف مُرحّلة خلال هذه السنة" />
          ) : (
            <div className="max-h-[560px] overflow-auto rounded-lg border">
              <Table className="min-w-[560px]">
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="min-w-36">الشهر</TableHead>
                    <TableHead className="w-44 text-end">الإيرادات</TableHead>
                    <TableHead className="w-44 text-end">المصروفات</TableHead>
                    <TableHead className="w-44 text-end">صافي الربح</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {months.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell className="text-sm font-medium">{monthLabel(m.month)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(m.revenue)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(m.expenses)}</TableCell>
                      <TableCell className={cn('num text-end text-sm font-semibold', m.profit < 0 && NEG_CLS)}>
                        {fmtMoney(m.profit)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className={TOTAL_ROW_CLS}>
                    <TableCell className="text-sm">إجمالي السنة</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(data?.totals.revenue ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(data?.totals.expenses ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(data?.totals.profit ?? 0)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  )
}

// ==================== تقرير المخزون ====================

interface WarehouseLite {
  id: string
  code: string
  name: string
}

export function InventoryReportView() {
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([])
  const [warehouseId, setWarehouseId] = useState('ALL')
  const { data, loading, run } = useReportFetch<InventoryResponse>()

  // قائمة المستودعات مرة واحدة
  useEffect(() => {
    let alive = true
    fetch('/api/warehouses')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('warehouses'))))
      .then((list: WarehouseLite[]) => {
        if (alive) setWarehouses(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (alive) setWarehouses([])
      })
    return () => {
      alive = false
    }
  }, [])

  // تغيير المستودع يطبّق فوراً
  useEffect(() => {
    const suffix = warehouseId !== 'ALL' ? `&warehouseId=${warehouseId}` : ''
    void run(`/api/reports?type=inventory${suffix}`)
  }, [run, warehouseId])

  const rows = data?.rows ?? []
  const isEmpty = !loading && rows.length === 0

  const exportRows = (): ExportCell[][] => {
    const list: ExportCell[][] = rows.map((r) => [
      r.code,
      r.name,
      r.unit ?? '',
      r.quantity,
      r.purchasePrice,
      r.stockValue,
      r.saleValue,
      r.minStock,
      r.underMin ? 'تحت الحد' : 'طبيعي',
    ])
    list.push(['الإجمالي', `${rows.length} صنف`, '', '', '', data?.totals.stockValueCost ?? 0, data?.totals.stockValueSale ?? 0, '', ''])
    return list
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          title="عدد الأصناف"
          value={fmtNumber(data?.kpis.itemsCount ?? 0)}
          hint={data?.warehouse ? `المستودع: ${data.warehouse.name}` : 'كل المستودعات'}
          icon={Package}
          tone="amber"
          loading={loading}
        />
        <KpiCard
          title="قيمة المخزون بالتكلفة"
          value={fmtMoney(data?.kpis.stockValueCost ?? 0)}
          hint={`≈ ${fmtUSD(data?.kpis.stockValueCost ?? 0)}`}
          icon={Coins}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="قيمته بسعر البيع"
          value={fmtMoney(data?.kpis.stockValueSale ?? 0)}
          hint={`≈ ${fmtUSD(data?.kpis.stockValueSale ?? 0)}`}
          icon={TrendingUp}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="أصناف تحت الحد الأدنى"
          value={fmtNumber(data?.kpis.underMinCount ?? 0)}
          hint={(data?.kpis.underMinCount ?? 0) > 0 ? 'تستلزم إعادة تزويد' : 'لا نواقص حالياً'}
          icon={(data?.kpis.underMinCount ?? 0) > 0 ? PackageX : PackageCheck}
          tone={(data?.kpis.underMinCount ?? 0) > 0 ? 'rose' : 'emerald'}
          loading={loading}
        />
      </div>

      <SectionCard title="فلترة التقرير" description="اختر مستودعاً محدداً أو اعرض كل المستودعات مجمعة حسب الصنف" icon={Package}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full space-y-1 sm:w-[260px]">
            <span className="text-xs">المستودع</span>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="h-9" aria-label="فلتر المستودع">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">كل المستودعات</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    <span className="num text-muted-foreground">{w.code}</span> — {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="أرصدة المخزون"
        description={data?.warehouse ? `المستودع: ${data.warehouse.name}` : 'كل المستودعات — مجمعة حسب الصنف'}
        icon={Package}
        action={
          <Badge variant="outline" className="num gap-1">
            {fmtNumber(rows.length)} صنف
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title="تقرير المخزون — الكميات والقيم"
            filename="inventory"
            headers={['الكود', 'الصنف', 'الوحدة', 'الكمية', 'سعر التكلفة', 'قيمة المخزون', 'قيمة البيع', 'الحد الأدنى', 'الحالة']}
            rowsLoader={exportRows}
          />
          {loading ? (
            <ReportLoading />
          ) : isEmpty ? (
            <ReportEmpty message="لا توجد أرصدة مخزون — أضف أصنافاً أو سجّل حركات إدخال" />
          ) : (
            <div className="max-h-[560px] overflow-auto rounded-lg border">
              <Table className="min-w-[900px]">
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="w-20">الكود</TableHead>
                    <TableHead className="min-w-44">الصنف</TableHead>
                    <TableHead className="w-20">الوحدة</TableHead>
                    <TableHead className="w-24 text-end">الكمية</TableHead>
                    <TableHead className="w-36 text-end">سعر التكلفة</TableHead>
                    <TableHead className="w-40 text-end">قيمة المخزون</TableHead>
                    <TableHead className="w-40 text-end">قيمة البيع</TableHead>
                    <TableHead className="w-28 text-end">الحد الأدنى</TableHead>
                    <TableHead className="w-28">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.code}>
                      <TableCell className="num text-xs text-muted-foreground">{r.code}</TableCell>
                      <TableCell className="text-sm font-medium">{r.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.unit ?? '—'}</TableCell>
                      <TableCell className="num text-end text-sm font-semibold">{fmtQty(r.quantity)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.purchasePrice)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.stockValue)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.saleValue)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtQty(r.minStock)}</TableCell>
                      <TableCell>
                        {r.underMin ? (
                          <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-xs text-rose-600 dark:text-rose-400">
                            تحت الحد
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className={TOTAL_ROW_CLS}>
                    <TableCell colSpan={5} className="text-sm">
                      الإجمالي — <span className="num">{fmtNumber(rows.length)}</span> صنف
                    </TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(data?.totals.stockValueCost ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(data?.totals.stockValueSale ?? 0)}</TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  )
}

// ==================== تقرير المبيعات / المشتريات ====================

const KIND_META = {
  sales: {
    typeParam: 'sales',
    label: 'تقرير المبيعات',
    description: 'فواتير البيع ومردوداته خلال الفترة مع الإحصائيات',
    icon: ShoppingCart,
    tone: 'emerald' as const,
    normalType: 'SALE',
    empty: 'لا توجد فواتير مبيعات خلال الفترة — جرّب توسيع الفترة',
  },
  purchases: {
    typeParam: 'purchases',
    label: 'تقرير المشتريات',
    description: 'فواتير الشراء ومردوداته خلال الفترة مع الإحصائيات',
    icon: Truck,
    tone: 'amber' as const,
    normalType: 'PURCHASE',
    empty: 'لا توجد فواتير مشتريات خلال الفترة — جرّب توسيع الفترة',
  },
} as const

export function SalesPurchasesReportView({ kind }: { kind: 'sales' | 'purchases' }) {
  const meta = KIND_META[kind]
  const { fFrom, fTo, setFFrom, setFTo, applied, apply } = usePeriodFilters()
  const { data, loading, run } = useReportFetch<SalesPurchasesResponse>()

  useEffect(() => {
    void run(`/api/reports?type=${meta.typeParam}&from=${applied.from}&to=${applied.to}`)
  }, [run, applied, meta.typeParam])

  const periodLabel = `من ${fmtYMD(applied.from)} إلى ${fmtYMD(applied.to)}`
  const rows = data?.rows ?? []
  const stats = data?.stats
  const isEmpty = !loading && rows.length === 0

  const exportRows = (): ExportCell[][] => {
    const list: ExportCell[][] = rows.map((r) => [
      r.number,
      AR_INVOICE_TYPE[r.type] ?? r.type,
      r.date.slice(0, 10),
      r.partnerName,
      r.subtotal,
      r.discount,
      r.tax,
      r.total,
      r.paid,
      r.remaining,
      AR_INVOICE_STATUS[r.status] ?? r.status,
    ])
    list.push([
      'الإجمالي',
      `${rows.length} مستند`,
      '',
      '',
      rows.reduce((s, r) => s + r.subtotal, 0),
      rows.reduce((s, r) => s + r.discount, 0),
      rows.reduce((s, r) => s + r.tax, 0),
      rows.reduce((s, r) => s + r.total, 0),
      rows.reduce((s, r) => s + r.paid, 0),
      rows.reduce((s, r) => s + r.remaining, 0),
      '',
    ])
    return list
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          title={kind === 'sales' ? 'فواتير البيع' : 'فواتير الشراء'}
          value={fmtNumber(stats?.invoicesCount ?? 0)}
          hint={stats && stats.invoicesCount > 0 ? `متوسط الفاتورة: ${fmtMoney(stats.avgInvoice)}` : 'خلال الفترة'}
          icon={meta.icon}
          tone={meta.tone}
          loading={loading}
        />
        <KpiCard
          title="إجمالي الفواتير"
          value={fmtMoney(stats?.invoicesTotal ?? 0)}
          hint={`≈ ${fmtUSD(stats?.invoicesTotal ?? 0)}`}
          icon={Coins}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="المردودات"
          value={fmtNumber(stats?.returnsCount ?? 0)}
          hint={stats ? `قيمتها: ${fmtMoney(stats.returnsTotal)}` : 'خلال الفترة'}
          icon={Receipt}
          tone="rose"
          loading={loading}
        />
        <KpiCard
          title="الصافي"
          value={fmtMoney(stats?.net ?? 0)}
          hint={stats ? `ضريبة: ${fmtMoney(stats.taxTotal)} — حسم: ${fmtMoney(stats.discountTotal)}` : 'فواتير − مردودات'}
          icon={(stats?.net ?? 0) >= 0 ? TrendingUp : TrendingDown}
          tone={(stats?.net ?? 0) >= 0 ? 'emerald' : 'rose'}
          loading={loading}
        />
      </div>

      <SectionCard title="فلاتر التقرير" description={meta.description} icon={meta.icon}>
        <PeriodFields from={fFrom} to={fTo} onFromChange={setFFrom} onToChange={setFTo} onApply={apply} loading={loading} />
      </SectionCard>

      <SectionCard
        title={meta.label}
        description={`الفترة — ${periodLabel}`}
        icon={FileBarChart}
        action={
          <Badge variant="outline" className="num gap-1">
            {fmtNumber(rows.length)} مستند
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title={`${meta.label} — ${periodLabel}`}
            filename={meta.typeParam}
            headers={['الرقم', 'النوع', 'التاريخ', 'الطرف', 'قبل الخصم', 'الحسم', 'الضريبة', 'الإجمالي', 'المسدد', 'المتبقي', 'الحالة']}
            rowsLoader={exportRows}
          />
          {loading ? (
            <ReportLoading />
          ) : isEmpty ? (
            <ReportEmpty message={meta.empty} />
          ) : (
            <div className="max-h-[560px] overflow-auto rounded-lg border">
              <Table className="min-w-[1120px]">
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="w-28">الرقم</TableHead>
                    <TableHead className="w-28">النوع</TableHead>
                    <TableHead className="w-28">التاريخ</TableHead>
                    <TableHead className="min-w-44">الطرف</TableHead>
                    <TableHead className="w-36 text-end">قبل الخصم</TableHead>
                    <TableHead className="w-32 text-end">الحسم</TableHead>
                    <TableHead className="w-32 text-end">الضريبة</TableHead>
                    <TableHead className="w-40 text-end">الإجمالي</TableHead>
                    <TableHead className="w-40 text-end">المسدد</TableHead>
                    <TableHead className="w-40 text-end">المتبقي</TableHead>
                    <TableHead className="w-32">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="num text-xs font-medium">{r.number}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {AR_INVOICE_TYPE[r.type] ?? r.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="num text-xs text-muted-foreground">{fmtDate(r.date)}</TableCell>
                      <TableCell className="text-sm font-medium">{r.partnerName}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.subtotal)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.discount)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.tax)}</TableCell>
                      <TableCell className="num text-end text-sm font-semibold">{fmtMoney(r.total)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.paid)}</TableCell>
                      <TableCell className={cn('num text-end text-sm', r.remaining > 0 && NEG_CLS)}>
                        {fmtMoney(r.remaining)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} label={AR_INVOICE_STATUS[r.status] ?? r.status} className="text-xs" />
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className={TOTAL_ROW_CLS}>
                    <TableCell colSpan={4} className="text-sm">
                      الإجمالي (شامل المردودات) — <span className="num">{fmtNumber(rows.length)}</span> مستند
                    </TableCell>
                    <TableCell className="num text-end text-sm">
                      {fmtMoney(rows.reduce((s, r) => s + r.subtotal, 0))}
                    </TableCell>
                    <TableCell className="num text-end text-sm">
                      {fmtMoney(rows.reduce((s, r) => s + r.discount, 0))}
                    </TableCell>
                    <TableCell className="num text-end text-sm">
                      {fmtMoney(rows.reduce((s, r) => s + r.tax, 0))}
                    </TableCell>
                    <TableCell className="num text-end text-sm">
                      {fmtMoney(rows.reduce((s, r) => s + r.total, 0))}
                    </TableCell>
                    <TableCell className="num text-end text-sm">
                      {fmtMoney(rows.reduce((s, r) => s + r.paid, 0))}
                    </TableCell>
                    <TableCell className="num text-end text-sm">
                      {fmtMoney(rows.reduce((s, r) => s + r.remaining, 0))}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  )
}

// ==================== تقرير ربحية الأصناف ====================

export function ItemProfitabilityView() {
  const { fFrom, fTo, setFFrom, setFTo, applied, apply } = usePeriodFilters()
  const { data, loading, run } = useReportFetch<ItemProfitabilityResponse>()

  useEffect(() => {
    void run(`/api/reports?type=item-profitability&from=${applied.from}&to=${applied.to}`)
  }, [run, applied])

  const periodLabel = `من ${fmtYMD(applied.from)} إلى ${fmtYMD(applied.to)}`
  const rows = data?.rows ?? []
  const kpis = data?.kpis
  const isEmpty = !loading && rows.length === 0

  const exportRows = (): ExportCell[][] => {
    const list: ExportCell[][] = rows.map((r) => [r.code, r.name, r.qtySold, r.revenue, r.cost, r.profit, r.margin])
    list.push([
      'الإجمالي',
      `${rows.length} صنف`,
      rows.reduce((s, r) => s + r.qtySold, 0),
      kpis?.revenue ?? 0,
      kpis?.cost ?? 0,
      kpis?.profit ?? 0,
      '',
    ])
    return list
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          title="إجمالي الإيراد"
          value={fmtMoney(kpis?.revenue ?? 0)}
          hint={`≈ ${fmtUSD(kpis?.revenue ?? 0)}`}
          icon={ArrowUpCircle}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="إجمالي التكلفة"
          value={fmtMoney(kpis?.cost ?? 0)}
          hint={`≈ ${fmtUSD(kpis?.cost ?? 0)}`}
          icon={ArrowDownCircle}
          tone="amber"
          loading={loading}
        />
        <KpiCard
          title="إجمالي الربح"
          value={fmtMoney(kpis?.profit ?? 0)}
          hint={`≈ ${fmtUSD(kpis?.profit ?? 0)}`}
          icon={(kpis?.profit ?? 0) >= 0 ? TrendingUp : TrendingDown}
          tone={(kpis?.profit ?? 0) >= 0 ? 'gold' : 'rose'}
          loading={loading}
          className={cn((kpis?.profit ?? 0) < 0 && NEG_CLS)}
        />
        <KpiCard
          title="أفضل صنف"
          value={kpis?.bestItem ? kpis.bestItem.name : '—'}
          hint={kpis?.bestItem ? `ربحه: ${fmtMoney(kpis.bestItem.profit)}` : 'الأعلى ربحاً بالفترة'}
          icon={Package}
          tone="emerald"
          loading={loading}
        />
      </div>

      <SectionCard title="فلاتر التقرير" description="الإيراد والتكلفة والربح لكل صنف من بنود فواتير البيع ومردوداتها" icon={Package}>
        <PeriodFields from={fFrom} to={fTo} onFromChange={setFFrom} onToChange={setFTo} onApply={apply} loading={loading} />
      </SectionCard>

      <SectionCard
        title="ربحية الأصناف"
        description={`الفترة — ${periodLabel} — مرتبة بالربح تنازلياً`}
        icon={FileBarChart}
        action={
          <Badge variant="outline" className="num gap-1">
            {fmtNumber(rows.length)} صنف
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title={`تقرير ربحية الأصناف — ${periodLabel}`}
            filename="item-profitability"
            headers={['الكود', 'الصنف', 'الكمية المباعة', 'الإيراد', 'التكلفة', 'الربح', 'الهامش %']}
            rowsLoader={exportRows}
          />
          {loading ? (
            <ReportLoading />
          ) : isEmpty ? (
            <ReportEmpty message="لا توجد بنود فواتير بيع خلال الفترة — سجّل مبيعات لعرض الربحية" />
          ) : (
            <div className="max-h-[560px] overflow-auto rounded-lg border">
              <Table className="min-w-[880px]">
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="w-20">الكود</TableHead>
                    <TableHead className="min-w-44">الصنف</TableHead>
                    <TableHead className="w-28 text-end">الكمية المباعة</TableHead>
                    <TableHead className="w-40 text-end">الإيراد</TableHead>
                    <TableHead className="w-40 text-end">التكلفة</TableHead>
                    <TableHead className="w-40 text-end">الربح</TableHead>
                    <TableHead className="w-24 text-end">الهامش</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.code}>
                      <TableCell className="num text-xs text-muted-foreground">{r.code}</TableCell>
                      <TableCell className="text-sm font-medium">{r.name}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtQty(r.qtySold)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.revenue)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.cost)}</TableCell>
                      <TableCell className={cn('num text-end text-sm font-semibold', r.profit < 0 && NEG_CLS)}>
                        {fmtMoney(r.profit)}
                      </TableCell>
                      <TableCell className={cn('num text-end text-sm', r.margin < 0 && NEG_CLS)}>
                        {fmtNumber(r.margin)}%
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className={TOTAL_ROW_CLS}>
                    <TableCell colSpan={3} className="text-sm">
                      الإجمالي — <span className="num">{fmtNumber(rows.length)}</span> صنف
                    </TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(kpis?.revenue ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(kpis?.cost ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(kpis?.profit ?? 0)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  )
}

// ==================== ربحية العملاء والمستودعات ====================
// نفس أساس ربحية الأصناف لكن التجميع حسب طرف الفاتورة أو مستودع البند — «من يربحني فعلاً؟»

const PROFIT_META = {
  customer: {
    label: 'ربحية العملاء',
    word: 'عميل',
    empty: 'لا توجد بنود فواتير بيع خلال الفترة — سجّل مبيعات لعرض ربحية العملاء',
    icon: Users,
  },
  warehouse: {
    label: 'ربحية المستودعات',
    word: 'مستودع',
    empty: 'لا توجد بنود فواتير بيع خلال الفترة — سجّل مبيعات لعرض ربحية المستودعات',
    icon: Package,
  },
} as const

export function ProfitabilityView() {
  const [by, setBy] = useState<'customer' | 'warehouse'>('customer')
  const { fFrom, fTo, setFFrom, setFTo, applied, apply } = usePeriodFilters()
  const { data, loading, run } = useReportFetch<ProfitabilityResponse>()

  useEffect(() => {
    void run(`/api/reports?type=profitability&by=${by}&from=${applied.from}&to=${applied.to}`)
  }, [run, by, applied])

  const meta = PROFIT_META[by]
  const periodLabel = `من ${fmtYMD(applied.from)} إلى ${fmtYMD(applied.to)}`
  const rows = data?.rows ?? []
  const kpis = data?.kpis
  const isEmpty = !loading && rows.length === 0

  const exportRows = (): ExportCell[][] => {
    const list: ExportCell[][] = rows.map((r) => [
      r.code,
      r.name,
      r.docsCount,
      r.qtySold,
      r.revenue,
      r.cost,
      r.profit,
      r.margin,
      r.share,
    ])
    list.push([
      'الإجمالي',
      `${rows.length} ${meta.word}`,
      '',
      '',
      kpis?.revenue ?? 0,
      kpis?.cost ?? 0,
      kpis?.profit ?? 0,
      kpis?.margin ?? 0,
      '',
    ])
    return list
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          title="إجمالي الإيراد"
          value={fmtMoney(kpis?.revenue ?? 0)}
          hint={`≈ ${fmtUSD(kpis?.revenue ?? 0)}`}
          icon={ArrowUpCircle}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="إجمالي الربح"
          value={fmtMoney(kpis?.profit ?? 0)}
          hint={`≈ ${fmtUSD(kpis?.profit ?? 0)}`}
          icon={(kpis?.profit ?? 0) >= 0 ? TrendingUp : TrendingDown}
          tone={(kpis?.profit ?? 0) >= 0 ? 'gold' : 'rose'}
          loading={loading}
          className={cn((kpis?.profit ?? 0) < 0 && NEG_CLS)}
        />
        <KpiCard
          title="الهامش العام"
          value={`${fmtNumber(kpis?.margin ?? 0)}%`}
          hint="الربح نسبة إلى الإيراد"
          icon={Coins}
          tone="slate"
          loading={loading}
        />
        <KpiCard
          title="الأعلى ربحاً"
          value={kpis?.best ? kpis.best.name : '—'}
          hint={kpis?.best ? `ربحه: ${fmtMoney(kpis.best.profit)}` : 'الأعلى ربحاً بالفترة'}
          icon={Handshake}
          tone="emerald"
          loading={loading}
        />
      </div>

      <SectionCard title="فلاتر التقرير" description="بنود فواتير البيع ومردوداتها مجمعة حسب العميل أو مستودع البند" icon={FileBarChart}>
        <PeriodFields from={fFrom} to={fTo} onFromChange={setFFrom} onToChange={setFTo} onApply={apply} loading={loading} />
      </SectionCard>

      <SectionCard
        title={meta.label}
        description={`${periodLabel} — مرتبة بالربح تنازلياً`}
        icon={meta.icon}
        action={
          <div className="flex gap-1 rounded-lg border p-1" role="group" aria-label="اختيار محور الربحية">
            <Button
              size="sm"
              variant={by === 'customer' ? 'default' : 'ghost'}
              className="h-7 gap-1 text-xs"
              onClick={() => setBy('customer')}
            >
              <Users className="h-3.5 w-3.5" />
              العملاء
            </Button>
            <Button
              size="sm"
              variant={by === 'warehouse' ? 'default' : 'ghost'}
              className="h-7 gap-1 text-xs"
              onClick={() => setBy('warehouse')}
            >
              <Package className="h-3.5 w-3.5" />
              المستودعات
            </Button>
          </div>
        }
      >
        <div className="print-area">
          <TableActions
            title={`${meta.label} — ${periodLabel}`}
            filename={by === 'customer' ? 'customer-profitability' : 'warehouse-profitability'}
            headers={['الكود', 'الاسم', 'المستندات', 'الكمية', 'الإيراد', 'التكلفة', 'الربح', 'الهامش %', 'الحصة %']}
            rowsLoader={exportRows}
          />
          {loading ? (
            <ReportLoading />
          ) : isEmpty ? (
            <ReportEmpty message={meta.empty} />
          ) : (
            <div className="max-h-[560px] overflow-auto rounded-lg border">
              <Table className="min-w-[980px]">
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="w-20">الكود</TableHead>
                    <TableHead className="min-w-40">{by === 'customer' ? 'العميل' : 'المستودع'}</TableHead>
                    <TableHead className="w-24 text-end">المستندات</TableHead>
                    <TableHead className="w-28 text-end">الكمية</TableHead>
                    <TableHead className="w-40 text-end">الإيراد</TableHead>
                    <TableHead className="w-40 text-end">التكلفة</TableHead>
                    <TableHead className="w-40 text-end">الربح</TableHead>
                    <TableHead className="w-24 text-end">الهامش</TableHead>
                    <TableHead className="w-24 text-end">الحصة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="num text-xs text-muted-foreground">{r.code}</TableCell>
                      <TableCell className="text-sm font-medium">{r.name}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtNumber(r.docsCount)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtQty(r.qtySold)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.revenue)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.cost)}</TableCell>
                      <TableCell className={cn('num text-end text-sm font-semibold', r.profit < 0 && NEG_CLS)}>
                        {fmtMoney(r.profit)}
                      </TableCell>
                      <TableCell className={cn('num text-end text-sm', r.margin < 0 && NEG_CLS)}>
                        {fmtNumber(r.margin)}%
                      </TableCell>
                      <TableCell className="num text-end text-xs text-muted-foreground">{fmtNumber(r.share)}%</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className={TOTAL_ROW_CLS}>
                    <TableCell colSpan={2} className="text-sm">
                      الإجمالي — <span className="num">{fmtNumber(rows.length)}</span> {meta.word}
                    </TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="num text-end text-sm">{fmtMoney(kpis?.revenue ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(kpis?.cost ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(kpis?.profit ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtNumber(kpis?.margin ?? 0)}%</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  )
}

// ==================== دوران المخزون والأصناف الراكدة ====================
// معدل دورة كل صنف وأيام التغطية وآخر بيع — والصنف الذي لم يتحرك منذ حد الركود راكد
// ورأس المال المعلق في الراكد هو أولوية التصفية والتسويق

export function InventoryTurnoverView() {
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([])
  const [warehouseId, setWarehouseId] = useState('ALL')
  const [stagnantDays, setStagnantDays] = useState('60')
  const { fFrom, fTo, setFFrom, setFTo, applied, apply } = usePeriodFilters()
  const { data, loading, run } = useReportFetch<InventoryTurnoverResponse>()

  // قائمة المستودعات مرة واحدة
  useEffect(() => {
    let alive = true
    fetch('/api/warehouses')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('warehouses'))))
      .then((list: WarehouseLite[]) => {
        if (alive) setWarehouses(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (alive) setWarehouses([])
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const suffix = warehouseId !== 'ALL' ? `&warehouseId=${warehouseId}` : ''
    void run(`/api/reports?type=inventory-turnover&from=${applied.from}&to=${applied.to}${suffix}&stagnantDays=${stagnantDays}`)
  }, [run, applied, warehouseId, stagnantDays])

  const periodLabel = `من ${fmtYMD(applied.from)} إلى ${fmtYMD(applied.to)}`
  const rows = data?.rows ?? []
  const kpis = data?.kpis
  const totals = data?.totals
  const isEmpty = !loading && rows.length === 0

  const statusText = (r: TurnoverRow): string =>
    r.isStagnant ? (r.lastSaleDate === null ? 'لم يُبع قط' : `راكد ${fmtNumber(r.stagnantDays ?? 0)} يوم`) : 'سليم'

  const exportRows = (): ExportCell[][] => {
    const list: ExportCell[][] = rows.map((r) => [
      r.code,
      r.name,
      statusText(r),
      r.currentQty,
      r.stockValue,
      r.qtySold,
      r.cogs,
      r.avgInventoryValue,
      r.turnover ?? '',
      r.daysOnHand ?? '',
      r.lastSaleDate ?? '',
    ])
    list.push([
      'الإجمالي',
      `${rows.length} صنف`,
      `${kpis?.stagnantCount ?? 0} راكد`,
      '',
      totals?.stockValue ?? 0,
      totals?.qtySold ?? 0,
      totals?.cogs ?? 0,
      '',
      '',
      '',
      '',
    ])
    return list
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          title="أصناف راكدة"
          value={fmtNumber(kpis?.stagnantCount ?? 0)}
          hint={data ? `حد الركود: ${data.stagnantDays} يوم دون حركة بيع` : 'حسب حد الركود المختار'}
          icon={PackageX}
          tone={(kpis?.stagnantCount ?? 0) > 0 ? 'rose' : 'emerald'}
          loading={loading}
        />
        <KpiCard
          title="رأس المال المعلق في الراكد"
          value={fmtMoney(kpis?.stagnantValue ?? 0)}
          hint={`≈ ${fmtUSD(kpis?.stagnantValue ?? 0)}`}
          icon={Coins}
          tone={(kpis?.stagnantValue ?? 0) > 0 ? 'amber' : 'emerald'}
          loading={loading}
        />
        <KpiCard
          title="معدل الدوران العام"
          value={kpis?.avgTurnover !== null && kpis?.avgTurnover !== undefined ? kpis.avgTurnover.toFixed(2) : '—'}
          hint="تكلفة المبيعات ÷ متوسط قيمة المخزون"
          icon={Repeat}
          tone="slate"
          loading={loading}
        />
        <KpiCard
          title="أعلى صنف راكد قيمة"
          value={kpis?.topStagnant ? kpis.topStagnant.name : '—'}
          hint={kpis?.topStagnant ? `قيمة رصيده: ${fmtMoney(kpis.topStagnant.stockValue)}` : 'لا توجد أصناف راكدة'}
          icon={PackageCheck}
          tone="amber"
          loading={loading}
        />
      </div>

      <SectionCard title="فلاتر التقرير" description="الكميات المباعة وتكلفتها ومتوسط المخزون خلال الفترة — والركود منذ آخر بيع" icon={Repeat}>
        <PeriodFields from={fFrom} to={fTo} onFromChange={setFFrom} onToChange={setFTo} onApply={apply} loading={loading}>
          <div className="space-y-1">
            <Label className="text-xs">المستودع</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="h-9 w-[180px]" aria-label="المستودع">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">كل المستودعات</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">حد الركود (يوم)</Label>
            <Select value={stagnantDays} onValueChange={setStagnantDays}>
              <SelectTrigger className="h-9 w-[120px]" aria-label="حد الركود">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 يوم</SelectItem>
                <SelectItem value="60">60 يوم</SelectItem>
                <SelectItem value="90">90 يوم</SelectItem>
                <SelectItem value="120">120 يوم</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </PeriodFields>
      </SectionCard>

      <SectionCard
        title="دوران المخزون"
        description={`${periodLabel} — الراكدة أولاً ثم الأبطأ دوراناً`}
        icon={Repeat}
        action={
          <Badge variant="outline" className="num gap-1">
            {fmtNumber(rows.length)} صنف
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title={`دوران المخزون والأصناف الراكدة — ${periodLabel}`}
            filename="inventory-turnover"
            headers={['الكود', 'الصنف', 'الحالة', 'الرصيد الحالي', 'قيمة الرصيد', 'المبيع بالفترة', 'التكلفة', 'متوسط المخزون', 'معدل الدوران', 'أيام التغطية', 'آخر بيع']}
            rowsLoader={exportRows}
          />
          {loading ? (
            <ReportLoading />
          ) : isEmpty ? (
            <ReportEmpty message="لا توجد أصناف نشطة لعرض دورانها" />
          ) : (
            <div className="max-h-[560px] overflow-auto rounded-lg border">
              <Table className="min-w-[1150px]">
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="w-20">الكود</TableHead>
                    <TableHead className="min-w-40">الصنف</TableHead>
                    <TableHead className="w-32">الحالة</TableHead>
                    <TableHead className="w-24 text-end">الرصيد</TableHead>
                    <TableHead className="w-32 text-end">قيمة الرصيد</TableHead>
                    <TableHead className="w-24 text-end">المبيع</TableHead>
                    <TableHead className="w-32 text-end">التكلفة</TableHead>
                    <TableHead className="w-32 text-end">متوسط المخزون</TableHead>
                    <TableHead className="w-24 text-end">الدوران</TableHead>
                    <TableHead className="w-24 text-end">التغطية</TableHead>
                    <TableHead className="w-28 text-end">آخر بيع</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="num text-xs text-muted-foreground">{r.code}</TableCell>
                      <TableCell className="text-sm font-medium">{r.name}</TableCell>
                      <TableCell>
                        {r.isStagnant ? (
                          <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400">
                            {r.lastSaleDate === null ? 'لم يُبع قط' : `راكد ${fmtNumber(r.stagnantDays ?? 0)} يوم`}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">سليم</span>
                        )}
                      </TableCell>
                      <TableCell className="num text-end text-sm">{fmtQty(r.currentQty)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.stockValue)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtQty(r.qtySold)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.cogs)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.avgInventoryValue)}</TableCell>
                      <TableCell className="num text-end text-sm">
                        {r.turnover !== null ? r.turnover.toFixed(2) : '—'}
                      </TableCell>
                      <TableCell className="num text-end text-xs text-muted-foreground">
                        {r.daysOnHand !== null ? `${fmtNumber(r.daysOnHand)} يوم` : '—'}
                      </TableCell>
                      <TableCell className="num text-end text-xs text-muted-foreground">
                        {r.lastSaleDate ? fmtYMD(r.lastSaleDate) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className={TOTAL_ROW_CLS}>
                    <TableCell colSpan={2} className="text-sm">
                      الإجمالي — <span className="num">{fmtNumber(rows.length)}</span> صنف
                    </TableCell>
                    <TableCell className="text-xs">{fmtNumber(kpis?.stagnantCount ?? 0)} راكد</TableCell>
                    <TableCell />
                    <TableCell className="num text-end text-sm">{fmtMoney(totals?.stockValue ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtQty(totals?.qtySold ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(totals?.cogs ?? 0)}</TableCell>
                    <TableCell colSpan={4} />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  )
}
