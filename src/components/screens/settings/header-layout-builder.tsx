'use client'

// مصمم الترويسة التفاعلي (Task 29) — نافذة منبثقة بالسحب والإفلات
// كل عناصر الكليشة صناديق مستقلة بحدود واضحة: الشعار، اسم الشركة، الهاتف، البريد،
// سطر النظام، الختم/تاريخ الطباعة، عنوان المستند — بالإضافة إلى خط الفصل
// والمسافة قبله من محتوى المستند. المسك والسحب يحرك، والمقابض تحجم،
// بلا أي محاذاة تلقائية أو قيود أو تصحيح — والتداخل مقصود ومسموح.
// ⭐ Task 34: الحفظ يدوي بالكامل — لا حفظ تلقائي إطلاقاً: السحب والتعديل يغيّران
// المعاينة المحلية فقط ويشيّران شارة «تغييرات غير محفوظة»، وزر «حفظ الآن» وحده
// يثبت على الخادم ويحدّث الكاش المطبوع. الإغلاق بلا حفظ يُنبّه ولا يُضيع شيئاً
// (يبقى التصميم في المعاينة) وزر «حفظ» في بطاقة القالب يحفظه أيضاً.
// ⭐ Task 31: أي تعديل في اللوحة يفعّل التخطيط الحر تلقائياً — علاج شكوى «التعديلات
// لا تُطبّق»: المستخدم كان يسحب والتفعيل مطفأ فلا يظهر شيء في الطباعة.
// FreeHeaderPreview: معاينة قراءة فقط بنفس المحرك — تُستخدم في بطاقة الإعدادات.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Move,
  MousePointerClick,
  Plus,
  RotateCcw,
  Save,
  Minus,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { fmtDateTime } from '@/lib/format'
import type { CompanyInfo } from '@/lib/company'
import { applyPrintTemplate, getCachedPrintTemplate } from '@/lib/print-template'
import {
  DEFAULT_HEADER_LAYOUT,
  HEADER_CANVAS_W,
  HEADER_ELEMENTS_META,
  HEADER_LAYOUT_RAILS,
  type PrintHeaderAlign,
  type PrintHeaderEl,
  type PrintHeaderElId,
  type PrintHeaderLayout,
} from '@/lib/print-template'

/* ============================================================
 * محرك الرسم المشترك — يطابق مولد printFreeHeaderCss حرفياً
 * ============================================================ */

/** لوحة ألوان المعاينة — عائلة عنبرية تمثل هوية المستندات (الطباعة تستخدم لون كل وحدة) */
const ACCENT = { main: '#78350f', bg: '#fffbeb', border: '#e5d3b3' }

function StampContent() {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return (
    <>
      <div>
        <span className="opacity-60">تاريخ الطباعة:</span>{' '}
        <span dir="ltr">{fmtDateTime(now)}</span>
      </div>
      <div>
        <span className="opacity-60">الساعة:</span> <span dir="ltr">{hh}:{mm}</span>
      </div>
    </>
  )
}

/** محتوى كل عنصر كما سيُطبع — النصوص التجريبية بنفس بنية وحدات الطباعة */
function ElContent({ id, layout, company, subtitle }: {
  id: PrintHeaderElId
  layout: PrintHeaderLayout
  company: CompanyInfo
  subtitle: string
}) {
  const el = layout.elements[id]
  switch (id) {
    case 'logo':
      return company.companyLogo ? (
        <img
          src={company.companyLogo}
          alt="شعار الشركة"
          draggable={false}
          style={{ width: '100%', height: el.size, maxWidth: el.w, objectFit: 'contain' }}
        />
      ) : (
        <div
          className="flex items-center justify-center rounded border border-dashed border-neutral-300 text-[10px] text-neutral-400"
          style={{ width: el.w, height: el.size }}
        >
          لا شعار مرفوع
        </div>
      )
    case 'companyName':
      return (
        <span className="font-extrabold" style={{ fontSize: el.size, color: ACCENT.main, lineHeight: 1.5 }}>
          {company.companyName || 'اسم الشركة'}
        </span>
      )
    case 'companyPhone':
      return (
        <span style={{ fontSize: el.size, color: '#374151' }}>
          هاتف: <span dir="ltr">{company.companyPhone || '—'}</span>
        </span>
      )
    case 'companyEmail':
      return (
        <span style={{ fontSize: el.size, color: '#374151' }}>
          بريد: <span dir="ltr">{company.companyEmail || '—'}</span>
        </span>
      )
    case 'systemLine':
      return (
        <span style={{ fontSize: el.size, color: '#6b7280' }}>
          {subtitle.trim() ? `${subtitle.trim()} — {وصف المستند}` : '{سطر النظام} — {وصف المستند}'}
        </span>
      )
    case 'stamp':
      return (
        <div style={{ fontSize: el.size, color: '#374151', lineHeight: 1.9 }}>
          <StampContent />
        </div>
      )
    case 'docTitle':
      return (
        <span
          className="inline-block rounded-md border font-bold"
          style={{
            fontSize: el.size,
            borderColor: ACCENT.border,
            background: ACCENT.bg,
            color: ACCENT.main,
            padding: '6px 26px',
          }}
        >
          عنوان المستند
        </span>
      )
  }
}

/** نمط تحديد موقع صندوق العنصر — مطابق لمولد CSS المطبوع */
function elBoxStyle(el: PrintHeaderEl, id: PrintHeaderElId): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    right: el.x,
    top: el.y,
    width: el.w,
    textAlign: el.align,
  }
  if (id !== 'logo') base.fontSize = el.size
  return base
}

/* ============================================================
 * مقياس العرض — ResizeObserver يحسب نسبة العرض للوح 718px
 * node: عقدة الغلاف تُحمل عبر callback ref في state — فيضمن ذلك
 * إعادة تشغيل الأثر عند تركيب محتوى النافذة المرمي (Radix يركّبه عند الفتح)
 * maxScale: أقصى تكبير (Task 30) — النافذة الكبيرة تكبّر اللوحة فوق مقاس
 * الورقة الحقيقي ليرى المستخدم ما يحركه بوضوح (الإحداثيات تبقى بالمقاس الحقيقي)
 * ============================================================ */
export function useCanvasScale(node: HTMLElement | null, active = true, maxScale = 1): number {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    if (!node || !active) return
    // حدود العقدة أفقياً ثابتة — تُقرأ مرة واحدة وتُطرح من offsetWidth (صندوق الحدود)
    const borderX =
      (parseFloat(getComputedStyle(node).borderLeftWidth) || 0) +
      (parseFloat(getComputedStyle(node).borderRightWidth) || 0)
    const ro = new ResizeObserver(() => {
      // ⭐ offsetWidth عرض تخطيطي صلب — علاج «رجفان/الصعقة الكهربائية» (Task 33) من جذريه:
      // (1) يتجاهل تحويلات CSS — أنيميشن فتح النافذة (zoom) كان يجعل getBoundingClientRect
      //     يعيد عرضاً بصرياً مضغوطاً عشوائياً فيُحسب مقياس خاطئ ويعلق طوال الجلسة
      //     (قيسنا حياً: 1.43708 عالقة بدل 1.4963 — ويكسر دقة تحويل السحب لإحداثيات الطباعة)
      // (2) يشمل منطقة شريط التمرير — ظهور/اختفاء الشريط أثناء السحب (أنظمة الشريط
      //     الكلاسيكي) لا يغيّره، فلا ارتداد مقياس ولا قفزات اللوحة
      // وهو مطابق للقياس القديم حرفياً عند غياب الشريط والتحويلات
      const w = node.offsetWidth - borderX
      setScale(w > 0 ? Math.min(maxScale, w / HEADER_CANVAS_W) : 1)
    })
    ro.observe(node) // يطلق قراءة أولى فوراً بالحجم الحالي
    return () => ro.disconnect()
  }, [node, active, maxScale])
  return scale
}

/* ============================================================
 * المعاينة القرائية — بطاقة الإعدادات
 * ============================================================ */
export function FreeHeaderPreview({ layout, company, subtitle, className }: {
  layout: PrintHeaderLayout
  company: CompanyInfo
  subtitle: string
  className?: string
}) {
  const [wrapNode, setWrapNode] = useState<HTMLDivElement | null>(null)
  const scale = useCanvasScale(wrapNode)
  const totalH = layout.height + layout.bodyGap
  return (
    <div ref={setWrapNode} className={cn('w-full', className)}>
      <div className="relative mx-auto" style={{ height: totalH * scale, width: '100%' }}>
        <div
          className="absolute top-0 right-0 overflow-visible bg-white"
          style={{
            width: HEADER_CANVAS_W,
            height: totalH,
            transform: `scale(${scale})`,
            transformOrigin: 'top right',
          }}
        >
          {/* منطقة ما بعد خط الفصل قبل المحتوى */}
          <div
            className="absolute inset-x-0"
            style={{ top: layout.height, height: layout.bodyGap, background: 'repeating-linear-gradient(45deg, #fafaf9, #fafaf9 8px, #f5f5f4 8px, #f5f5f4 16px)' }}
          />
          {/* خط الفصل */}
          <div className="absolute inset-x-0" style={{ top: layout.height - 1.5, borderTop: `3px double ${ACCENT.main}` }} />
          {HEADER_ELEMENTS_META.map(({ id }) => {
            const el = layout.elements[id]
            if (!el.visible) return null
            return (
              <div key={id} style={elBoxStyle(el, id)}>
                <ElContent id={id} layout={layout} company={company} subtitle={subtitle} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ============================================================
 * المصمم التفاعلي
 * ============================================================ */

type DragMode = 'move' | 'w-left' | 'w-right' | 'size' | 'corner-left' | 'corner-right' | 'line-h' | 'line-gap'

interface DragState {
  mode: DragMode
  id?: PrintHeaderElId
  sx: number
  sy: number
  /** ⭐ مقياس اللوحة المجمّد لحظة بدء السحب — علاج الرجفان (Task 33):
   *  كل حسابات السحب تستخدم مقياس البداية حتى لو تغيّر مقياس العرض أثناءها
   *  فلا يقفز الصندوق تحت المؤشر مهما حدث (شريط تمرير/إعادة قياس) */
  scale: number
  startEl?: PrintHeaderEl
  startH: number
  startGap: number
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

/** حقل رقمي دقيق بإدخال حر — يزامن القيمة الخارجية ويرفض غير الأرقام */
function NumField({ value, onCommit, step = 1, ariaLabel, min, max }: {
  value: number
  onCommit: (v: number) => void
  step?: number
  ariaLabel: string
  min?: number
  max?: number
}) {
  const [txt, setTxt] = useState(String(Math.round(value)))
  const [focused, setFocused] = useState(false)
  const [lastValue, setLastValue] = useState(value)
  // مزامنة أثناء الرندر (النمط المعتمد بدل effect): تتبّع القيمة الخارجية وتحديث النص عند تغيرها خارج الإدخال
  if (!focused && value !== lastValue) {
    setLastValue(value)
    setTxt(String(Math.round(value)))
  }
  const commit = (s: string) => {
    const n = Number.parseFloat(s)
    if (!Number.isFinite(n)) return
    let v = n
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    onCommit(v)
  }
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-7 w-7"
        aria-label={`إنقاص ${ariaLabel}`}
        onClick={() => commit(String(Math.round(value) - step))}
      >
        <Minus className="h-3 w-3" aria-hidden="true" />
      </Button>
      <Input
        dir="ltr"
        inputMode="numeric"
        className="h-7 w-16 px-1.5 text-center text-xs"
        aria-label={ariaLabel}
        value={txt}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setTxt(e.target.value)
          commit(e.target.value)
        }}
        onBlur={() => {
          setFocused(false)
          setTxt(String(Math.round(value)))
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-7 w-7"
        aria-label={`زيادة ${ariaLabel}`}
        onClick={() => commit(String(Math.round(value) + step))}
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
      </Button>
    </div>
  )
}

export function HeaderLayoutBuilderDialog({ open, onOpenChange, layout, onLayout, company, subtitle }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  layout: PrintHeaderLayout
  /** محدِّث دالة (updater) يرفع التغيير لحالة القالب في البطاقة */
  onLayout: (updater: (prev: PrintHeaderLayout) => PrintHeaderLayout) => void
  company: CompanyInfo
  subtitle: string
}) {
  const { toast } = useToast()
  const [wrapNode, setWrapNode] = useState<HTMLDivElement | null>(null)
  // النافذة الكبيرة (Task 30): تكبير حتى 150% من مقاس الورقة الحقيقي — سهولة الرؤية والمسك
  const scale = useCanvasScale(wrapNode, open, 1.5)
  const [selected, setSelected] = useState<PrintHeaderElId | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const dragRef = useRef<DragState | null>(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  // ⭐ تزامن السحب مع إطارات العرض (علاج الرجفان Task 33): كل pointermove كان
  // يرندر النافذة كاملة فوراً خارج نبض الشاشة — تُخزّن آخر إحداثيات وتُطبّق
  // مرة واحدة كل إطار (requestAnimationFrame) فتتحرك اللوحة بسلاسة 60fps
  const rafRef = useRef<number | null>(null)
  const lastMoveRef = useRef<{ cx: number; cy: number } | null>(null)

  const totalH = layout.height + layout.bodyGap

  /** الحفظ الفوري — الكاش المحلي لحظة الإفلات والخادم بعدها بمهل قصيرة */
  const doSave = useCallback(async () => {
    setSaveState('saving')
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printHeaderLayout: JSON.stringify(layoutRef.current) }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error ?? 'فشل الحفظ')
      }
      // الكاش يُبنى على آخر قيم محفوظة للخادم + التخطيط الجديد — لا يسرّي تعديلات كلاسيكية غير محفوظة
      applyPrintTemplate({ ...getCachedPrintTemplate(), layout: layoutRef.current })
      setSaveState('saved')
    } catch (err) {
      setSaveState('error')
      toast({
        title: 'تعذر حفظ التخطيط',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      })
    }
  }, [toast])

  /** ⭐ Task 34 — لا حفظ تلقائي: كل تعديل يشير شارة «تغييرات غير محفوظة» فقط،
   *  وزر «حفظ الآن» وحده يستدعي doSave */
  const markDirty = useCallback(() => setSaveState('dirty'), [])

  /** عند فتح النافذة تُقرأ حالة الحفظ من الكاش المطبوع نفسه (الذي يحدَّث عند كل
   *  حفظ — من هنا أو من زر «حفظ» البطاقة) فتبقى الشارة صادقة عبر الفتح والإغلاق */
  useEffect(() => {
    if (!open) return
    const cached = getCachedPrintTemplate().layout
    if (!cached) {
      setSaveState('idle')
      return
    }
    setSaveState(JSON.stringify(cached) === JSON.stringify(layoutRef.current) ? 'saved' : 'dirty')
  }, [open])

  /** الإغلاق لا يحفظ شيئاً — إن وُجدت تغييرات غير محفوظة يُنبَّه المستخدم بلطف:
   *  تصميمه يبقى في المعاينة ويمكن ثبته بزر «حفظ الآن» هنا أو «حفظ» في البطاقة */
  const handleClose = (v: boolean) => {
    if (!v && saveState === 'dirty') {
      toast({
        title: 'أُغلق المصمم دون حفظ',
        description: 'ما سحبته ما زال حياً في المعاينة — اضغط «حفظ الآن» لتثبيته على الطباعة، أو زر «حفظ» في بطاقة قالب الطباعة',
      })
    }
    onOpenChange(v)
  }

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
  }, [])

  /** ⭐ التفعيل التلقائي للتخطيط الحر عند أول تعديل (Task 31):
   *  الجرح: المستخدم يفتح المصمم ويسحب العناصر فيراها تتحرك هنا — لكن مفتاح
   *  «تفعيل التخطيط الحر» مطفأ فتُحفظ الإحداثيات بلا أن تُطبّق في الطباعة أبداً
   *  (شكواه الحرفية: «بعد تعديل كليشة الطباعة لم يتم تطبيق التعديلات»).
   *  العلاج: أي تعديل فعلي (سحب/تحجيم/أرقام/إظهار) يفعّله تلقائياً مع إشعار واضح */
  const ensureEnabled = () => {
    if (layoutRef.current.enabled) return
    onLayout((prev) => ({ ...prev, enabled: true }))
    toast({
      title: 'تم تفعيل التخطيط الحر تلقائياً',
      description: 'ما تسحبه سيظهر في الطباعة بعد الضغط على «حفظ الآن» — ويمكنك إيقافه من المفتاح أعلاه',
    })
  }

  const setEl = (id: PrintHeaderElId, patch: Partial<PrintHeaderEl>) => {
    ensureEnabled()
    onLayout((prev) => ({
      ...prev,
      elements: { ...prev.elements, [id]: { ...prev.elements[id], ...patch } },
    }))
    markDirty()
  }

  const setCanvas = (patch: Partial<Pick<PrintHeaderLayout, 'height' | 'bodyGap'>>) => {
    ensureEnabled()
    onLayout((prev) => ({ ...prev, ...patch }))
    markDirty()
  }

  /* ===== السحب — حساب خام بلا أي محاذاة أو قصر موضعي ===== */
  const minSize = (id: PrintHeaderElId, v: number): number => {
    const meta = HEADER_ELEMENTS_META.find((m) => m.id === id)!
    const rails = meta.kind === 'image' ? HEADER_LAYOUT_RAILS.sizeLogo : HEADER_LAYOUT_RAILS.sizeText
    return Math.min(rails.max, Math.max(rails.min, v))
  }

  const beginDrag = (e: React.PointerEvent, mode: DragMode, id?: PrintHeaderElId) => {
    e.preventDefault()
    e.stopPropagation()
    if (id) setSelected(id)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = {
      mode,
      id,
      sx: e.clientX,
      sy: e.clientY,
      scale, // مقياس البداية المجمّد — حسابات السحب كلها به حتى نهاية السحبة
      startEl: id ? { ...layoutRef.current.elements[id] } : undefined,
      startH: layoutRef.current.height,
      startGap: layoutRef.current.bodyGap,
    }
  }

  /** تطبيق حركة واحدة — يُستدعى مرة كل إطار عرض بإحداثيات آخر حدث:
   *  ⭐ يستخدم d.scale المجمّد لحظة البداية لا مقياس العرض الحي —
   *  أي تغيّر للمقياس أثناء السحبة لا يحرك الصندوق تحت المؤشر إطلاقاً */
  const applyDragFrame = () => {
    rafRef.current = null
    const ev = lastMoveRef.current
    const d = dragRef.current
    if (!ev || !d) return
    const dx = (ev.cx - d.sx) / d.scale
    const dy = (ev.cy - d.sy) / d.scale
    const r1 = (v: number) => Math.round(v)
    if (d.mode === 'line-h') {
      const rails = HEADER_LAYOUT_RAILS.height
      setCanvasSilent({ height: Math.min(rails.max, Math.max(rails.min, r1(d.startH + dy))) })
      return
    }
    if (d.mode === 'line-gap') {
      const rails = HEADER_LAYOUT_RAILS.bodyGap
      setCanvasSilent({ bodyGap: Math.min(rails.max, Math.max(rails.min, r1(d.startGap + dy))) })
      return
    }
    if (!d.id || !d.startEl) return
    const s = d.startEl
    switch (d.mode) {
      case 'move':
        setElSilent(d.id, { x: r1(s.x - dx), y: r1(s.y + dy) })
        break
      case 'w-right': // مقبض الحافة اليمنى: سحب لليمين يوسّع من اليسار (بلا قصر)
        setElSilent(d.id, { x: r1(s.x - dx), w: Math.max(HEADER_LAYOUT_RAILS.w.min, r1(s.w + dx)) })
        break
      case 'w-left': // مقبض الحافة اليسرى: العرض فقط — الموضع ثابت
        setElSilent(d.id, { w: Math.max(HEADER_LAYOUT_RAILS.w.min, r1(s.w - dx)) })
        break
      case 'size': // مقبض الوسط السفلي: الحجم فقط
        setElSilent(d.id, { size: minSize(d.id, r1(s.size + dy)) })
        break
      case 'corner-right': // ركن سفلي يمين: موضع وعرض وحجم معاً
        setElSilent(d.id, {
          x: r1(s.x - dx),
          w: Math.max(HEADER_LAYOUT_RAILS.w.min, r1(s.w + dx)),
          size: minSize(d.id, r1(s.size + dy)),
        })
        break
      case 'corner-left': // ركن سفلي يسار: عرض وحجم
        setElSilent(d.id, {
          w: Math.max(HEADER_LAYOUT_RAILS.w.min, r1(s.w - dx)),
          size: minSize(d.id, r1(s.size + dy)),
        })
        break
    }
  }

  /** التقاط حركة المؤشر — لا رندر فوري هنا: تُخزّن الإحداثيات ويُجدول تطبيقها
   *  مع نبض الشاشة التالي (requestAnimationFrame) فتندمج حركات كثيرة بإطار واحد */
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    e.preventDefault()
    lastMoveRef.current = { cx: e.clientX, cy: e.clientY }
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(applyDragFrame)
    }
  }

  const endDrag = () => {
    if (!dragRef.current) return
    // تطبيق آخر حركة معلقة فوراً قبل الإفلات — لا تضيع نهاية السحبة أبداً
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    applyDragFrame()
    lastMoveRef.current = null
    dragRef.current = null
    ensureEnabled() // السحب تعديل فعلي — يفعّل التخطيط الحر تلقائياً إن كان مطفأً (Task 31)
    markDirty() // ⭐ Task 34 — الإفلات يشير شارة «غير محفوظة» فقط، والحفظ بزر «حفظ الآن»
  }

  /** تحديث صامت أثناء السحب — لا حفظ إطلاقاً أثناء الحركة، الإفلات يشير الشارة فقط */
  const setElSilent = (id: PrintHeaderElId, patch: Partial<PrintHeaderEl>) => {
    onLayout((prev) => ({
      ...prev,
      elements: { ...prev.elements, [id]: { ...prev.elements[id], ...patch } },
    }))
  }
  const setCanvasSilent = (patch: Partial<Pick<PrintHeaderLayout, 'height' | 'bodyGap'>>) => {
    onLayout((prev) => ({ ...prev, ...patch }))
  }

  const selMeta = selected ? HEADER_ELEMENTS_META.find((m) => m.id === selected)! : null
  const selEl = selected ? layout.elements[selected] : null

  const SAVE_BADGE: Record<SaveState, { text: string; cls: React.ReactNode }> = {
    idle: { text: '—', cls: null },
    dirty: {
      text: 'تغييرات غير محفوظة — اضغط «حفظ الآن»',
      cls: <span className="flex items-center gap-1 font-semibold text-amber-600"><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />تغييرات غير محفوظة — اضغط «حفظ الآن»</span>,
    },
    saving: {
      text: 'جارٍ الحفظ…',
      cls: <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />جارٍ الحفظ…</span>,
    },
    saved: {
      text: 'حُفظ',
      cls: <span className="flex items-center gap-1 text-emerald-600"><Check className="h-3.5 w-3.5" aria-hidden="true" />حُفظ على الطباعة</span>,
    },
    error: {
      text: 'فشل الحفظ',
      cls: <span className="flex items-center gap-1 text-red-600"><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />فشل الحفظ — أعد المحاولة</span>,
    },
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        /* مصمم الترويسة يفتح بملء الشاشة (100vw/100vh) — مساحة عمل كاملة بلا حصر بعرض
         * منطقة المحتوى خلف الشريط الجانبي؛ التمركز الافتراضي (left/top 50% + translate -50%)
         * يبقى صحيحاً لأن عرض/ارتفاع النافذة يطابقان الشاشة كاملة تماماً فلا إزاحة تُحسب أصلاً */
        className="left-1/2! top-1/2! h-screen max-h-screen w-screen max-w-none translate-x-[-50%] translate-y-[-50%] overflow-y-auto rounded-none sm:max-w-none md:flex md:h-screen md:flex-col md:overflow-hidden"
        dir="rtl"
      >
        {/* ⭐ Task 53 — زر إغلاق X مجسّم (3D Dark Glossy) أعلى اليسار: مخرج آمن
         *  بارز وثابت داخل الحاوية دائماً — يستدعي handleClose الحارسة نفسها
         *  (تنبيه «تغييرات غير محفوظة» يعمل كما هو) بلا أي مساس بالحفظ أو السحب */}
        <button
          type="button"
          aria-label="إغلاق مصمم الترويسة"
          title="إغلاق المصمم"
          onClick={() => handleClose(false)}
          className={cn(
            'absolute left-3 top-3 z-50 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
            'border border-white/10 bg-gradient-to-b from-zinc-600/70 via-zinc-800 to-zinc-900 text-zinc-50',
            'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),inset_0_-1px_0_0_rgba(0,0,0,0.45),0_4px_12px_-4px_rgba(0,0,0,0.6),0_0_12px_-4px_color-mix(in_oklab,var(--primary)_45%,transparent)]',
            'transition-all duration-200 ease-out',
            'hover:from-zinc-500/70 hover:text-white hover:scale-105',
            'hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22),0_6px_16px_-6px_rgba(0,0,0,0.7),0_0_18px_-4px_color-mix(in_oklab,var(--primary)_70%,transparent)]',
            'active:scale-95',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
        >
          <X className="size-[18px]" strokeWidth={2.5} aria-hidden="true" />
          <span className="sr-only">إغلاق</span>
        </button>
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex flex-wrap items-center justify-between gap-2 pe-12">
            <span className="flex items-center gap-2">
              <Move className="h-4 w-4 text-amber-600" aria-hidden="true" />
              مصمم الترويسة — سحب وإفلات
            </span>
            <span className="text-xs font-normal">{SAVE_BADGE[saveState].cls ?? SAVE_BADGE[saveState].text}</span>
          </DialogTitle>
        </DialogHeader>

        {/* شريط التفعيل */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="space-y-0.5">
            <p className="text-sm font-bold">تفعيل التخطيط الحر في الطباعة</p>
            <p className="text-xs text-muted-foreground">
              عند التفعيل تُرسم الترويسة بالإحداثيات المحفوظة حرفياً في كل المستندات — وعند الإيقاف تعود للمقاييس الكلاسيكية دون فقدان ما صممته — وأي تعديل في اللوحة يفعّله تلقائياً والحفظ بزر «حفظ الآن»
            </p>
          </div>
          <Switch
            aria-label="تفعيل التخطيط الحر في الطباعة"
            checked={layout.enabled}
            onCheckedChange={(v) => {
              onLayout((prev) => ({ ...prev, enabled: v }))
              markDirty()
            }}
          />
        </div>

        {/* تحذير بارز عند الإيقاف (Task 31) — كان المستخدم يسحب ولا يعلم أن إيقاف المفتاح يجعل تعديلاته بلا أثر في الطباعة */}
        {!layout.enabled && (
          <div className="flex shrink-0 items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
            <p className="leading-relaxed text-red-700 dark:text-red-400">
              التخطيط الحر معطّل الآن — <strong>ما تسحبه في اللوحة لن يظهر في الطباعة</strong> حتى يُفعّل المفتاح أعلاه. يُفعّل تلقائياً مع أول سحبة أو تعديل تقوم به.
            </p>
          </div>
        )}

        <div className="grid min-h-0 flex-1 gap-4 md:flex">
          {/* ===== اللوحة ===== */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><MousePointerClick className="h-3.5 w-3.5" aria-hidden="true" />اسحب الصندوق لتحريكه</span>
              <span>المقابض الجانبية للعرض والسفلية للحجم</span>
              <span>بلا محاذاة تلقائية — والتداخل مسموح</span>
              {scale > 1.01 && (
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-px font-bold text-amber-700">
                  معروض بـ {Math.round(scale * 100)}% — والإحداثيات بالمقاس المطبوع الحقيقي
                </span>
              )}
            </div>
            <div ref={setWrapNode} className="min-h-32 rounded-lg border bg-neutral-200/60 p-2 md:min-h-0 md:flex-1 md:overflow-y-auto">
              <div className="relative" style={{ height: totalH * scale + 26 }}>
                <div
                  className="absolute top-0 right-0 select-none bg-white shadow-sm"
                  style={{
                    width: HEADER_CANVAS_W,
                    height: totalH,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top right',
                    touchAction: 'none',
                  }}
                  onPointerDown={() => setSelected(null)}
                >
                  {/* ⭐ Task 53 — شبكة محاذاة هندسية منقطة 20×20px: مسطرة بصرية ثابتة
                   *  تساعد على تمركز الشعار والختم والعناوين أثناء السحب — رمادي باهت
                   *  جداً لا يشتت الرؤية، لا تجذب المؤشر، وتُحجب كلياً عن الطباعة (no-print) */}
                  <div
                    className="no-print pointer-events-none absolute inset-0"
                    style={{
                      backgroundImage: [
                        'radial-gradient(circle, rgba(120,113,108,0.50) 1.1px, transparent 1.7px)',
                        'linear-gradient(to right, rgba(120,113,108,0.13) 1px, transparent 1px)',
                        'linear-gradient(to bottom, rgba(120,113,108,0.13) 1px, transparent 1px)',
                      ].join(', '),
                      backgroundSize: '20px 20px, 20px 20px, 20px 20px',
                    }}
                  />

                  {/* منطقة bodyGap بعد خط الفصل */}
                  <div
                    className="pointer-events-none absolute inset-x-0"
                    style={{ top: layout.height, height: layout.bodyGap, background: 'repeating-linear-gradient(45deg, #fafaf9, #fafaf9 8px, #f5f5f4 8px, #f5f5f4 16px)' }}
                  />

                  {/* خط الفصل — قابل للسحب عمودياً لتغيير ارتفاع الترويسة */}
                  <div
                    className="absolute inset-x-0 z-40 cursor-rowsize"
                    style={{ top: layout.height - 9, height: 18, cursor: 'row-resize', touchAction: 'none' }}
                    onPointerDown={(e) => beginDrag(e, 'line-h')}
                    onPointerMove={onDragMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    role="slider"
                    aria-label="موضع خط الفصل"
                    aria-valuenow={layout.height}
                  >
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2" style={{ borderTop: `3px double ${ACCENT.main}` }} />
                    <span className="absolute start-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[8.5px] font-bold text-amber-700 shadow-sm">
                      خط الفصل · {Math.round(layout.height)}px
                    </span>
                  </div>

                  {/* العناصر السبعة */}
                  {HEADER_ELEMENTS_META.map(({ id, label, kind }) => {
                    const el = layout.elements[id]
                    const isSel = selected === id
                    return (
                      <div
                        key={id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${label} — اسحب للتحريك`}
                        className={cn(
                          'cursor-grab rounded-sm border border-dashed',
                          isSel ? 'z-30 border-amber-500 bg-amber-500/5' : 'z-20 border-neutral-400/70 hover:border-neutral-500',
                          !el.visible && 'opacity-40',
                        )}
                        style={{ ...elBoxStyle(el, id), touchAction: 'none', userSelect: 'none' }}
                        onPointerDown={(e) => beginDrag(e, 'move', id)}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelected(id)
                          }
                        }}
                      >
                        {/* شارة الاسم والمقاس */}
                        <span
                          className={cn(
                            'pointer-events-none absolute -top-2 start-1.5 z-10 whitespace-nowrap rounded-full border px-1.5 py-px text-[8.5px] font-bold leading-none shadow-sm',
                            isSel ? 'border-amber-400 bg-amber-100 text-amber-800' : 'border-neutral-300 bg-white text-neutral-500',
                          )}
                        >
                          {label} · {kind === 'image' ? `${Math.round(el.w)}×${Math.round(el.size)}` : `${Math.round(el.size)}px`}
                          {isSel && (
                            <span className="num"> · x:{Math.round(el.x)} y:{Math.round(el.y)}</span>
                          )}
                          {!el.visible && ' · مخفي'}
                        </span>
                        <div className={cn('p-1', el.visible ? '' : 'grayscale')}>
                          <ElContent id={id} layout={layout} company={company} subtitle={subtitle} />
                        </div>

                        {/* مقابض التحجيم — للعنصر المحدد فقط */}
                        {isSel && (
                          <>
                            <span
                              className="absolute -left-1 top-1/2 z-10 h-6 w-2 -translate-y-1/2 cursor-ew-resize rounded bg-amber-500/90 shadow"
                              style={{ touchAction: 'none', left: -4 }}
                              onPointerDown={(e) => beginDrag(e, 'w-left', id)}
                              onPointerMove={onDragMove}
                              onPointerUp={endDrag}
                              onPointerCancel={endDrag}
                              aria-label={`تحجيم عرض ${label}`}
                            />
                            <span
                              className="absolute -right-1 top-1/2 z-10 h-6 w-2 -translate-y-1/2 cursor-ew-resize rounded bg-amber-500/90 shadow"
                              style={{ touchAction: 'none', right: -4 }}
                              onPointerDown={(e) => beginDrag(e, 'w-right', id)}
                              onPointerMove={onDragMove}
                              onPointerUp={endDrag}
                              onPointerCancel={endDrag}
                              aria-label={`تحجيم عرض وموضع ${label}`}
                            />
                            <span
                              className="absolute bottom-[-4px] left-1/2 z-10 h-2 w-6 -translate-x-1/2 cursor-ns-resize rounded bg-amber-600/90 shadow"
                              style={{ touchAction: 'none' }}
                              onPointerDown={(e) => beginDrag(e, 'size', id)}
                              onPointerMove={onDragMove}
                              onPointerUp={endDrag}
                              onPointerCancel={endDrag}
                              aria-label={`تحجيم ${label}`}
                            />
                            <span
                              className="absolute bottom-[-4px] right-[-4px] z-10 h-3 w-3 cursor-nwse-resize rounded-sm bg-amber-700 shadow"
                              style={{ touchAction: 'none', cursor: 'nwse-resize' }}
                              onPointerDown={(e) => beginDrag(e, 'corner-right', id)}
                              onPointerMove={onDragMove}
                              onPointerUp={endDrag}
                              onPointerCancel={endDrag}
                              aria-label={`تحجيم شامل ${label}`}
                            />
                            <span
                              className="absolute bottom-[-4px] left-[-4px] z-10 h-3 w-3 cursor-nesw-resize rounded-sm bg-amber-700 shadow"
                              style={{ touchAction: 'none', cursor: 'nesw-resize' }}
                              onPointerDown={(e) => beginDrag(e, 'corner-left', id)}
                              onPointerMove={onDragMove}
                              onPointerUp={endDrag}
                              onPointerCancel={endDrag}
                              aria-label={`تحجيم شامل معاكس ${label}`}
                            />
                          </>
                        )}
                      </div>
                    )
                  })}

                  {/* مقبض أسفل اللوحة — المسافة قبل محتوى المستند */}
                  <div
                    className="absolute inset-x-0 z-40"
                    style={{ bottom: -9, height: 18, cursor: 'row-resize', touchAction: 'none' }}
                    onPointerDown={(e) => beginDrag(e, 'line-gap')}
                    onPointerMove={onDragMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    role="slider"
                    aria-label="المسافة قبل محتوى المستند"
                    aria-valuenow={layout.bodyGap}
                  >
                    <div className="absolute inset-x-6 top-1/2 h-1 -translate-y-1/2 rounded bg-amber-400/70" />
                    <span className="absolute start-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[8.5px] font-bold text-amber-700 shadow-sm">
                      محتوى المستند يبدأ بعد {Math.round(layout.bodyGap)}px
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ===== لوحة الخصائص ===== */}
          <div className="w-full shrink-0 space-y-4 md:w-80 md:max-h-full md:overflow-y-auto md:border-s md:ps-4">
            {/* قائمة العناصر */}
            <div className="rounded-lg border p-4">
              <p className="mb-2 text-xs font-bold">عناصر الكليشة — اضغط لتحديده</p>
              <div className="space-y-1.5">
                {HEADER_ELEMENTS_META.map(({ id, label }) => {
                  const el = layout.elements[id]
                  const isSel = selected === id
                  return (
                    <div
                      key={id}
                      className={cn(
                        'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5',
                        isSel ? 'border-amber-400 bg-amber-500/10' : 'border-transparent bg-muted/40',
                      )}
                    >
                      <button
                        type="button"
                        className="flex-1 text-start text-xs font-semibold hover:text-amber-700"
                        onClick={() => setSelected(id)}
                      >
                        {label}
                        <span className="num ms-1.5 text-[10px] font-normal text-muted-foreground" dir="ltr">
                          {Math.round(el.x)},{Math.round(el.y)}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={el.visible ? `إخفاء ${label}` : `إظهار ${label}`}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => setEl(id, { visible: !el.visible })}
                      >
                        {el.visible ? <Eye className="h-3.5 w-3.5" aria-hidden="true" /> : <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* خصائص العنصر المحدد */}
            {selMeta && selEl ? (
              <div className="space-y-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                <p className="text-xs font-bold text-amber-800 dark:text-amber-400">خصائص: {selMeta.label}</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">x (من اليمين)</Label>
                    <NumField value={selEl.x} onCommit={(v) => setEl(selMeta.id, { x: v })} ariaLabel="الموضع الأفقي" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">y (من الأعلى)</Label>
                    <NumField value={selEl.y} onCommit={(v) => setEl(selMeta.id, { y: v })} ariaLabel="الموضع الرأسي" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">العرض</Label>
                    <NumField value={selEl.w} onCommit={(v) => setEl(selMeta.id, { w: v })} ariaLabel="عرض الصندوق" min={HEADER_LAYOUT_RAILS.w.min} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">{selMeta.kind === 'image' ? 'الارتفاع' : 'حجم الخط'}</Label>
                    <NumField value={selEl.size} onCommit={(v) => setEl(selMeta.id, { size: v })} ariaLabel="حجم العنصر" min={selMeta.kind === 'image' ? HEADER_LAYOUT_RAILS.sizeLogo.min : HEADER_LAYOUT_RAILS.sizeText.min} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">محاذاة النص داخل الصندوق</Label>
                  <div className="flex gap-1.5">
                    {([
                      { v: 'right', icon: AlignRight, label: 'يمين' },
                      { v: 'center', icon: AlignCenter, label: 'وسط' },
                      { v: 'left', icon: AlignLeft, label: 'يسار' },
                    ] as { v: PrintHeaderAlign; icon: typeof AlignRight; label: string }[]).map(({ v, icon: Icon, label }) => (
                      <Button
                        key={v}
                        type="button"
                        variant={selEl.align === v ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 flex-1 gap-1 text-[11px]"
                        onClick={() => setEl(selMeta.id, { align: v })}
                      >
                        <Icon className="h-3 w-3" aria-hidden="true" />
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto min-h-8 w-full gap-1 whitespace-normal py-1.5 text-[11px] leading-snug"
                  onClick={() => {
                    setEl(selMeta.id, { ...DEFAULT_HEADER_LAYOUT.elements[selMeta.id] })
                  }}
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  إعادة هذا العنصر لموضعه الافتراضي
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                <MousePointerClick className="mx-auto mb-1 h-4 w-4" aria-hidden="true" />
                حدد عنصراً من اللوحة أو القائمة لضبط موضعها وحجمها بالأرقام بدقة البكسل
              </div>
            )}

            {/* مقاييس اللوحة */}
            <div className="space-y-3 rounded-lg border p-4">
              <p className="text-xs font-bold">مقاييس اللوحة</p>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span>موضع خط الفصل</span>
                <NumField
                  value={layout.height}
                  onCommit={(v) => setCanvas({ height: v })}
                  ariaLabel="موضع خط الفصل"
                  min={HEADER_LAYOUT_RAILS.height.min}
                  max={HEADER_LAYOUT_RAILS.height.max}
                />
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span>المسافة قبل المحتوى</span>
                <NumField
                  value={layout.bodyGap}
                  onCommit={(v) => setCanvas({ bodyGap: v })}
                  ariaLabel="المسافة قبل المحتوى"
                  min={HEADER_LAYOUT_RAILS.bodyGap.min}
                  max={HEADER_LAYOUT_RAILS.bodyGap.max}
                />
              </div>
            </div>

            {/* إجراءات عامة */}
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-auto min-h-8 gap-1.5 whitespace-normal py-1.5 text-xs leading-snug"
                onClick={() => {
                  onLayout((prev) => ({ ...DEFAULT_HEADER_LAYOUT, enabled: prev.enabled }))
                  markDirty()
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                إعادة التخطيط كاملاً للافتراضي
              </Button>
              <Button
                type="button"
                size="sm"
                className={cn('gap-1.5 text-xs font-bold', saveState === 'dirty' && 'animate-pulse')}
                onClick={() => void doSave()}
                disabled={saveState === 'saving'}
                aria-label="حفظ التخطيط على الطباعة"
              >
                {saveState === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
                حفظ الآن
              </Button>
            </div>
          </div>
        </div>

        <p className="shrink-0 text-[11px] leading-relaxed text-muted-foreground">
          ⭐ الحفظ يدوي بالكامل: السحب والتعديل يغيّران المعاينة فقط ويشيّران شارة «تغييرات غير محفوظة» — وزر
          <strong className="mx-1 text-foreground">حفظ الآن</strong>
          وحده يثبت التصميم على الخادم فيُطبَّق حرفياً على كل الفواتير والسندات والقيود والكشوفات والتقارير، حتى لو
          تداخلت العناصر عمداً. الإغلاق دون حفظ يُنبهك ولا يُضيع شيئاً. اللوحة بمقاس منطقة محتوى A4 (718px) وتتضخّم حتى
          150% في النافذة الكبيرة — فما تراه هو ما يُطبع.
        </p>
      </DialogContent>
    </Dialog>
  )
}
