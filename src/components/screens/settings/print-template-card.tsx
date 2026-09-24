'use client'

// بطاقة قالب الطباعة — التخصيص الديناميكي للترويسة والتواقيع (Task 26) وترقيم الصفحات (Task 26-b)
// ومقاييس الترويسة المُحكمة بصناديق هوامش (Task 28): حجم الشعار + حجم النصوص + المسافة
// بين العناصر + الهامش السفلي — مع معاينة تصميمية ترسم إطاراً متقطعاً حول كل عنصر
// وتعرض مقاسه الحقيقي بالبكسل كما سيُطبع (الصناديق للمعاينة فقط ولا تُطبع أبداً)
// الحفظ يطبق فوراً على كل أسطح الطباعة الثمانية — للمدير فقط (والخادم يفرض ذلك أيضاً)

import { useState, type Dispatch, type SetStateAction } from 'react'
import { LayoutDashboard, Loader2, Lock, MousePointerClick, Printer, RotateCcw, Ruler, Save } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import { SectionCard } from '@/components/common/section-card'
import { useToast } from '@/hooks/use-toast'
import { useApp, useIsArchive } from '@/lib/store'
import { type CompanyInfo } from '@/lib/company'
import {
  applyPrintTemplate,
  AR_LOGO_POSITION,
  COMPANY_FONT_BASE,
  DEFAULT_HEADER_LAYOUT,
  DEFAULT_PRINT_TEMPLATE,
  LOGO_BASE_HEIGHT,
  logoHeightPx,
  SUB_FONT_BASE,
  type PrintHeaderLayout,
  type PrintLogoPosition,
  type PrintTemplate,
} from '@/lib/print-template'
import { fmtDate } from '@/lib/format'
import { FreeHeaderPreview, HeaderLayoutBuilderDialog } from './header-layout-builder'

/** خيارات حجم الشعار كنسبة من التصميم الحالي (200px) */
const LOGO_SCALE_OPTIONS: { value: string; label: string }[] = [
  { value: '60', label: '60% — صغير جداً' },
  { value: '75', label: '75% — صغير' },
  { value: '90', label: '90% — أصغر قليلاً' },
  { value: '100', label: '100% — الحجم الحالي (افتراضي)' },
  { value: '115', label: '115% — أكبر قليلاً' },
  { value: '130', label: '130% — كبير' },
  { value: '150', label: '150% — كبير جداً' },
  { value: '160', label: '160% — الأقصى' },
]

/** خيارات حجم نصوص الترويسة (Task 28) — نفس نطاق الشعار */
const TEXT_SCALE_OPTIONS: { value: string; label: string }[] = [
  { value: '60', label: '60% — صغير جداً' },
  { value: '75', label: '75% — صغير' },
  { value: '90', label: '90% — أصغر قليلاً' },
  { value: '100', label: '100% — الحجم الحالي (افتراضي)' },
  { value: '115', label: '115% — أكبر قليلاً' },
  { value: '130', label: '130% — كبير' },
  { value: '160', label: '160% — الأقصى' },
]

/** خيارات المسافة بين عناصر الترويسة (Task 28) */
const GAP_OPTIONS: { value: string; label: string }[] = [
  { value: '0', label: '0px — متلاصقة' },
  { value: '8', label: '8px — ضيقة' },
  { value: '16', label: '16px — الحالية (افتراضي)' },
  { value: '24', label: '24px — متباعدة' },
  { value: '32', label: '32px — واسعة' },
  { value: '40', label: '40px — الأوسع' },
]

/** خيارات الهامش السفلي للترويسة قبل خط الفصل (Task 28) */
const PADDING_OPTIONS: { value: string; label: string }[] = [
  { value: '0', label: '0px — ملاصق للخط' },
  { value: '5', label: '5px' },
  { value: '10', label: '10px — الحالي (افتراضي)' },
  { value: '15', label: '15px' },
  { value: '20', label: '20px — مريح' },
  { value: '30', label: '30px — الأقصى' },
]

const POSITION_OPTIONS: PrintLogoPosition[] = ['right', 'center', 'left']

/** شارة مقاس صغيرة تُلصق على صندوق العنصر في المعاينة التصميمية */
function SizeChip({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'amber' }) {
  return (
    <span
      className={`pointer-events-none absolute -top-2 start-1.5 z-10 rounded-full border px-1.5 py-px text-[8.5px] font-bold leading-none shadow-sm ${
        tone === 'amber'
          ? 'border-amber-300 bg-amber-50 text-amber-700'
          : 'border-neutral-300 bg-white text-neutral-500'
      }`}
    >
      {children}
    </span>
  )
}

interface PrintTemplateCardProps {
  tpl: PrintTemplate
  setTpl: Dispatch<SetStateAction<PrintTemplate>>
  company: CompanyInfo
}

export function PrintTemplateCard({ tpl, setTpl, company }: PrintTemplateCardProps) {
  const { toast } = useToast()
  const user = useApp((s) => s.user)
  const isAdmin = user?.role === 'ADMIN'
  // وضع استعراض أرشيف فترة مقفلة — يخفي أزرار الحفظ وفتح المصمم (حفظه التلقائي كتابة)
  const isArchive = useIsArchive()
  const [saving, setSaving] = useState(false)
  const [builderOpen, setBuilderOpen] = useState(false)

  const set = (patch: Partial<PrintTemplate>) => setTpl((t) => ({ ...t, ...patch }))

  // التخطيط الحر مفعّل ← عناصر التحكم الكلاسيكية بالموضع/الحجم تتعارض مع إحداثيات
  // السحب والإفلات فتُعطَّل صراحة (تبقى ظاهرة لتوضيح ما تجاوزه المصمم، لا تُخفى)
  const classicControlsDisabled = saving || !!tpl.layout?.enabled

  /** التخطيط الحر — يبدأ من الافتراضي عند أول فتح للمصمم إن لم يُحفظ شيء بعد */
  const activeLayout: PrintHeaderLayout = tpl.layout ?? DEFAULT_HEADER_LAYOUT
  const updateLayout = (updater: (prev: PrintHeaderLayout) => PrintHeaderLayout) =>
    setTpl((t) => ({ ...t, layout: updater(t.layout ?? DEFAULT_HEADER_LAYOUT) }))

  /** هل ضبط المستخدم حجم النصوص يدوياً؟ — قبل ذلك تتبع النصوص حجم الشعار تلقائياً فلا تشوه (Task 28) */
  const [textTouched, setTextTouched] = useState(false)

  /** تغيير حجم الشعار مع سحب النصوص معه تلقائياً (إن لم تُضبط يدوياً) — ترويسة متوازنة دائماً */
  const setLogoScale = (v: number) =>
    setTpl((t) => (textTouched ? { ...t, logoScale: v } : { ...t, logoScale: v, textScale: v }))

  // ===== الحفظ — تحقق محلي مطابق لتحقق الخادم ثم تطبيق الكاش فوراً =====
  // نطاق هذه البطاقة الآن: تصميم الترويسة والمعاينة فقط — التوقيعات لها بطاقتها
  // وحفظها المستقل في تبويب «بيانات الهوية والتوقيعات» (SignatureSettingsCard)
  const save = async () => {
    const subtitle = tpl.subtitle.trim()
    if (subtitle.length > 60) {
      toast({ title: 'سطر النظام طويل', description: 'بحد أقصى 60 محرفاً', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printSubtitle: subtitle,
          printLogoPosition: tpl.logoPosition,
          printLogoScale: tpl.logoScale,
          printTextScale: tpl.textScale,
          printHeaderGap: tpl.headerGap,
          printHeaderPadding: tpl.headerPadding,
          printPageNumbers: String(tpl.pageNumbers),
          // التخطيط الحر يُحفظ مع الزر أيضاً (مع المصمم حفظه التلقائي المستقل)
          ...(tpl.layout ? { printHeaderLayout: JSON.stringify(tpl.layout) } : {}),
        }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok || !data) {
        toast({ title: 'تعذر حفظ قالب الطباعة', description: data?.error ?? 'حدث خطأ غير متوقع', variant: 'destructive' })
        return
      }
      applyPrintTemplate({ ...tpl, subtitle }) // الكاش المحلي يتحدث فوراً — الطباعة القادمة بالتخصيص الجديد
      toast({
        title: 'تم حفظ قالب الطباعة',
        description: 'سيظهر التخصيص في كل الفواتير والسندات والقيود والكشوفات فوراً',
      })
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  /** استعادة الافتراضي + حفظ فوري (Task 30):
   *  قديماً كان الزر يصفّر الحالة المحلية فقط — وإن حفظ المستخدم لاحقاً فإن
   *  printHeaderLayout لم يُرسَل (layout null) فكان الخادم يُبقي التخطيط الحر
   *  المحفوظ مفعّلاً ويظل يغلب الافتراضيات في كل المطبوعات (شكوى «الافتراضيات
   *  لا تطبق على الفوترة») — الآن الإرسال صريح بتخطيط افتراضي معطّل ويُحفظ فوراً
   *  فتُطبَّق الافتراضيات على الفواتير والسندات والتقارير مباشرة بلا خطوة ثانية */
  const resetAndSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printSubtitle: DEFAULT_PRINT_TEMPLATE.subtitle,
          printLogoPosition: DEFAULT_PRINT_TEMPLATE.logoPosition,
          printLogoScale: DEFAULT_PRINT_TEMPLATE.logoScale,
          printTextScale: DEFAULT_PRINT_TEMPLATE.textScale,
          printHeaderGap: DEFAULT_PRINT_TEMPLATE.headerGap,
          printHeaderPadding: DEFAULT_PRINT_TEMPLATE.headerPadding,
          printPageNumbers: String(DEFAULT_PRINT_TEMPLATE.pageNumbers),
          printHeaderLayout: JSON.stringify({ ...DEFAULT_HEADER_LAYOUT, enabled: false }),
        }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok || !data) {
        toast({ title: 'تعذر استعادة الافتراضي', description: data?.error ?? 'حدث خطأ غير متوقع', variant: 'destructive' })
        return
      }
      // يُبقي التوقيعات كما هي — هذا الزر يقتصر نطاقه على تصميم الترويسة فقط
      const resetLayout = { ...DEFAULT_HEADER_LAYOUT, enabled: false }
      const resetFields = {
        subtitle: DEFAULT_PRINT_TEMPLATE.subtitle,
        logoPosition: DEFAULT_PRINT_TEMPLATE.logoPosition,
        logoScale: DEFAULT_PRINT_TEMPLATE.logoScale,
        textScale: DEFAULT_PRINT_TEMPLATE.textScale,
        headerGap: DEFAULT_PRINT_TEMPLATE.headerGap,
        headerPadding: DEFAULT_PRINT_TEMPLATE.headerPadding,
        pageNumbers: DEFAULT_PRINT_TEMPLATE.pageNumbers,
        layout: resetLayout,
      }
      setTpl((t) => ({ ...t, ...resetFields }))
      applyPrintTemplate({ ...tpl, ...resetFields }) // الكاش يتحدث فوراً — المطبوعات القادمة بالافتراضي
      toast({
        title: 'استُعيد الافتراضي وحُفظ',
        description: 'يُطبَّق الآن على كل الفواتير والسندات والقيود والكشوفات والتقارير — وعاد المصمم لمواضعه الافتراضية (معطّلاً)',
      })
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <SectionCard
        title="تصميم الترويسة والمعاينة"
        description="تخصيص ترويسة كل المستندات المطبوعة"
        icon={Printer}
      >
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p>تخصيص تصميم الترويسة متاح للمدير فقط — راجع مدير النظام لتعديلها.</p>
        </div>
      </SectionCard>
    )
  }

  // ===== المعاينة الحية — نفس بنية رأس الطباعة الورقي بمقاس مصغر (÷3.2) =====
  const previewH = Math.max(28, Math.round(logoHeightPx(tpl) / 3.2))
  const companyFontPx = Math.round((COMPANY_FONT_BASE * tpl.textScale) / 100)
  const subFontPx = Math.round((SUB_FONT_BASE * tpl.textScale) / 100)
  const companyPreviewFont = Math.max(8, Math.round(companyFontPx / 2.2))
  const subPreviewFont = Math.max(6, Math.round(subFontPx / 2.2))
  const subPreview = tpl.subtitle.trim()
  const logoBoxClasses =
    tpl.logoPosition === 'right'
      ? 'order-first w-[30%] justify-start'
      : tpl.logoPosition === 'left'
        ? 'order-last w-[30%] justify-end'
        : 'flex-1 justify-center'

  return (
    <SectionCard
      title="تصميم الترويسة والمعاينة"
      description="ترويسة وترقيم صفحات كل الفواتير والسندات والقيود والكشوفات — تُطبَّق فوراً بعد الحفظ دون مسّ أي بيانات"
      icon={Printer}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        {/* ===== عناصر التخصيص ===== */}
        <div className="space-y-5">
          {/* زر المصمم التفاعلي (Task 29) */}
          <div className="rounded-lg border border-amber-500/30 bg-gradient-to-l from-amber-500/10 to-transparent p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="flex items-center gap-1.5 text-sm font-bold">
                  <LayoutDashboard className="h-4 w-4 text-amber-600" aria-hidden="true" />
                  مصمم الترويسة التفاعلي
                </p>
                <p className="text-xs text-muted-foreground">
                  اسحب كل عنصر بمشك وأينما شئت، وحجّمه بالمقابض، بلا أي قيود أو محاذاة تلقائية — والإحداثيات تُحفظ فوراً حتى مع التداخل المقصود
                </p>
              </div>
              {!isArchive && (
                <Button onClick={() => setBuilderOpen(true)} className="gap-2">
                  <MousePointerClick className="h-4 w-4" aria-hidden="true" />
                  فتح المصمم
                </Button>
              )}
            </div>
            {tpl.layout?.enabled && (
              <p className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                ✦ التخطيط الحر مفعّل حالياً — الترويسة تُرسم بالإحداثيات المحفوظة في كل المستندات، وعناصر التحكم الكلاسيكية بالموضع والحجم أدناه معطَّلة لمنع تعارضها مع إحداثيات المصمم
              </p>
            )}
          </div>

          {/* الترويسة */}
          <div className="space-y-3">
            <p className="text-sm font-bold">الترويسة</p>
            <div className="space-y-1.5">
              <Label htmlFor="print-subtitle">سطر النظام (تحت اسم الشركة)</Label>
              <Input
                id="print-subtitle"
                value={tpl.subtitle}
                onChange={(e) => set({ subtitle: e.target.value })}
                placeholder="نظام المحاسبة والمخزون"
                maxLength={60}
                disabled={saving}
              />
              <p className="text-xs text-muted-foreground">
                وصف المستند (فواتير المبيعات والسندات النقدية…) يُضاف تلقائياً بعده — وتركه فارغاً يخفي السطر
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="print-logo-position">موضع الشعار</Label>
                <Select
                  value={tpl.logoPosition}
                  onValueChange={(v) => set({ logoPosition: v as PrintLogoPosition })}
                  disabled={classicControlsDisabled}
                >
                  <SelectTrigger id="print-logo-position" aria-label="موضع الشعار">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POSITION_OPTIONS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {AR_LOGO_POSITION[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="print-logo-scale">حجم الشعار</Label>
                <Select
                  value={String(tpl.logoScale)}
                  onValueChange={(v) => setLogoScale(Number(v))}
                  disabled={classicControlsDisabled}
                >
                  <SelectTrigger id="print-logo-scale" aria-label="حجم الشعار">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOGO_SCALE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* مقاييس الترويسة الدقيقة (Task 28) — الصناديق في المعاينة تعرض أثرها */}
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
              <p className="mb-2.5 flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                <Ruler className="h-3.5 w-3.5" aria-hidden="true" />
                مقاييس الترويسة الدقيقة — لكل عنصر بُعده الخاص
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="print-text-scale" className="text-xs">
                    حجم النصوص
                  </Label>
                  <Select
                    value={String(tpl.textScale)}
                    onValueChange={(v) => {
                      setTextTouched(true)
                      set({ textScale: Number(v) })
                    }}
                    disabled={classicControlsDisabled}
                  >
                    <SelectTrigger id="print-text-scale" aria-label="حجم نصوص الترويسة" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEXT_SCALE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="print-header-gap" className="text-xs">
                    المسافة بين العناصر
                  </Label>
                  <Select
                    value={String(tpl.headerGap)}
                    onValueChange={(v) => set({ headerGap: Number(v) })}
                    disabled={classicControlsDisabled}
                  >
                    <SelectTrigger id="print-header-gap" aria-label="المسافة بين عناصر الترويسة" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GAP_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="print-header-padding" className="text-xs">
                    الهامش السفلي
                  </Label>
                  <Select
                    value={String(tpl.headerPadding)}
                    onValueChange={(v) => set({ headerPadding: Number(v) })}
                    disabled={classicControlsDisabled}
                  >
                    <SelectTrigger id="print-header-padding" aria-label="الهامش السفلي للترويسة" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PADDING_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                الصناديق المتقطعة في المعاينة تُظهر بُعد كل عنصر بالمقاس الحقيقي للطباعة — اضبط الحجم ثم راقب الأرقام
                فوق كل صندوق. النصوص والشعار يتحركان معاً بنِسَب متوازنة فلا تشوه مهما كبرت أو صغّرت.
              </p>
            </div>

            {!company.companyLogo && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                لا يوجد شعار مرفوع بعد — ارفعه من تبويب «بيانات الهوية والتوقيعات» وسيظهر في الموضع والحجم المحددين هنا
              </p>
            )}
          </div>

          {/* التقسيم والترقيم (Task 26-b) */}
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="print-page-numbers" className="text-sm font-bold">
                  ترقيم الصفحات
                </Label>
                <p className="text-xs text-muted-foreground">
                  عند طول المستند تُقسَّم الصفوف تلقائياً على أوراق A4، مع «صفحة X من Y» أسفل كل ورقة
                  وتكرار رأس مصغّر وعناوين الجدول في كل صفحة
                </p>
              </div>
              <Switch
                id="print-page-numbers"
                aria-label="ترقيم الصفحات في الطباعة"
                checked={tpl.pageNumbers}
                onCheckedChange={(v) => set({ pageNumbers: v })}
                disabled={saving}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isArchive && (
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                حفظ قالب الطباعة
              </Button>
            )}
            {!isArchive && (
              <Button
                variant="outline"
                onClick={() => void resetAndSave()}
                disabled={saving}
                title="يعيد كل مقاييس الكليشة للافتراضي ويوقف التخطيط الحر — ويحفظ فوراً لتُطبَّق على كل المطبوعات"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                استعادة الافتراضي وحفظه
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            «استعادة الافتراضي وحفظه» تُطبَّق فوراً على كل الفواتير والسندات والتقارير بعد الحفظ — وتوقف التخطيط الحر مع إعادة عناصره لمواضعها الافتراضية، ويمكنك إعادة تفعيله وتعديله من المصمم في أي وقت
          </p>
        </div>

        {/* ===== المعاينة الحية ===== */}
        <div className="space-y-2">
          <Label>معاينة حية {tpl.layout?.enabled ? '— بالتخطيط الحر المحفوظ (ما تراه هو ما يُطبع)' : '— بصناديق الأبعاد كما ستُطبع'}</Label>
          {tpl.layout?.enabled ? (
            <div className="rounded-lg border bg-neutral-100 p-3 shadow-sm" aria-label="معاينة التخطيط الحر">
              <FreeHeaderPreview layout={tpl.layout} company={company} subtitle={tpl.subtitle} />
              <div className="mt-2 flex justify-center">
                {!isArchive && (
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setBuilderOpen(true)}>
                    <MousePointerClick className="h-3.5 w-3.5" aria-hidden="true" />
                    تعديل في المصمم
                  </Button>
                )}
              </div>
            </div>
          ) : (
          <>
          <div className="rounded-lg border bg-white p-4 text-neutral-900 shadow-sm" aria-label="معاينة قالب الطباعة">
            <div
              className="flex items-center border-b-2 border-double border-neutral-400"
              style={{ gap: `${Math.max(2, Math.round(tpl.headerGap / 3))}px`, paddingBottom: `${Math.max(2, Math.round(tpl.headerPadding / 3))}px` }}
            >
              {/* صندوق اسم الشركة — الشارة تعرض حجم الخط الحقيقي */}
              <div
                className="relative w-[30%] min-w-0 rounded-sm border border-dashed border-neutral-400 p-1.5 text-right"
                title={`اسم الشركة — حجم الخط المطبوع: ${companyFontPx}px`}
              >
                <SizeChip>اسم الشركة · {companyFontPx}px</SizeChip>
                <p className="truncate font-bold" style={{ fontSize: `${companyPreviewFont}px` }}>
                  {company.companyName || 'شركة الأمل التجارية 2026'}
                </p>
                {company.companyPhone && (
                  <p className="mt-0.5 truncate" style={{ fontSize: `${subPreviewFont}px` }}>
                    هاتف: <span className="num">{company.companyPhone}</span>
                  </p>
                )}
                {company.companyEmail && (
                  <p className="mt-0.5 truncate" style={{ fontSize: `${subPreviewFont}px` }}>
                    بريد: <span className="num" dir="ltr">{company.companyEmail}</span>
                  </p>
                )}
                {subPreview && (
                  <p className="mt-0.5 truncate text-neutral-500" style={{ fontSize: `${subPreviewFont}px` }}>
                    {subPreview} — {`{وصف المستند}`}
                  </p>
                )}
              </div>

              {/* صندوق الشعار — الشارة تعرض الارتفاع الحقيقي */}
              <div
                className={`relative flex min-w-0 items-center rounded-sm border border-dashed border-amber-400/80 p-1 ${logoBoxClasses}`}
                title={`الشعار — الارتفاع المطبوع: ${logoHeightPx(tpl)}px`}
              >
                <SizeChip tone="amber">الشعار · {logoHeightPx(tpl)}px</SizeChip>
                {company.companyLogo ? (
                  <img src={company.companyLogo} alt="شعار الشركة" style={{ height: `${previewH}px` }} className="object-contain" />
                ) : (
                  <div
                    className="flex w-20 items-center justify-center rounded border border-dashed border-neutral-300 text-[9px] text-neutral-400"
                    style={{ height: `${previewH}px` }}
                  >
                    موضع الشعار
                  </div>
                )}
              </div>

              {/* صندوق تاريخ الطباعة */}
              <div
                className="relative w-[30%] shrink-0 rounded-sm border border-dashed border-neutral-400 p-1.5 text-left text-neutral-500"
                title={`تاريخ الطباعة — حجم الخط المطبوع: ${subFontPx}px`}
              >
                <SizeChip>الختم · {subFontPx}px</SizeChip>
                <p style={{ fontSize: `${subPreviewFont}px` }}>
                  تاريخ الطباعة: <span className="num">{fmtDate(new Date())}</span>
                </p>
              </div>
            </div>

            <p className="mt-3 text-center text-xs font-bold">عنوان المستند يظهر هنا</p>

            <div className="mt-8 flex justify-around px-4">
              <div className="w-28 text-center">
                <div className="border-t border-dashed border-neutral-400 pt-1.5 text-[10px] font-bold">المستلم</div>
              </div>
              {tpl.signAccountantVisible && (
                <div className="w-28 text-center">
                  <div className="border-t border-dashed border-neutral-400 pt-1.5 text-[10px] font-bold">
                    {tpl.signAccountant || '—'}
                  </div>
                  {tpl.signAccountantName && <div className="mt-0.5 text-[9px] text-neutral-500">{tpl.signAccountantName}</div>}
                </div>
              )}
              {tpl.signManagerVisible && (
                <div className="w-28 text-center">
                  <div className="border-t border-dashed border-neutral-400 pt-1.5 text-[10px] font-bold">
                    {tpl.signManager || '—'}
                  </div>
                  {tpl.signManagerName && <div className="mt-0.5 text-[9px] text-neutral-500">{tpl.signManagerName}</div>}
                </div>
              )}
            </div>

            {tpl.pageNumbers && (
              <div className="mt-6 border-t border-neutral-200 pt-1.5 text-center text-[10px] text-neutral-400">
                صفحة 1 من 1
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            المقاس مصغّر للعرض ({LOGO_BASE_HEIGHT}px أساس ÷ 3.2) — والأرقام فوق الصناديق هي المقاسات الحقيقية للطباعة.
            الصناديق المتقطعة إرشادية للمعاينة فقط ولا تظهر في الورق أبداً. المسافة والهامش المضبوطان يُطبقان كما هما.
          </p>
          </>
          )}
        </div>
      </div>

      {/* المصمم التفاعلي (Task 29) — نافذة السحب والإفلات */}
      <HeaderLayoutBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        layout={activeLayout}
        onLayout={updateLayout}
        company={company}
        subtitle={tpl.subtitle}
      />
    </SectionCard>
  )
}
