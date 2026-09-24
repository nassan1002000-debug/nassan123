'use client'

// التقارير المالية الثلاثة — ميزان المراجعة / قائمة الدخل / الميزانية العمومية
// نقل تنفيذ الشاشة السابقة كما هو: KPIs + فلاتر الفترة + جداول + توازن + طباعة وتصدير
// (التبويبات استُبدلت بتنقل مركز التقارير — كل تقرير مكوّن مستقل بنوعه)

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BarChart3,
  CheckCircle2,
  Coins,
  FileBarChart,
  Loader2,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { KpiCard } from '@/components/common/kpi-card'
import { SectionCard } from '@/components/common/section-card'
import { TableActions } from '@/components/screens/common/table-actions'
import { useToast } from '@/hooks/use-toast'
import {
  BADGE_BALANCED,
  BADGE_UNBALANCED,
  NEG_CLS,
  PeriodFields,
  ReportEmpty,
  ReportLoading,
  TOTAL_ROW_CLS,
  fmtYMD,
  useReportFetch,
} from './report-shared'
import { AR_ACCOUNT_TYPE, fmtMoney, fmtNumber, fmtUSD, todayYMD } from '@/lib/format'
import type { ExportCell } from '@/lib/export'
import { cn } from '@/lib/utils'

// ==================== أنواع بيانات التقرير (مطابقة لاستجابة /api/reports) ====================

export type FinancialReportType = 'trial-balance' | 'income-statement' | 'balance-sheet'

interface TrialBalanceRow {
  accountId: string
  code: string
  name: string
  type: string
  totalDebit: number
  totalCredit: number
  balance: number
}

interface TrialBalanceResponse {
  type: 'trial-balance'
  from: string
  to: string
  rows: TrialBalanceRow[]
  totals: { totalDebit: number; totalCredit: number; balance: number }
  count: number
  balanced: boolean
}

interface StatementRow {
  accountId: string
  code: string
  name: string
  amount: number
}

interface StatementSection {
  rows: StatementRow[]
  total: number
}

interface IncomeStatementResponse {
  type: 'income-statement'
  from: string
  to: string
  revenues: StatementSection
  expenses: StatementSection
  netProfit: number
  count: number
}

interface BalanceSheetRow {
  accountId: string
  code: string
  name: string
  amount: number
  isResult: boolean
}

interface BalanceSheetSection {
  rows: BalanceSheetRow[]
  total: number
}

interface BalanceSheetResponse {
  type: 'balance-sheet'
  to: string
  assets: BalanceSheetSection
  liabilities: BalanceSheetSection
  equity: BalanceSheetSection
  result: number
  totals: { assets: number; liabilities: number; equity: number; liabilitiesAndEquity: number }
  balanced: boolean
  count: number
}

type ReportData = TrialBalanceResponse | IncomeStatementResponse | BalanceSheetResponse

// ==================== ثوابت العرض ====================

const REPORT_META: Record<FinancialReportType, { label: string; description: string }> = {
  'trial-balance': {
    label: 'ميزان المراجعة',
    description: 'حركة الفترة لكل حساب ورقي (بلا أبناء) مع التحقق من توازن المدين والدائن',
  },
  'income-statement': {
    label: 'قائمة الدخل',
    description: 'الإيرادات والمصروفات خلال الفترة وصافي الربح أو الخسارة',
  },
  'balance-sheet': {
    label: 'الميزانية العمومية',
    description: 'الأصول والخصوم وحقوق الملكية تراكمياً حتى تاريخ التقرير مع سطر النتيجة',
  },
}

const EXPORT_HEADERS: Record<FinancialReportType, string[]> = {
  'trial-balance': ['الكود', 'الحساب', 'النوع', 'مدين', 'دائن', 'الرصيد'],
  'income-statement': ['القسم', 'الكود', 'الحساب', 'المبلغ'],
  'balance-sheet': ['القسم', 'الكود', 'الحساب', 'الرصيد'],
}

/** صف رأس قسم داخل جدول التقرير (الإيرادات/المصروفات/الأصول…) */
function SectionRow({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <TableRow className="bg-muted/60 hover:bg-muted/60">
      <TableCell colSpan={colSpan} className="text-sm font-bold text-foreground">
        {label}
      </TableCell>
    </TableRow>
  )
}

/** صف إجمالي فرعي/نهائي مميّز بالذهبي (لون الثيم الأساسي) */
function TotalRow({
  label,
  amount,
  colSpan,
  negative,
}: {
  label: string
  amount: number
  colSpan: number
  negative?: boolean
}) {
  return (
    <TableRow className={TOTAL_ROW_CLS}>
      <TableCell colSpan={colSpan} className="text-sm">
        {label}
      </TableCell>
      <TableCell className={cn('num text-end text-sm', negative && NEG_CLS)}>
        {fmtMoney(amount)}
      </TableCell>
    </TableRow>
  )
}

// ==================== بناء صفوف التصدير (قيم خام بلا تنسيق) ====================

function exportRowsFor(d: ReportData): ExportCell[][] {
  switch (d.type) {
    case 'trial-balance': {
      const rows: ExportCell[][] = d.rows.map((r) => [
        r.code,
        r.name,
        AR_ACCOUNT_TYPE[r.type] ?? r.type,
        r.totalDebit,
        r.totalCredit,
        r.balance,
      ])
      rows.push(['الإجمالي', '', '', d.totals.totalDebit, d.totals.totalCredit, d.totals.balance])
      return rows
    }
    case 'income-statement': {
      const rows: ExportCell[][] = d.revenues.rows.map(
        (r): ExportCell[] => ['إيرادات', r.code, r.name, r.amount],
      )
      rows.push(['إيرادات', '', 'إجمالي الإيرادات', d.revenues.total])
      for (const r of d.expenses.rows) rows.push(['مصروفات', r.code, r.name, r.amount])
      rows.push(['مصروفات', '', 'إجمالي المصروفات', d.expenses.total])
      rows.push(['', '', 'صافي الربح (الإيرادات − المصروفات)', d.netProfit])
      return rows
    }
    case 'balance-sheet': {
      const rows: ExportCell[][] = d.assets.rows.map(
        (r): ExportCell[] => ['أصول', r.code, r.name, r.amount],
      )
      rows.push(['أصول', '', 'إجمالي الأصول', d.assets.total])
      for (const r of d.liabilities.rows) rows.push(['خصوم', r.code, r.name, r.amount])
      rows.push(['خصوم', '', 'إجمالي الخصوم', d.liabilities.total])
      for (const r of d.equity.rows) rows.push(['حقوق ملكية', r.code, r.name, r.amount])
      rows.push(['حقوق ملكية', '', 'إجمالي حقوق الملكية', d.equity.total])
      rows.push(['', '', 'إجمالي الخصوم وحقوق الملكية', d.totals.liabilitiesAndEquity])
      rows.push(['', '', 'حالة التوازن', d.balanced ? 'متوازنة' : 'غير متوازنة'])
      return rows
    }
  }
}

// ==================== جداول التقرير ====================

function TrialBalanceTable({ d }: { d: TrialBalanceResponse }) {
  return (
    <Table className="min-w-[780px]">
      <TableHeader className="sticky top-0 z-10">
        <TableRow className="bg-muted hover:bg-muted">
          <TableHead className="w-20">الكود</TableHead>
          <TableHead className="min-w-52">الحساب</TableHead>
          <TableHead className="w-24">النوع</TableHead>
          <TableHead className="w-44 text-end">مدين (حركة الفترة)</TableHead>
          <TableHead className="w-44 text-end">دائن (حركة الفترة)</TableHead>
          <TableHead className="w-40 text-end">الرصيد</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {d.rows.map((r) => (
          <TableRow key={r.accountId}>
            <TableCell className="num text-xs text-muted-foreground">{r.code}</TableCell>
            <TableCell className="text-sm font-medium">{r.name}</TableCell>
            <TableCell>
              <Badge variant="outline" className="text-xs">
                {AR_ACCOUNT_TYPE[r.type] ?? r.type}
              </Badge>
            </TableCell>
            <TableCell className="num text-end text-sm">{fmtMoney(r.totalDebit)}</TableCell>
            <TableCell className="num text-end text-sm">{fmtMoney(r.totalCredit)}</TableCell>
            <TableCell className={cn('num text-end text-sm font-semibold', r.balance < 0 && NEG_CLS)}>
              {fmtMoney(r.balance)}
            </TableCell>
          </TableRow>
        ))}
        <TableRow className={TOTAL_ROW_CLS}>
          <TableCell colSpan={3} className="text-sm">
            الإجمالي — <span className="num">{fmtNumber(d.rows.length)}</span> حساب
          </TableCell>
          <TableCell className="num text-end text-sm">{fmtMoney(d.totals.totalDebit)}</TableCell>
          <TableCell className="num text-end text-sm">{fmtMoney(d.totals.totalCredit)}</TableCell>
          <TableCell className="num text-end text-sm">{fmtMoney(d.totals.balance)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}

function IncomeStatementTable({ d }: { d: IncomeStatementResponse }) {
  const renderRow = (r: StatementRow) => (
    <TableRow key={r.accountId}>
      <TableCell className="num w-20 text-xs text-muted-foreground">{r.code}</TableCell>
      <TableCell className="text-sm font-medium">{r.name}</TableCell>
      <TableCell className={cn('num w-44 text-end text-sm', r.amount < 0 && NEG_CLS)}>
        {fmtMoney(r.amount)}
      </TableCell>
    </TableRow>
  )

  return (
    <Table className="min-w-[640px]">
      <TableHeader className="sticky top-0 z-10">
        <TableRow className="bg-muted hover:bg-muted">
          <TableHead className="w-20">الكود</TableHead>
          <TableHead className="min-w-56">الحساب</TableHead>
          <TableHead className="w-44 text-end">المبلغ</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <SectionRow label="الإيرادات" colSpan={3} />
        {d.revenues.rows.map(renderRow)}
        <TotalRow label="إجمالي الإيرادات" amount={d.revenues.total} colSpan={2} />

        <SectionRow label="المصروفات" colSpan={3} />
        {d.expenses.rows.map(renderRow)}
        <TotalRow label="إجمالي المصروفات" amount={d.expenses.total} colSpan={2} />

        {/* صافي الربح — بالأحمر إن كان سالباً (خسارة) */}
        <TableRow
          className={cn(
            'bg-primary/10 text-base font-bold hover:bg-primary/10',
            d.netProfit < 0 ? NEG_CLS : 'text-primary',
          )}
        >
          <TableCell colSpan={2} className="text-sm">
            {d.netProfit >= 0 ? 'صافي الربح (الإيرادات − المصروفات)' : 'صافي الخسارة (المصروفات − الإيرادات)'}
          </TableCell>
          <TableCell className="num text-end text-sm">{fmtMoney(Math.abs(d.netProfit))}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}

function BalanceSheetTable({ d }: { d: BalanceSheetResponse }) {
  const renderRow = (r: BalanceSheetRow) => (
    <TableRow key={r.isResult ? 'result-row' : r.accountId}>
      <TableCell className="num w-20 text-xs text-muted-foreground">{r.code || '—'}</TableCell>
      <TableCell className={cn('text-sm font-medium', r.isResult && 'font-bold text-primary')}>
        {r.name}
        {r.isResult && (
          <Badge
            variant="outline"
            className={cn('ms-2 text-[10px]', d.result >= 0 ? BADGE_BALANCED : BADGE_UNBALANCED)}
          >
            {d.result >= 0 ? 'ربح' : 'خسارة'}
          </Badge>
        )}
      </TableCell>
      <TableCell
        className={cn('num w-44 text-end text-sm', r.amount < 0 && NEG_CLS, r.isResult && 'font-bold')}
      >
        {fmtMoney(r.amount)}
      </TableCell>
    </TableRow>
  )

  return (
    <Table className="min-w-[640px]">
      <TableHeader className="sticky top-0 z-10">
        <TableRow className="bg-muted hover:bg-muted">
          <TableHead className="w-20">الكود</TableHead>
          <TableHead className="min-w-56">الحساب</TableHead>
          <TableHead className="w-44 text-end">الرصيد حتى {fmtYMD(d.to)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <SectionRow label="الأصول" colSpan={3} />
        {d.assets.rows.map(renderRow)}
        <TotalRow label="إجمالي الأصول" amount={d.assets.total} colSpan={2} />

        <SectionRow label="الخصوم" colSpan={3} />
        {d.liabilities.rows.map(renderRow)}
        <TotalRow label="إجمالي الخصوم" amount={d.liabilities.total} colSpan={2} />

        <SectionRow label="حقوق الملكية" colSpan={3} />
        {d.equity.rows.map(renderRow)}
        <TotalRow
          label="إجمالي حقوق الملكية (شاملة النتيجة)"
          amount={d.equity.total}
          colSpan={2}
          negative={d.equity.total < 0}
        />

        <TotalRow
          label="إجمالي الخصوم وحقوق الملكية"
          amount={d.totals.liabilitiesAndEquity}
          colSpan={2}
          negative={d.totals.liabilitiesAndEquity < 0}
        />
      </TableBody>
    </Table>
  )
}

// ==================== واجهة التقرير المالي ====================

export function FinancialReportView({ type }: { type: FinancialReportType }) {
  const { toast } = useToast()
  const currentYear = new Date().getFullYear()
  const defaultFrom = `${currentYear}-01-01`
  const defaultTo = todayYMD()

  // قيم حقول الفترة (لم تُطبَّق بعد) + الفلاتر المطبَّقة فعلياً على الطلب
  const [fFrom, setFFrom] = useState(defaultFrom)
  const [fTo, setFTo] = useState(defaultTo)
  const [applied, setApplied] = useState<{ from: string; to: string }>({ from: defaultFrom, to: defaultTo })

  const { data, loading, run } = useReportFetch<ReportData>()

  // ===== جلب التقرير عند تغير النوع أو الفترة المطبَّقة =====
  const load = useCallback(async () => {
    const params = new URLSearchParams({ type })
    if (applied.from) params.set('from', applied.from)
    if (applied.to) params.set('to', applied.to)
    await run(`/api/reports?${params.toString()}`)
  }, [type, applied, run])

  useEffect(() => {
    void load()
  }, [load])

  // زر «عرض التقرير» — يطبّق الفترة المحددة (تحقق: من ≤ إلى)
  const applyPeriod = useCallback(() => {
    if (type !== 'balance-sheet' && fFrom && fTo && fFrom > fTo) {
      toast({
        title: 'فترة غير صحيحة',
        description: 'تاريخ «من» يجب أن يكون قبلاً أو مساوياً لتاريخ «إلى»',
        variant: 'destructive',
      })
      return
    }
    setApplied((prev) => ({ ...prev, from: fFrom, to: fTo }))
  }, [fFrom, fTo, type, toast])

  // بيانات مقسومة بالنوع بعد التضييق (narrowing) بلا any
  const tb = data?.type === 'trial-balance' ? data : null
  const inc = data?.type === 'income-statement' ? data : null
  const bs = data?.type === 'balance-sheet' ? data : null

  const meta = REPORT_META[type]

  const periodLabel =
    type === 'balance-sheet'
      ? `حتى تاريخ ${fmtYMD(applied.to)}`
      : `من ${fmtYMD(applied.from)} إلى ${fmtYMD(applied.to)}`

  // حالة التوازن (للميزان والميزانية) — لوسم «متوازنة ✓ / غير متوازنة!»
  const balanceInfo: { balanced: boolean } | null = tb
    ? { balanced: tb.balanced }
    : bs
      ? { balanced: bs.balanced }
      : null

  const isEmpty =
    !loading &&
    (!data ||
      (data.type === 'trial-balance' && data.rows.length === 0) ||
      (data.type === 'income-statement' && data.count === 0) ||
      (data.type === 'balance-sheet' && data.count === 0))

  return (
    <div className="space-y-4">
      {/* بطاقات المؤشرات — حسب نوع التقرير */}
      {type === 'trial-balance' && (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <KpiCard
            title="إجمالي المدين"
            value={fmtMoney(tb?.totals.totalDebit ?? 0)}
            hint={`≈ ${fmtUSD(tb?.totals.totalDebit ?? 0)}`}
            icon={ArrowDownCircle}
            tone="gold"
            loading={loading}
          />
          <KpiCard
            title="إجمالي الدائن"
            value={fmtMoney(tb?.totals.totalCredit ?? 0)}
            hint={`≈ ${fmtUSD(tb?.totals.totalCredit ?? 0)}`}
            icon={ArrowUpCircle}
            tone="gold"
            loading={loading}
          />
          <KpiCard
            title="عدد الحسابات"
            value={fmtNumber(tb?.count ?? 0)}
            hint="حسابات ورقية ذات حركة"
            icon={BarChart3}
            tone="slate"
            loading={loading}
          />
          <KpiCard
            title="حالة التوازن"
            value={loading ? '' : (tb?.balanced ?? false) ? 'متوازنة ✓' : 'غير متوازنة!'}
            hint={
              tb
                ? `فرق المدين والدائن: ${fmtMoney(Math.abs(tb.totals.balance))}`
                : 'مدين = دائن'
            }
            icon={(tb?.balanced ?? false) ? CheckCircle2 : XCircle}
            tone={(tb?.balanced ?? false) ? 'emerald' : 'rose'}
            loading={loading}
          />
        </div>
      )}

      {type === 'income-statement' && (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <KpiCard
            title="إجمالي الإيرادات"
            value={fmtMoney(inc?.revenues.total ?? 0)}
            hint={`≈ ${fmtUSD(inc?.revenues.total ?? 0)}`}
            icon={Coins}
            tone="emerald"
            loading={loading}
          />
          <KpiCard
            title="إجمالي المصروفات"
            value={fmtMoney(inc?.expenses.total ?? 0)}
            hint={`≈ ${fmtUSD(inc?.expenses.total ?? 0)}`}
            icon={TrendingDown}
            tone="amber"
            loading={loading}
          />
          <KpiCard
            title={(inc?.netProfit ?? 0) >= 0 ? 'صافي الربح' : 'صافي الخسارة'}
            value={fmtMoney(Math.abs(inc?.netProfit ?? 0))}
            hint={`≈ ${fmtUSD(Math.abs(inc?.netProfit ?? 0))}${(inc?.netProfit ?? 0) < 0 ? ' — خسارة' : ''}`}
            icon={(inc?.netProfit ?? 0) >= 0 ? TrendingUp : TrendingDown}
            tone={(inc?.netProfit ?? 0) >= 0 ? 'gold' : 'rose'}
            loading={loading}
            className={cn((inc?.netProfit ?? 0) < 0 && NEG_CLS)}
          />
          <KpiCard
            title="عدد الحسابات"
            value={fmtNumber(inc?.count ?? 0)}
            hint="إيرادات ومصروفات ذات حركة"
            icon={BarChart3}
            tone="slate"
            loading={loading}
          />
        </div>
      )}

      {type === 'balance-sheet' && (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <KpiCard
            title="إجمالي الأصول"
            value={fmtMoney(bs?.totals.assets ?? 0)}
            hint={`≈ ${fmtUSD(bs?.totals.assets ?? 0)}`}
            icon={ArrowUpCircle}
            tone="gold"
            loading={loading}
          />
          <KpiCard
            title="إجمالي الخصوم"
            value={fmtMoney(bs?.totals.liabilities ?? 0)}
            hint={`≈ ${fmtUSD(bs?.totals.liabilities ?? 0)}`}
            icon={ArrowDownCircle}
            tone="amber"
            loading={loading}
          />
          <KpiCard
            title="حقوق الملكية"
            value={fmtMoney(bs?.totals.equity ?? 0)}
            hint={`≈ ${fmtUSD(bs?.totals.equity ?? 0)} — شاملة النتيجة`}
            icon={TrendingUp}
            tone="emerald"
            loading={loading}
          />
          <KpiCard
            title="حالة التوازن"
            value={loading ? '' : (bs?.balanced ?? false) ? 'متوازنة ✓' : 'غير متوازنة!'}
            hint={
              bs
                ? `الأصول − (الخصوم + حقوق الملكية): ${fmtMoney(
                    Math.abs(bs.totals.assets - bs.totals.liabilitiesAndEquity),
                  )}`
                : 'الأصول = الخصوم + حقوق الملكية'
            }
            icon={(bs?.balanced ?? false) ? CheckCircle2 : XCircle}
            tone={(bs?.balanced ?? false) ? 'emerald' : 'rose'}
            loading={loading}
          />
        </div>
      )}

      {/* شريط الفلاتر */}
      <SectionCard title="فلاتر التقرير" description={meta.description} icon={SlidersHorizontal}>
        <PeriodFields
          from={fFrom}
          to={fTo}
          onFromChange={setFFrom}
          onToChange={setFTo}
          onApply={applyPeriod}
          loading={loading}
          hideFrom={type === 'balance-sheet'}
        />
      </SectionCard>

      {/* جدول التقرير — منطقة الطباعة */}
      <SectionCard
        title={meta.label}
        description={`${type === 'balance-sheet' ? 'تراكمي' : 'حركة الفترة'} — ${periodLabel}`}
        icon={FileBarChart}
        action={
          <div className="flex items-center gap-2">
            {balanceInfo && !loading && (
              <Badge
                variant="outline"
                className={cn('gap-1 text-sm', balanceInfo.balanced ? BADGE_BALANCED : BADGE_UNBALANCED)}
              >
                {balanceInfo.balanced ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                {balanceInfo.balanced ? 'متوازنة ✓' : 'غير متوازنة!'}
              </Badge>
            )}
            <Badge variant="outline" className="num gap-1">
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {fmtNumber(data?.count ?? 0)} سطر
            </Badge>
          </div>
        }
      >
        <div className="print-area">
          <TableActions
            title={`${meta.label} — ${periodLabel}`}
            filename={type}
            headers={EXPORT_HEADERS[type]}
            rowsLoader={() => (data ? exportRowsFor(data) : [])}
          />
          {loading ? (
            <ReportLoading />
          ) : isEmpty ? (
            <ReportEmpty message="لا توجد حركات في الفترة — جرّب توسيع الفترة أو راجع القيود المُرحّلة" />
          ) : (
            <div className="max-h-[560px] overflow-auto rounded-lg border">
              {data?.type === 'trial-balance' && <TrialBalanceTable d={data} />}
              {data?.type === 'income-statement' && <IncomeStatementTable d={data} />}
              {data?.type === 'balance-sheet' && <BalanceSheetTable d={data} />}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  )
}
