'use client'

// شاشة استعراض الفترة المحاسبية المقفلة — للقراءة فقط بالكامل
// تُعرض بدل التطبيق كله عند دخول وضع الاستعراض (من شاشة الدخول أو الإعدادات):
// • لافتة كهرمانية ثابتة توضح الوضع مع زرّي «العودة إلى الفترة الحالية» و«تسجيل الخروج»
// • تبويبات تقارير تُقرأ من النسخة الأرشيفية الملتقطة لحظة الإقفال (وليس القاعدة الحية):
//   نظرة عامة · ميزان المراجعة · قائمة الدخل · الميزانية · القيود · الفواتير · السندات · الأطراف · المخزون
import { useCallback, useEffect, useState } from 'react'
import {
  Archive,
  ArrowRightCircle,
  BookOpen,
  FileText,
  Landmark,
  Loader2,
  LogOut,
  Package,
  ReceiptText,
  Scale,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { KpiCard } from '@/components/common/kpi-card'
import { SectionCard } from '@/components/common/section-card'
import { useApp, type SessionUser, type ViewPeriodInfo } from '@/lib/store'
import { fmtDate, fmtMoney, fmtNumber, fmtUSD } from '@/lib/format'
import { cn } from '@/lib/utils'

const AR_INVOICE_TYPE: Record<string, string> = {
  SALE: 'مبيعات',
  SALES_RETURN: 'مردود مبيعات',
  PURCHASE: 'مشتريات',
  PURCHASE_RETURN: 'مردود مشتريات',
}
const AR_INVOICE_STATUS: Record<string, string> = {
  PAID: 'مسددة',
  PARTIAL: 'جزئية',
  UNPAID: 'غير مسددة',
}
const AR_PAYMENT_TYPE: Record<string, string> = { RECEIPT: 'قبض', PAYMENT: 'دفع' }
const AR_METHOD: Record<string, string> = { CASH: 'نقداً', BANK: 'بنك', CHEQUE: 'شيك' }
const AR_ENTRY_STATUS: Record<string, string> = { DRAFT: 'مسودة', POSTED: 'مرحّل', CANCELLED: 'ملغى' }
const AR_ENTITY_TYPE: Record<string, string> = {
  ASSET: 'أصول',
  LIABILITY: 'التزامات',
  EQUITY: 'حقوق ملكية',
  REVENUE: 'إيرادات',
  EXPENSE: 'مصروفات',
}

interface PeriodMeta {
  id: string
  label: string
  closingDate: string
  openingDate: string
  openingEntryNumber: string
  rotatedEntries: number
  closedBy: string
}

export function PeriodViewScreen({ user }: { user: SessionUser }) {
  const viewPeriod = useApp((s) => s.viewPeriod)
  const { toast } = useToastSafe()

  const [meta, setMeta] = useState<PeriodMeta | null>(null)
  const [loadingMeta, setLoadingMeta] = useState(true)

  // بيانات التعريف
  useEffect(() => {
    if (!viewPeriod) return
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/period-view/${viewPeriod.id}`)
        const data = (await res.json().catch(() => null)) as { period?: PeriodMeta } | null
        if (alive && res.ok && data?.period) setMeta(data.period)
      } finally {
        if (alive) setLoadingMeta(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [viewPeriod])

  const exitView = useCallback(async () => {
    // GET عمداً — يعمل داخل وضع القراءة فقط
    await fetch('/api/auth/period-view', { cache: 'no-store' }).catch(() => undefined)
    window.location.reload()
  }, [])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    window.location.reload()
  }, [])

  const periodLabel = meta?.label ?? viewPeriod?.label ?? 'فترة سابقة'
  const closingDay = meta?.closingDate ?? viewPeriod?.closingDate ?? ''

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ===== لافتة وضع الاستعراض ===== */}
      <div className="sticky top-0 z-20 border-b border-amber-500/40 bg-amber-500/10 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex min-w-0 items-center gap-2 text-sm">
            <Archive className="h-4.5 w-4.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <span className="font-bold text-amber-600 dark:text-amber-400">استعراض فترة مقفلة: </span>
            <span className="truncate font-semibold">
              {periodLabel}
              {closingDay && ` — حتى تاريخ ${fmtDate(closingDay)}`}
            </span>
            <Badge variant="outline" className="shrink-0 border-amber-500/50 text-[10px] text-amber-600 dark:text-amber-400">
              للقراءة فقط — يمنع تعديل أو حذف أي بيانات
            </Badge>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden text-xs text-muted-foreground md:inline">
              {user.name} ({user.username})
            </span>
            <Button size="sm" variant="outline" onClick={exitView} className="h-9 gap-1.5">
              <ArrowRightCircle className="h-4 w-4" aria-hidden />
              العودة إلى الفترة الحالية
            </Button>
            <Button size="sm" variant="ghost" onClick={logout} className="h-9 gap-1.5 text-muted-foreground">
              <LogOut className="h-4 w-4" aria-hidden />
              خروج
            </Button>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">
        {loadingMeta ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <div className="mb-4">
              <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
                <Archive className="h-6 w-6 text-primary" aria-hidden />
                أرشيف الفترة «{periodLabel}»
              </h1>
              {meta && (
                <p className="mt-1 text-sm text-muted-foreground">
                  أُقفلت بتاريخ {fmtDate(meta.closingDate)} — سند القيد الافتتاحي{' '}
                  <span className="num font-mono font-semibold">{meta.openingEntryNumber}</span> دُوّر فيه{' '}
                  {fmtNumber(meta.rotatedEntries)} قيداً — بواسطة {meta.closedBy} — البيانات أدناه منسوخة من
                  النسخة الأرشيفية لحظة الإقفال
                </p>
              )}
            </div>
            <ViewTabs periodId={viewPeriod?.id ?? meta?.id ?? ''} onToast={toast} />
          </>
        )}
      </main>

      <footer className="no-print border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-xs text-muted-foreground">
        استعراض أرشيفي — شركة الأمل التجارية 2026 ©
      </footer>
    </div>
  )
}

// إشعار خفيف محلي (تجنب استيراد مزود التوست الكامل داخل شاشة معزولة)
function useToastSafe() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 3000)
    return () => clearTimeout(t)
  }, [msg])
  const toast = useCallback((m: string) => setMsg(m), [])
  useEffect(() => {
    if (!msg) return
    // عرض بسيط أسفل الشاشة
    let el = document.getElementById('period-view-toast')
    if (!el) {
      el = document.createElement('div')
      el.id = 'period-view-toast'
      el.className =
        'fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border bg-card px-4 py-2 text-sm shadow-lg'
      document.body.appendChild(el)
    }
    el.textContent = msg
  }, [msg])
  return { toast }
}

// ==================== التبويبات والجلب ====================

type Fetcher = <T>(url: string) => Promise<T | null>

function ViewTabs({ periodId, onToast }: { periodId: string; onToast: (m: string) => void }) {
  const fetchJson: Fetcher = useCallback(async (url) => {
    try {
      const res = await fetch(url)
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        onToast(data?.error ?? 'تعذر جلب البيانات من الأرشيف')
        return null
      }
      return (await res.json()) as never
    } catch {
      onToast('تعذر الاتصال بالخادم')
      return null
    }
  }, [onToast])

  return (
    <Tabs defaultValue="overview" dir="rtl">
      <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1">
        <TabsTrigger value="overview" className="gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" /> نظرة عامة
        </TabsTrigger>
        <TabsTrigger value="trial" className="gap-1.5">
          <Scale className="h-3.5 w-3.5" /> ميزان المراجعة
        </TabsTrigger>
        <TabsTrigger value="income" className="gap-1.5">
          <ReceiptText className="h-3.5 w-3.5" /> قائمة الدخل
        </TabsTrigger>
        <TabsTrigger value="balance" className="gap-1.5">
          <Landmark className="h-3.5 w-3.5" /> الميزانية
        </TabsTrigger>
        <TabsTrigger value="journal" className="gap-1.5">
          <BookOpen className="h-3.5 w-3.5" /> القيود
        </TabsTrigger>
        <TabsTrigger value="invoices" className="gap-1.5">
          <FileText className="h-3.5 w-3.5" /> الفواتير
        </TabsTrigger>
        <TabsTrigger value="payments" className="gap-1.5">
          <ReceiptText className="h-3.5 w-3.5" /> السندات
        </TabsTrigger>
        <TabsTrigger value="partners" className="gap-1.5">
          <Users className="h-3.5 w-3.5" /> الأطراف
        </TabsTrigger>
        <TabsTrigger value="items" className="gap-1.5">
          <Package className="h-3.5 w-3.5" /> المخزون
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <OverviewTab fetchJson={fetchJson} periodId={periodId} />
      </TabsContent>
      <TabsContent value="trial">
        <TrialTab fetchJson={fetchJson} periodId={periodId} />
      </TabsContent>
      <TabsContent value="income">
        <IncomeTab fetchJson={fetchJson} periodId={periodId} />
      </TabsContent>
      <TabsContent value="balance">
        <BalanceTab fetchJson={fetchJson} periodId={periodId} />
      </TabsContent>
      <TabsContent value="journal">
        <JournalTab fetchJson={fetchJson} periodId={periodId} />
      </TabsContent>
      <TabsContent value="invoices">
        <InvoicesTab fetchJson={fetchJson} periodId={periodId} />
      </TabsContent>
      <TabsContent value="payments">
        <PaymentsTab fetchJson={fetchJson} periodId={periodId} />
      </TabsContent>
      <TabsContent value="partners">
        <PartnersTab fetchJson={fetchJson} periodId={periodId} />
      </TabsContent>
      <TabsContent value="items">
        <ItemsTab fetchJson={fetchJson} periodId={periodId} />
      </TabsContent>
    </Tabs>
  )
}

const api = (periodId: string, qs: string) => `/api/period-view/${periodId}/data?${qs}`

// ==================== نظرة عامة ====================
interface OverviewData {
  meta: { label: string; closingDate: string; openingEntryNumber: string; rotatedEntries: number; closedBy: string }
  counts: { entries: number; invoices: number; payments: number; items: number; partners: number; employees: number }
  salesTotal: number
  purchasesTotal: number
  netProfit: number
  cash: number
  bank: number
  inventory: number
}

function OverviewTab({ fetchJson, periodId }: { fetchJson: Fetcher; periodId: string }) {
  const [data, setData] = useState<OverviewData | null>(null)
  useEffect(() => {
    let alive = true
    fetchJson<OverviewData>(api(periodId, 'tab=overview')).then((d) => alive && setData(d))
    return () => {
      alive = false
    }
  }, [fetchJson, periodId])

  if (!data) return <TabSkeleton />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard title="القيود" value={fmtNumber(data.counts.entries)} icon={BookOpen} tone="emerald" />
        <KpiCard title="الفواتير" value={fmtNumber(data.counts.invoices)} icon={FileText} tone="gold" />
        <KpiCard title="السندات" value={fmtNumber(data.counts.payments)} icon={ReceiptText} tone="slate" />
        <KpiCard title="المواد" value={fmtNumber(data.counts.items)} icon={Package} tone="amber" />
        <KpiCard title="الأطراف" value={fmtNumber(data.counts.partners)} icon={Users} tone="gold" />
        <KpiCard title="الموظفون" value={fmtNumber(data.counts.employees)} icon={Users} tone="rose" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard title="إجمالي المبيعات" value={fmtMoney(data.salesTotal)} icon={TrendingUp} tone="emerald" hint={fmtUSD(data.salesTotal)} />
        <KpiCard title="إجمالي المشتريات" value={fmtMoney(data.purchasesTotal)} icon={ReceiptText} tone="amber" hint={fmtUSD(data.purchasesTotal)} />
        <KpiCard
          title={data.netProfit >= 0 ? 'صافي الربح' : 'صافي الخسارة'}
          value={fmtMoney(Math.abs(data.netProfit))}
          icon={TrendingUp}
          tone={data.netProfit >= 0 ? 'emerald' : 'rose'}
          hint={fmtUSD(data.netProfit)}
        />
        <KpiCard title="الصندوق" value={fmtMoney(data.cash)} icon={Landmark} tone="gold" hint={fmtUSD(data.cash)} />
        <KpiCard title="البنك" value={fmtMoney(data.bank)} icon={Landmark} tone="slate" hint={fmtUSD(data.bank)} />
        <KpiCard title="المخزون" value={fmtMoney(data.inventory)} icon={Package} tone="emerald" hint={fmtUSD(data.inventory)} />
      </div>
      <p className="text-xs text-muted-foreground">
        هذه الأرقام لقطة تاريخية لحظة الإقفال — الفترة الحالية تبدأ بعد {fmtDate(data.meta.closingDate)} وسند
        الافتتاحي {data.meta.openingEntryNumber} هو نقطة انطلاقها
      </p>
    </div>
  )
}

// ==================== جداول عامة ====================

function TabSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  )
}

function MoneyCell({ value }: { value: number }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  return <span className="num font-mono text-xs">{fmtMoney(value)}</span>
}

// ==================== ميزان المراجعة ====================
interface TrialData {
  rows: { code: string; name: string; type: string; debit: number; credit: number }[]
  totalDebit: number
  totalCredit: number
}

function TrialTab({ fetchJson, periodId }: { fetchJson: Fetcher; periodId: string }) {
  const [data, setData] = useState<TrialData | null>(null)
  useEffect(() => {
    let alive = true
    fetchJson<TrialData>(api(periodId, 'tab=trial')).then((d) => alive && setData(d))
    return () => {
      alive = false
    }
  }, [fetchJson, periodId])

  if (!data) return <TabSkeleton />
  return (
    <SectionCard title="ميزان المراجعة حتى تاريخ الإقفال" description="كل الحسابات ذات الأرصدة — من قيود الأرشيف المرحّلة">
      <div className="max-h-[62vh] overflow-auto rounded-xl border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="w-20">الكود</TableHead>
              <TableHead>الحساب</TableHead>
              <TableHead className="w-24">النوع</TableHead>
              <TableHead className="text-left">مدين</TableHead>
              <TableHead className="text-left">دائن</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r) => (
              <TableRow key={r.code}>
                <TableCell className="num font-mono text-xs font-bold text-primary">{r.code}</TableCell>
                <TableCell className="text-sm font-semibold">{r.name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]">
                    {AR_ENTITY_TYPE[r.type] ?? r.type}
                  </Badge>
                </TableCell>
                <TableCell className="text-left">
                  <MoneyCell value={r.debit} />
                </TableCell>
                <TableCell className="text-left">
                  <MoneyCell value={r.credit} />
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/50 font-bold">
              <TableCell colSpan={3} className="text-sm">
                الإجمالي
              </TableCell>
              <TableCell className="text-left">
                <span className="num font-mono text-xs">{fmtMoney(data.totalDebit)}</span>
              </TableCell>
              <TableCell className="text-left">
                <span className="num font-mono text-xs">{fmtMoney(data.totalCredit)}</span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <p className={cn('mt-2 text-xs', Math.abs(data.totalDebit - data.totalCredit) < 0.02 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
        {Math.abs(data.totalDebit - data.totalCredit) < 0.02
          ? 'الميزان متوازن ✓ — إجمالي المدين يساوي إجمالي الدائن'
          : 'تحذير: فرق في التوازن!'}
      </p>
    </SectionCard>
  )
}

// ==================== قائمة الدخل / الميزانية ====================
interface IncomeData {
  rows: { code: string; name: string; type: string; balance: number }[]
  totalRevenue: number
  totalExpense: number
  netProfit: number
}
interface BalanceData {
  rows: { code: string; name: string; type: string; balance: number }[]
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  netProfit?: number
}

function IncomeTab({ fetchJson, periodId }: { fetchJson: Fetcher; periodId: string }) {
  const [data, setData] = useState<IncomeData | null>(null)
  useEffect(() => {
    let alive = true
    fetchJson<IncomeData>(api(periodId, 'tab=income')).then((d) => alive && setData(d))
    return () => {
      alive = false
    }
  }, [fetchJson, periodId])

  if (!data) return <TabSkeleton />
  return (
    <SectionCard title="قائمة الدخل حتى تاريخ الإقفال" description="نتيجة الفترة المقفلة — الإيرادات والمصروفات">
      <div className="max-h-[62vh] overflow-auto rounded-xl border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="w-20">الكود</TableHead>
              <TableHead>الحساب</TableHead>
              <TableHead className="text-left">القيمة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r) => (
              <TableRow key={r.code}>
                <TableCell className="num font-mono text-xs font-bold text-primary">{r.code}</TableCell>
                <TableCell className="text-sm font-semibold">
                  {r.name} <Badge variant="outline" className="ms-1 text-[10px]">{AR_ENTITY_TYPE[r.type]}</Badge>
                </TableCell>
                <TableCell className="text-left">
                  <MoneyCell value={Math.abs(r.balance)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <KpiCard title="إجمالي الإيرادات" value={fmtMoney(data.totalRevenue)} tone="emerald" hint={fmtUSD(data.totalRevenue)} />
        <KpiCard title="إجمالي المصروفات" value={fmtMoney(data.totalExpense)} tone="rose" hint={fmtUSD(data.totalExpense)} />
        <KpiCard
          title={data.netProfit >= 0 ? 'صافي الربح' : 'صافي الخسارة'}
          value={fmtMoney(Math.abs(data.netProfit))}
          tone={data.netProfit >= 0 ? 'gold' : 'rose'}
          hint={fmtUSD(data.netProfit)}
        />
      </div>
    </SectionCard>
  )
}

function BalanceTab({ fetchJson, periodId }: { fetchJson: Fetcher; periodId: string }) {
  const [data, setData] = useState<BalanceData | null>(null)
  useEffect(() => {
    let alive = true
    fetchJson<BalanceData>(api(periodId, 'tab=balance')).then((d) => alive && setData(d))
    return () => {
      alive = false
    }
  }, [fetchJson, periodId])

  if (!data) return <TabSkeleton />
  return (
    <SectionCard title="الميزانية العمومية حتى تاريخ الإقفال" description="الأصول = الالتزامات + حقوق الملكية">
      <div className="max-h-[62vh] overflow-auto rounded-xl border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="w-20">الكود</TableHead>
              <TableHead>الحساب</TableHead>
              <TableHead className="w-24">النوع</TableHead>
              <TableHead className="text-left">القيمة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r) => (
              <TableRow key={r.code}>
                <TableCell className="num font-mono text-xs font-bold text-primary">{r.code}</TableCell>
                <TableCell className="text-sm font-semibold">{r.name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]">
                    {AR_ENTITY_TYPE[r.type] ?? r.type}
                  </Badge>
                </TableCell>
                <TableCell className="text-left">
                  <MoneyCell value={Math.abs(r.balance)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <KpiCard title="إجمالي الأصول" value={fmtMoney(data.totalAssets)} tone="gold" hint={fmtUSD(data.totalAssets)} />
        <KpiCard title="إجمالي الالتزامات" value={fmtMoney(data.totalLiabilities)} tone="rose" hint={fmtUSD(data.totalLiabilities)} />
        <KpiCard title="حقوق الملكية" value={fmtMoney(data.totalEquity)} tone="emerald" hint={fmtUSD(data.totalEquity)} />
      </div>
      {typeof data.netProfit === 'number' &&
        Math.abs(data.totalAssets - data.totalLiabilities - data.totalEquity) > 0.01 && (
        <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          ملاحظة محاسبية: فرق{' '}
          {fmtMoney(Math.abs(data.totalAssets - data.totalLiabilities - data.totalEquity))} بين الأصول
          و(الالتزامات + حقوق الملكية) هو صافي نتيجة الفترة ({data.netProfit >= 0 ? 'ربح' : 'خسارة'}) — في
          الأرشيف ما تزال ضمن حسابات الإيرادات والمصروفات، وقيد الإقفال الذي ينقلها إلى الأرباح المحتجزة
          وُلّد في القاعدة الحية عند الإقفال ولا يُخزّن في الأرشيف.
        </p>
      )}
    </SectionCard>
  )
}

// ==================== القيود ====================
interface JournalRow {
  id: string
  number: string
  date: string
  description: string
  status: string
  totalDebit: number
  totalCredit: number
}

function JournalTab({ fetchJson, periodId }: { fetchJson: Fetcher; periodId: string }) {
  const [data, setData] = useState<{ key: string; rows: JournalRow[]; total: number } | null>(null)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const listKey = `${periodId}|${page}|${q.trim()}`
  const [openEntry, setOpenEntry] = useState<null | {
    number: string
    date: string
    description: string
    totalDebit: number
    lines: { code: string; accountName: string; debit: number; credit: number; description: string | null }[]
  }>(null)

  useEffect(() => {
    let alive = true
    const qs = new URLSearchParams({ tab: 'journal', page: String(page) })
    if (q.trim()) qs.set('q', q.trim())
    fetchJson<{ rows: JournalRow[]; total: number }>(api(periodId, qs.toString())).then((d) => {
      if (alive && d) setData({ key: listKey, rows: d.rows, total: d.total })
    })
    return () => {
      alive = false
    }
  }, [fetchJson, periodId, page, q, listKey])

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 25))
  const total = data && data.key === listKey ? data.total : 0
  const rows = data && data.key === listKey ? data.rows : null

  return (
    <SectionCard
      title="قيود الفترة المقفلة"
      description={`${fmtNumber(total)} قيداً — أُرسلت للأرشيف عند الإقفال (اضغط القيد لتفاصيل أسطره)`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          placeholder="بحث برقم القيد أو الوصف…"
          className="h-9 max-w-64"
          aria-label="بحث في القيود"
        />
        {pages > 1 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Button variant="outline" size="sm" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              السابق
            </Button>
            <span className="num px-1">
              {page}/{pages}
            </span>
            <Button variant="outline" size="sm" className="h-8" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              التالي
            </Button>
          </div>
        )}
      </div>

      {!rows ? (
        <TabSkeleton />
      ) : rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">لا قيود مطابقة</p>
      ) : (
        <div className="max-h-[62vh] overflow-auto rounded-xl border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-24">الرقم</TableHead>
                <TableHead className="w-24">التاريخ</TableHead>
                <TableHead>الوصف</TableHead>
                <TableHead className="w-20 text-center">الحالة</TableHead>
                <TableHead className="text-left">المبلغ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id} className="cursor-pointer" onClick={async () => {
                  const d = await fetchJson<{ entry: NonNullable<typeof openEntry> }>(api(periodId, `tab=journal&entryId=${e.id}`))
                  if (d?.entry) setOpenEntry(d.entry)
                }}>
                  <TableCell className="num font-mono text-xs font-bold text-primary">{e.number}</TableCell>
                  <TableCell className="num text-xs">{fmtDate(e.date)}</TableCell>
                  <TableCell className="max-w-72 truncate text-sm">{e.description}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className="text-[10px]">
                      {AR_ENTRY_STATUS[e.status] ?? e.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-left">
                    <MoneyCell value={e.totalDebit} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {openEntry && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-label={`تفاصيل القيد ${openEntry.number}`}
          onClick={() => setOpenEntry(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl border bg-card p-4 shadow-xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="font-bold">
                  قيد <span className="num font-mono text-primary">{openEntry.number}</span> — {fmtDate(openEntry.date)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{openEntry.description}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setOpenEntry(null)}>
                إغلاق
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">الكود</TableHead>
                  <TableHead>الحساب</TableHead>
                  <TableHead className="text-left">مدين</TableHead>
                  <TableHead className="text-left">دائن</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openEntry.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="num font-mono text-xs">{l.code}</TableCell>
                    <TableCell className="text-sm">
                      {l.accountName}
                      {l.description && <span className="block text-[11px] text-muted-foreground">{l.description}</span>}
                    </TableCell>
                    <TableCell className="text-left">
                      <MoneyCell value={l.debit} />
                    </TableCell>
                    <TableCell className="text-left">
                      <MoneyCell value={l.credit} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

// ==================== الفواتير ====================
interface InvoiceRow {
  number: string
  date: string
  type: string
  partnerName: string
  total: number
  paid: number
  status: string
}

function InvoicesTab({ fetchJson, periodId }: { fetchJson: Fetcher; periodId: string }) {
  const [data, setData] = useState<{ key: string; rows: InvoiceRow[]; total: number } | null>(null)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const listKey = `${periodId}|${page}|${q.trim()}`

  useEffect(() => {
    let alive = true
    const qs = new URLSearchParams({ tab: 'invoices', page: String(page) })
    if (q.trim()) qs.set('q', q.trim())
    fetchJson<{ rows: InvoiceRow[]; total: number }>(api(periodId, qs.toString())).then((d) => {
      if (alive && d) setData({ key: listKey, rows: d.rows, total: d.total })
    })
    return () => {
      alive = false
    }
  }, [fetchJson, periodId, page, q, listKey])

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 25))
  const total = data && data.key === listKey ? data.total : 0
  const rows = data && data.key === listKey ? data.rows : null

  return (
    <SectionCard title="فواتير الفترة المقفلة" description={`${fmtNumber(total)} فاتورة في الأرشيف`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          placeholder="بحث برقم الفاتورة أو الطرف…"
          className="h-9 max-w-64"
          aria-label="بحث في الفواتير"
        />
        {pages > 1 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Button variant="outline" size="sm" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              السابق
            </Button>
            <span className="num px-1">
              {page}/{pages}
            </span>
            <Button variant="outline" size="sm" className="h-8" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              التالي
            </Button>
          </div>
        )}
      </div>
      {!rows ? (
        <TabSkeleton />
      ) : rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">لا فواتير مطابقة</p>
      ) : (
        <div className="max-h-[62vh] overflow-auto rounded-xl border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-24">الرقم</TableHead>
                <TableHead className="w-24">التاريخ</TableHead>
                <TableHead className="w-24">النوع</TableHead>
                <TableHead>الطرف</TableHead>
                <TableHead className="w-20 text-center">الحالة</TableHead>
                <TableHead className="text-left">الإجمالي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.number}>
                  <TableCell className="num font-mono text-xs font-bold text-primary">{r.number}</TableCell>
                  <TableCell className="num text-xs">{fmtDate(r.date)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {AR_INVOICE_TYPE[r.type] ?? r.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm font-semibold">{r.partnerName}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className="text-[10px]">
                      {AR_INVOICE_STATUS[r.status] ?? r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-left">
                    <MoneyCell value={r.total} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  )
}

// ==================== السندات ====================
interface PaymentRow {
  number: string
  date: string
  type: string
  amount: number
  method: string
  partnerName: string
}

function PaymentsTab({ fetchJson, periodId }: { fetchJson: Fetcher; periodId: string }) {
  const [data, setData] = useState<{ key: string; rows: PaymentRow[]; total: number } | null>(null)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const listKey = `${periodId}|${page}|${q.trim()}`

  useEffect(() => {
    let alive = true
    const qs = new URLSearchParams({ tab: 'payments', page: String(page) })
    if (q.trim()) qs.set('q', q.trim())
    fetchJson<{ rows: PaymentRow[]; total: number }>(api(periodId, qs.toString())).then((d) => {
      if (alive && d) setData({ key: listKey, rows: d.rows, total: d.total })
    })
    return () => {
      alive = false
    }
  }, [fetchJson, periodId, page, q, listKey])

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 25))
  const total = data && data.key === listKey ? data.total : 0
  const rows = data && data.key === listKey ? data.rows : null

  return (
    <SectionCard title="سندات الفترة المقفلة" description={`${fmtNumber(total)} سند قبض/دفع في الأرشيف`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          placeholder="بحث برقم السند أو الطرف…"
          className="h-9 max-w-64"
          aria-label="بحث في السندات"
        />
        {pages > 1 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Button variant="outline" size="sm" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              السابق
            </Button>
            <span className="num px-1">
              {page}/{pages}
            </span>
            <Button variant="outline" size="sm" className="h-8" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              التالي
            </Button>
          </div>
        )}
      </div>
      {!rows ? (
        <TabSkeleton />
      ) : rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">لا سندات مطابقة</p>
      ) : (
        <div className="max-h-[62vh] overflow-auto rounded-xl border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-24">الرقم</TableHead>
                <TableHead className="w-24">التاريخ</TableHead>
                <TableHead className="w-20">النوع</TableHead>
                <TableHead>الطرف</TableHead>
                <TableHead className="w-20">الطريقة</TableHead>
                <TableHead className="text-left">المبلغ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.number}>
                  <TableCell className="num font-mono text-xs font-bold text-primary">{r.number}</TableCell>
                  <TableCell className="num text-xs">{fmtDate(r.date)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {AR_PAYMENT_TYPE[r.type] ?? r.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm font-semibold">{r.partnerName}</TableCell>
                  <TableCell className="text-xs">{AR_METHOD[r.method] ?? r.method}</TableCell>
                  <TableCell className="text-left">
                    <MoneyCell value={r.amount} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  )
}

// ==================== الأطراف ====================
interface PartnerRow {
  code: string
  name: string
  type: string
  docs: number
  cash: number
  balance: number
}

function PartnersTab({ fetchJson, periodId }: { fetchJson: Fetcher; periodId: string }) {
  const [rows, setRows] = useState<PartnerRow[] | null>(null)
  useEffect(() => {
    let alive = true
    fetchJson<{ rows: PartnerRow[] }>(api(periodId, 'tab=partners')).then((d) => alive && setRows(d?.rows ?? []))
    return () => {
      alive = false
    }
  }, [fetchJson, periodId])

  if (!rows) return <TabSkeleton />
  return (
    <SectionCard title="أرصدة الأطراف حتى تاريخ الإقفال" description="محسوبة من فواتير وسندات كل طرف في الأرشيف">
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">لا أطراف بحركات</p>
      ) : (
        <div className="max-h-[62vh] overflow-auto rounded-xl border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-24">الكود</TableHead>
                <TableHead>الطرف</TableHead>
                <TableHead className="w-24">النوع</TableHead>
                <TableHead className="text-left">فواتيره</TableHead>
                <TableHead className="text-left">سنداته</TableHead>
                <TableHead className="text-left">الرصيد</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.code}>
                  <TableCell className="num font-mono text-xs text-muted-foreground">{r.code}</TableCell>
                  <TableCell className="text-sm font-semibold">{r.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {r.type === 'CUSTOMER' ? 'عميل' : 'مورد'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-left">
                    <MoneyCell value={r.docs} />
                  </TableCell>
                  <TableCell className="text-left">
                    <MoneyCell value={r.cash} />
                  </TableCell>
                  <TableCell className="text-left">
                    <span className={cn('num font-mono text-xs font-bold', r.balance > 0 ? 'text-primary' : '')}>
                      {fmtMoney(Math.abs(r.balance))} {r.balance >= 0 ? '(مدين)' : '(دائن)'}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  )
}

// ==================== المخزون ====================
interface ItemRow {
  code: string
  name: string
  salePrice: number
  warehouse: string
  quantity: number
  locations: string[]
  units: string
}

function ItemsTab({ fetchJson, periodId }: { fetchJson: Fetcher; periodId: string }) {
  const [data, setData] = useState<{ key: string; rows: ItemRow[]; total: number } | null>(null)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const listKey = `${periodId}|${page}|${q.trim()}`

  useEffect(() => {
    let alive = true
    const qs = new URLSearchParams({ tab: 'items', page: String(page) })
    if (q.trim()) qs.set('q', q.trim())
    fetchJson<{ rows: ItemRow[]; total: number }>(api(periodId, qs.toString())).then((d) => {
      if (alive && d) setData({ key: listKey, rows: d.rows, total: d.total })
    })
    return () => {
      alive = false
    }
  }, [fetchJson, periodId, page, q, listKey])

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 25))
  const total = data && data.key === listKey ? data.total : 0
  const rows = data && data.key === listKey ? data.rows : null

  return (
    <SectionCard title="المواد وأرصدة المخزون لحظة الإقفال" description={`${fmtNumber(total)} مادة في الأرشيف`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          placeholder="بحث بالاسم أو رقم البطاقة…"
          className="h-9 max-w-64"
          aria-label="بحث في المواد"
        />
        {pages > 1 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Button variant="outline" size="sm" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              السابق
            </Button>
            <span className="num px-1">
              {page}/{pages}
            </span>
            <Button variant="outline" size="sm" className="h-8" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              التالي
            </Button>
          </div>
        )}
      </div>
      {!rows ? (
        <TabSkeleton />
      ) : rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">لا مواد مطابقة</p>
      ) : (
        <div className="max-h-[62vh] overflow-auto rounded-xl border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-20">البطاقة</TableHead>
                <TableHead>المادة</TableHead>
                <TableHead className="w-40">القسم</TableHead>
                <TableHead className="w-20 text-left">الرصيد</TableHead>
                <TableHead className="text-left">سعر البيع</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.code}>
                  <TableCell className="num font-mono text-xs font-bold text-primary">{r.code}</TableCell>
                  <TableCell className="text-sm font-semibold">
                    {r.name}
                    {r.units && <span className="block text-[11px] text-muted-foreground">{r.units}</span>}
                  </TableCell>
                  <TableCell className="text-xs">{r.warehouse}</TableCell>
                  <TableCell className="text-left">
                    <span className="num font-mono text-xs font-bold">{fmtNumber(r.quantity)}</span>
                  </TableCell>
                  <TableCell className="text-left">
                    <MoneyCell value={r.salePrice} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  )
}
