'use client'

// تقارير الحركات والقيود — كشف حساب طرف / الصندوق / المصروفات / مقارنة الفترات
// نمط موحد: KPIs أعلى + فلاتر + جدول بمنطقة طباعة (TableActions + .print-area)

import { Fragment, useCallback, useEffect, useState } from 'react'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BarChart3,
  CalendarDays,
  Coins,
  FileBarChart,
  Hourglass,
  Inbox,
  Minus,
  NotebookText,
  Receipt,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { KpiCard } from '@/components/common/kpi-card'
import { SectionCard } from '@/components/common/section-card'
import { StatusBadge } from '@/components/common/status-badge'
import { TableActions } from '@/components/screens/common/table-actions'
import { useToast } from '@/hooks/use-toast'
import {
  NEG_CLS,
  PartnerCombobox,
  PeriodFields,
  ReportEmpty,
  ReportLoading,
  TOTAL_ROW_CLS,
  fmtYMD,
  useReportFetch,
} from './report-shared'
import type {
  CompareRow,
  ExpensesResponse,
  PartnerStatementResponse,
  PeriodComparisonResponse,
  ReceivablesAgingResponse,
  TreasuryResponse,
} from './report-types'
import { AR_METHOD, AR_PAYMENT_TYPE, fmtDate, fmtMoney, fmtNumber, fmtUSD, todayYMD } from '@/lib/format'
import type { ExportCell } from '@/lib/export'
import { cn } from '@/lib/utils'

// ==================== كشف حساب طرف (عميل/مورد) ====================

const STATEMENT_META = {
  CUSTOMER: {
    label: 'كشف حساب عميل',
    partnerWord: 'عميلاً',
    empty: 'لا توجد حركات لهذا العميل بالفترة المحددة',
    icon: Users,
    exportName: 'customer-statement',
  },
  SUPPLIER: {
    label: 'كشف حساب مورد',
    partnerWord: 'مورداً',
    empty: 'لا توجد حركات لهذا المورد بالفترة المحددة',
    icon: NotebookText,
    exportName: 'supplier-statement',
  },
} as const

export function PartnerStatementView({ mode }: { mode: 'CUSTOMER' | 'SUPPLIER' }) {
  const meta = STATEMENT_META[mode]
  const { toast } = useToast()

  // الطرف المختار + فترة اختيارية (فارغة = كل الفترات)
  const [partnerId, setPartnerId] = useState<string | null>(null)
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [applied, setApplied] = useState<{ partnerId: string; from: string; to: string } | null>(null)

  const { data, loading, run } = useReportFetch<PartnerStatementResponse>()

  const apply = useCallback(() => {
    if (!partnerId) {
      toast({
        title: `اختر ${meta.partnerWord} أولاً`,
        description: 'لا يمكن توليد الكشف دون تحديد الطرف من القائمة',
        variant: 'destructive',
      })
      return
    }
    if (fFrom && fTo && fFrom > fTo) {
      toast({
        title: 'فترة غير صحيحة',
        description: 'تاريخ «من» يجب أن يكون قبلاً أو مساوياً لتاريخ «إلى»',
        variant: 'destructive',
      })
      return
    }
    setApplied({ partnerId, from: fFrom, to: fTo })
  }, [partnerId, fFrom, fTo, toast, meta.partnerWord])

  useEffect(() => {
    if (!applied) return
    const params = new URLSearchParams({ type: 'partner-statement', partnerId: applied.partnerId })
    if (applied.from) params.set('from', applied.from)
    if (applied.to) params.set('to', applied.to)
    void run(`/api/reports?${params.toString()}`)
  }, [applied, run])

  const periodLabel = applied
    ? applied.from || applied.to
      ? `${applied.from ? `من ${fmtYMD(applied.from)}` : 'كل الفترات'}${applied.to ? ` إلى ${fmtYMD(applied.to)}` : ''}`
      : 'كل الفترات'
    : ''

  const rows = data?.rows ?? []
  const isEmpty = !loading && !!data && rows.length === 0

  const exportRows = (): ExportCell[][] => {
    if (!data) return []
    const list: ExportCell[][] = [
      ['', 'رصيد افتتاحي', '', '', '', '', data.opening],
      ...data.rows.map((r): ExportCell[] => [
        r.date.slice(0, 10),
        r.docType,
        r.number,
        r.description,
        r.debit,
        r.credit,
        r.balance,
      ]),
    ]
    list.push(['الإجمالي', '', '', '', data.totals.debit, data.totals.credit, data.totals.closing])
    return list
  }

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <KpiCard
            title="الرصيد الافتتاحي"
            value={fmtMoney(data.opening)}
            hint={data.opening >= 0 ? 'مدين (لصالحنا)' : 'دائن (علينا)'}
            icon={CalendarDays}
            tone="slate"
          />
          <KpiCard
            title="إجمالي المدين"
            value={fmtMoney(data.totals.debit)}
            hint={mode === 'CUSTOMER' ? 'فواتير البيع ومردوداتها' : 'مردودات الشراء وسندات الدفع'}
            icon={ArrowUpCircle}
            tone="amber"
          />
          <KpiCard
            title="إجمالي الدائن"
            value={fmtMoney(data.totals.credit)}
            hint={mode === 'CUSTOMER' ? 'مردودات البيع وسندات القبض' : 'فواتير الشراء ومردوداتها'}
            icon={ArrowDownCircle}
            tone="emerald"
          />
          <KpiCard
            title="الرصيد الختامي"
            value={fmtMoney(data.totals.closing)}
            hint={data.totals.closing >= 0 ? 'مدين (لصالحنا)' : 'دائن (علينا)'}
            icon={data.totals.closing >= 0 ? TrendingUp : TrendingDown}
            tone={data.totals.closing >= 0 ? 'gold' : 'rose'}
            className={cn(data.totals.closing < 0 && NEG_CLS)}
          />
        </div>
      )}

      <SectionCard
        title="فلاتر الكشف"
        description="اختر الطرف ثم حدّد فترة اختيارية — ترك الحقلين فارغين يعرض كل الحركات"
        icon={meta.icon}
      >
        <PeriodFields
          from={fFrom}
          to={fTo}
          onFromChange={setFFrom}
          onToChange={setFTo}
          onApply={apply}
          // الزر يبقى فعّالاً قبل أول توليد (لا يوجد جلب أولي هنا) — ويُقفل أثناء جلب الكشف فقط
          loading={!!applied && loading}
          applyLabel="عرض الكشف"
        >
          <div className="w-full space-y-1 sm:w-auto">
            <span className="text-xs">الطرف</span>
            <PartnerCombobox type={mode} value={partnerId} onChange={setPartnerId} />
          </div>
        </PeriodFields>
      </SectionCard>

      <SectionCard
        title={data ? `${meta.label} — ${data.partner.name}` : meta.label}
        description={
          data
            ? `${data.partner.code}${data.partner.phone ? ` — ${data.partner.phone}` : ''}${periodLabel ? ` — ${periodLabel}` : ''}`
            : 'حدّد الطرف ثم اضغط عرض الكشف'
        }
        icon={FileBarChart}
        action={
          data ? (
            <Badge variant="outline" className="num gap-1">
              {fmtNumber(data.count)} حركة
            </Badge>
          ) : undefined
        }
      >
        <div className="print-area">
          <TableActions
            title={`${meta.label}${data ? ` — ${data.partner.name}` : ''}${periodLabel ? ` — ${periodLabel}` : ''}`}
            filename={meta.exportName}
            headers={['التاريخ', 'المستند', 'الرقم', 'البيان', 'مدين', 'دائن', 'الرصيد']}
            rowsLoader={exportRows}
          />
          {!applied ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border py-14 text-center text-muted-foreground">
              <meta.icon className="h-8 w-8" />
              <p className="text-sm">اختر {meta.partnerWord} من القائمة أعلاه لعرض كشف حسابه</p>
            </div>
          ) : loading ? (
            <ReportLoading />
          ) : isEmpty ? (
            <ReportEmpty message={meta.empty} />
          ) : (
            <div className="max-h-[560px] overflow-auto rounded-lg border">
              <Table className="min-w-[880px]">
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="w-28">التاريخ</TableHead>
                    <TableHead className="w-36">المستند</TableHead>
                    <TableHead className="w-28">الرقم</TableHead>
                    <TableHead className="min-w-44">البيان</TableHead>
                    <TableHead className="w-36 text-end">مدين</TableHead>
                    <TableHead className="w-36 text-end">دائن</TableHead>
                    <TableHead className="w-40 text-end">الرصيد</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* الرصيد الافتتاحي — صف أول بلا حركة */}
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell className="text-xs text-muted-foreground">—</TableCell>
                    <TableCell className="text-sm font-semibold">رصيد افتتاحي</TableCell>
                    <TableCell />
                    <TableCell className="text-xs text-muted-foreground">
                      {data?.from ? `قبل ${fmtYMD(data.from)}` : 'من بداية الحساب'}
                    </TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className={cn('num text-end text-sm font-semibold', (data?.opening ?? 0) < 0 && NEG_CLS)}>
                      {fmtMoney(data?.opening ?? 0)}
                    </TableCell>
                  </TableRow>
                  {rows.map((r, i) => (
                    <TableRow key={`${r.number}-${i}`}>
                      <TableCell className="num text-xs text-muted-foreground">{fmtDate(r.date)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {r.docType}
                        </Badge>
                      </TableCell>
                      <TableCell className="num text-xs font-medium">{r.number}</TableCell>
                      <TableCell className="max-w-64 truncate text-sm text-muted-foreground" title={r.description}>
                        {r.description}
                      </TableCell>
                      <TableCell className="num text-end text-sm">
                        {r.debit !== 0 ? fmtMoney(r.debit) : '—'}
                      </TableCell>
                      <TableCell className="num text-end text-sm">
                        {r.credit !== 0 ? fmtMoney(r.credit) : '—'}
                      </TableCell>
                      <TableCell className={cn('num text-end text-sm font-semibold', r.balance < 0 && NEG_CLS)}>
                        {fmtMoney(r.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className={TOTAL_ROW_CLS}>
                    <TableCell colSpan={4} className="text-sm">
                      إجمالي الحركة — الرصيد الختامي
                    </TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(data?.totals.debit ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(data?.totals.credit ?? 0)}</TableCell>
                    <TableCell className={cn('num text-end text-sm', (data?.totals.closing ?? 0) < 0 && NEG_CLS)}>
                      {fmtMoney(data?.totals.closing ?? 0)}
                    </TableCell>
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

// ==================== تقرير الصندوق ====================

export function TreasuryReportView() {
  const currentYear = new Date().getFullYear()
  const [fFrom, setFFrom] = useState(`${currentYear}-01-01`)
  const [fTo, setFTo] = useState(todayYMD())
  const [applied, setApplied] = useState({ from: `${currentYear}-01-01`, to: todayYMD() })
  const { toast } = useToast()
  const { data, loading, run } = useReportFetch<TreasuryResponse>()

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

  useEffect(() => {
    void run(`/api/reports?type=treasury&from=${applied.from}&to=${applied.to}`)
  }, [run, applied])

  const periodLabel = `من ${fmtYMD(applied.from)} إلى ${fmtYMD(applied.to)}`
  const rows = data?.rows ?? []
  const isEmpty = !loading && !!data && rows.length === 0

  const exportRows = (): ExportCell[][] => {
    if (!data) return []
    const list: ExportCell[][] = data.rows.map((r): ExportCell[] => [
      r.number,
      AR_PAYMENT_TYPE[r.type] ?? r.type,
      r.date.slice(0, 10),
      r.partnerName ?? '—',
      AR_METHOD[r.method] ?? r.method,
      r.notes ?? '',
      r.incoming,
      r.outgoing,
      r.balance,
    ])
    list.push(['الإجمالي', '', '', '', '', '', data.totals.incoming, data.totals.outgoing, data.closing])
    return list
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          title="الرصيد الافتتاحي"
          value={fmtMoney(data?.opening ?? 0)}
          hint={`قبل ${fmtYMD(applied.from)}`}
          icon={CalendarDays}
          tone="slate"
          loading={loading}
        />
        <KpiCard
          title="إجمالي الوارد"
          value={fmtMoney(data?.totals.incoming ?? 0)}
          hint={`${fmtNumber(rows.filter((r) => r.type === 'RECEIPT').length)} سند قبض`}
          icon={ArrowUpCircle}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="إجمالي الصادر"
          value={fmtMoney(data?.totals.outgoing ?? 0)}
          hint={`${fmtNumber(rows.filter((r) => r.type === 'PAYMENT').length)} سند دفع`}
          icon={ArrowDownCircle}
          tone="rose"
          loading={loading}
        />
        <KpiCard
          title="الرصيد الختامي"
          value={fmtMoney(data?.closing ?? 0)}
          hint={`صافي الفترة: ${fmtMoney(data?.totals.net ?? 0)}`}
          icon={Wallet}
          tone={(data?.closing ?? 0) >= 0 ? 'gold' : 'rose'}
          loading={loading}
          className={cn((data?.closing ?? 0) < 0 && NEG_CLS)}
        />
      </div>

      <SectionCard title="فلاتر التقرير" description="حركات سندات القبض والدفع خلال الفترة مع الرصيد المتحرك" icon={Wallet}>
        <PeriodFields from={fFrom} to={fTo} onFromChange={setFFrom} onToChange={setFTo} onApply={apply} loading={loading} />
      </SectionCard>

      <SectionCard
        title="حركات الصندوق"
        description={`الفترة — ${periodLabel}`}
        icon={FileBarChart}
        action={
          <Badge variant="outline" className="num gap-1">
            {fmtNumber(rows.length)} سند
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title={`تقرير الصندوق — ${periodLabel}`}
            filename="treasury"
            headers={['الرقم', 'النوع', 'التاريخ', 'الطرف', 'الطريقة', 'البيان', 'وارد', 'صادر', 'الرصيد']}
            rowsLoader={exportRows}
          />

          {/* التوزيع حسب طريقة الدفع — شرائح ملخصة */}
          {data && data.byMethod.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {data.byMethod.map((m) => (
                <Badge key={m.method} variant="outline" className="gap-1.5 text-xs">
                  {AR_METHOD[m.method] ?? m.method}
                  <span className="num text-emerald-600 dark:text-emerald-400">+{fmtMoney(m.incoming)}</span>
                  <span className="num text-rose-600 dark:text-rose-400">−{fmtMoney(m.outgoing)}</span>
                </Badge>
              ))}
            </div>
          )}

          {loading ? (
            <ReportLoading />
          ) : isEmpty ? (
            <ReportEmpty message="لا توجد سندات قبض أو دفع خلال الفترة" />
          ) : (
            <div className="max-h-[560px] overflow-auto rounded-lg border">
              <Table className="min-w-[1020px]">
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="w-28">الرقم</TableHead>
                    <TableHead className="w-28">النوع</TableHead>
                    <TableHead className="w-28">التاريخ</TableHead>
                    <TableHead className="min-w-40">الطرف</TableHead>
                    <TableHead className="w-24">الطريقة</TableHead>
                    <TableHead className="min-w-40">البيان</TableHead>
                    <TableHead className="w-36 text-end">وارد</TableHead>
                    <TableHead className="w-36 text-end">صادر</TableHead>
                    <TableHead className="w-40 text-end">الرصيد</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={`${r.number}-${i}`}>
                      <TableCell className="num text-xs font-medium">{r.number}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.type} label={AR_PAYMENT_TYPE[r.type] ?? r.type} className="text-xs" />
                      </TableCell>
                      <TableCell className="num text-xs text-muted-foreground">{fmtDate(r.date)}</TableCell>
                      <TableCell className="text-sm font-medium">{r.partnerName ?? '—'}</TableCell>
                      <TableCell className="text-xs">{AR_METHOD[r.method] ?? r.method}</TableCell>
                      <TableCell className="max-w-56 truncate text-sm text-muted-foreground" title={r.notes ?? undefined}>
                        {r.notes ?? '—'}
                      </TableCell>
                      <TableCell className="num text-end text-sm text-emerald-600 dark:text-emerald-400">
                        {r.incoming !== 0 ? fmtMoney(r.incoming) : '—'}
                      </TableCell>
                      <TableCell className="num text-end text-sm text-rose-600 dark:text-rose-400">
                        {r.outgoing !== 0 ? fmtMoney(r.outgoing) : '—'}
                      </TableCell>
                      <TableCell className={cn('num text-end text-sm font-semibold', r.balance < 0 && NEG_CLS)}>
                        {fmtMoney(r.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className={TOTAL_ROW_CLS}>
                    <TableCell colSpan={6} className="text-sm">
                      إجمالي الفترة — الرصيد الختامي <span className="num">{fmtMoney(data?.closing ?? 0)}</span>
                    </TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(data?.totals.incoming ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(data?.totals.outgoing ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(data?.totals.net ?? 0)}</TableCell>
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

// ==================== تقرير المصروفات ====================

export function ExpensesReportView() {
  const currentYear = new Date().getFullYear()
  const [fFrom, setFFrom] = useState(`${currentYear}-01-01`)
  const [fTo, setFTo] = useState(todayYMD())
  const [applied, setApplied] = useState({ from: `${currentYear}-01-01`, to: todayYMD() })
  const { toast } = useToast()
  const { data, loading, run } = useReportFetch<ExpensesResponse>()

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

  useEffect(() => {
    void run(`/api/reports?type=expenses&from=${applied.from}&to=${applied.to}`)
  }, [run, applied])

  const periodLabel = `من ${fmtYMD(applied.from)} إلى ${fmtYMD(applied.to)}`
  const rows = data?.rows ?? []
  const details = data?.details ?? []
  const kpis = data?.kpis
  const isEmpty = !loading && rows.length === 0

  const exportRows = (): ExportCell[][] => {
    if (!data) return []
    const list: ExportCell[][] = data.rows.map((r): ExportCell[] => [
      r.code,
      r.name,
      r.entriesCount,
      r.total,
      r.share,
    ])
    list.push(['الإجمالي', `${data.rows.length} تصنيف`, data.kpis.entriesCount, data.totals.total, 100])
    return list
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          title="إجمالي المصروفات"
          value={fmtMoney(kpis?.total ?? 0)}
          hint={`≈ ${fmtUSD(kpis?.total ?? 0)}`}
          icon={Coins}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="عدد القيود"
          value={fmtNumber(kpis?.entriesCount ?? 0)}
          hint="قيود مُرحّلة بالفترة"
          icon={FileBarChart}
          tone="slate"
          loading={loading}
        />
        <KpiCard
          title="أعلى تصنيف"
          value={kpis?.topCategory ?? '—'}
          hint={rows.length > 0 ? `من ${fmtNumber(rows.length)} تصنيف` : 'الأعلى إنفاقاً'}
          icon={Receipt}
          tone="amber"
          loading={loading}
        />
        <KpiCard
          title="متوسط القيد"
          value={fmtMoney(kpis?.avgEntry ?? 0)}
          hint={kpis && kpis.entriesCount > 0 ? `الإجمالي ÷ ${fmtNumber(kpis.entriesCount)}` : 'متوسط قيمة القيد'}
          icon={TrendingDown}
          tone="rose"
          loading={loading}
        />
      </div>

      <SectionCard title="فلاتر التقرير" description="المصروفات حسب التصنيف من القيود المُرحّلة خلال الفترة" icon={Receipt}>
        <PeriodFields from={fFrom} to={fTo} onFromChange={setFFrom} onToChange={setFTo} onApply={apply} loading={loading} />
      </SectionCard>

      {/* جدولان داخل منطقة طباعة واحدة — التجميع بالتصنيف ثم آخر 100 حركة */}
      <SectionCard
        title="المصروفات حسب التصنيف"
        description={`الفترة — ${periodLabel}`}
        icon={BarChart3}
        action={
          <Badge variant="outline" className="num gap-1">
            {fmtNumber(rows.length)} تصنيف
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title={`تقرير المصروفات — ${periodLabel}`}
            filename="expenses"
            headers={['الكود', 'التصنيف', 'عدد القيود', 'الإجمالي', 'النسبة %']}
            rowsLoader={exportRows}
          />
          {loading ? (
            <ReportLoading />
          ) : isEmpty ? (
            <ReportEmpty message="لا توجد قيود مصروفات مُرحّلة خلال الفترة" />
          ) : (
            <>
              <div className="max-h-[560px] overflow-auto rounded-lg border">
                <Table className="min-w-[680px]">
                  <TableHeader className="sticky top-0 z-10">
                    <TableRow className="bg-muted hover:bg-muted">
                      <TableHead className="w-20">الكود</TableHead>
                      <TableHead className="min-w-44">التصنيف</TableHead>
                      <TableHead className="w-28 text-end">عدد القيود</TableHead>
                      <TableHead className="w-44 text-end">الإجمالي</TableHead>
                      <TableHead className="w-24 text-end">النسبة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.code}>
                        <TableCell className="num text-xs text-muted-foreground">{r.code}</TableCell>
                        <TableCell className="text-sm font-medium">{r.name}</TableCell>
                        <TableCell className="num text-end text-sm">{fmtNumber(r.entriesCount)}</TableCell>
                        <TableCell className="num text-end text-sm font-semibold">{fmtMoney(r.total)}</TableCell>
                        <TableCell className="num text-end text-sm text-muted-foreground">{fmtNumber(r.share)}%</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className={TOTAL_ROW_CLS}>
                      <TableCell colSpan={3} className="text-sm">
                        الإجمالي — <span className="num">{fmtNumber(rows.length)}</span> تصنيف
                      </TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(data?.totals.total ?? 0)}</TableCell>
                      <TableCell className="num text-end text-sm">100%</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              {/* تفاصيل آخر 100 حركة */}
              <div className="mt-6">
                <h4 className="mb-2 flex items-center gap-2 text-sm font-bold">
                  <Inbox className="h-4 w-4 text-primary" />
                  آخر حركة مصروف
                  <Badge variant="outline" className="num text-[10px]">
                    {fmtNumber(details.length)} حركة
                  </Badge>
                </h4>
                <div className="max-h-[420px] overflow-auto rounded-lg border">
                  <Table className="min-w-[760px]">
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="bg-muted hover:bg-muted">
                        <TableHead className="w-28">التاريخ</TableHead>
                        <TableHead className="w-28">القيد</TableHead>
                        <TableHead className="min-w-40">التصنيف</TableHead>
                        <TableHead className="min-w-48">البيان</TableHead>
                        <TableHead className="w-40 text-end">المبلغ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {details.map((d, i) => (
                        <TableRow key={`${d.entryNumber}-${i}`}>
                          <TableCell className="num text-xs text-muted-foreground">{fmtDate(d.date)}</TableCell>
                          <TableCell className="num text-xs font-medium">{d.entryNumber}</TableCell>
                          <TableCell className="text-sm font-medium">{d.accountName}</TableCell>
                          <TableCell className="max-w-64 truncate text-sm text-muted-foreground" title={d.description}>
                            {d.description}
                          </TableCell>
                          <TableCell className="num text-end text-sm">{fmtMoney(d.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}
        </div>
      </SectionCard>
    </div>
  )
}

// ==================== أعمار الذمم (عميل/مورد) ====================
// أرصدة الأطراف المدينة موزعة على فئات عمر الفواتير — مصدر الحقيقة نفسه رصيد شاشة الأطراف

const AGING_META = {
  CUSTOMER: {
    label: 'أعمار ذمم العملاء',
    word: 'عميل',
    empty: 'لا توجد ذمم قائمة على العملاء — كل الحسابات مسددة بالكامل',
    icon: Users,
  },
  SUPPLIER: {
    label: 'أعمار مستحقات الموردين',
    word: 'مورداً',
    empty: 'لا توجد مستحقات قائمة للموردين — كل الحسابات مسددة بالكامل',
    icon: NotebookText,
  },
} as const

export function ReceivablesAgingView() {
  const [side, setSide] = useState<'CUSTOMER' | 'SUPPLIER'>('CUSTOMER')
  const { data, loading, run } = useReportFetch<ReceivablesAgingResponse>()

  useEffect(() => {
    void run(`/api/reports?type=receivables-aging&side=${side}`)
  }, [run, side])

  const meta = AGING_META[side]
  const rows = data?.rows ?? []
  const kpis = data?.kpis
  const totals = data?.totals
  const isEmpty = !loading && rows.length === 0

  const exportRows = (): ExportCell[][] => {
    const list: ExportCell[][] = rows.map((r) => [
      r.code,
      r.name,
      r.carried,
      r.b0_30,
      r.b31_60,
      r.b61_90,
      r.b90plus,
      r.total,
      r.oldestDays ?? '',
    ])
    list.push([
      'الإجمالي',
      `${rows.length} ${meta.word}`,
      totals?.carried ?? 0,
      totals?.b0_30 ?? 0,
      totals?.b31_60 ?? 0,
      totals?.b61_90 ?? 0,
      totals?.b90plus ?? 0,
      totals?.total ?? 0,
      '',
    ])
    return list
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          title="إجمالي الذمم القائمة"
          value={fmtMoney(totals?.total ?? 0)}
          hint={`≈ ${fmtUSD(totals?.total ?? 0)}`}
          icon={Wallet}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="عدد الأطراف المدينة"
          value={fmtNumber(kpis?.partnersCount ?? 0)}
          hint={meta.label}
          icon={Users}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="متأخر أكثر من 90 يوماً"
          value={fmtMoney(kpis?.overdue90 ?? 0)}
          hint="يستوجب المتابعة والتحصيل العاجل"
          icon={Hourglass}
          tone={(kpis?.overdue90 ?? 0) > 0 ? 'rose' : 'emerald'}
          loading={loading}
          className={cn((kpis?.overdue90 ?? 0) > 0 && NEG_CLS)}
        />
        <KpiCard
          title="أكبر مدين"
          value={kpis?.topPartner ? kpis.topPartner.name : '—'}
          hint={kpis?.topPartner ? `مديونيته: ${fmtMoney(kpis.topPartner.total)}` : 'لا توجد ذمم قائمة'}
          icon={NotebookText}
          tone="slate"
          loading={loading}
        />
      </div>

      <SectionCard
        title={meta.label}
        description="رصيد كل طرف موزع بعمر فواتيره — الأرصدة المدوّرة من الفترة المقفلة تظهر في عمود «مرحّل»، والدفعات غير المخصصة تخمد من الأقدم أولاً"
        icon={meta.icon}
        action={
          <div className="flex gap-1 rounded-lg border p-1" role="group" aria-label="اختيار نوع الطرف">
            <Button
              size="sm"
              variant={side === 'CUSTOMER' ? 'default' : 'ghost'}
              className="h-7 gap-1 text-xs"
              onClick={() => setSide('CUSTOMER')}
            >
              <Users className="h-3.5 w-3.5" />
              العملاء
            </Button>
            <Button
              size="sm"
              variant={side === 'SUPPLIER' ? 'default' : 'ghost'}
              className="h-7 gap-1 text-xs"
              onClick={() => setSide('SUPPLIER')}
            >
              <Truck className="h-3.5 w-3.5" />
              الموردون
            </Button>
          </div>
        }
      >
        <div className="print-area">
          <TableActions
            title={`${meta.label} — حتى ${fmtYMD(todayYMD())}`}
            filename={side === 'CUSTOMER' ? 'customers-aging' : 'suppliers-aging'}
            headers={['الكود', 'الطرف', 'مرحّل (مقفلة)', '0-30 يوم', '31-60 يوم', '61-90 يوم', '+90 يوم', 'الإجمالي', 'أقدم فاتورة (يوم)']}
            rowsLoader={exportRows}
          />
          {loading ? (
            <ReportLoading />
          ) : isEmpty ? (
            <ReportEmpty message={meta.empty} />
          ) : (
            <div className="max-h-[560px] overflow-auto rounded-lg border">
              <Table className="min-w-[1040px]">
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="w-20">الكود</TableHead>
                    <TableHead className="min-w-44">الطرف</TableHead>
                    <TableHead className="w-32 text-end">مرحّل (مقفلة)</TableHead>
                    <TableHead className="w-32 text-end">0-30 يوم</TableHead>
                    <TableHead className="w-32 text-end">31-60 يوم</TableHead>
                    <TableHead className="w-32 text-end">61-90 يوم</TableHead>
                    <TableHead className="w-32 text-end">+90 يوم</TableHead>
                    <TableHead className="w-40 text-end">الإجمالي</TableHead>
                    <TableHead className="w-28 text-end">أقدم فاتورة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="num text-xs text-muted-foreground">{r.code}</TableCell>
                      <TableCell className="text-sm font-medium">
                        {r.name}
                        {r.phone ? <span className="num ms-2 text-xs text-muted-foreground">{r.phone}</span> : null}
                      </TableCell>
                      <TableCell className="num text-end text-sm text-muted-foreground">
                        {fmtMoney(r.carried)}
                      </TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.b0_30)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.b31_60)}</TableCell>
                      <TableCell className="num text-end text-sm">{fmtMoney(r.b61_90)}</TableCell>
                      <TableCell className={cn('num text-end text-sm', r.b90plus > 0 && NEG_CLS)}>
                        {fmtMoney(r.b90plus)}
                      </TableCell>
                      <TableCell className="num text-end text-sm font-semibold">{fmtMoney(r.total)}</TableCell>
                      <TableCell className="num text-end text-xs text-muted-foreground">
                        {r.oldestDays !== null ? `${fmtNumber(r.oldestDays)} يوم` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className={TOTAL_ROW_CLS}>
                    <TableCell colSpan={2} className="text-sm">
                      الإجمالي — <span className="num">{fmtNumber(rows.length)}</span> {meta.word}
                    </TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(totals?.carried ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(totals?.b0_30 ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(totals?.b31_60 ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(totals?.b61_90 ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(totals?.b90plus ?? 0)}</TableCell>
                    <TableCell className="num text-end text-sm">{fmtMoney(totals?.total ?? 0)}</TableCell>
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

// ==================== مقارنة الفترات ====================
// الفترة الحالية افتراضياً من أول الشهر حتى اليوم والسابقة يحسبها الخادم بنفس الطول
// (شهور تقويمية كاملة ← الشهور السابقة، جزئية ← نفس عدد الأيام) — 9 مؤشرات تشغيلية
// ومحاسبية بالفرق ونسبة التغير، والزيادة حسنة أو سيئة حسب طبيعة المؤشر

const GROUP_LABEL: Record<CompareRow['group'], string> = {
  sales: 'المبيعات',
  purchases: 'المشتريات',
  cash: 'النقدية',
  pnl: 'الأرباح والخسائر',
}

function deltaCls(r: CompareRow): string {
  if (Math.abs(r.delta) < 0.005) return 'text-muted-foreground'
  const good = r.goodWhen === 'up' ? r.delta > 0 : r.goodWhen === 'down' ? r.delta < 0 : null
  if (good === null) return ''
  return good ? 'text-emerald-600 dark:text-emerald-400' : NEG_CLS
}

const signedPct = (pct: number | null): string => (pct === null ? '—' : `${pct > 0 ? '+' : ''}${fmtNumber(pct)}%`)

export function PeriodComparisonView() {
  const { toast } = useToast()
  const monthStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`
  const [fFrom, setFFrom] = useState(monthStart)
  const [fTo, setFTo] = useState(todayYMD())
  const [applied, setApplied] = useState({ from: monthStart, to: todayYMD() })
  const { data, loading, run } = useReportFetch<PeriodComparisonResponse>()

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

  useEffect(() => {
    void run(`/api/reports?type=period-comparison&from=${applied.from}&to=${applied.to}`)
  }, [run, applied])

  const rows = data?.rows ?? []
  const kpis = data?.kpis
  const cur = data?.current
  const prev = data?.previous
  const isEmpty = !loading && rows.length === 0

  const salesRow = rows.find((r) => r.group === 'sales' && r.label === 'صافي المبيعات')
  const profitRow = rows.find((r) => r.label === 'صافي الربح المحاسبي')
  const receiptsRow = rows.find((r) => r.label === 'التحصيلات النقدية (سندات القبض)')

  const verdictMeta =
    kpis?.verdict === 'up'
      ? { text: 'الأرباح تتحسن', icon: TrendingUp, tone: 'emerald' as const }
      : kpis?.verdict === 'down'
        ? { text: 'الأرباح تتراجع', icon: TrendingDown, tone: 'rose' as const }
        : { text: 'الأرباح مستقرة', icon: Minus, tone: 'slate' as const }
  const VerdictIcon = verdictMeta.icon

  const fmtVal = (r: CompareRow, v: number): string => (r.kind === 'money' ? fmtMoney(v) : fmtNumber(v))

  const exportRows = (): ExportCell[][] =>
    rows.map((r) => [GROUP_LABEL[r.group], r.label, r.current, r.previous, r.delta, r.deltaPct === null ? '' : r.deltaPct])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          title="صافي المبيعات — الفترة الحالية"
          value={fmtMoney(salesRow?.current ?? 0)}
          hint={kpis?.salesDeltaPct === null ? 'لا توجد مبيعات بالفترة السابقة للمقارنة' : `التغير عن السابقة: ${signedPct(kpis?.salesDeltaPct ?? null)}`}
          icon={TrendingUp}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="صافي الربح المحاسبي"
          value={fmtMoney(profitRow?.current ?? 0)}
          hint={kpis?.profitDeltaPct === null ? 'لا توجد حركة بالفترة السابقة للمقارنة' : `التغير عن السابقة: ${signedPct(kpis?.profitDeltaPct ?? null)}`}
          icon={Coins}
          tone={(profitRow?.current ?? 0) >= 0 ? 'gold' : 'rose'}
          loading={loading}
          className={cn((profitRow?.current ?? 0) < 0 && NEG_CLS)}
        />
        <KpiCard
          title="التحصيلات النقدية"
          value={fmtMoney(receiptsRow?.current ?? 0)}
          hint={receiptsRow ? `السابقة: ${fmtMoney(receiptsRow.previous)}` : 'سندات القبض خلال الفترة'}
          icon={Wallet}
          tone="slate"
          loading={loading}
        />
        <KpiCard
          title="الحكم العام"
          value={verdictMeta.text}
          hint={
            kpis
              ? `فرق الربح: ${kpis.profitDelta > 0 ? '+' : ''}${fmtMoney(kpis.profitDelta)}`
              : 'مقارنة الربح الحالي بالسابق'
          }
          icon={VerdictIcon}
          tone={verdictMeta.tone}
          loading={loading}
          className={cn(kpis?.verdict === 'down' && NEG_CLS)}
        />
      </div>

      <SectionCard
        title="فلاتر المقارنة"
        description="الافتراضي: أول الشهر الحالي حتى اليوم مقابل الفترة المماثلة السابقة — عدّل الفترة ثم طبّق"
        icon={CalendarDays}
      >
        <PeriodFields
          from={fFrom}
          to={fTo}
          onFromChange={setFFrom}
          onToChange={setFTo}
          onApply={apply}
          loading={loading}
          applyLabel="قارن الفترتين"
        />
      </SectionCard>

      <SectionCard
        title="نتيجة المقارنة"
        description={
          cur && prev
            ? `الحالية ${fmtYMD(cur.from)} — ${fmtYMD(cur.to)} مقابل السابقة ${fmtYMD(prev.from)} — ${fmtYMD(prev.to)}`
            : 'تسع مؤشرات بالفرق ونسبة التغير'
        }
        icon={FileBarChart}
      >
        <div className="print-area">
          <TableActions
            title={`مقارنة الفترات — ${cur ? `${fmtYMD(cur.from)} — ${fmtYMD(cur.to)}` : ''} مقابل ${prev ? `${fmtYMD(prev.from)} — ${fmtYMD(prev.to)}` : ''}`}
            filename="period-comparison"
            headers={['المجموعة', 'المؤشر', 'الفترة الحالية', 'الفترة السابقة', 'الفرق', 'التغير %']}
            rowsLoader={exportRows}
          />
          {loading ? (
            <ReportLoading />
          ) : isEmpty ? (
            <ReportEmpty message="تعذر توليد المقارنة — تحقق من الفترة المختارة" />
          ) : (
            <div className="max-h-[560px] overflow-auto rounded-lg border">
              <Table className="min-w-[820px]">
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="w-36">المؤشر</TableHead>
                    <TableHead className="w-40 text-end">{cur ? `${fmtYMD(cur.from)} — ${fmtYMD(cur.to)}` : 'الفترة الحالية'}</TableHead>
                    <TableHead className="w-40 text-end">{prev ? `${fmtYMD(prev.from)} — ${fmtYMD(prev.to)}` : 'الفترة السابقة'}</TableHead>
                    <TableHead className="w-36 text-end">الفرق</TableHead>
                    <TableHead className="w-24 text-end">التغير %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => {
                    const showGroup = i === 0 || rows[i - 1].group !== r.group
                    return (
                      <Fragment key={r.label}>
                        {showGroup && (
                          <TableRow className="bg-muted/50 hover:bg-muted/50">
                            <TableCell colSpan={5} className="text-xs font-bold text-primary">
                              {GROUP_LABEL[r.group]}
                            </TableCell>
                          </TableRow>
                        )}
                        <TableRow>
                          <TableCell className="text-sm">{r.label}</TableCell>
                          <TableCell className="num text-end text-sm font-semibold">{fmtVal(r, r.current)}</TableCell>
                          <TableCell className="num text-end text-sm">{fmtVal(r, r.previous)}</TableCell>
                          <TableCell className={cn('num text-end text-sm', deltaCls(r))}>
                            {r.delta > 0 ? '+' : ''}
                            {fmtVal(r, r.delta)}
                          </TableCell>
                          <TableCell className={cn('num text-end text-xs', deltaCls(r))}>{signedPct(r.deltaPct)}</TableCell>
                        </TableRow>
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  )
}
