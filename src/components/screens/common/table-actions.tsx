'use client'

// شريط إجراءات الطباعة والتصدير الموحد لكل شاشات القوائم — المرحلة 7-ب (مطوّر)
// • زر «طباعة»: يجلب كل الصفوف (لا الصفحة المعروضة) عبر onBeforePrint ثم يطبع منطقة
//   .print-area وحدها بعرض الورقة — بلا قص كلمات أو أرقام أو محارف اتجاهية وهمية
// • زر «تصدير إكسل»: CSV بترميز UTF-8 + BOM يفتح بالعربية في Excel مباشرة (كل الصفوف)
// • onBeforePrint/onAfterPrint: تتيح للشاشة توسيع البيانات قبل الطباعة ثم استعادة التقسيم بعدها
// • rowsLoader يدعم التزامن (async) لجلب كل الصفوف وقت التصدير في الشاشات مقسّمة صفحياً خادمياً

import { useEffect, useState } from 'react'
import { FileSpreadsheet, Loader2, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { exportTableToCsv, type ExportCell } from '@/lib/export'
import { fmtDateTime } from '@/lib/format'
import { getCachedCompanyInfo, loadCompanyInfo, type CompanyInfo } from '@/lib/company'
import {
  PRINT_PAGINATION_CSS,
  buildPrintMediaMirror,
  getCachedPrintTemplate,
  loadPrintTemplate,
  logoHeightPx,
  logoPositionClasses,
  paginatePrintRoot,
  printReportsHeaderCss,
  resolvePrintAccent,
  signatureBoxesHtml,
  systemSubLine,
  type PrintTemplate,
} from '@/lib/print-template'

interface TableActionsProps {
  /** عنوان الشاشة — يظهر في رأس الطباعة */
  title: string
  /** اسم ملف التصدير بدون الامتداد والتاريخ */
  filename: string
  /** رؤوس الجدول المعروضة نفسها */
  headers: string[]
  /** صفوف مصفوفة البيانات المعروضة (بعد الفلترة) بقيم خام */
  rows?: ExportCell[][]
  /** بديل عن rows — يُبنى وقت التصدير من أحدث حالة (يدعم جلب كل الصفوف بشكل متزامن) */
  rowsLoader?: () => ExportCell[][] | Promise<ExportCell[][]>
  /** تُستدعى قبل الطباعة — الشاشة تجلب وتصيّر كل الصفوف هنا (مثلاً كل صفحات الخادم) */
  onBeforePrint?: () => Promise<void> | void
  /** تُستدعى بعد انتهاء الطباعة — الشاشة تستعيد التقسيم الصفحي العادي */
  onAfterPrint?: () => void
}

// محارف التحكم الاتجاهية (RLE/PDF/LRE/RLM…) — غير مرئية على الشاشة لكن بعض مطبوعات
// المتصفح تعرضها كرموز غريبة، فتُزال من منطقة الطباعة مؤقتاً وتُسترجع بعدها حرفياً
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g

// أداة تحقق تشخيصية من وحدة التحكم — تستدعي دوال محرك التقسيم الحقيقية نفسها
// (مرآة أنماط الطباعة + التقسيم صفّاً صفّاً) بلا أي أثر وظيفي على التطبيق
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__printPaginate = {
    buildPrintMediaMirror,
    paginatePrintRoot,
    resolvePrintAccent,
  }
}

let savedTextNodes: { node: Text; text: string }[] = []

function stripBidiControls(root: ParentNode) {
  savedTextNodes = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    if (BIDI_CONTROLS.test(t.data)) {
      savedTextNodes.push({ node: t, text: t.data })
      t.data = t.data.replace(BIDI_CONTROLS, '')
    }
  }
}

function restoreBidiControls() {
  for (const { node, text } of savedTextNodes) node.data = text
  savedTextNodes = []
}

export function TableActions({ title, filename, headers, rows, rowsLoader, onBeforePrint, onAfterPrint }: TableActionsProps) {
  const [preparing, setPreparing] = useState(false)

  // بيانات الشركة لرأس الطباعة — الكاش المحلي فوراً ثم تحديث من الخادم مرة عند التركيب
  // (suppressHydrationWarning لأن الكاش يُقرأ متزامناً وقد يخالف HTML الخادم — بدون أخطاء console)
  const [company, setCompany] = useState<CompanyInfo>(() => getCachedCompanyInfo())
  // قالب الطباعة (Task 26): سطر النظام + موضع وحجم الشعار — الكاش فوراً ثم تحديث من الخادم
  const [tpl, setTpl] = useState<PrintTemplate>(() => getCachedPrintTemplate())
  useEffect(() => {
    let alive = true
    void loadCompanyInfo().then((info) => {
      if (alive) setCompany(info)
    })
    void loadPrintTemplate().then((t) => {
      if (alive) setTpl(t)
    })
    return () => {
      alive = false
    }
  }, [])
  const headerSubLine = systemSubLine(tpl)

  async function handlePrint() {
    if (preparing) return
    setPreparing(true)
    const area = document.querySelector('.print-area') as HTMLElement | null
    try {
      // 1) الشاشة تجلب وتصيّر كل الصفوف (إن طبّقت ذلك)
      try {
        await onBeforePrint?.()
      } catch {
        /* فشل الجلب الكامل — نطبع المعروض لا شيء */
      }

      // 2) انتظار إعادة الرسم حتى تظهر الصفوف الجديدة في الـDOM فعلياً
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      if (!area) {
        window.print()
        return
      }

      // 3) إزالة المحارف الاتجاهية الوهمية من نصوص منطقة الطباعة (تُسترجع حرفياً بعد الطباعة)
      stripBidiControls(area)

      // 4) المسار المرقّم (Task 54): محرك التقسيم المادي صفّاً صفّاً على أوراق A4 —
      //    يُبنى استنساخ لمنطقة الطباعة ويُقاس بالتخطيط الورقي الفعلي (مرآة @media print)
      //    فيتوزع الصفوف على أوراق محكومة: «صفحة X من Y» أسفل كل ورقة، وترويسة مصغّرة
      //    بلون هوية المستند وعناوين الجداول تتكرر آلياً بصفحات التتابع، والإجماليات
      //    والتواقيع تلحق آخر ورقة دائماً. الوثيقة الأصلية لا تُمسّ — النسخة تُرمى بعدها
      if (tpl.pageNumbers) {
        const mirror = document.createElement('style')
        mirror.textContent = buildPrintMediaMirror()
        document.head.appendChild(mirror)

        const clone = area.cloneNode(true) as HTMLElement
        clone.classList.add('print-doc')
        clone.setAttribute('data-company', company.companyName || '')
        clone.setAttribute('data-doc-title', title)
        clone.style.setProperty('--print-accent', resolvePrintAccent())
        const signRow = signatureBoxesHtml(tpl)
        if (signRow) {
          const row = document.createElement('div')
          row.className = 'list-sign-row'
          row.innerHTML = signRow
          clone.appendChild(row)
        }

        area.style.display = 'none'
        document.body.insertBefore(clone, document.body.firstChild)
        document.documentElement.classList.add('printing')
        try {
          try {
            paginatePrintRoot(clone)
          } catch {
            /* أي خلل في التقسيم لا يمنع الطباعة أصلاً — النسخة تُطبع كما هي */
          }
          // يتعطل التنفيذ هنا حتى يغلق المستخدم حوار الطباعة
          window.print()
        } finally {
          document.documentElement.classList.remove('printing')
          clone.remove()
          area.style.display = ''
          mirror.remove()
          restoreBidiControls()
        }
        return
      }

      // 5) المسار القديم (الترقيم معطّل من إعدادات قالب الطباعة) — كما هو حرفياً:
      //    نقل منطقة الطباعة ابناً مباشراً للجذر — تتحرر من أي حاوية أعرض من الورقة
      //    فتلتزم عرض صفحة A4 تماماً (كلا الطرفين بلا إزاحة = عرض الورقة)
      const parent = area.parentNode
      const next = area.nextSibling
      document.body.insertBefore(area, document.body.firstChild)
      document.documentElement.classList.add('printing')

      try {
        // يتعطل التنفيذ هنا حتى يغلق المستخدم حوار الطباعة
        window.print()
      } finally {
        // 6) استعادة كل شيء كما كان — الشاشة تعود طبيعياً تماماً
        document.documentElement.classList.remove('printing')
        if (parent) parent.insertBefore(area, next)
        restoreBidiControls()
      }
    } finally {
      onAfterPrint?.()
      setPreparing(false)
    }
  }

  async function handleExport() {
    const data = rowsLoader ? await rowsLoader() : (rows ?? [])
    exportTableToCsv({ filename, headers, rows: data })
  }

  return (
    <>
      {/* رأس الطباعة المشترك — يظهر فقط في المعاينة الورقية (print-header في globals.css)
          صف واحد: اسم الشركة يميناً + الشعار 4× متمركز + تاريخ ووقت الطباعة يساراً — بطلب المستخدم
          صناديق ph-* + كتلة printReportsHeaderCss (Task 30): توحيد الكليشة مع الوحدات السبع —
          مقاييس الترويسة (النصوص/المسافة/الهامش) والتخطيط الحر بإحداثيات المصمم نفسها تُطبّق هنا أيضاً */}
      {/* CSS الأوراق المرقّمة — يُحقن فقط عند تفعيل الترقيم من قالب الطباعة (Task 26-b/54) */}
      <style dangerouslySetInnerHTML={{ __html: printReportsHeaderCss(tpl) + (tpl.pageNumbers ? PRINT_PAGINATION_CSS : '') }} />
      <div className="print-header">
        <div className="ph-row flex items-center gap-4" suppressHydrationWarning>
          <div className="ph-company-wrap w-[30%] text-right" suppressHydrationWarning>
            <p className="ph-company text-base font-bold leading-tight" suppressHydrationWarning>
              {company.companyName}
            </p>
            {company.companyPhone && (
              <p className="ph-phone mt-0.5 text-xs" suppressHydrationWarning>
                هاتف: <span className="num">{company.companyPhone}</span>
              </p>
            )}
            {company.companyEmail && (
              <p className="ph-email mt-0.5 text-xs" suppressHydrationWarning>
                بريد: <span className="num">{company.companyEmail}</span>
              </p>
            )}
            {headerSubLine && (
              <p className="ph-sys mt-0.5 text-xs" suppressHydrationWarning>
                {headerSubLine}
              </p>
            )}
          </div>
          <div className={`ph-logo ${logoPositionClasses(tpl)}`} suppressHydrationWarning>
            {company.companyLogo && (
              <img
                src={company.companyLogo}
                alt={`شعار ${company.companyName}`}
                style={{ height: `${logoHeightPx(tpl)}px` }}
                className="object-contain"
                suppressHydrationWarning
              />
            )}
          </div>
          <div className="ph-stamp w-[30%] text-left text-xs leading-relaxed">
            <p>
              تاريخ الطباعة: <span className="num">{fmtDateTime(new Date())}</span>
            </p>
            <p>
              الساعة:{' '}
              <span className="num">
                {String(new Date().getHours()).padStart(2, '0')}:
                {String(new Date().getMinutes()).padStart(2, '0')}
              </span>
            </p>
          </div>
        </div>
        <div className="ph-user mt-2 flex items-center justify-between text-xs leading-relaxed">
          <p>المستخدم: المدير</p>
        </div>
        <p className="ph-title mt-3 text-center text-sm font-bold">{title}</p>
      </div>

      {/* شريط الزرين — للشاشة فقط ولا يُطبع */}
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="text-primary"
          onClick={handlePrint}
          disabled={preparing}
          title="طباعة القائمة كاملة على أوراق A4 مرقّمة (صفحة X من Y) مع تكرار العناوين في كل صفحة"
          aria-label={`طباعة ${title}`}
        >
          {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
          {preparing ? 'جارٍ تجهيز الطباعة…' : 'طباعة'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-primary"
          onClick={handleExport}
          title="تصدير القائمة كاملة إلى ملف إكسل CSV بالعربية"
          aria-label={`تصدير ${title} إلى إكسل`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          تصدير إكسل
        </Button>
      </div>
    </>
  )
}
