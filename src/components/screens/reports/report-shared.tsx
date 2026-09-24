'use client'

// مشتريات مركز التقارير — تعريف بطاقات التقارير الـ16 + أدوات ومكونات مشتركة
// (hook الجلب بعدّاد تسلسلي، حقول الفترة، قائمة اختيار الطرف البحثية، ألوان موحدة)

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BarChart3,
  CalendarRange,
  Check,
  ChevronsUpDown,
  Coins,
  FileBarChart,
  Handshake,
  Hourglass,
  Inbox,
  Landmark,
  Loader2,
  NotebookText,
  Package,
  Receipt,
  Repeat,
  Scale,
  ShoppingCart,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ==================== مفاتيح التقارير وبطاقات المركز ====================

// «كشف الحساب» واجهة واحدة بمفتاحين (عميل/مورد) — كلاهما يستدعي partner-statement
export type ReportKey =
  | 'trial-balance'
  | 'income-statement'
  | 'balance-sheet'
  | 'monthly-pnl'
  | 'inventory'
  | 'sales'
  | 'purchases'
  | 'customer-statement'
  | 'supplier-statement'
  | 'treasury'
  | 'expenses'
  | 'item-profitability'
  | 'receivables-aging'
  | 'profitability'
  | 'period-comparison'
  | 'inventory-turnover'

export interface ReportCardDef {
  key: ReportKey
  title: string
  description: string
  icon: LucideIcon
  /** أصناف مربع الأيقونة — bg-X/15 text-X متنوعة بلا أزرق/نيلي */
  iconBox: string
}

export const REPORT_CARDS: ReportCardDef[] = [
  {
    key: 'trial-balance',
    title: 'ميزان المراجعة',
    description: 'ملخص أرصدة الحسابات (مدين ودائن)',
    icon: Scale,
    iconBox: 'bg-primary/15 text-primary',
  },
  {
    key: 'income-statement',
    title: 'الأرباح والخسائر',
    description: 'إيرادات ومصروفات وصافي الربح',
    icon: TrendingUp,
    iconBox: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  {
    key: 'balance-sheet',
    title: 'الميزانية العمومية',
    description: 'أصول والتزامات وحقوق ملكية',
    icon: Landmark,
    iconBox: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  },
  {
    key: 'monthly-pnl',
    title: 'أرباح وخسائر شهرية',
    description: 'تحليل الأرباح والخسائر شهرياً خلال السنة',
    icon: BarChart3,
    iconBox: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  },
  {
    key: 'inventory',
    title: 'تقرير المخزون',
    description: 'كميات وقيم وأصناف تحت الحد الأدنى',
    icon: Package,
    iconBox: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  {
    key: 'sales',
    title: 'تقرير المبيعات',
    description: 'تفاصيل فواتير البيع والإحصائيات',
    icon: ShoppingCart,
    iconBox: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  {
    key: 'purchases',
    title: 'تقرير المشتريات',
    description: 'تفاصيل فواتير الشراء والإحصائيات',
    icon: Truck,
    iconBox: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  },
  {
    key: 'customer-statement',
    title: 'كشف حساب عميل',
    description: 'حركة فواتير ودفعات عميل محدد',
    icon: Users,
    iconBox: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  },
  {
    key: 'supplier-statement',
    title: 'كشف حساب مورد',
    description: 'حركة فواتير ودفعات مورد محدد',
    icon: NotebookText,
    iconBox: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  },
  {
    key: 'treasury',
    title: 'تقرير الصندوق',
    description: 'حركات الوارد والصادر ورصيد الصندوق',
    icon: Wallet,
    iconBox: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  },
  {
    key: 'expenses',
    title: 'تقرير المصروفات',
    description: 'المصروفات حسب التصنيف وتفاصيل القيود',
    icon: Receipt,
    iconBox: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  },
  {
    key: 'item-profitability',
    title: 'تقرير ربحية الأصناف',
    description: 'الإيراد والتكلفة والربح لكل صنف',
    icon: Coins,
    iconBox: 'bg-primary/15 text-primary',
  },
  {
    key: 'receivables-aging',
    title: 'أعمار الذمم',
    description: 'أرصدة العملاء والموردين على فئات العمر 0-30/31-60/61-90/+90',
    icon: Hourglass,
    iconBox: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  {
    key: 'profitability',
    title: 'ربحية العملاء والمستودعات',
    description: 'من من عملائك ومستودعاتك يربحني فعلاً — إيراد وتكلفة وربح',
    icon: Handshake,
    iconBox: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  {
    key: 'period-comparison',
    title: 'مقارنة الفترات',
    description: 'هذا الشهر مقابل الماضي — مبيعات وتحصيلات ومصروفات وأرباح',
    icon: CalendarRange,
    iconBox: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  },
  {
    key: 'inventory-turnover',
    title: 'دوران المخزون',
    description: 'معدل دوران كل صنف وأيام التغطية والأصناف الراكدة ورأس المال المعطل',
    icon: Repeat,
    iconBox: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  },
]

// ==================== ألوان وأصناف مشتركة ====================

export const BADGE_BALANCED = 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
export const BADGE_UNBALANCED = 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
/** المبالغ السالبة (أرصدة دائنة/خسائر) */
export const NEG_CLS = 'text-rose-600 dark:text-rose-400'
/** صف الإجمالي المميز بالذهبي */
export const TOTAL_ROW_CLS = 'bg-primary/10 font-bold text-primary hover:bg-primary/10'

/** تنسيق تاريخ YYYY-MM-DD للعرض (ي/Y/ي) دون المرور عبر Date تفادياً لإزاحة المنطقة الزمنية */
export function fmtYMD(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return y && m && d ? `${y}/${m}/${d}` : ymd
}

// ==================== حالات الجدول الموحدة ====================

export function ReportLoading() {
  return (
    <div className="flex items-center justify-center rounded-lg border py-14 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  )
}

export function ReportEmpty({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border py-14 text-center text-muted-foreground">
      <Inbox className="h-8 w-8" />
      <p className="text-sm">{message}</p>
    </div>
  )
}

// ==================== hook الجلب الموحد للتقارير ====================
// عدّاد تسلسلي يمنع طغيان استجابة أقدم عند تغير الفلاتر بسرعة — مع toast عند الفشل

export function useReportFetch<T>() {
  const { toast } = useToast()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)

  const run = useCallback(
    async (url: string) => {
      const s = ++seq.current
      setLoading(true)
      try {
        const res = await fetch(url)
        const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null
        if (s !== seq.current) return
        if (!res.ok || !json) {
          toast({
            title: 'تعذر توليد التقرير',
            description: json?.error ?? 'حدث خطأ غير متوقع',
            variant: 'destructive',
          })
          setData(null)
          return
        }
        setData(json)
      } catch {
        if (s === seq.current) {
          toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
          setData(null)
        }
      } finally {
        if (s === seq.current) setLoading(false)
      }
    },
    [toast],
  )

  return { data, loading, run }
}

// ==================== حقول الفترة + زر التطبيق ====================

interface PeriodFieldsProps {
  from: string
  to: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
  onApply: () => void
  loading?: boolean
  /** إخفاء حقل «من» — للتقارير التراكمية */
  hideFrom?: boolean
  /** ضوابط فلترة إضافية تظهر قبل زر التطبيق (مستودع/طرف/سنة…) */
  children?: ReactNode
  applyLabel?: string
}

export function PeriodFields({
  from,
  to,
  onFromChange,
  onToChange,
  onApply,
  loading,
  hideFrom,
  children,
  applyLabel = 'عرض التقرير',
}: PeriodFieldsProps) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      {!hideFrom && (
        <div className="space-y-1">
          <Label className="text-xs">من</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => onFromChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onApply()}
            className="num h-9 w-[150px]"
            aria-label="بداية الفترة"
          />
        </div>
      )}
      <div className="space-y-1">
        <Label className="text-xs">إلى</Label>
        <Input
          type="date"
          value={to}
          onChange={(e) => onToChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onApply()}
          className="num h-9 w-[150px]"
          aria-label="نهاية الفترة"
        />
      </div>
      {children}
      <Button size="sm" className="h-9" onClick={onApply} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileBarChart className="h-4 w-4" />}
        {applyLabel}
      </Button>
    </div>
  )
}

// ==================== قائمة اختيار الطرف البحثية (كشف الحساب) ====================

export interface PartnerLite {
  id: string
  code: string
  name: string
  type: string
}

interface PartnerComboboxProps {
  type: 'CUSTOMER' | 'SUPPLIER'
  value: string | null
  onChange: (partnerId: string) => void
  disabled?: boolean
  className?: string
}

export function PartnerCombobox({ type, value, onChange, disabled, className }: PartnerComboboxProps) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [partners, setPartners] = useState<PartnerLite[]>([])
  const [loading, setLoading] = useState(true)

  const isCustomer = type === 'CUSTOMER'

  useEffect(() => {
    let alive = true
    // loading مهيأة true من الحالة الابتدائية — النوع ثابت لعمر المكوّن
    fetch(`/api/partners?type=${type}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('partners'))))
      .then((d: { partners?: PartnerLite[] }) => {
        if (alive) setPartners(d.partners ?? [])
      })
      .catch(() => {
        if (alive) {
          setPartners([])
          toast({ title: 'تعذر جلب قائمة الأطراف', variant: 'destructive' })
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [type, toast])

  const selected = partners.find((p) => p.id === value) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return partners
    return partners.filter(
      (p) => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
    )
  }, [partners, query])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className={cn('h-9 w-full justify-between gap-1 font-normal sm:w-[260px]', !selected && 'text-muted-foreground', className)}
        >
          {loading ? (
            <span className="flex items-center gap-2 text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              جاري تحميل الأطراف…
            </span>
          ) : selected ? (
            <span className="truncate">
              <span className="num text-muted-foreground">{selected.code}</span>
              {' — '}
              {selected.name}
            </span>
          ) : (
            <span>{isCustomer ? 'اختر العميل…' : 'اختر المورد…'}</span>
          )}
          <ChevronsUpDown className="ms-auto h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="ابحث بالكود أو الاسم…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>لا توجد أطراف مطابقة للبحث</CommandEmpty>
            <CommandGroup>
              {filtered.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.code} ${p.name}`}
                  onSelect={() => {
                    onChange(p.id)
                    setOpen(false)
                    setQuery('')
                  }}
                  className="gap-2"
                >
                  <Check
                    className={cn('h-4 w-4 shrink-0 text-primary', p.id === value ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="num shrink-0 text-xs text-muted-foreground">{p.code}</span>
                  <span className="min-w-0 truncate">{p.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
