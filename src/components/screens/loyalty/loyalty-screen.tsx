'use client'

// شاشة نقاط الولاء الديناميكية — المنظومة الكاملة في نافذة واحدة:
// 1) تبويب الجدول الرئيسي: كل العملاء (المتاح | المسترد سابقاً) + كشف الحساب التفصيلي
// 2) العمليات اليدوية: إهداء/خصم فردي وجماعي بسبب إلزامي + صرف الكاش المباشر بسند دفع (1110)
// 3) تبويب الإعدادات: الحد الأدنى + أيام الدورة + النقاط الأساسية + سعر النقطة + مفتاح التنشيط المركزي
// القاعدة الرياضية الصارمة مشتركة من lib/loyalty.ts — وجدول المضاعفات يُبنى حياً من الإعدادات

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Banknote,
  BadgeCheck,
  CalendarDays,
  Coins,
  Eye,
  Gift,
  HandCoins,
  Loader2,
  MessageCircle,
  MinusCircle,
  Printer,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Star,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumInput } from '@/components/ui/number-input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { KpiCard } from '@/components/common/kpi-card'
import { SectionCard } from '@/components/common/section-card'
import { useToast } from '@/hooks/use-toast'
import { useApp, useIsArchive } from '@/lib/store'
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, fmtUSD } from '@/lib/format'
import { cn } from '@/lib/utils'
import { awardTableRows, type LoyaltySettingsData, type LoyaltyStatementRow } from '@/lib/loyalty'
import { round2 } from '@/lib/math'
import { printLoyaltyStatement } from './print-loyalty-statement'

// ==================== أنواع الواجهة ====================

interface CustomerRow {
  id: string
  code: string
  name: string
  phone: string | null
  whatsappUrl?: string | null
  isActive: boolean
  available: number
  redeemed: number
  earned: number
  redeemValue: number
}

interface LoyaltyTotals {
  customers: number
  withBalance: number
  availablePoints: number
  redeemedPoints: number
  redeemValue: number
}

interface MainData {
  settings: LoyaltySettingsData
  customers: CustomerRow[]
  totals: LoyaltyTotals
}

interface StatementData {
  customer: { id: string; code: string; name: string; phone: string | null; isActive: boolean }
  points: { available: number; redeemed: number; earned: number }
  rows: LoyaltyStatementRow[]
}

const TX_BADGE: Record<string, { label: string; className: string }> = {
  EARN: { label: 'استحقاق آلي', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  REDEEM: { label: 'استرداد (حسم)', className: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  CASHOUT: { label: 'صرف نقدي', className: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400' },
  GIFT: { label: 'إهداء', className: 'border-primary/40 bg-primary/10 text-primary' },
  DEDUCT: { label: 'خصم وحرمان', className: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400' },
  REVOKE: { label: 'عكس آلي', className: 'border-muted-foreground/40 bg-muted/40 text-muted-foreground' },
  OPENING: { label: 'رصيد افتتاحي', className: 'border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400' },
}

function TypeBadge({ type }: { type: string }) {
  const cfg = TX_BADGE[type] ?? { label: type, className: '' }
  return <Badge variant="outline" className={cn('text-[10px] whitespace-nowrap', cfg.className)}>{cfg.label}</Badge>
}

// ==================== الشاشة الرئيسية ====================

export function LoyaltyScreen() {
  const { toast } = useToast()
  // وضع استعراض الأرشيف (الشرط 4) — إخفاء أزرار الكتابة (العمليات اليدوية/الجماعية وإعدادات)
  const isArchive = useIsArchive()
  const user = useApp((s) => s.user)
  const isAdmin = user?.role === 'ADMIN'
  const canOperate = user?.role === 'ADMIN' || user?.role === 'ACCOUNTANT'

  const [data, setData] = useState<MainData | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'table' | 'settings'>('table')

  // نوافذ العمليات
  const [statementOf, setStatementOf] = useState<CustomerRow | null>(null)
  const [manualOp, setManualOp] = useState<{ customer: CustomerRow; mode: 'GIFT' | 'DEDUCT' } | null>(null)
  const [cashOutOf, setCashOutOf] = useState<CustomerRow | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/loyalty${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`)
      const json = (await res.json().catch(() => null)) as (MainData & { error?: string }) | null
      if (!res.ok || !json) throw new Error(json?.error ?? 'failed')
      setData(json)
    } catch {
      toast({ title: 'تعذر جلب بيانات نقاط الولاء', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [query, toast])

  useEffect(() => {
    void load()
  }, [load])

  const settings = data?.settings

  return (
    <div className="space-y-4">
      {/* الرأس */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Star className="h-5 w-5 text-primary" />
            نقاط الولاء الديناميكية
          </h2>
          <p className="text-xs text-muted-foreground">
            منظومة الاحتساب الآلي والاسترداد والصرف النقدي — مضاعفات صارمة بلا تجميع للفواتير الصغيرة
          </p>
        </div>
        <div className="flex items-center gap-2">
          {settings?.isEnabled ? (
            <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <BadgeCheck className="h-3.5 w-3.5" />
              النظام منشط
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              النظام غير منشط
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            تحديث
          </Button>
          {canOperate && !isArchive && (
            <Button size="sm" onClick={() => setBulkOpen(true)} disabled={!settings?.isEnabled}>
              <Users className="h-4 w-4" />
              عملية جماعية
              {!isAdmin && <span className="text-[10px] font-normal">(للمدير)</span>}
            </Button>
          )}
        </div>
      </div>

      {/* صمام الأمان — تنبيه واضح عند التوقف */}
      {settings && !settings.isEnabled && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            نظام نقاط الولاء متوقف حالياً — لا يُحتسب أي نقاط من الفواتير، ومربع النقاط مخفي كلياً عن فواتير
            المبيعات وعن الطباعة. {isAdmin ? 'فعّله من تبويب الإعدادات أدناه.' : 'اتصل بالمدير لتفعيله.'}
          </span>
        </div>
      )}

      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="العملاء المسجلون"
          value={loading ? '…' : fmtNumber(data?.totals.customers ?? 0)}
          hint={`${fmtNumber(data?.totals.withBalance ?? 0)} عميلاً يملك رصيداً متاحاً`}
          icon={Users}
          tone="slate"
          loading={loading}
        />
        <KpiCard
          title="نقاط متاحة (كل العملاء)"
          value={loading ? '…' : fmtNumber(data?.totals.availablePoints ?? 0)}
          hint={`قيمتها ≈ ${fmtMoney(data?.totals.redeemValue ?? 0)} ل.س`}
          icon={Coins}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="نقاط مستردة سابقاً"
          value={loading ? '…' : fmtNumber(data?.totals.redeemedPoints ?? 0)}
          hint="استرداد داخل الفواتير + الصرف النقدي"
          icon={HandCoins}
          tone="amber"
          loading={loading}
        />
        <KpiCard
          title="سعر النقطة الواحدة"
          value={loading ? '…' : `${fmtMoney(settings?.pointPrice ?? 0)} ل.س`}
          hint={`الحد الأدنى للفاتورة المؤهلة: ${fmtMoney(settings?.minInvoiceValue ?? 0)} ل.س`}
          icon={Sparkles}
          tone="emerald"
          loading={loading}
        />
      </div>

      {/* التبويبات */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'table' | 'settings')}>
        <TabsList className="h-9">
          <TabsTrigger value="table" className="gap-1.5 px-4 text-sm">
            <Users className="h-4 w-4" />
            الجداول وكشوف الحساب
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5 px-4 text-sm">
            <Settings2 className="h-4 w-4" />
            الإعدادات والمتغيرات
          </TabsTrigger>
        </TabsList>

        {/* ===== تبويب الجدول الرئيسي ===== */}
        <TabsContent value="table" className="mt-3">
          <SectionCard
            title="الجدول الرئيسي الشامل"
            description="اضغط على أي عميل لفتح كشف حساب نقاطه التفصيلي المؤرخ"
            icon={Users}
            action={
              <div className="relative w-56">
                <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ابحث بالاسم أو الكود أو الهاتف…"
                  className="h-9 ps-8"
                  aria-label="بحث في العملاء"
                />
              </div>
            }
          >
            {loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (data?.customers.length ?? 0) === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                لا يوجد عملاء مطابقون — أنشئ ملفات العملاء من شاشة العملاء والموردون
              </p>
            ) : (
              <div className="max-h-[52vh] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="min-w-[180px]">العميل</TableHead>
                      <TableHead className="text-center">الحالة</TableHead>
                      <TableHead className="text-center">الرصيد المتاح الحالي</TableHead>
                      <TableHead className="text-center">إجمالي المسترد سابقاً</TableHead>
                      <TableHead className="text-center">إجمالي المكتسب</TableHead>
                      <TableHead className="text-center">قيمة الرصيد (ل.س)</TableHead>
                      <TableHead className="text-center">الإجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data!.customers.map((c) => (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer transition-colors hover:bg-accent/40"
                        onClick={() => setStatementOf(c)}
                      >
                        <TableCell>
                          <p className="truncate text-sm font-bold">{c.name}</p>
                          <p className="num text-[10px] text-muted-foreground">
                            {c.code}
                            {c.phone ? ` · ${c.phone}` : ''}
                          </p>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px]',
                              c.isActive
                                ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                                : 'text-muted-foreground',
                            )}
                          >
                            {c.isActive ? 'نشط' : 'موقوف'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={cn('num text-sm font-extrabold', c.available > 0 ? 'text-primary' : 'text-muted-foreground')}>
                            {fmtNumber(c.available)}
                          </span>
                          <span className="text-[10px] text-muted-foreground"> نقطة</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="num text-sm font-semibold text-amber-600 dark:text-amber-400">
                            {fmtNumber(c.redeemed)}
                          </span>
                          <span className="text-[10px] text-muted-foreground"> نقطة</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="num text-sm font-semibold text-muted-foreground">{fmtNumber(c.earned)}</span>
                          <span className="text-[10px] text-muted-foreground"> نقطة</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="num text-sm font-semibold">{fmtMoney(c.redeemValue)}</span>
                        </TableCell>
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            {c.whatsappUrl && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400"
                                title="واتساب"
                                aria-label={`فتح محادثة واتساب مع ${c.name}`}
                                asChild
                              >
                                <a href={c.whatsappUrl} target="_blank" rel="noopener noreferrer">
                                  <MessageCircle className="h-4 w-4" />
                                </a>
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="كشف الحساب التفصيلي" onClick={() => setStatementOf(c)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            {canOperate && !isArchive && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400"
                                  title="إهداء نقاط يدوية"
                                  disabled={!settings?.isEnabled}
                                  onClick={() => setManualOp({ customer: c, mode: 'GIFT' })}
                                >
                                  <Gift className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
                                  title="خصم وحرمان نقاط"
                                  disabled={!settings?.isEnabled}
                                  onClick={() => setManualOp({ customer: c, mode: 'DEDUCT' })}
                                >
                                  <MinusCircle className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400"
                                  title="صرف القيمة نقداً — سند دفع من الصندوق"
                                  disabled={!settings?.isEnabled || c.available <= 0}
                                  onClick={() => setCashOutOf(c)}
                                >
                                  <Banknote className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ===== تبويب الإعدادات ===== */}
        <TabsContent value="settings" className="mt-3">
          <SettingsTab settings={settings} loading={loading} isAdmin={isAdmin} isArchive={isArchive} onSaved={() => void load()} />
        </TabsContent>
      </Tabs>

      {/* النوافذ */}
      <StatementDialog customer={statementOf} onClose={() => setStatementOf(null)} settings={settings} />
      <ManualOpDialog op={manualOp} onClose={() => setManualOp(null)} onDone={() => void load()} />
      <CashOutDialog customer={cashOutOf} onClose={() => setCashOutOf(null)} onDone={() => void load()} />
      <BulkDialog open={bulkOpen} onClose={() => setBulkOpen(false)} onDone={() => void load()} />
    </div>
  )
}

// ==================== تبويب الإعدادات ====================

/**
 * الجملة الموحدة الديناميكية لقاعدة المضاعفات — تُقرأ قيمتها مباشرة من حقل النسبة الحالي
 * لحظياً (قبل الحفظ وبعده) — وتُعرض موحدة أسفل الحقل وفي صندوق القاعدة، فلا أرقام ثابتة في أي موضع
 */
function FactorRuleText({ factor }: { factor: number }) {
  const neutral = Math.abs(factor - 1) <= 1e-9
  return (
    <>
      قاعدة المضاعفات: عند تفعيل نسبة مضاعفة النقاط الأسبوعية (×{' '}
      <span className="num font-bold">{fmtNumber(factor)}</span>)، يتم ضرب نقاط كل مضاعف كامل مغلق تلقائياً في هذه النسبة
      لحظة الترحيل الفعلي للفاتورة، وتُقرب النتيجة لأقرب عدد صحيح.
      {neutral && <span className="font-medium"> القيمة 1 تعني النقاط كما هي بلا مضاعفة.</span>}
    </>
  )
}

function SettingsTab({
  settings,
  loading,
  isAdmin,
  isArchive,
  onSaved,
}: {
  settings: LoyaltySettingsData | undefined
  loading: boolean
  isAdmin: boolean
  isArchive: boolean
  onSaved: () => void
}) {
  const { toast } = useToast()

  const [isEnabled, setIsEnabled] = useState(false)
  const [minInvoiceValue, setMinInvoiceValue] = useState('')
  const [cycleDays, setCycleDays] = useState('')
  const [basePoints, setBasePoints] = useState('')
  const [pointPrice, setPointPrice] = useState('')
  const [multiplicationFactor, setMultiplicationFactor] = useState('')
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)

  // مزامنة الحالة المحلية مع الإعدادات الحية عند كل جلب
  useEffect(() => {
    if (!settings) return
    setIsEnabled(settings.isEnabled)
    setMinInvoiceValue(String(settings.minInvoiceValue))
    setCycleDays(String(settings.cycleDays))
    setBasePoints(String(settings.basePoints))
    setPointPrice(String(settings.pointPrice))
    setMultiplicationFactor(String(settings.multiplicationFactor))
  }, [settings])

  // نسبة المضاعفة الحية — كل ما عداها واحد يفتح عمود «قبل النسبة» في الجدول
  const factorNum = Number(multiplicationFactor) || 1
  const showFactorCol = Math.abs(factorNum - 1) > 1e-9

  // جدول المضاعفات الحي — يُبنى من القيم المدخلة لحظياً (معاينة قبل الحفظ)
  // النقاط النهائية مشمولة نسبة المضاعفة الأسبوعية — وعمود «قبل النسبة» يُبنى بنسبة 1 للمقارنة
  const liveTable = useMemo(() => {
    const min = Number(minInvoiceValue) || 0
    const base = Number(basePoints) || 0
    const f = Number(multiplicationFactor) || 1
    if (min <= 0 || base <= 0 || f <= 0) return []
    return awardTableRows({ minInvoiceValue: min, basePoints: base, multiplicationFactor: f })
  }, [minInvoiceValue, basePoints, multiplicationFactor])

  const rawTable = useMemo(() => {
    const min = Number(minInvoiceValue) || 0
    const base = Number(basePoints) || 0
    if (min <= 0 || base <= 0) return []
    return awardTableRows({ minInvoiceValue: min, basePoints: base, multiplicationFactor: 1 })
  }, [minInvoiceValue, basePoints])

  const save = async (overrideEnabled?: boolean) => {
    setSaving(true)
    try {
      const res = await fetch('/api/loyalty/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isEnabled: overrideEnabled ?? isEnabled,
          minInvoiceValue: Number(minInvoiceValue) || 0,
          cycleDays: Number(cycleDays) || 1,
          basePoints: Number(basePoints) || 1,
          pointPrice: Number(pointPrice) || 0,
          multiplicationFactor: Number(multiplicationFactor) || 1,
        }),
      })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast({ title: 'تعذر حفظ الإعدادات', description: json?.error, variant: 'destructive' })
        return
      }
      toast({
        title: 'تم حفظ إعدادات نقاط الولاء',
        description:
          overrideEnabled ?? isEnabled
            ? 'النظام منشط — يُحتسب آلياً مع كل فاتورة مبيعات مؤهلة'
            : 'النظام متوقف — الواجهة عادت لنموذجها الأصلي في الفواتير',
      })
      onSaved()
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (checked: boolean) => {
    setIsEnabled(checked)
    setToggling(true)
    try {
      const res = await fetch('/api/loyalty/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: checked }),
      })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setIsEnabled(!checked)
        toast({ title: 'تعذر تغيير حالة النظام', description: json?.error, variant: 'destructive' })
        return
      }
      toast({
        title: checked ? 'تم تنشيط نظام نقاط الولاء' : 'تم إيقاف نظام نقاط الولاء',
        description: checked
          ? 'مربع النقاط ظهر في فواتير المبيعات والاحتساب الآلي يعمل'
          : 'مربع النقاط اختفى من الفواتير والطباعة عادت لنموذجها الأصلي',
      })
      onSaved()
    } catch {
      setIsEnabled(!checked)
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setToggling(false)
    }
  }

  if (loading || !settings) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {/* بطاقة المتغيرات */}
      <SectionCard
        title="المتغيرات الدورية للمنظومة"
        description="تُعدَّل وتُحفظ في قاعدة البيانات — تُطبق فوراً على كل الفواتير الجديدة"
        icon={Settings2}
      >
        <div className="space-y-4 p-4">
          {/* مفتاح التنشيط المركزي */}
          <div
            className={cn(
              'flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors',
              isEnabled ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'border-amber-500/40 bg-amber-500/[0.06]',
            )}
          >
            <div>
              <p className="text-sm font-bold">تنشيط نظام نقاط الولاء</p>
              <p className="text-xs text-muted-foreground">
                المفتاح المركزي للمنظومة كاملة — إيقافه يخفي مربع النقاط من الفواتير والطباعة فوراً ويعيد الواجهة لنموذجها الأصلي
              </p>
            </div>
            {isAdmin && !isArchive ? (
              <Switch checked={isEnabled} onCheckedChange={toggleEnabled} disabled={toggling} aria-label="تنشيط نظام نقاط الولاء" />
            ) : (
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px]',
                  isEnabled ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
                )}
              >
                {isEnabled ? 'منشط' : 'متوقف'}
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">
                الحد الأدنى لقيمة الفاتورة (ل.س) <span className="text-rose-500">*</span>
              </Label>
              <NumInput value={minInvoiceValue} onChange={(e) => setMinInvoiceValue(e.target.value)} className="h-9 text-start" disabled={!isAdmin} />
              <p className="text-[10px] text-muted-foreground">الفاتورة الأصغر من هذا الحد تُهمل كلياً — صفر نقاط ولا تجميع نهائياً</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                عدد أيام الدورة الأسبوعية <span className="text-rose-500">*</span>
              </Label>
              <NumInput value={cycleDays} onChange={(e) => setCycleDays(e.target.value)} className="h-9 text-start" disabled={!isAdmin} />
              <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <CalendarDays className="h-3 w-3" />
                الدورة الأسبوعية الكاملة — 7 أيام (أسبوع واحد)
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                عدد النقاط الأساسية <span className="text-rose-500">*</span>
              </Label>
              <NumInput value={basePoints} onChange={(e) => setBasePoints(e.target.value)} className="h-9 text-start" disabled={!isAdmin} />
              <p className="text-[10px] text-muted-foreground">
                نقاط المضاعف الكامل الأول — والمضاعفات المغلقة التالية تُحتسب وفق قاعدة المضاعفات الموحدة أدناه
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                سعر النقطة الواحدة (ل.س) <span className="text-rose-500">*</span>
              </Label>
              <NumInput value={pointPrice} onChange={(e) => setPointPrice(e.target.value)} className="h-9 text-start" disabled={!isAdmin} />
              <p className="text-[10px] text-muted-foreground">يتحول به الاسترداد إلى حسم مالي — والصرف النقدي بسند دفع من الصندوق</p>
            </div>
            <div className="space-y-1.5 rounded-lg border border-primary/30 bg-primary/[0.04] p-3 sm:col-span-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="flex items-center gap-1.5 text-xs font-bold">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  نسبة مضاعفة النقاط الأسبوعية (Multiplication Factor) <span className="text-rose-500">*</span>
                </Label>
                {showFactorCol && (
                  <Badge variant="outline" className="border-primary/40 bg-primary/10 text-[10px] text-primary">
                    مفعّلة الآن: ×{fmtNumber(factorNum)}
                  </Badge>
                )}
              </div>
              <NumInput
                value={multiplicationFactor}
                onChange={(e) => setMultiplicationFactor(e.target.value)}
                className="h-9 max-w-40 text-start"
                disabled={!isAdmin}
              />
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                <FactorRuleText factor={factorNum} />
              </p>
            </div>
          </div>

          {isAdmin && !isArchive && (
            <div className="flex items-center justify-end gap-2">
              <Button onClick={() => void save()} disabled={saving} className="min-w-32">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                حفظ الإعدادات
              </Button>
            </div>
          )}
        </div>
      </SectionCard>

      {/* بطاقة جدول المضاعفات الحي */}
      <SectionCard
        title="جدول المضاعفات الصارم — معاينة حية"
        description={
          showFactorCol
            ? `يُبنى لحظياً من القيم المدخلة أعلاه — النقاط النهائية مضروبة بنسبة المضاعفة الأسبوعية (×${fmtNumber(factorNum)})`
            : 'يُبنى لحظياً من القيم المدخلة أعلاه — المبالغ الكسرية تثبت على المضاعف الكامل الأخير'
        }
        icon={Sparkles}
      >
        <div className="p-4">
          {liveTable.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">أدخل حدّاً أدنى ونقاطاً أساسية صحيحة لعرض الجدول</p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-center">من (ل.س)</TableHead>
                    <TableHead className="text-center">إلى (ل.س)</TableHead>
                    {showFactorCol && <TableHead className="text-center">قبل النسبة</TableHead>}
                    <TableHead className="text-center">
                      {showFactorCol ? `النقاط النهائية (×${fmtNumber(factorNum)})` : 'النقاط الممنوحة'}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {liveTable.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="num text-center text-sm">{fmtNumber(r.from)}</TableCell>
                      <TableCell className="num text-center text-sm">
                        {i === liveTable.length - 1 ? `${fmtNumber(r.to)} وما فوق` : fmtNumber(r.to)}
                      </TableCell>
                      {showFactorCol && (
                        <TableCell className="num text-center text-sm text-muted-foreground line-through decoration-muted-foreground/50">
                          {fmtNumber(rawTable[i]?.points ?? 0)}
                        </TableCell>
                      )}
                      <TableCell className="text-center">
                        <span className="num text-sm font-extrabold text-primary">{fmtNumber(r.points)}</span>
                        <span className="text-[10px] text-muted-foreground"> نقطة</span>
                        {showFactorCol && r.points !== (rawTable[i]?.points ?? 0) && (
                          <span className="num mr-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                            (+{fmtNumber(r.points - (rawTable[i]?.points ?? 0))})
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="mt-3 rounded-lg bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground/80">قاعدة الاحتساب القطعية:</p>
            <p className="mb-1.5 font-medium text-foreground/90">
              <FactorRuleText factor={factorNum} />
            </p>
            <ul className="list-inside list-disc space-y-0.5">
              <li>تُحتسب النقاط للفاتورة الفردية المعتمدة التي تبلغ الحد الأدنى أو تتجاوزه فقط — الفواتير الأصغر تمنح صفر نقاط ولا تُجمع مع بعضها تحت أي ظرف.</li>
              <li>المبالغ الكسرية التي لا تقفل مضاعفاً كاملاً جديداً تثبت على نقاط المضاعف الكامل الأخير دون أي زيادة تلقائية.</li>
              <li>الاسترداد داخل الفاتورة يُرحَّل محاسبياً إلى حساب الحسم الممنوح (4110) — والصرف النقدي سند دفع يخرج من الصندوق (1110).</li>
            </ul>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}

// ==================== كشف الحساب التفصيلي ====================

function StatementDialog({
  customer,
  onClose,
  settings,
}: {
  customer: CustomerRow | null
  onClose: () => void
  settings?: LoyaltySettingsData
}) {
  const { toast } = useToast()
  const [data, setData] = useState<StatementData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!customer) return
    let alive = true
    const run = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/loyalty/statement?customerId=${customer.id}`)
        const json = (await res.json().catch(() => null)) as StatementData | null
        if (alive) setData(res.ok ? json : null)
      } catch {
        if (alive) setData(null)
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [customer])

  const doPrint = () => {
    if (!data) return
    const ok = printLoyaltyStatement(data, settings)
    if (!ok) {
      toast({
        title: 'تعذر فتح نافذة الطباعة',
        description: 'فضلاً اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة',
        variant: 'destructive',
      })
    }
  }

  return (
    <Dialog open={!!customer} onOpenChange={(open) => !open && onClose()}>
      <DialogContent variant="preview" className="w-[calc(100vw_-_var(--sidebar-w)_-_2rem)] sm:max-w-5xl">
        <DialogHeader className="text-start">
          <div className="flex flex-wrap items-center justify-between gap-2 pl-14">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <Star className="h-5 w-5 text-primary" />
              كشف حساب النقاط — {customer?.name}
              {customer && <span className="num text-xs font-normal text-muted-foreground">{customer.code}</span>}
            </DialogTitle>
            {data && (
              <Button size="sm" className="shrink-0" onClick={doPrint}>
                <Printer className="h-4 w-4" />
                طباعة كشف النقاط
              </Button>
            )}
          </div>
          <DialogDescription>كل الحركات مؤرخة وموثقة بالسبب — والرصيد المتبقي بعد كل حركة</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : data ? (
          <div className="space-y-3">
            {/* ملخص النقاط */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border bg-primary/[0.06] p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground">الرصيد المتاح</p>
                <p className="num text-lg font-extrabold text-primary">{fmtNumber(data.points.available)}</p>
              </div>
              <div className="rounded-lg border bg-amber-500/[0.06] p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground">المسترد سابقاً</p>
                <p className="num text-lg font-extrabold text-amber-600 dark:text-amber-400">{fmtNumber(data.points.redeemed)}</p>
              </div>
              <div className="rounded-lg border bg-muted/40 p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground">المكتسب كلياً</p>
                <p className="num text-lg font-extrabold">{fmtNumber(data.points.earned)}</p>
              </div>
            </div>

            {/* جدول الكشف */}
            <div className="max-h-[46vh] overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-28">رقم الفاتورة/السند</TableHead>
                    <TableHead className="w-24">التاريخ</TableHead>
                    <TableHead className="min-w-[220px]">البيان والسبب</TableHead>
                    <TableHead className="w-20 text-center">مضافة (+)</TableHead>
                    <TableHead className="w-20 text-center">مخصومة (−)</TableHead>
                    <TableHead className="w-24 text-center">الرصيد المتبقي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                        لا توجد حركات نقاط بعد — ستُسجل آلياً مع أول فاتورة مبيعات مؤهلة
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="num text-xs font-semibold text-primary">{r.refNumber ?? '—'}</TableCell>
                        <TableCell className="num whitespace-nowrap text-xs text-muted-foreground">
                          {fmtDate(r.createdAt)}
                        </TableCell>
                        <TableCell>
                          <TypeBadge type={r.type} />
                          <p className="mt-0.5 text-xs leading-relaxed">{r.reason}</p>
                        </TableCell>
                        <TableCell className="num text-center text-sm font-bold text-emerald-600 dark:text-emerald-400">
                          {r.points > 0 ? `+${fmtNumber(r.points)}` : '—'}
                        </TableCell>
                        <TableCell className="num text-center text-sm font-bold text-rose-600 dark:text-rose-400">
                          {r.points < 0 ? `−${fmtNumber(Math.abs(r.points))}` : '—'}
                        </TableCell>
                        <TableCell className="num text-center text-sm font-extrabold">{fmtNumber(r.balanceAfter)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">تعذر جلب كشف الحساب</p>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ==================== العمليات الفردية — إهداء / خصم وحرمان ====================

function ManualOpDialog({
  op,
  onClose,
  onDone,
}: {
  op: { customer: CustomerRow; mode: 'GIFT' | 'DEDUCT' } | null
  onClose: () => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const [points, setPoints] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (op) {
      setPoints('')
      setReason('')
    }
  }, [op])

  const pts = Number(points) || 0
  const maxDeduct = op?.customer.available ?? 0
  const invalid =
    !op || !(pts > 0) || !Number.isInteger(pts) || (op.mode === 'DEDUCT' && pts > maxDeduct) || !reason.trim()
  const after = op
    ? op.mode === 'GIFT'
      ? op.customer.available + pts
      : op.customer.available - Math.min(pts, maxDeduct)
    : 0

  const submit = async () => {
    if (!op || invalid || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/loyalty/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: op.customer.id, mode: op.mode, points: pts, reason: reason.trim() }),
      })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast({ title: 'تعذر تنفيذ العملية', description: json?.error, variant: 'destructive' })
        return
      }
      toast({
        title: op.mode === 'GIFT' ? `أُهديت ${pts} نقطة للعميل` : `خُصمت ${pts} نقطة من العميل`,
        description: `الحركة موثقة في كشف حساب ${op.customer.name} بالسبب المدخل`,
      })
      onDone()
      onClose()
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!op} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw_-_var(--sidebar-w)_-_2rem)] sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle className="flex items-center gap-2">
            {op?.mode === 'GIFT' ? (
              <>
                <Gift className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                إهداء نقاط يدوية — {op?.customer.name}
              </>
            ) : (
              <>
                <MinusCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                خصم وحرمان نقاط — {op?.customer.name}
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            الرصيد الحالي: <span className="num font-bold">{fmtNumber(op?.customer.available ?? 0)}</span> نقطة — الحركة توثق فوراً في كشف حسابه
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">
              عدد النقاط <span className="text-rose-500">*</span>
            </Label>
            <NumInput value={points} onChange={(e) => setPoints(e.target.value)} placeholder="0" className="h-9 text-start" />
            {op?.mode === 'DEDUCT' && pts > maxDeduct && (
              <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                الرصيد لا يكفي — المتاح {fmtNumber(maxDeduct)} نقطة فقط
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              السبب (إلزامي — يظهر في كشف الحساب) <span className="text-rose-500">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={op?.mode === 'GIFT' ? 'مثال: مكافأة ولاء عن شهر…' : 'مثال: تصحيح خطأ استحقاق سابق…'}
              rows={2}
              className="resize-none"
            />
          </div>
          {op && pts > 0 && (
            <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">الرصيد بعد العملية:</span>
              <span className="num font-extrabold text-primary">{fmtNumber(Math.max(0, after))} نقطة</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            تراجع
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={invalid || saving}
            className={op?.mode === 'GIFT' ? '' : 'bg-rose-600 hover:bg-rose-700'}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : op?.mode === 'GIFT' ? (
              <Gift className="h-4 w-4" />
            ) : (
              <MinusCircle className="h-4 w-4" />
            )}
            {op?.mode === 'GIFT' ? 'إهداء النقاط' : 'خصم النقاط'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ==================== صرف الكاش المباشر — سند دفع من الصندوق ====================

function CashOutDialog({
  customer,
  onClose,
  onDone,
}: {
  customer: CustomerRow | null
  onClose: () => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const [points, setPoints] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ voucherNumber: string; entryNumber: string; amount: number; points: number } | null>(null)

  useEffect(() => {
    if (customer) {
      setPoints(String(customer.available))
      setResult(null)
    }
  }, [customer])

  const pts = Number(points) || 0
  const available = customer?.available ?? 0
  // سعر النقطة مُشتق من قيمة الرصيد المعروضة (redeemValue ÷ المتاح) — دقيق للعرض الحي
  const pointPriceDerived = available > 0 ? (customer?.redeemValue ?? 0) / available : 0
  const cashValue = round2(pts * pointPriceDerived)
  const invalid = !customer || !(pts > 0) || !Number.isInteger(pts) || pts > available

  const submit = async () => {
    if (!customer || invalid || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/loyalty/cash-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: customer.id, points: pts }),
      })
      const json = (await res.json().catch(() => null)) as {
        error?: string
        ok?: boolean
        voucherNumber?: string
        entryNumber?: string
        amount?: number
        points?: number
      } | null
      if (!res.ok || !json?.ok) {
        toast({ title: 'تعذر صرف النقاط', description: json?.error, variant: 'destructive' })
        return
      }
      setResult({
        voucherNumber: json.voucherNumber ?? '',
        entryNumber: json.entryNumber ?? '',
        amount: json.amount ?? 0,
        points: json.points ?? pts,
      })
      toast({
        title: `صُرفت ${fmtMoney(json.amount ?? 0)} ل.س نقداً`,
        description: `سند دفع ${json.voucherNumber} من الصندوق (1110) — النقاط أُصفرت من كشف الحساب`,
      })
      onDone()
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!customer} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw_-_var(--sidebar-w)_-_2rem)] sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            صرف الكاش المباشر — {customer?.name}
          </DialogTitle>
          <DialogDescription>
            يولّد سند دفع نقداً يخرج من الصندوق (1110) ويقيد على الحسم الممنوح (4110) — وتُصفر النقاط المستبدلة فوراً
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <BadgeCheck className="h-6 w-6" />
            </div>
            <p className="text-sm font-bold">
              صُرف {fmtNumber(result.points)} نقطة بقيمة {fmtMoney(result.amount)} ل.س نقداً
            </p>
            <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-xs" dir="rtl">
              <p>
                سند الدفع: <span className="num font-bold text-primary">{result.voucherNumber}</span> — من الصندوق (1110)
              </p>
              <p>
                القيد: <span className="num font-bold text-primary">{result.entryNumber}</span> — مدين: الحسم الممنوح (4110)
              </p>
            </div>
            <Button onClick={onClose} className="w-full">
              إغلاق
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <span className="text-muted-foreground">الرصيد المتاح:</span>
                <span className="num font-extrabold text-primary">{fmtNumber(available)} نقطة</span>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  النقاط المطلوب صرفها <span className="text-rose-500">*</span>
                </Label>
                <NumInput value={points} onChange={(e) => setPoints(e.target.value)} className="h-9 text-start" />
                {pts > available && (
                  <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                    المتاح {fmtNumber(available)} نقطة فقط
                  </p>
                )}
              </div>
              {pts > 0 && customer && (
                <div className="flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-sm">
                  <span className="text-muted-foreground">القيمة المالية المصروفة:</span>
                  <span className="num font-extrabold text-amber-700 dark:text-amber-400">
                    {fmtMoney(cashValue)} ل.س <span className="num text-[10px] font-normal text-muted-foreground">≈ {fmtUSD(cashValue)}</span>
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                تراجع
              </Button>
              <Button onClick={() => void submit()} disabled={invalid || saving} className="bg-amber-600 hover:bg-amber-700">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                صرف نقداً وتوليد السند
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ==================== العمليات الجماعية — لكل العملاء ====================

function BulkDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast()
  const isAdmin = useApp((s) => s.user?.role === 'ADMIN')
  const [mode, setMode] = useState<'GIFT' | 'DEDUCT'>('GIFT')
  const [points, setPoints] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setMode('GIFT')
      setPoints('')
      setReason('')
    }
  }, [open])

  const pts = Number(points) || 0
  const invalid = !isAdmin || !(pts > 0) || !Number.isInteger(pts) || !reason.trim()

  const submit = async () => {
    if (invalid || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/loyalty/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, points: pts, reason: reason.trim() }),
      })
      const json = (await res.json().catch(() => null)) as {
        error?: string
        affectedCount?: number
        skippedCount?: number
        totalCustomers?: number
        skippedNames?: string[]
      } | null
      if (!res.ok) {
        toast({ title: 'تعذر تنفيذ العملية الجماعية', description: json?.error, variant: 'destructive' })
        return
      }
      const skipped = json?.skippedCount ?? 0
      toast({
        title: `${mode === 'GIFT' ? 'أُهديت' : 'خُصمت'} ${pts} نقطة ${mode === 'GIFT' ? 'لكل' : 'من'} ${json?.affectedCount ?? 0} عميل`,
        description:
          skipped > 0
            ? `تخطي ${skipped} عميل لعدم كفاية الرصيد — والسبب الموحد موثق في كشف حساب كل متأثر`
            : 'السبب الموحد موثق في كشف حساب كل عميل',
      })
      if (skipped > 0 && json?.skippedNames?.length) {
        toast({
          title: `تخطي ${skipped} عميل لعدم كفاية الرصيد`,
          description: json.skippedNames.join('، '),
          variant: 'destructive',
        })
      }
      onDone()
      onClose()
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[calc(100vw_-_var(--sidebar-w)_-_2rem)] sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            عملية جماعية — لجميع العملاء المسجلين
          </DialogTitle>
          <DialogDescription>تُطبق دفعة واحدة على كل العملاء بنفس العدد والسبب الموحد — حصراً للمدير</DialogDescription>
        </DialogHeader>

        {!isAdmin ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-3 py-4 text-center text-sm text-amber-700 dark:text-amber-400">
            العملية الجماعية متاحة للمدير فقط
          </p>
        ) : (
          <>
            <div className="space-y-3">
              <div className="grid h-9 grid-cols-2 gap-1 rounded-md border p-0.5">
                {(['GIFT', 'DEDUCT'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    aria-pressed={mode === m}
                    className={cn(
                      'rounded-sm text-sm transition-colors',
                      mode === m
                        ? m === 'GIFT'
                          ? 'bg-emerald-500/15 font-semibold text-emerald-600 dark:text-emerald-400'
                          : 'bg-rose-500/15 font-semibold text-rose-600 dark:text-rose-400'
                        : 'text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {m === 'GIFT' ? 'إهداء لجميع العملاء' : 'خصم من جميع العملاء'}
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  عدد النقاط (لكل عميل) <span className="text-rose-500">*</span>
                </Label>
                <NumInput value={points} onChange={(e) => setPoints(e.target.value)} placeholder="0" className="h-9 text-start" />
                {mode === 'DEDUCT' && (
                  <p className="text-[10px] text-muted-foreground">
                    من لا يملك الرصيد الكافي يُتخطى ولن تُفشل العملية الباقية — ويُوثق التخطي في الرد
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  السبب الموحد (إلزامي — يظهر في كشف حساب كل عميل) <span className="text-rose-500">*</span>
                </Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="مثال: حملة ترويجية عن عيد… / تسوية نظامية…"
                  rows={2}
                  className="resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                تراجع
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={invalid || saving}
                className={mode === 'GIFT' ? '' : 'bg-rose-600 hover:bg-rose-700'}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                تنفيذ على الجميع
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
