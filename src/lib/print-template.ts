// قالب الطباعة الموحد — الترويسة والتواقيع القابلة للتخصيص من الإعدادات (Task 26)
// + ترقيم الصفحات: تقسيم تلقائي على أوراق A4 مع «صفحة X من Y» أسفل كل ورقة (Task 26-b)
// يُخزَّن في جدول Setting (مفاتيح print*) ويُكاش محلياً بمفتاح printTemplate
// الافتراضي = المظهر الحالي حرفياً (شعار بالوسط 200px + «نظام المحاسبة والمخزون» + المحاسب/المدير المالي + ترقيم مفعّل)
// فلا أي تغيير بصري حتى يخصّص المستخدم بنفسه — والطباعة تعمل حتى بلا كاش (الافتراضيات)

/** موضع الشعار في الترويسة — الوسط هو التصميم القائم (الشركة يميناً والختم يساراً) */
export type PrintLogoPosition = 'right' | 'center' | 'left'

export interface PrintTemplate {
  /** سطر النظام تحت اسم الشركة (قبل وصف المستند التلقائي) — الفارغ يخفي السطر */
  subtitle: string
  /** موضع الشعار */
  logoPosition: PrintLogoPosition
  /** حجم الشعار بنسبة مئوية من التصميم الحالي (200px) — 60..160 و100 يعني كما هو */
  logoScale: number
  /** حجم نصوص الترويسة (اسم الشركة والسطر الفرعي وتاريخ الطباعة) — 60..160 و100 يعني التصميم الحالي (Task 28) */
  textScale: number
  /** المسافة بين عناصر الترويسة الثلاثة بالبكسل — 0..40 والافتراضي 16 (Task 28) */
  headerGap: number
  /** هامش الترويسة السفلي (قبل خط الفصل المزدوج) بالبكسل — 0..30 والافتراضي 10 (Task 28) */
  headerPadding: number
  /** مسمى خانة المحاسب */
  signAccountant: string
  /** اسم اختياري تحت مسمى المحاسب */
  signAccountantName: string
  /** إظهار/إخفاء خانة المحاسب */
  signAccountantVisible: boolean
  /** مسمى خانة المدير المالي */
  signManager: string
  /** اسم اختياري تحت مسمى المدير المالي */
  signManagerName: string
  /** إظهار/إخفاء خانة المدير المالي */
  signManagerVisible: boolean
  /** ترقيم الصفحات: تقسيم الصفوف تلقائياً على أوراق A4 مع «صفحة X من Y» أسفل كل ورقة (Task 26-b) */
  pageNumbers: boolean
  /** التخطيط الحر للترويسة (Task 29) — null يعني الوضع الكلاسيكي (المقاييس المرنة أعلاه) */
  layout: PrintHeaderLayout | null
}

/** الافتراضيات — مطابقة للمطبوع اليوم حرفياً (صفر تغيير قبل التخصيص) */
export const DEFAULT_PRINT_TEMPLATE: PrintTemplate = {
  subtitle: 'نظام المحاسبة والمخزون',
  logoPosition: 'center',
  logoScale: 100,
  textScale: 100,
  headerGap: 16,
  headerPadding: 10,
  signAccountant: 'المحاسب',
  signAccountantName: '',
  signAccountantVisible: true,
  signManager: 'المدير المالي',
  signManagerName: '',
  signManagerVisible: true,
  pageNumbers: true,
  layout: null,
}

/** نطاق نسبة حجم الشعار المسموح — متزامن مع تحقق /api/settings */
export const LOGO_SCALE_MIN = 60
export const LOGO_SCALE_MAX = 160

/** نطاق حجم نصوص الترويسة (Task 28) */
export const TEXT_SCALE_MIN = 60
export const TEXT_SCALE_MAX = 160

/** نطاقا المسافة بين العناصر والهامش السفلي (Task 28) */
export const HEADER_GAP_MIN = 0
export const HEADER_GAP_MAX = 40
export const HEADER_PADDING_MIN = 0
export const HEADER_PADDING_MAX = 30

/** الارتفاع الأساسي للشعار في تصميم الترويسة (px) — تُضرب بنسبة logoScale */
export const LOGO_BASE_HEIGHT = 200

/** أساسات الخط في تصميم الترويسة — تُضرب بنسبة textScale (Task 28) */
export const COMPANY_FONT_BASE = 19
export const SUB_FONT_BASE = 11

/* ============================================================
 * التخطيط الحر للترويسة (Task 29) — مصمم السحب والإفلات
 * كل عنصر صندوق مطلق بإحداثياته الخاصة داخل لوحة بمقاس منطقة
 * محتوى A4 (عرض 190mm = 718px) — بلا محاذاة تلقائية ولا قيود
 * ولا تصحيح: التداخل مقصود ومسموح، والإحداثيات تُحفظ كما هي
 * ============================================================ */

/** معرفات عناصر الترويسة القابلة للتحرير الحر */
export type PrintHeaderElId =
  | 'logo' // الشعار
  | 'companyName' // اسم الشركة
  | 'companyPhone' // هاتف الشركة
  | 'companyEmail' // بريد الشركة (Task 31) — كان محفوظاً في هوية الشركة دون أن يُطبع
  | 'systemLine' // سطر النظام (النصوص)
  | 'stamp' // الختم — تاريخ ووقت الطباعة
  | 'docTitle' // عنوان المستند

export type PrintHeaderAlign = 'right' | 'center' | 'left'

/** صندوق عنصر واحد — x تُقاس من يمين اللوحة وy من أعلاها (بكسل طباعة حقيقي) */
export interface PrintHeaderEl {
  x: number
  y: number
  /** عرض الصندوق — للشعار يحدد أقصى عرض للصورة مع object-contain */
  w: number
  /** للشعار: ارتفاع الصورة — للنصوص: حجم الخط */
  size: number
  align: PrintHeaderAlign
  visible: boolean
}

export interface PrintHeaderLayout {
  /** مفعّل؟ عند الإيقاف تعود الترويسة للوضع الكلاسيكي المرن (المقاييس أعلاه) — والإحداثيات تبقى محفوظة */
  enabled: boolean
  /** موضع خط الفصل (نهاية منطقة الترويسة) — ارتفاع كتلة .head بالبكسل */
  height: number
  /** مسافة إضافية بعد الخط قبل محتوى المستند (مكان عنوان المستند الحر) */
  bodyGap: number
  elements: Record<PrintHeaderElId, PrintHeaderEl>
}

/** عرض لوحة الترويسة = منطقة محتوى A4 (210mm − 2×10mm هامش = 190mm ≈ 718px) */
export const HEADER_CANVAS_W = 718

/** حدود عقلانية ضد القيم الشاذة فقط — بعيدة كل البعد عن الاستخدام الطبيعي
 *  (السحب داخل المصمم حر بلا أي قصر؛ التطبيع حماية من بيانات فاسدة) */
export const HEADER_LAYOUT_RAILS = {
  height: { min: 60, max: 600 },
  bodyGap: { min: 0, max: 400 },
  x: { min: -300, max: 1300 },
  y: { min: -300, max: 1600 },
  w: { min: 24, max: 900 },
  sizeText: { min: 5, max: 160 },
  sizeLogo: { min: 16, max: 600 },
} as const

/** ترتيب العناصر في واجهة المصمم + تسمياتها العربية وافتراضيات أحجامها */
export const HEADER_ELEMENTS_META: {
  id: PrintHeaderElId
  label: string
  kind: 'image' | 'text'
  defSize: number
}[] = [
  { id: 'logo', label: 'الشعار', kind: 'image', defSize: 200 },
  { id: 'companyName', label: 'اسم الشركة', kind: 'text', defSize: 19 },
  { id: 'companyPhone', label: 'هاتف الشركة', kind: 'text', defSize: 11 },
  { id: 'companyEmail', label: 'بريد الشركة', kind: 'text', defSize: 11 },
  { id: 'systemLine', label: 'سطر النظام', kind: 'text', defSize: 11 },
  { id: 'stamp', label: 'الختم / تاريخ الطباعة', kind: 'text', defSize: 11 },
  { id: 'docTitle', label: 'عنوان المستند', kind: 'text', defSize: 16 },
]

const EL_IDS: PrintHeaderElId[] = HEADER_ELEMENTS_META.map((m) => m.id)

/** التخطيط الحر الافتراضي — يعكس التصميم المرن الحالي (شعار وسط، شركة يمين، ختم يسار، عنوان أسفل الخط) */
export const DEFAULT_HEADER_LAYOUT: PrintHeaderLayout = {
  enabled: false,
  height: 230,
  bodyGap: 64,
  elements: {
    logo: { x: 239, y: 0, w: 240, size: 200, align: 'center', visible: true },
    companyName: { x: 0, y: 64, w: 230, size: 19, align: 'right', visible: true },
    companyPhone: { x: 0, y: 100, w: 230, size: 11, align: 'right', visible: true },
    // y:140 تحت سطر النظام (y:122) — لا يتداخل مع التخطيطات المحفوظة سابقاً التي تنقصها البريد
    companyEmail: { x: 0, y: 140, w: 230, size: 11, align: 'right', visible: true },
    systemLine: { x: 0, y: 122, w: 300, size: 11, align: 'right', visible: true },
    stamp: { x: 488, y: 64, w: 230, size: 11, align: 'left', visible: true },
    docTitle: { x: 159, y: 244, w: 400, size: 16, align: 'center', visible: true },
  },
}

/**
 * تطبيع قيمة التخطيط الحر من أي مصدر غير موثوق (نص JSON من الخادم/الكاش أو كائن جاهز)
 * — يعيد null عند الغياب أو الفساد الكامل، ويقصر القيم الشاذة على الحدود العقلانية
 */
export function normalizeLayoutValue(raw: unknown): PrintHeaderLayout | null {
  try {
    let obj: unknown = raw
    if (typeof raw === 'string') {
      const s = raw.trim()
      if (!s) return null
      obj = JSON.parse(s)
    }
    if (!obj || typeof obj !== 'object') return null
    const o = obj as Record<string, unknown>
    const num = (v: unknown, min: number, max: number, dflt: number): number => {
      const n = typeof v === 'number' ? v : Number.parseFloat(String(v))
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 10) / 10)) : dflt
    }
    const elsSrc = (o.elements ?? {}) as Record<string, unknown>
    const elements = {} as Record<PrintHeaderElId, PrintHeaderEl>
    for (const meta of HEADER_ELEMENTS_META) {
      const e = (elsSrc[meta.id] ?? {}) as Record<string, unknown>
      const sizeMin = meta.kind === 'image' ? HEADER_LAYOUT_RAILS.sizeLogo.min : HEADER_LAYOUT_RAILS.sizeText.min
      const sizeMax = meta.kind === 'image' ? HEADER_LAYOUT_RAILS.sizeLogo.max : HEADER_LAYOUT_RAILS.sizeText.max
      const align = e.align === 'center' || e.align === 'left' ? e.align : e.align === 'right' ? 'right' : DEFAULT_HEADER_LAYOUT.elements[meta.id].align
      elements[meta.id] = {
        x: num(e.x, HEADER_LAYOUT_RAILS.x.min, HEADER_LAYOUT_RAILS.x.max, DEFAULT_HEADER_LAYOUT.elements[meta.id].x),
        y: num(e.y, HEADER_LAYOUT_RAILS.y.min, HEADER_LAYOUT_RAILS.y.max, DEFAULT_HEADER_LAYOUT.elements[meta.id].y),
        w: num(e.w, HEADER_LAYOUT_RAILS.w.min, HEADER_LAYOUT_RAILS.w.max, DEFAULT_HEADER_LAYOUT.elements[meta.id].w),
        size: num(e.size, sizeMin, sizeMax, meta.defSize),
        align,
        visible: e.visible === undefined ? true : e.visible !== false && e.visible !== 'false',
      }
    }
    return {
      enabled: o.enabled === true || o.enabled === 'true',
      height: num(o.height, HEADER_LAYOUT_RAILS.height.min, HEADER_LAYOUT_RAILS.height.max, DEFAULT_HEADER_LAYOUT.height),
      bodyGap: num(o.bodyGap, HEADER_LAYOUT_RAILS.bodyGap.min, HEADER_LAYOUT_RAILS.bodyGap.max, DEFAULT_HEADER_LAYOUT.bodyGap),
      elements,
    }
  } catch {
    return null
  }
}

/** هل المعرّف معرّف عنصر ترويسة صحيح؟ */
export function isHeaderElId(v: string): v is PrintHeaderElId {
  return (EL_IDS as string[]).includes(v)
}

/**
 * كتلة CSS للتخطيط الحر — تُلحق بprintHeaderCss عند التفعيل فتغلب قواعد الوضع الكلاسيكي:
 * • .head كتلة بارتفاع محدد (height) يُرسم عندها خط الفصل، ويليها bodyGap قبل المحتوى
 * • كل عنصر مطلق داخل #doc-root (الموضع المرجعي المشترك) بإحداثياته المحفوظة حرفياً
 * • .co تُذاب بdisplay:contents ليصبح كل ابن منها (الاسم/الهاتف/سطر النظام) صندوقاً مستقلاً
 * • العناصر المخفية display:none — وما فوق الحدود يظاهر فوق المحتوى عمداً (بلا أي قصر)
 */
export function printFreeHeaderCss(layout: PrintHeaderLayout): string {
  const p = (el: PrintHeaderEl): string =>
    `position: absolute !important; right: ${el.x}px !important; top: ${el.y}px !important; width: ${el.w}px !important; text-align: ${el.align} !important;`
  const box = (el: PrintHeaderEl, extra = ''): string =>
    el.visible ? `${p(el)}${extra}` : 'display: none !important;'
  const els = layout.elements
  return [
    '/* ——— التخطيط الحر للترويسة (Task 29): كل عنصر بإحداثياته المطلقة ——— */',
    `#doc-root { position: relative !important }`,
    `.head { height: ${layout.height}px !important; padding: 0 !important; margin-bottom: ${layout.bodyGap}px !important }`,
    `.head-row { display: block !important; height: 100% !important; gap: 0 !important }`,
    `.co { display: contents !important }`,
    `.company { ${box(els.companyName, `font-size: ${els.companyName.size}px !important; line-height: 1.5 !important;`)} }`,
    `.co > .company-sub:not(.company-sys):not(.company-email) { ${box(els.companyPhone, `font-size: ${els.companyPhone.size}px !important; margin-top: 0 !important;`)} }`,
    `.co > .company-email { ${box(els.companyEmail, `font-size: ${els.companyEmail.size}px !important; margin-top: 0 !important;`)} }`,
    `.company-sys { ${box(els.systemLine, `font-size: ${els.systemLine.size}px !important; margin-top: 0 !important;`)} }`,
    `.head-logo-wrap { ${box(els.logo)} }`,
    `.head-logo { height: ${els.logo.size}px !important; width: 100% !important; max-width: ${els.logo.w}px !important; object-fit: contain !important }`,
    `.print-stamp { ${box(els.stamp, `font-size: ${els.stamp.size}px !important; margin-top: 0 !important; line-height: 1.9 !important;`)} }`,
    `h2.doc-title { ${box(els.docTitle, 'margin: 0 !important;')} }`,
    `h2.doc-title span { font-size: ${els.docTitle.size}px !important }`,
  ].join('\n  ')
}

const CACHE_KEY = 'printTemplate'

/** تسميات عربية لموضع الشعار (الواجهة وسجل التدقيق) */
export const AR_LOGO_POSITION: Record<PrintLogoPosition, string> = {
  right: 'يمين',
  center: 'وسط',
  left: 'يسار',
}

/** تطبيع قيم غير موثوقة إلى قالب سليم داخل النطاقات — يقبل شكلين:
 *  (1) كائن إعدادات الخادم بمفاتيح print* (استجابة /api/settings)
 *  (2) كائن القالب المخزن محلياً بأسماء الحقول المباشرة (كاش writeCache)
 *  فتعمل القراءة من الكاش ومن الخادم بالآلية نفسها بلا كسر */
function normalize(raw: Record<string, unknown> | null | undefined): PrintTemplate {
  const pick = (serverKey: string, localKey: string): unknown =>
    raw && serverKey in raw ? raw[serverKey] : raw?.[localKey]
  const str = (serverKey: string, localKey: string, max: number): string => {
    const v = pick(serverKey, localKey)
    return typeof v === 'string' ? v.trim().slice(0, max) : ''
  }
  const pos = pick('printLogoPosition', 'logoPosition')
  const scale = Number.parseInt(String(pick('printLogoScale', 'logoScale') ?? ''), 10)
  const tScale = Number.parseInt(String(pick('printTextScale', 'textScale') ?? ''), 10)
  const gap = Number.parseInt(String(pick('printHeaderGap', 'headerGap') ?? ''), 10)
  const pad = Number.parseInt(String(pick('printHeaderPadding', 'headerPadding') ?? ''), 10)
  const clamp = (v: number, min: number, max: number, dflt: number): number =>
    Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : dflt
  const bool = (serverKey: string, localKey: string): boolean => {
    const v = pick(serverKey, localKey)
    return v === undefined || v === null ? true : String(v) !== 'false'
  }
  return {
    subtitle: str('printSubtitle', 'subtitle', 60),
    logoPosition: pos === 'right' || pos === 'left' ? pos : 'center',
    logoScale: clamp(scale, LOGO_SCALE_MIN, LOGO_SCALE_MAX, DEFAULT_PRINT_TEMPLATE.logoScale),
    textScale: clamp(tScale, TEXT_SCALE_MIN, TEXT_SCALE_MAX, DEFAULT_PRINT_TEMPLATE.textScale),
    headerGap: clamp(gap, HEADER_GAP_MIN, HEADER_GAP_MAX, DEFAULT_PRINT_TEMPLATE.headerGap),
    headerPadding: clamp(pad, HEADER_PADDING_MIN, HEADER_PADDING_MAX, DEFAULT_PRINT_TEMPLATE.headerPadding),
    signAccountant: str('printSignAccountant', 'signAccountant', 40) || DEFAULT_PRINT_TEMPLATE.signAccountant,
    signAccountantName: str('printSignAccountantName', 'signAccountantName', 60),
    signAccountantVisible: bool('printSignAccountantVisible', 'signAccountantVisible'),
    signManager: str('printSignManager', 'signManager', 40) || DEFAULT_PRINT_TEMPLATE.signManager,
    signManagerName: str('printSignManagerName', 'signManagerName', 60),
    signManagerVisible: bool('printSignManagerVisible', 'signManagerVisible'),
    pageNumbers: bool('printPageNumbers', 'pageNumbers'),
    // التخطيط الحر (Task 29) — نص JSON من الخادم (printHeaderLayout) أو كائن من الكاش المحلي (layout)
    layout: normalizeLayoutValue(pick('printHeaderLayout', 'layout') ?? null),
  }
}

/** قراءة الكاش المحلي — null خارج المتصفح أو عند تعذر القراءة */
function readCache(): PrintTemplate | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return normalize(JSON.parse(raw) as Record<string, unknown>)
  } catch {
    return null
  }
}

function writeCache(tpl: PrintTemplate): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(tpl))
  } catch {
    // التخزين قد يكون ممتلئاً أو محظوراً — تعمل الطباعة بالقيم الحالية عندها
  }
}

/**
 * جلب قالب الطباعة من الخادم وتخزينه محلياً — تعيد دائماً قالباً مضموناً
 * (عند الفشل: آخر كاش محلي ثم الافتراضيات) — تُستدعى عند إقلاع الواجهة وبعد الحفظ
 */
export async function loadPrintTemplate(): Promise<PrintTemplate> {
  const fallback = readCache() ?? DEFAULT_PRINT_TEMPLATE
  try {
    const res = await fetch('/api/settings')
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !data) return fallback
    const tpl = normalize(data)
    writeCache(tpl)
    return tpl
  } catch {
    return fallback
  }
}

/** قراءة متزامنة من localStorage — لوحدات الطباعة الفورية بلا انتظار شبكة */
export function getCachedPrintTemplate(): PrintTemplate {
  return readCache() ?? DEFAULT_PRINT_TEMPLATE
}

/** تحديث الكاش المحلي مباشرة بعد حفظ الإعدادات — الطباعة تعكس التخصيص فوراً */
export function applyPrintTemplate(tpl: PrintTemplate): void {
  writeCache(normalize(tpl as unknown as Record<string, unknown>))
}

/** ارتفاع الشعار النهائي بالبكسل — 200px عند النسبة 100 */
export function logoHeightPx(tpl: PrintTemplate): number {
  return Math.round((LOGO_BASE_HEIGHT * tpl.logoScale) / 100)
}

/**
 * سطر CSS لموضع الشعار داخل .head-row — يُحقن في وحدة الطباعة عند غير الوسط
 * الوسط: '' (الترتيب الطبيعي: الشركة يميناً والشعار متمركزاً والختم يساراً كما هو اليوم)
 */
export function logoOrderCss(tpl: PrintTemplate): string {
  if (tpl.logoPosition === 'right') {
    return '.head-logo-wrap { order: -1; flex: 0 0 30%; justify-content: flex-start }'
  }
  if (tpl.logoPosition === 'left') {
    return '.head-logo-wrap { order: 4; flex: 0 0 30%; justify-content: flex-end }'
  }
  return ''
}

/**
 * كتلة CSS الترويسة الكاملة (Task 28) — تُحقن في كل وحدات الطباعة بعد قواعدها الأساسية:
 * • حجم الشعار (logoScale) + حجم نصوص الترويسة (textScale: اسم الشركة/السطر الفرعي/تاريخ الطباعة)
 *   — قديماً كان الشعار وحده يتمدد فتتفكك نسب الترويسة (التشوه الذي لاحظه المستخدم بين 60% و160%)
 * • المسافة بين العناصر (headerGap) والهامش السفلي قبل خط الفصل (headerPadding)
 * • ترتيب الشعار (logoOrderCss) — كل مقاييس الترويسة من مصدر واحد فلا انفصام بينها
 * مع !important: ترتيب القواعد الأساسية يختلف بين الوحدات السبع (بعضها يعرّف .print-stamp
 * بعد موضع الحقن) — فالتجاوز هنا يجب أن يفوز دائماً أياً كان ترتيب ورقة الأنماط
 */
export function printHeaderCss(tpl: PrintTemplate): string {
  const ts = (tpl.textScale / 100).toFixed(2)
  const classic = [
    `.head-row { gap: ${tpl.headerGap}px !important }`,
    `.company { font-size: calc(${COMPANY_FONT_BASE}px * ${ts}) !important }`,
    `.company-sub { font-size: calc(${SUB_FONT_BASE}px * ${ts}) !important }`,
    `.print-stamp { font-size: calc(${SUB_FONT_BASE}px * ${ts}) !important }`,
    `.head { padding-bottom: ${tpl.headerPadding}px !important }`,
    `.head-logo { height: ${logoHeightPx(tpl)}px !important }`,
    logoOrderCss(tpl),
  ]
    .filter(Boolean)
  // التخطيط الحر (Task 29) يُلحق أخيراً فيتغلب على القواعد الكلاسيكية عند تفعيله
  if (tpl.layout?.enabled) classic.push(printFreeHeaderCss(tpl.layout))
  return classic.join('\n  ')
}

/** أصناف Tailwind لموضع الشعار في رأس مركز التقارير (table-actions — بنية React) */
export function logoPositionClasses(tpl: PrintTemplate): string {
  if (tpl.logoPosition === 'right') return 'order-first flex w-[30%] justify-start'
  if (tpl.logoPosition === 'left') return 'order-last flex w-[30%] justify-end'
  return 'flex flex-1 justify-center'
}

/**
 * كتلة CSS لرأس مركز التقارير (table-actions) — توحيد الكليشة على كل أسطح الطباعة (Task 30):
 * • الكلاسيكي: مقاييس textScale/headerGap/headerPadding نفسها التي تُطبق على الوحدات السبع
 *   (كان رأس التقارير ثابت المقاسات فلا تنعكس عليه تخصيصات الكليشة ولا استعادتها)
 * • التخطيط الحر عند تفعيله: نفس إحداثيات المصمم حرفياً على صناديق ph-* —
 *   عنوان التقرير هو «عنوان المستند»، وسطر «المستخدم» يُخفى لأنه ليس من عناصر الكليشة
 * يُحقن كوسم style في TableActions — والرأس نفسه لا يظهر إلا في الطباعة أصلاً
 */
export function printReportsHeaderCss(tpl: PrintTemplate): string {
  const ts = (tpl.textScale / 100).toFixed(2)
  const css = [
    `.print-header .ph-row { gap: ${tpl.headerGap}px !important }`,
    `.print-header { padding-bottom: ${tpl.headerPadding}px !important }`,
    `.print-header .ph-company { font-size: calc(${COMPANY_FONT_BASE}px * ${ts}) !important }`,
    `.print-header .ph-sub, .print-header .ph-stamp { font-size: calc(${SUB_FONT_BASE}px * ${ts}) !important }`,
  ]
  const layout = tpl.layout
  if (layout?.enabled) {
    const p = (el: PrintHeaderEl): string =>
      `position: absolute !important; right: ${el.x}px !important; top: ${el.y}px !important; width: ${el.w}px !important; text-align: ${el.align} !important;`
    const box = (el: PrintHeaderEl, extra = ''): string =>
      el.visible ? `${p(el)}${extra}` : 'display: none !important;'
    const els = layout.elements
    css.push(
      '/* ——— التخطيط الحر على رأس التقارير: نفس إحداثيات المصمم حرفياً ——— */',
      `.print-header { position: relative !important; height: ${layout.height}px !important; padding: 0 !important; margin-bottom: ${layout.bodyGap}px !important }`,
      `.print-header .ph-row { display: contents !important }`,
      `.print-header .ph-company-wrap { display: contents !important }`,
      `.print-header .ph-company { ${box(els.companyName, `font-size: ${els.companyName.size}px !important; line-height: 1.5 !important;`)} }`,
      `.print-header .ph-phone { ${box(els.companyPhone, `font-size: ${els.companyPhone.size}px !important; margin-top: 0 !important;`)} }`,
      `.print-header .ph-email { ${box(els.companyEmail, `font-size: ${els.companyEmail.size}px !important; margin-top: 0 !important;`)} }`,
      `.print-header .ph-sys { ${box(els.systemLine, `font-size: ${els.systemLine.size}px !important; margin-top: 0 !important;`)} }`,
      `.print-header .ph-logo { ${box(els.logo)} }`,
      `.print-header .ph-logo img { height: ${els.logo.size}px !important; width: 100% !important; max-width: ${els.logo.w}px !important; object-fit: contain !important }`,
      `.print-header .ph-stamp { ${box(els.stamp, `font-size: ${els.stamp.size}px !important; margin-top: 0 !important; line-height: 1.9 !important;`)} }`,
      `.print-header .ph-title { ${box(els.docTitle, `margin: 0 !important; font-size: ${els.docTitle.size}px !important;`)} }`,
      `.print-header .ph-user { display: none !important }`,
    )
  }
  return css.join('\n  ')
}

/** تهريب نصوص القالب قبل حقنها في HTML الطباعة */
export function escapeTpl(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * سطر النظام الفرعي للترويسة: «{subtitle} — {وصف المستند}»
 * الفارغ يعني إخفاء السطر كلياً — بلا وصف يعيد subtitle وحده
 */
export function systemSubLine(tpl: PrintTemplate, docSuffix?: string): string {
  const base = tpl.subtitle.trim()
  if (!base) return ''
  const suffix = docSuffix?.trim() ?? ''
  return suffix ? `${base} — ${suffix}` : base
}

/** صندوق توقيع واحد — السطر المنقّط + المسمى + الاسم الاختياري تحته */
function signBox(title: string, name: string): string {
  const nameHtml = name.trim()
    ? `<div style="font-size:10px;color:#6b7280;margin-top:2px">${escapeTpl(name.trim())}</div>`
    : ''
  return `<div class="sign-box"><div class="line">${escapeTpl(title)}</div>${nameHtml}</div>`
}

/**
 * صندوقا المحاسب والمدير المالي حسب القالب — مع احترام الإظهار/الإخفاء والأسماء
 * تُركَّب بعد صندوق الوحدة الإضافي (المستلم/المحصل) إن وُجد — والفراغ يعني حذف الصف
 */
export function signatureBoxesHtml(tpl: PrintTemplate): string {
  const boxes: string[] = []
  if (tpl.signAccountantVisible) boxes.push(signBox(tpl.signAccountant, tpl.signAccountantName))
  if (tpl.signManagerVisible) boxes.push(signBox(tpl.signManager, tpl.signManagerName))
  return boxes.join('\n    ')
}

/* ============================================================
 * ترقيم الصفحات (Task 26-b) — تقسيم قياسي على أوراق A4
 * الوحدات تطبع بهامش @page صفر (لإخفاء ترويسة المتصفح) فلا يمكن
 * استخدام هوامش CSS للترقيم؛ لذلك تُبنى أوراق بمقاس الصفحة نفسه
 * يملؤها سكربت صفّي بالصفوف المقيسة فعلياً، وكل ورقة تحمل «صفحة X من Y»
 * ============================================================ */

/** CSS الأوراق المرقّمة — يُحقن بعد أنماط الوحدة فيتغلب على حشو body الورقي القديم */
export const PRINT_PAGINATION_CSS = `
  /* ===== أوراق A4 مضبوطة مع تذييل ترقيم (Task 26-b) =====
     العرض 210mm ثابت (لا 100%) حتى يكون قياس التقسيم على الشاشة مطابقاً للطباعة تماماً */
  .sheet { position: relative; width: 210mm; height: 296.5mm; overflow: hidden; background: #fff; padding: 4mm 10mm 13mm; page-break-after: always; break-after: page }
  .sheet:not(.sheet-first) { padding-top: 10mm }
  .sheet:last-child { page-break-after: auto; break-after: auto }
  .sheet-body { display: flow-root }
  .page-no { position: absolute; bottom: 5mm; inset-inline: 10mm; text-align: center; font-size: 10px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 5px; letter-spacing: 0.2px }
  /* داخل الأوراق: يُسمح بلف كل خلية (نصية أو رقمية) — لا نُبقي whitespace-nowrap
   * الموروث من مكوّن الجدول المشترك (src/components/ui/table.tsx، مصمَّم للتمرير
   * الأفقي على الشاشة) لأن table-layout:fixed هنا يمنع أي تمرير: أي خلية أعرض من
   * عمودها الثابت (اسم طرف طويل، بيان يتضمن سعر الصرف، شارة حالة بسطرين) كانت
   * تفيض بصرياً فوق الخلية المجاورة بدل النزول لسطر ثانٍ — وهذا هو سبب «التداخل»
   * المُبلَّغ عنه في كل التقارير المطبوعة. اللف لا يُخلّ بدقة التقسيم لأن سكربت
   * الترقيم يقيس ارتفاع كل صف فعلياً بعد الرندر لا يُخمّنه */
  .sheet td, .sheet th { white-space: normal }
  /* عرض ثابت للجدول الرئيسي: العروض تتحدد من صف الترويسة وحده، فإلحاق tfoot أو الصفوف
     لا يعيد توزيع الأعمدة — وقياس التقسيم يبقى مطابقاً للرندر النهائي وجداول التتابع متراصة الأعمدة */
  .sheet table[data-print-main] { table-layout: fixed }
  /* ترويسة مصغّرة لصفحات التتابع (الورقة الثانية فصاعداً) — لونها من هوية المستند عبر data-accent */
  .slim-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; border-bottom: 2px solid #92400e; padding-bottom: 5px; margin-bottom: 10px }
  .slim-head .slim-co { font-size: 13px; font-weight: 800 }
  .slim-head .slim-doc { font-size: 11px; color: #6b7280; font-weight: 600 }
  /* ذيل المستند يلتصق أسفل آخر ورقة فوق رقم الصفحة مباشرة (Task 30) — بدل طفوه وسط الصفحة */
  .sheet .foot.foot-bottom { position: absolute; bottom: 12mm; inset-inline: 10mm; margin-top: 0 !important }
  /* على الشاشة: أوراق ظليلة تفصل بينها مسافة كمعاينة طباعة حقيقية */
  @media screen {
    .sheet { box-shadow: 0 2px 12px rgba(0,0,0,0.14); margin-bottom: 16px; margin-inline: auto; border: 1px solid #e5e7eb }
  }
  /* الهوامش صارت داخل الأوراق نفسها — إلغاء حشو body الورقي القديم */
  @media print {
    body { padding: 0 !important }
    .sheet { box-shadow: none; border: 0; margin: 0 }
  }

  /* ===== تعميم المحرك على طباعات القوائم والتقارير (Task 54) =====
     عند الترقيم تُستنسخ منطقة .print-area وتوسم print-doc وتُطبع أوراقاً:
     تُلغى هوامش/تموضع منطقة الطباعة الأصلية لأن الأوراق تحمل هوامشها بنفسها —
     وإلا لتحاصر الأوراق 210mm داخل حشو 10mm فتُقص عند حافة الورقة */
  .print-doc { padding: 0 !important; position: static !important; inset: auto !important; width: auto !important; background: #ffffff !important }
  /* لون هوية المستند (--print-accent يُحمل على جذر النسخة من --primary للنظام) —
     يتجاوز قاعدة التأسيد الأسود الشاملة .print-area * { color: #000 !important } بأولوية أعلى */
  .print-doc .slim-head { border-bottom-color: var(--print-accent, #92400e) !important }
  .print-doc .slim-head .slim-co { color: var(--print-accent, #92400e) !important }
  .print-doc .page-no { color: #9ca3af !important; border-top-color: #e5e7eb !important }
  /* صف التواقيع أسفل آخر ورقة لطباعات القوائم — بنية مطابقة لوحدات السندات (signBox) */
  .list-sign-row { margin-top: 28px; display: flex; justify-content: space-around; align-items: flex-end; padding-inline: 24px }
  .sign-box { width: 210px; text-align: center }
  .sign-box .line { border-top: 1.5px dashed #9ca3af; padding-top: 6px; font-weight: 700; color: #374151; margin-top: 34px }
`

/**
 * سكربت تقسيم الأوراق وترقيمها — يُحقن في نافذة الطباعة قبل استدعاء window.print
 * الاتفاق مع الوحدات: غلاف <div id="doc-root" data-company data-doc-title data-accent>
 * والجدول الرئيسي موسوم data-print-main — وما بعده (إجماليات/تواقيع/تذييل) ينتقل لآخر ورقة
 * القياس فعلي بمحرك التنسيق (صف صف) فتتوزع الصفوف الملفوفة بدقة بلا أي تخمين
 */
export function printPaginationScript(): string {
  const js = `(function () {
  'use strict'
  var root = document.getElementById('doc-root')
  if (!root || root.getAttribute('data-paginated') === '1') return
  root.setAttribute('data-paginated', '1')
  var ACCENT = root.getAttribute('data-accent') || '#92400e'
  var DOC = root.getAttribute('data-doc-title') || ''
  var done = false

  function padPx(el, prop) { var v = parseFloat(getComputedStyle(el)[prop]); return isFinite(v) ? v : 0 }
  function capacity(sheet) { return sheet.clientHeight - padPx(sheet, 'paddingTop') - padPx(sheet, 'paddingBottom') }
  function pageNo(page, total) {
    var d = document.createElement('div')
    d.className = 'page-no'
    d.textContent = 'صفحة ' + page + ' من ' + total
    return d
  }
  function slimHead() {
    var d = document.createElement('div')
    d.className = 'slim-head'
    d.style.borderBottomColor = ACCENT
    var co = document.createElement('span')
    co.className = 'slim-co'
    co.style.color = ACCENT
    co.textContent = root.getAttribute('data-company') || ''
    var doc = document.createElement('span')
    doc.className = 'slim-doc'
    doc.textContent = DOC ? (DOC + ' — تابع') : 'تابع'
    d.appendChild(co)
    d.appendChild(doc)
    return d
  }
  function makeSheet(first, baseTable) {
    var sh = document.createElement('div')
    sh.className = 'sheet' + (first ? ' sheet-first' : '')
    var body = document.createElement('div')
    body.className = 'sheet-body'
    var t = null
    if (!first) {
      body.appendChild(slimHead())
      t = document.createElement('table')
      t.className = baseTable.className
      // نسخ سمة الجدول الرئيسي أيضاً — قواعد العرض الثابت والمحاذاة تلاحق النسخ كما الأصل
      var attrs = baseTable.attributes
      for (var a = 0; a < attrs.length; a++) {
        if (attrs[a].name !== 'id') t.setAttribute(attrs[a].name, attrs[a].value)
      }
      t.innerHTML = (baseTable.tHead ? baseTable.tHead.outerHTML : '') + '<tbody></tbody>'
      body.appendChild(t)
    }
    sh.appendChild(body)
    root.appendChild(sh)
    // الورقة الأولى تعود بلا جدول — يستبدلها paginate بالجدول الأصلي بعد نقل المحتوى
    return { sheet: sh, body: body, table: t, tbody: t ? t.tBodies[0] : null }
  }

  function paginate() {
    var table = root.querySelector('table[data-print-main]')
    var sheets = []
    if (!table || !table.tBodies.length || table.tBodies[0].rows.length === 0) {
      // مستند بلا جدول بيانات (سند/كشف فارغ) — ورقة واحدة برقمها
      var one = makeSheet(true, null)
      while (root.firstChild && root.firstChild !== one.sheet) one.body.appendChild(root.firstChild)
      sheets = [one.sheet]
    } else {
      var tbody = table.tBodies[0]
      var rows = Array.prototype.slice.call(tbody.rows)
      var tfoot = table.tFoot
      var theadHtml = table.tHead ? table.tHead.outerHTML : ''
      var trail = []
      var sib = table.nextElementSibling
      while (sib) { trail.push(sib); sib = sib.nextElementSibling }
      rows.forEach(function (r) { r.parentNode.removeChild(r) })
      if (tfoot) tfoot.parentNode.removeChild(tfoot)
      trail.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el) })

      // الورقة الأولى تحتضن المحتوى الثابت (الترويسة/العنوان/الميتا) والجدول نفسه
      var first = makeSheet(true, null)
      while (root.firstChild && root.firstChild !== first.sheet) first.body.appendChild(root.firstChild)
      sheets = [first.sheet]
      var cur = { sheet: first.sheet, body: first.body, table: table, tbody: tbody }
      var curCap = capacity(first.sheet)
      for (var i = 0; i < rows.length; i++) {
        cur.tbody.appendChild(rows[i])
        // هامش أمان 4px: نتراجع عن الصف قبل ملامسة سقف الورقة — لا قصّ بكسل واحد
        if (cur.body.offsetHeight > curCap - 4) {
          cur.tbody.removeChild(rows[i])
          cur = makeSheet(false, table)
          curCap = capacity(cur.sheet)
          cur.tbody.appendChild(rows[i])
        }
      }
      // الإجماليات والتواقيع والتذييل في آخر ورقة — وإن لم تتسع فورقة جديدة خاصة بها
      var attachEnd = function () {
        if (tfoot) cur.table.appendChild(tfoot)
        for (var j = 0; j < trail.length; j++) cur.body.appendChild(trail[j])
      }
      attachEnd()
      if (cur.body.offsetHeight > curCap - 4) {
        if (tfoot && tfoot.parentNode) tfoot.parentNode.removeChild(tfoot)
        trail.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el) })
        cur = makeSheet(false, table)
        curCap = capacity(cur.sheet)
        attachEnd()
      }
      sheets = Array.prototype.map.call(root.querySelectorAll('.sheet'), function (s) { return s })
    }
    var total = sheets.length
    for (var k = 0; k < total; k++) sheets[k].appendChild(pageNo(k + 1, total))
    // ذيل المستند (.foot) يلتصق أسفل آخر ورقة (Task 30) — خارج التدفق فلا يؤثر على قياس التقسيم
    var lastSheet = sheets[total - 1]
    var footEl = lastSheet.querySelector('.foot')
    if (footEl) footEl.classList.add('foot-bottom')
  }

  function run() {
    if (done) return
    done = true
    try { paginate() } catch (e) { /* أي خلل في الترقيم لا يمنع الطباعة أصلاً */ }
  }
  function whenReady() {
    var waits = []
    if (document.fonts && document.fonts.ready) waits.push(document.fonts.ready)
    Array.prototype.forEach.call(document.images || [], function (im) {
      if (im.complete) return
      waits.push(im.decode ? im.decode().catch(function () {}) : Promise.resolve())
    })
    Promise.race([
      Promise.all(waits),
      new Promise(function (res) { setTimeout(res, 500) })
    ]).then(run)
  }
  if (document.readyState === 'complete') whenReady()
  else window.addEventListener('load', whenReady)
  setTimeout(run, 900) // ضمانة قصوى قبل استدعاء الطباعة المتأخر (1100ms في الوحدات)
})()`
  return '<script>' + js + '</scr' + 'ipt>'
}

/* ============================================================
 * تعميم محرك التقسيم على طباعات القوائم والتقارير (Task 54)
 * الوحدات تطبع بنافذة منبثقة تُبنى HTML وتحمل سكربت التقسيم أعلاه، أما شاشات
 * القوائم فتطبع في الوثيقة الحية — لذلك وُفّرت الدوال التالية لتُستدعى مباشرة
 * من TableActions قبل window.print: مرآة أنماط الطباعة + تقسيم الجذر صفّاً صفّاً.
 * الخوارزمية مطابقة لسكربت الوحدات حرفياً (قياس فعلي بلا تخمين) مع تعميم واحد:
 * «ذيل المستند» = كل الأشقاء التالية للسلف الأعلى للجدول داخل الجذر (في الوحدات
 * الجدول ابن مباشر فتعطي القاعدتان نفس النتيجة، وفي القوائم يسمح الجذر بأغلفة
 * overflow والإجماليات بعد الجدول فتُلحق كلها بآخر ورقة دائماً)
 * ============================================================ */

/** لون هوية المستند للطباعة — من متغير النظام --primary (زمرد نهاراً/ذهبي ليلاً) */
export function resolvePrintAccent(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
    if (v) return v
  } catch {
    /* بيئة بلا CSSOM — اللون الاحتياطي */
  }
  return '#92400e'
}

/**
 * مرآة أنماط الطباعة — تستخرج من أوراق أنماط الوثيقة الحية كل القواعد المحبوسة
 * داخل @media print (حظر globals الورقي + متغيرات print: في Tailwind) وتعيدها
 * نصاً غير محبوس، فتُحقن مؤقتاً قبل القياس ليُقاس التقسيم على التخطيط الورقي
 * الفعلي نفسه (خط 11px وحشو 4/6 وإلغاء أرضيات min-width…) لا على تخطيط الشاشة
 * — وهذا شرط «دون تخمين»: ما يُقاس هو ما يُطبع حرفياً. تُزال المرآة بعد الطباعة.
 */
export function buildPrintMediaMirror(): string {
  const out: string[] = []
  const walk = (rules: CSSRuleList | null | undefined) => {
    if (!rules) return
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i]
      if (r instanceof CSSMediaRule) {
        if (r.conditionText.trim() === 'print') {
          for (const inner of Array.from(r.cssRules)) out.push(inner.cssText)
        } else {
          walk(r.cssRules) // وسائط متداخلة قد تحتوي print داخلها
        }
      } else if (r instanceof CSSLayerBlockRule || r instanceof CSSSupportsRule) {
        walk(r.cssRules)
      }
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules)
    } catch {
      /* أوراق خارجية محجوبة القراءة — تُتجاهل */
    }
  }
  return out.join('\n')
}

/** صندوق رقم الصفحة «صفحة X من Y» */
function printPageNo(page: number, total: number): HTMLDivElement {
  const d = document.createElement('div')
  d.className = 'page-no'
  d.textContent = `صفحة ${page} من ${total}`
  return d
}

/** الترويسة المصغرة لصفحات التتابع — بلون هوية المستند */
function printSlimHead(company: string, doc: string, accent: string): HTMLDivElement {
  const d = document.createElement('div')
  d.className = 'slim-head'
  d.style.borderBottomColor = accent
  const co = document.createElement('span')
  co.className = 'slim-co'
  co.style.color = accent
  co.textContent = company
  const docEl = document.createElement('span')
  docEl.className = 'slim-doc'
  docEl.textContent = doc ? `${doc} — تابع` : 'تابع'
  d.appendChild(co)
  d.appendChild(docEl)
  return d
}

/**
 * تقسيم جذر الطباعة صفّاً صفّاً على أوراق A4 (نسخة الوثيقة الحية من سكربت الوحدات).
 * الجذر = نسخة .print-area الموسومة print-doc وتحمل data-company و data-doc-title
 * و --print-accent. يعمل بالقياس الفعلي لمحرك التنسيق: يُلحق صف صف ويتراجع عن الصف
 * قبل ملامسة سقف الورقة بهامش أمان 4px، وتكرّر ترويسة الجدول في كل ورقة تتابع
 * (نسخ thead) مع الترويسة المصغرة، والإجماليات والتواقيع وذيل المستند تلحق آخر
 * ورقة دائماً، وكل ورقة تحمل «صفحة X من Y». لا يغيّر شيئاً في الوثيقة الأصلية —
 * يُستدعى على نسخة مقتطعة تُرمى بعد الطباعة.
 */
export function paginatePrintRoot(root: HTMLElement): void {
  if (root.getAttribute('data-paginated') === '1') return
  root.setAttribute('data-paginated', '1')
  const COMPANY = root.getAttribute('data-company') || ''
  const DOC = root.getAttribute('data-doc-title') || ''
  const ACCENT = root.style.getPropertyValue('--print-accent') || root.getAttribute('data-accent') || '#92400e'

  const padPx = (el: HTMLElement, prop: 'paddingTop' | 'paddingBottom') => {
    const v = parseFloat(getComputedStyle(el)[prop])
    return isFinite(v) ? v : 0
  }
  const capacity = (sheet: HTMLElement) => sheet.clientHeight - padPx(sheet, 'paddingTop') - padPx(sheet, 'paddingBottom')

  // سياق الورقة الحالية — الجدول و tbody غير صفريين دائماً في مسار التقسيم الفعلي
  // (ورقة «بلا جدول» تستعمل sheet/body فقط ولا تمر بهذا المسار)
  type SheetCtx = { sheet: HTMLDivElement; body: HTMLDivElement; table: HTMLTableElement; tbody: HTMLTableSectionElement }
  const makeSheet = (first: boolean, baseTable: HTMLTableElement | null): SheetCtx => {
    const sh = document.createElement('div')
    sh.className = 'sheet' + (first ? ' sheet-first' : '')
    const body = document.createElement('div')
    body.className = 'sheet-body'
    let t: HTMLTableElement | null = null
    if (!first && baseTable) {
      body.appendChild(printSlimHead(COMPANY, DOC, ACCENT))
      t = document.createElement('table')
      t.className = baseTable.className
      // نسخ سمة الجدول الرئيسي أيضاً — قواعد العرض الثابت والمحاذاة تلاحق النسخ كما الأصل
      const attrs = baseTable.attributes
      for (let a = 0; a < attrs.length; a++) {
        if (attrs[a].name !== 'id') t.setAttribute(attrs[a].name, attrs[a].value)
      }
      t.innerHTML = (baseTable.tHead ? baseTable.tHead.outerHTML : '') + '<tbody></tbody>'
      // نسخ colgroup العروض المثبتة — أعمدة صفحات التتابع مطابقة للصفحة الأولى
      const cg = baseTable.querySelector('colgroup')
      if (cg) t.insertBefore(cg.cloneNode(true), t.firstChild)
      body.appendChild(t)
    }
    sh.appendChild(body)
    root.appendChild(sh)
    return {
      sheet: sh,
      body,
      table: t as HTMLTableElement,
      tbody: (t ? t.tBodies[0] : null) as HTMLTableSectionElement,
    }
  }

  // الجدول الرئيسي = الجدول الأكثر صفوفاً في المنطقة (يتسامح مع جداول ميتا صغيرة إن وُجدت)
  let table: HTMLTableElement | null = null
  let maxRows = -1
  for (const t of Array.from(root.querySelectorAll('table'))) {
    const n = t.tBodies.length ? t.tBodies[0].rows.length : 0
    if (n > maxRows) {
      maxRows = n
      table = t
    }
  }

  if (!table || maxRows <= 0) {
    // مستند بلا جدول بيانات — ورقة واحدة تحمل المحتوى كله برقمها
    const one = makeSheet(true, null)
    while (root.firstChild && root.firstChild !== one.sheet) one.body.appendChild(root.firstChild)
    one.sheet.appendChild(printPageNo(1, 1))
    return
  }

  const mainTable = table
  const tbody = mainTable.tBodies[0]
  const rows = Array.prototype.slice.call(tbody.rows) as HTMLTableRowElement[]
  const tfoot = mainTable.tFoot

  // الذيل = كل الأشقاء التالية للسلف الأعلى للجدول داخل الجذر (إجماليات/تواقيع/تذييل)
  // — يُحسب قبل النقل لأن مواقع الأشقاء تتغير حين يحتضنها جسم الورقة
  let topAncestor: Element = mainTable
  while (topAncestor.parentNode && topAncestor.parentNode !== root) topAncestor = topAncestor.parentElement!
  const trail: Element[] = []
  let sib = topAncestor.nextElementSibling
  while (sib) {
    trail.push(sib)
    sib = sib.nextElementSibling
  }

  // الورقة الأولى تحتضن المحتوى الثابت (رأس الطباعة/العنوان/الميتا) والجدول نفسه **بصفوفه كاملة**
  // — يجب أن تُبنى قبل قياس الأعمدة: داخل الورقة فقط يجلس الجدول على عرض الورق الفعلي
  // (منطقة محتوى A4 ≈ 718px) والقياس بصفوف كاملة يعطي التوزيع الطبيعي للطباعة لا
  // منسوجاً من رؤوس فارغة أو من عرض الشاشة
  const first = makeSheet(true, null)
  while (root.firstChild && root.firstChild !== first.sheet) first.body.appendChild(root.firstChild)
  let cur = { sheet: first.sheet, body: first.body, table: mainTable, tbody }
  let curCap = capacity(first.sheet)

  // تثبيت عروض الأعمدة: اقرأ العروض الطبيعية من التخطيط التلقائي (auto) على عرض
  // الورقة وبصفوف كاملة ثم ثبتها داخل <colgroup> بنِسب مئوية — جداول القوائم لا
  // تحمل عروضاً معلنة فتوزيع fixed الأعمى (أعمدة متساوية) يلطّخ الصفوف بلفّ مضاعف؛
  // أما العروض المقيسة على الورق فتعيد على كل صفحات التتابع أعمدة الصفحة الأولى
  // بالقرش (استقرار ومحاذاة بين الصفحات) دون تغيير شكل الصفحة الأولى حرفياً
  const seedRow = mainTable.tHead?.rows[0] ?? mainTable.rows[0] ?? null
  const tableW = mainTable.getBoundingClientRect().width
  const seedCells = seedRow ? Array.from(seedRow.cells) : []
  const seedable = tableW > 0 && seedCells.length > 0 && seedCells.every((c) => c.colSpan <= 1)
  if (seedable) {
    const cg = document.createElement('colgroup')
    for (const c of seedCells) {
      const col = document.createElement('col')
      col.style.width = ((c.getBoundingClientRect().width / tableW) * 100).toFixed(3) + '%'
      cg.appendChild(col)
    }
    mainTable.insertBefore(cg, mainTable.firstChild)
  }
  mainTable.setAttribute('data-print-main', '')

  // الآن تُفرَّغ الصفوف لتُعاد صفّاً صفّاً بالقياس الفعلي — التخطيط صار fixed بالعروض
  // المثبتة فتبقى الأعمدة ثابتة خلال العملية كلها
  rows.forEach((r) => r.parentNode?.removeChild(r))
  if (tfoot) tfoot.parentNode?.removeChild(tfoot)
  trail.forEach((el) => el.parentNode?.removeChild(el))

  for (let i = 0; i < rows.length; i++) {
    cur.tbody.appendChild(rows[i])
    // هامش أمان 4px: نتراجع عن الصف قبل ملامسة سقف الورقة — لا قصّ بكسل واحد
    if (cur.body.offsetHeight > curCap - 4) {
      cur.tbody.removeChild(rows[i])
      cur = makeSheet(false, mainTable)
      curCap = capacity(cur.sheet)
      cur.tbody.appendChild(rows[i])
    }
  }

  // الإجماليات والتواقيع والتذييل في آخر ورقة — وإن لم تتسع فورقة جديدة خاصة بها
  const attachEnd = () => {
    if (tfoot) cur.table.appendChild(tfoot)
    for (const el of trail) cur.body.appendChild(el)
  }
  attachEnd()
  if (cur.body.offsetHeight > curCap - 4) {
    if (tfoot && tfoot.parentNode) tfoot.parentNode.removeChild(tfoot)
    trail.forEach((el) => el.parentNode?.removeChild(el))
    cur = makeSheet(false, mainTable)
    curCap = capacity(cur.sheet)
    attachEnd()
  }

  const sheets = Array.prototype.slice.call(root.querySelectorAll('.sheet')) as HTMLElement[]
  const total = sheets.length
  for (let k = 0; k < total; k++) sheets[k].appendChild(printPageNo(k + 1, total))
  // ذيل المستند (.foot) يلتصق أسفل آخر ورقة فوق رقم الصفحة — كما في الوحدات
  const lastSheet = sheets[total - 1]
  const footEl = lastSheet.querySelector('.foot')
  if (footEl) footEl.classList.add('foot-bottom')
}
