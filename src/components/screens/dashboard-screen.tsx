'use client'

// لوحة التحكم — مؤشرات مالية + رسوم بيانية + أحدث النشاط + تنبيهات المخزون
// البيانات من GET /api/dashboard (جلب بسيط عبر fetch + useEffect)

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  BookOpenText,
  Boxes,
  Inbox,
  PackageSearch,
  PieChart as PieChartIcon,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  Users,
  Truck,
  PiggyBank,
  RotateCcw,
} from 'lucide-react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { KpiCard } from '@/components/common/kpi-card'
import { SectionCard } from '@/components/common/section-card'
import { StatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import {
  AR_ENTRY_STATUS,
  AR_INVOICE_STATUS,
  AR_INVOICE_TYPE,
  AR_MOVE_TYPE,
  fmtDate,
  fmtMoney,
  fmtNumber,
  fmtQty,
  fmtUSD,
} from '@/lib/format'
import { cn } from '@/lib/utils'

// ==================== الأنواع ====================

interface MonthPoint {
  month: string
  label: string
  revenue: number
  expense: number
  profit: number
}

interface DashboardData {
  kpis: {
    totalRevenue: number
    totalExpense: number
    netProfit: number
    liquidity: number
    inventoryValue: number
    customersCount: number
    suppliersCount: number
    lowStockCount: number
  }
  chart: MonthPoint[]
  assetsDistribution: { name: string; value: number }[]
  recentInvoices: {
    id: string
    number: string
    type: string
    partnerName: string
    total: number
    status: string
    date: string
  }[]
  recentEntries: {
    id: string
    number: string
    description: string
    totalDebit: number
    status: string
    date: string
  }[]
  recentMovements: {
    id: string
    itemName: string
    type: string
    quantity: number
    date: string
    reason: string | null
  }[]
  lowStock: {
    itemId: string
    itemName: string
    available: number
    minStock: number
    unit: string
  }[]
  invoiceStatusCounts: { PAID: number; PARTIAL: number; UNPAID: number }
}

// ==================== أدوات مساعدة ====================

function compactNum(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`
  return `${Math.round(n)}`
}

// نافذة تلميح حيّة مضيئة موحّدة للرسوم — التفاصيل المالية تظهر عند الهوفر فقط
function GlowTooltip({
  active,
  payload,
  label,
  showPercent = false,
  total = 0,
}: {
  active?: boolean
  payload?: { name?: string; value?: number | string; color?: string; fill?: string }[]
  label?: string | number
  showPercent?: boolean
  total?: number
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div
      dir="rtl"
      className="rounded-xl border border-white/15 bg-card/95 px-3.5 py-2.5 backdrop-blur-sm"
      style={{
        boxShadow:
          '0 12px 30px rgba(0,0,0,0.55), 0 0 20px color-mix(in oklab, var(--primary) 26%, transparent), inset 0 1px 0 rgba(255,255,255,0.14)',
      }}
    >
      {label !== undefined && label !== '' && (
        <p className="mb-1.5 text-xs font-bold text-foreground">{label}</p>
      )}
      <div className="space-y-1.5">
        {payload.map((item, i) => {
          const dot = item.color ?? item.fill ?? 'var(--primary)'
          const val = fmtMoney(Number(item.value ?? 0))
          const pct = total > 0 ? Math.round((Number(item.value ?? 0) / total) * 100) : 0
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: dot, boxShadow: `0 0 6px ${dot}` }}
              />
              <span className="text-muted-foreground">{item.name}</span>
              <span className="font-bold text-foreground num">{val}</span>
              {showPercent && <span className="text-[10px] text-muted-foreground num">{pct}%</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const listRows = [0, 1, 2, 3, 4]

const moveTone: Record<string, { text: string; bg: string }> = {
  IN: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' },
  OUT: { text: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/12 text-rose-600 dark:text-rose-400' },
  TRANSFER: { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/12 text-amber-600 dark:text-amber-400' },
}

const statusProgressColor: Record<string, string> = {
  PAID: '[&>div]:bg-emerald-500',
  PARTIAL: '[&>div]:bg-amber-500',
  UNPAID: '[&>div]:bg-rose-500',
}

// ==================== حالات فرعية ====================

function ListEmpty({ text, icon: Icon }: { text: string; icon: typeof Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="rounded-xl bg-muted p-3">
        <Icon className="h-6 w-6 text-muted-foreground/60" />
      </div>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {listRows.map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  )
}

function ChartSkeleton() {
  return <Skeleton className="h-[280px] w-full rounded-xl" />
}

// ==================== الشاشة ====================

export default function DashboardScreen() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as DashboardData
      setData(json)
    } catch {
      setData(null)
      toast({
        title: 'خطأ في التحميل',
        description: 'تعذّر جلب بيانات لوحة التحكم، حاول مجدداً',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  // حالة فشل التحميل الكامل
  if (!loading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center rounded-xl border bg-card">
        <div className="text-center">
          <div className="mx-auto w-fit rounded-xl bg-amber-500/12 p-4">
            <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="mt-4 font-semibold">تعذّر تحميل بيانات لوحة التحكم</p>
          <p className="mt-1 text-sm text-muted-foreground">تأكد من تشغيل الخادم ثم أعد المحاولة</p>
          <Button onClick={() => load()} className="mt-5 gap-2">
            <RotateCcw className="h-4 w-4" />
            إعادة المحاولة
          </Button>
        </div>
      </div>
    )
  }

  const k = data?.kpis
  const chart = data?.chart ?? []
  const assets = data?.assetsDistribution ?? []
  const assetsTotal = assets.reduce((sum, a) => sum + a.value, 0)
  const lowStock = data?.lowStock ?? []
  const invoiceCounts = data?.invoiceStatusCounts ?? { PAID: 0, PARTIAL: 0, UNPAID: 0 }
  const invoicesTotal = invoiceCounts.PAID + invoiceCounts.PARTIAL + invoiceCounts.UNPAID

  const invoiceStatusRows = [
    { key: 'PAID', label: AR_INVOICE_STATUS.PAID, count: invoiceCounts.PAID },
    { key: 'PARTIAL', label: AR_INVOICE_STATUS.PARTIAL, count: invoiceCounts.PARTIAL },
    { key: 'UNPAID', label: AR_INVOICE_STATUS.UNPAID, count: invoiceCounts.UNPAID },
  ]

  return (
    <div className="space-y-4">
      {/* ==================== شريط المؤشرات ==================== */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          loading={loading}
          title="إجمالي الإيرادات"
          value={fmtMoney(k?.totalRevenue ?? 0)}
          hint={`≈ ${fmtUSD(k?.totalRevenue ?? 0)}`}
          icon={TrendingUp}
          tone="emerald"
        />
        <KpiCard
          loading={loading}
          title="إجمالي المصروفات"
          value={fmtMoney(k?.totalExpense ?? 0)}
          hint={`≈ ${fmtUSD(k?.totalExpense ?? 0)}`}
          icon={TrendingDown}
          tone="rose"
        />
        <KpiCard
          loading={loading}
          title="صافي الربح"
          value={fmtMoney(k?.netProfit ?? 0)}
          hint={`≈ ${fmtUSD(k?.netProfit ?? 0)}`}
          icon={PiggyBank}
          tone="gold"
          trend={(k?.netProfit ?? 0) >= 0 ? 'up' : 'down'}
          trendText={(k?.netProfit ?? 0) >= 0 ? 'مربح' : 'خسارة'}
        />
        <KpiCard
          loading={loading}
          title="السيولة (صندوق + بنك)"
          value={fmtMoney(k?.liquidity ?? 0)}
          hint={`≈ ${fmtUSD(k?.liquidity ?? 0)}`}
          icon={Banknote}
          tone="gold"
        />
        <KpiCard
          loading={loading}
          title="قيمة المخزون"
          value={fmtMoney(k?.inventoryValue ?? 0)}
          hint={`≈ ${fmtUSD(k?.inventoryValue ?? 0)}`}
          icon={Boxes}
          tone="amber"
        />
        <KpiCard
          loading={loading}
          title="عدد العملاء"
          value={fmtNumber(k?.customersCount ?? 0)}
          hint="مسجّل في النظام"
          icon={Users}
          tone="slate"
        />
        <KpiCard
          loading={loading}
          title="عدد الموردين"
          value={fmtNumber(k?.suppliersCount ?? 0)}
          hint="مسجّل في النظام"
          icon={Truck}
          tone="slate"
        />
        <KpiCard
          loading={loading}
          title="أصناف تحت الحد الأدنى"
          value={fmtNumber(k?.lowStockCount ?? 0)}
          hint="بحاجة إلى تزويد"
          icon={PackageSearch}
          tone={(k?.lowStockCount ?? 0) > 0 ? 'rose' : 'emerald'}
        />
      </div>

      {/* ==================== صف الرسوم البيانية ==================== */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          title="الأداء المالي — 6 أشهر"
          description="الإيرادات والمصروفات وصافي الربح شهرياً"
          icon={TrendingUp}
          className="lg:col-span-2"
        >
          {loading ? (
            <ChartSkeleton />
          ) : (
            <div
              className="overflow-hidden [&_.exp-bar_path]:[filter:drop-shadow(0_6px_9px_rgba(0,0,0,.5))_drop-shadow(0_0_10px_color-mix(in_oklab,var(--chart-3)_45%,transparent))] [&_.profit-line_circle]:[filter:drop-shadow(0_0_5px_var(--chart-1))] [&_.profit-line_path]:[filter:drop-shadow(0_0_7px_var(--chart-1))_drop-shadow(0_2px_5px_rgba(0,0,0,.5))] [&_.rev-bar_path]:[filter:drop-shadow(0_6px_9px_rgba(0,0,0,.5))_drop-shadow(0_0_10px_color-mix(in_oklab,var(--chart-2)_45%,transparent))]"
              dir="ltr"
            >
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chart} margin={{ top: 12, right: 0, left: 0, bottom: 0 }}>
                {/* تدرجات مجسمة لامعة: إضاءة علوية بيضاء ← قاعدة ← عمق سفلي داكن، بميلان أفقي خفيف */}
                <defs>
                  <linearGradient id="barRevGrad" x1="0" y1="0" x2="0.25" y2="1">
                    <stop offset="0%" stopColor="color-mix(in oklab, var(--chart-2) 50%, white)" />
                    <stop offset="20%" stopColor="var(--chart-2)" />
                    <stop offset="100%" stopColor="color-mix(in oklab, var(--chart-2) 45%, black)" />
                  </linearGradient>
                  <linearGradient id="barExpGrad" x1="0" y1="0" x2="0.25" y2="1">
                    <stop offset="0%" stopColor="color-mix(in oklab, var(--chart-3) 50%, white)" />
                    <stop offset="20%" stopColor="var(--chart-3)" />
                    <stop offset="100%" stopColor="color-mix(in oklab, var(--chart-3) 45%, black)" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  reversed
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                />
                <YAxis
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickFormatter={(v: number) => compactNum(v)}
                />
                <Tooltip content={<GlowTooltip />} cursor={{ fill: 'var(--accent)', opacity: 0.35 }} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />
                <Bar
                  dataKey="revenue"
                  name="الإيرادات"
                  fill="url(#barRevGrad)"
                  radius={[10, 10, 4, 4]}
                  maxBarSize={30}
                  className="rev-bar"
                  stroke="rgba(255,255,255,0.28)"
                  strokeWidth={1}
                />
                <Bar
                  dataKey="expense"
                  name="المصروفات"
                  fill="url(#barExpGrad)"
                  radius={[10, 10, 4, 4]}
                  maxBarSize={30}
                  className="exp-bar"
                  stroke="rgba(255,255,255,0.28)"
                  strokeWidth={1}
                />
                <Line
                  dataKey="profit"
                  name="صافي الربح"
                  stroke="var(--chart-1)"
                  strokeWidth={3}
                  className="profit-line"
                  dot={{ r: 3.5, fill: 'var(--chart-1)', stroke: 'rgba(255,255,255,0.4)', strokeWidth: 1.5 }}
                  activeDot={{ r: 6, stroke: 'rgba(255,255,255,0.5)', strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="توزيع الأصول" description="حسب المجموعات الرئيسية" icon={PieChartIcon}>
          {loading ? (
            <ChartSkeleton />
          ) : assets.length === 0 ? (
            <ListEmpty text="لا توجد أرصدة أصول" icon={Inbox} />
          ) : (
            <div className="[&_.assets-pie_path]:[filter:drop-shadow(0_10px_16px_rgba(0,0,0,.55))_drop-shadow(0_0_14px_color-mix(in_oklab,var(--primary)_16%,transparent))]">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                {/* تدرجات شعاعية مجسمة — إضاءة من أعلى اليسار تحاكي كرة مضيئة لكل لون */}
                <defs>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <radialGradient key={n} id={`assetGrad${n}`} cx="0.35" cy="0.3" r="0.95">
                      <stop offset="0%" stopColor={`color-mix(in oklab, var(--chart-${n}) 55%, white)`} />
                      <stop offset="55%" stopColor={`var(--chart-${n})`} />
                      <stop offset="100%" stopColor={`color-mix(in oklab, var(--chart-${n}) 50%, black)`} />
                    </radialGradient>
                  ))}
                </defs>
                {/* الطبقة السفلية: سماكة داكنة منزاحة لإيحاء بُعد مجسم تحت كل قطاع */}
                <Pie
                  data={assets}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="53%"
                  innerRadius={58}
                  outerRadius={94}
                  paddingAngle={3}
                  cornerRadius={10}
                  stroke="none"
                  isAnimationActive={false}
                  className="pointer-events-none assets-depth"
                >
                  {assets.map((entry) => (
                    <Cell key={entry.name} fill="rgba(0,0,0,0.6)" />
                  ))}
                </Pie>
                <Pie
                  data={assets}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={94}
                  paddingAngle={3}
                  cornerRadius={10}
                  className="assets-pie"
                  stroke="rgba(255,255,255,0.22)"
                  strokeWidth={1.5}
                >
                  {assets.map((entry, i) => (
                    <Cell key={entry.name} fill={`url(#assetGrad${(i % 5) + 1})`} />
                  ))}
                </Pie>
                {/* التفاصيل المالية عبر التلميح الحي المضيء فقط — بلا نصوص داخل/حول الدائرة */}
                <Tooltip content={<GlowTooltip showPercent total={assetsTotal} />} />
              </PieChart>
            </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ==================== أحدث النشاط ==================== */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* أحدث الفواتير */}
        <SectionCard title="أحدث الفواتير" description="آخر 5 فواتير بيع وشراء" icon={ReceiptText} contentClassName="p-2">
          {loading ? (
            <div className="p-2">
              <ListSkeleton />
            </div>
          ) : (data?.recentInvoices.length ?? 0) === 0 ? (
            <ListEmpty text="لا توجد فواتير بعد" icon={ReceiptText} />
          ) : (
            <div className="max-h-80 space-y-1 overflow-y-auto px-1">
              {data?.recentInvoices.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ReceiptText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">
                      <span className="num">{inv.number}</span> · {inv.partnerName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {AR_INVOICE_TYPE[inv.type] ?? inv.type} · {fmtDate(inv.date)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <StatusBadge status={inv.status} label={AR_INVOICE_STATUS[inv.status] ?? inv.status} />
                    <span className="text-xs font-semibold num">{fmtMoney(inv.total)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* أحدث القيود */}
        <SectionCard title="أحدث القيود اليومية" description="آخر 5 قيود محاسبية" icon={BookOpenText} contentClassName="p-2">
          {loading ? (
            <div className="p-2">
              <ListSkeleton />
            </div>
          ) : (data?.recentEntries.length ?? 0) === 0 ? (
            <ListEmpty text="لا توجد قيود بعد" icon={BookOpenText} />
          ) : (
            <div className="max-h-80 space-y-1 overflow-y-auto px-1">
              {data?.recentEntries.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <BookOpenText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">
                      <span className="num">{e.number}</span> · {e.description}
                    </p>
                    <p className="text-xs text-muted-foreground">{fmtDate(e.date)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <StatusBadge status={e.status} label={AR_ENTRY_STATUS[e.status] ?? e.status} />
                    <span className="text-xs font-semibold num">{fmtMoney(e.totalDebit)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* أحدث حركات المخزون */}
        <SectionCard title="أحدث حركات المخزون" description="آخر 5 حركات إدخال وإخراج" icon={ArrowLeftRight} contentClassName="p-2">
          {loading ? (
            <div className="p-2">
              <ListSkeleton />
            </div>
          ) : (data?.recentMovements.length ?? 0) === 0 ? (
            <ListEmpty text="لا توجد حركات مخزون بعد" icon={ArrowLeftRight} />
          ) : (
            <div className="max-h-80 space-y-1 overflow-y-auto px-1">
              {data?.recentMovements.map((mv) => {
                const tone = moveTone[mv.type] ?? moveTone.TRANSFER
                return (
                  <div
                    key={mv.id}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
                  >
                    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tone.bg)}>
                      <ArrowLeftRight className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug">{mv.itemName}</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {mv.reason ?? '—'} · {fmtDate(mv.date)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-center gap-1">
                      <span className={cn('text-xs font-semibold', tone.text)}>
                        {AR_MOVE_TYPE[mv.type] ?? mv.type}
                      </span>
                      <span className="text-xs font-semibold num">{fmtQty(mv.quantity)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ==================== التنبيهات ==================== */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* تنبيهات نقص المخزون */}
        <SectionCard
          title="تنبيهات نقص المخزون"
          description="أصناف وصلت تحت الحد الأدنى"
          icon={AlertTriangle}
          action={
            <Badge
              variant="outline"
              className="border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 num"
            >
              {lowStock.length} صنف
            </Badge>
          }
        >
          {loading ? (
            <ChartSkeleton />
          ) : lowStock.length === 0 ? (
            <ListEmpty text="جميع الأصناف ضمن الحد الآمن" icon={PackageSearch} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الصنف</TableHead>
                  <TableHead>المتوفر</TableHead>
                  <TableHead>الحد الأدنى</TableHead>
                  <TableHead>النقص</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStock.map((row) => {
                  const deficit = Math.max(0, row.minStock - row.available)
                  return (
                    <TableRow key={row.itemId}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className="border-rose-500/30 bg-rose-500/15 text-rose-600 dark:text-rose-400"
                          >
                            نقص
                          </Badge>
                          <span className="text-sm font-medium">{row.itemName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={cn('num font-medium', row.available <= 0 && 'text-rose-600 dark:text-rose-400')}>
                          {fmtQty(row.available)} {row.unit}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="num text-muted-foreground">{fmtQty(row.minStock)}</span>
                      </TableCell>
                      <TableCell className="text-left">
                        <span className="num font-semibold text-amber-600 dark:text-amber-400">
                          {fmtQty(deficit)} {row.unit}
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        {/* ملخص حالات الفواتير */}
        <SectionCard
          title="ملخص حالات الفواتير"
          description={`إجمالي ${fmtNumber(invoicesTotal)} فاتورة حسب حالة السداد`}
          icon={ReceiptText}
        >
          {loading ? (
            <ChartSkeleton />
          ) : (
            <div className="space-y-5">
              {invoiceStatusRows.map((row) => {
                const pct = invoicesTotal > 0 ? Math.round((row.count / invoicesTotal) * 100) : 0
                return (
                  <div key={row.key} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={row.key} label={row.label} />
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg font-bold num">{fmtNumber(row.count)}</span>
                        <span className="text-xs text-muted-foreground num">({pct}%)</span>
                      </div>
                    </div>
                    <Progress value={pct} className={cn('h-2', statusProgressColor[row.key])} />
                  </div>
                )
              })}
              {invoicesTotal === 0 && (
                <p className="pt-1 text-center text-sm text-muted-foreground">لا توجد فواتير مسجّلة بعد</p>
              )}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
