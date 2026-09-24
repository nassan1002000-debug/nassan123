'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Wallet,
  Landmark,
  Coins,
  ArrowDownCircle,
  ArrowUpCircle,
  TrendingUp,
  TrendingDown,
  ReceiptText,
  Inbox,
  BarChart3,
  PieChart as PieChartIcon,
  RefreshCw,
} from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { KpiCard } from '@/components/common/kpi-card'
import { SectionCard } from '@/components/common/section-card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { fmtMoney, fmtUSD, fmtDate, AR_METHOD, AR_MONTHS } from '@/lib/format'

// ==================== الأنواع ====================

interface Voucher {
  id: string
  number: string
  type: string
  partnerName: string
  amount: number
  method: string
  date: string
  notes: string | null
}

interface TreasuryData {
  balances: { cash: number; bank: number; total: number }
  monthly: { receipts: number; payments: number; net: number }
  cashflowChart: { month: string; receipts: number; payments: number }[]
  methodDistribution: { method: string; count: number; total: number }[]
  recentVouchers: Voucher[]
}

const EMERALD = '#10b981'
const ROSE = '#f43f5e'

// أرقام مختصرة لمحور الرسم (مليون / ألف)
function compact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) {
    const v = (n / 1_000_000).toFixed(1).replace(/\.0$/, '')
    return `${v}م`
  }
  if (abs >= 1_000) return `${Math.round(n / 1_000)}ألف`
  return `${Math.round(n)}`
}

// ==================== تلميحات الرسوم ====================

interface TipEntry {
  name?: string | number
  value?: number | string
  dataKey?: string | number
}

function CashflowTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TipEntry[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-md text-xs space-y-1">
      <p className="font-semibold">{label}</p>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: p.dataKey === 'receipts' ? EMERALD : ROSE }}
            />
            {p.name}
          </span>
          <span className="num font-medium">{fmtMoney(Number(p.value ?? 0))}</span>
        </div>
      ))}
    </div>
  )
}

function MethodTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: TipEntry[]
}) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  const value = Number(p.value ?? 0)
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-md text-xs space-y-1">
      <p className="font-semibold">{p.name}</p>
      <p className="num">{fmtMoney(value)}</p>
      <p className="text-muted-foreground num">≈ {fmtUSD(value)}</p>
    </div>
  )
}

// ==================== صف سند ====================

function methodBadge(method: string): string {
  return AR_METHOD[method] ?? method
}

export default function TreasuryScreen() {
  const { toast } = useToast()
  const [data, setData] = useState<TreasuryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const runFetch = useCallback(() => {
    fetch('/api/treasury')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<TreasuryData>
      })
      .then((json) => {
        setData(json)
        setFailed(false)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
        setFailed(true)
        toast({
          title: 'خطأ في التحميل',
          description: 'تعذر جلب بيانات الصندوق — تحقق من الاتصال وأعد المحاولة',
          variant: 'destructive',
        })
      })
  }, [toast])

  useEffect(() => {
    runFetch()
  }, [runFetch])

  const retry = () => {
    setFailed(false)
    setLoading(true)
    runFetch()
  }

  // ===== حالة الفشل =====
  if (failed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center rounded-xl border bg-card">
        <div className="text-center space-y-3">
          <p className="text-sm text-muted-foreground">تعذر تحميل بيانات الصندوق</p>
          <Button size="sm" variant="outline" onClick={retry}>
            <RefreshCw className="h-4 w-4" />
            إعادة المحاولة
          </Button>
        </div>
      </div>
    )
  }

  const nowMonth = new Date().getMonth()
  const monthLabel = AR_MONTHS[nowMonth]

  const balances = data?.balances
  const monthly = data?.monthly
  const chart = data?.cashflowChart ?? []
  const dist = data?.methodDistribution ?? []
  const recent = data?.recentVouchers ?? []
  const receiptsList = recent.filter((v) => v.type === 'RECEIPT')
  const paymentsList = recent.filter((v) => v.type === 'PAYMENT')

  const pieData = dist.map((d) => ({
    name: AR_METHOD[d.method] ?? d.method,
    value: d.total,
    count: d.count,
  }))
  const hasPieData = pieData.some((d) => d.value > 0)

  return (
    <div className="space-y-6">
      {/* ============ بطاقات الأرصدة البارزة ============ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          title="رصيد الصندوق (نقداً)"
          value={fmtMoney(balances?.cash ?? 0)}
          hint={`≈ ${fmtUSD(balances?.cash ?? 0)}`}
          icon={Wallet}
          tone="gold"
          loading={loading}
          className="border-primary/20 bg-gradient-to-bl from-primary/[0.06] via-transparent to-transparent p-5"
        />
        <KpiCard
          title="رصيد البنك"
          value={fmtMoney(balances?.bank ?? 0)}
          hint={`≈ ${fmtUSD(balances?.bank ?? 0)}`}
          icon={Landmark}
          tone="emerald"
          loading={loading}
          className="border-primary/20 bg-gradient-to-bl from-primary/[0.06] via-transparent to-transparent p-5"
        />
        <KpiCard
          title="إجمالي السيولة"
          value={fmtMoney(balances?.total ?? 0)}
          hint={`≈ ${fmtUSD(balances?.total ?? 0)}`}
          icon={Coins}
          tone="slate"
          loading={loading}
          className="border-primary/20 bg-gradient-to-bl from-primary/[0.08] via-transparent to-transparent p-5"
        />
      </div>

      {/* ============ مؤشرات الشهر الحالي ============ */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <KpiCard
          title={`مقبوضات شهر ${monthLabel}`}
          value={fmtMoney(monthly?.receipts ?? 0)}
          hint={`≈ ${fmtUSD(monthly?.receipts ?? 0)}`}
          icon={ArrowDownCircle}
          tone="emerald"
          trend="up"
          trendText="تدفق داخل"
          loading={loading}
        />
        <KpiCard
          title={`مدفوعات شهر ${monthLabel}`}
          value={fmtMoney(monthly?.payments ?? 0)}
          hint={`≈ ${fmtUSD(monthly?.payments ?? 0)}`}
          icon={ArrowUpCircle}
          tone="rose"
          trend="down"
          trendText="تدفق خارج"
          loading={loading}
        />
        <KpiCard
          title="صافي التدفق النقدي"
          value={fmtMoney(monthly?.net ?? 0)}
          hint={`≈ ${fmtUSD(monthly?.net ?? 0)}`}
          icon={(monthly?.net ?? 0) >= 0 ? TrendingUp : TrendingDown}
          tone={(monthly?.net ?? 0) >= 0 ? 'gold' : 'rose'}
          trend={(monthly?.net ?? 0) >= 0 ? 'up' : 'down'}
          trendText={(monthly?.net ?? 0) >= 0 ? 'فائض نقدي' : 'عجز نقدي'}
          loading={loading}
        />
      </div>

      {/* ============ صف الرسوم ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* التدفق النقدي 6 أشهر */}
        <SectionCard
          title="التدفق النقدي — 6 أشهر"
          description="مقبوضات مقابل مدفوعات السندات"
          icon={BarChart3}
          className="lg:col-span-2"
        >
          {loading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chart} margin={{ top: 8, left: 8, right: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradReceipts" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={EMERALD} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={EMERALD} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gradPayments" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ROSE} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={ROSE} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="month"
                  reversed
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  orientation="right"
                  tickFormatter={(v: number) => compact(v)}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                />
                <Tooltip content={<CashflowTooltip />} cursor={{ stroke: 'var(--border)' }} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => (
                    <span className="text-xs text-muted-foreground">{value}</span>
                  )}
                />
                <Area
                  type="monotone"
                  dataKey="receipts"
                  name="مقبوضات"
                  stroke={EMERALD}
                  strokeWidth={2}
                  fill="url(#gradReceipts)"
                />
                <Area
                  type="monotone"
                  dataKey="payments"
                  name="مدفوعات"
                  stroke={ROSE}
                  strokeWidth={2}
                  fill="url(#gradPayments)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        {/* توزيع طرائق الدفع */}
        <SectionCard
          title="التوزيع حسب الطريقة"
          description="نقداً / بنك / شيك"
          icon={PieChartIcon}
        >
          {loading ? (
            <Skeleton className="h-[260px] w-full rounded-full" />
          ) : hasPieData ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={88}
                  paddingAngle={3}
                  stroke="var(--card)"
                  strokeWidth={2}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={`var(--chart-${(i % 3) + 1})`} />
                  ))}
                </Pie>
                <Tooltip content={<MethodTooltip />} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => (
                    <span className="text-xs text-muted-foreground">{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-muted-foreground">
              <Inbox className="h-8 w-8" />
              <p className="text-xs">لا توجد سندات لعرض التوزيع</p>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ============ أحدث السندات ============ */}
      <SectionCard
        title="أحدث السندات"
        description="آخر 8 سندات قبض ودفع"
        icon={ReceiptText}
        contentClassName="p-0"
      >
        {loading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
            <Inbox className="h-8 w-8" />
            <p className="text-xs">لا توجد سندات بعد</p>
          </div>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {recent.map((v) => {
              const isReceipt = v.type === 'RECEIPT'
              return (
                <li key={v.id} className="flex items-center gap-3 px-4 py-3">
                  <div
                    className={
                      isReceipt
                        ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                        : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-500/12 text-rose-600 dark:text-rose-400'
                    }
                  >
                    {isReceipt ? (
                      <ArrowDownCircle className="h-4.5 w-4.5" />
                    ) : (
                      <ArrowUpCircle className="h-4.5 w-4.5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      <span className="num">{v.number}</span>
                      <span className="mx-1.5 text-muted-foreground">•</span>
                      {v.partnerName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {methodBadge(v.method)} · <span className="num">{fmtDate(v.date)}</span>
                      {v.notes ? ` · ${v.notes}` : ''}
                    </p>
                  </div>
                  <p
                    className={`num shrink-0 text-sm font-bold ${
                      isReceipt
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {isReceipt ? '+' : '−'} {fmtMoney(v.amount)}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>

      {/* ============ سندات القبض / الدفع ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title="سندات القبض"
          description="التدفقات الداخلة"
          icon={ArrowDownCircle}
          contentClassName="p-0"
        >
          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : receiptsList.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
              <Inbox className="h-7 w-7" />
              <p className="text-xs">لا توجد سندات قبض</p>
            </div>
          ) : (
            <ul className="max-h-64 divide-y overflow-y-auto">
              {receiptsList.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      <span className="num">{v.number}</span>
                      <span className="mx-1.5 text-muted-foreground">•</span>
                      {v.partnerName}
                    </p>
                    <span className="mt-0.5 inline-block rounded-md border px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
                      {methodBadge(v.method)}
                    </span>
                  </div>
                  <div className="shrink-0 text-left">
                    <p className="num text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      {fmtMoney(v.amount)}
                    </p>
                    <p className="num text-[10px] text-muted-foreground">{fmtDate(v.date)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="سندات الدفع"
          description="التدفقات الخارجة"
          icon={ArrowUpCircle}
          contentClassName="p-0"
        >
          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : paymentsList.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
              <Inbox className="h-7 w-7" />
              <p className="text-xs">لا توجد سندات دفع</p>
            </div>
          ) : (
            <ul className="max-h-64 divide-y overflow-y-auto">
              {paymentsList.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      <span className="num">{v.number}</span>
                      <span className="mx-1.5 text-muted-foreground">•</span>
                      {v.partnerName}
                    </p>
                    <span className="mt-0.5 inline-block rounded-md border px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
                      {methodBadge(v.method)}
                    </span>
                  </div>
                  <div className="shrink-0 text-left">
                    <p className="num text-sm font-bold text-rose-600 dark:text-rose-400">
                      {fmtMoney(v.amount)}
                    </p>
                    <p className="num text-[10px] text-muted-foreground">{fmtDate(v.date)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
