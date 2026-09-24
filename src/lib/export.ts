// أداة تصدير موحدة — CSV بترميز UTF-8 مع BOM ليفتح Excel العربية مباشرة
// الأرقام تُصدَّر كما هي بلا فواصل آلاف (قيم خام جاهزة للجداول المحاسبية)
// التواريخ تُمرَّر بصيغة ISO (YYYY-MM-DD) من الشاشات

export type ExportCell = string | number

export interface ExportTableOptions {
  /** اسم الملف بدون الامتداد والتاريخ — يُضاف إليه اليوم تلقائياً */
  filename: string
  headers: string[]
  rows: ExportCell[][]
}

/** تاريخ اليوم بصيغة YYYY-MM-DD (نفس منطق todayYMD في format.ts) */
function dateStamp(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * تهريب الخلية وفق معيار CSV:
 * احتواء بالاقتباس المزدوج عند وجود فاصلة/اقتباس/سطر جديد، ومضاعفة الاقتباسات الداخلية.
 * الأرقام تُكتب قيمتها الخام بلا تنسيق آلاف، ومحارف التحكم الاتجاهية (RLE/PDF…)
 * تُزال كي لا تظهر كرموز غريبة داخل Excel.
 */
function escapeCell(value: ExportCell): string {
  const s = String(value ?? '').replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** بناء محتوى CSV كاملاً مع BOM (مفيد للاختبار وأدوات المعاينة) */
export function buildCsvContent({ headers, rows }: Pick<ExportTableOptions, 'headers' | 'rows'>): string {
  const lines = [headers, ...rows].map((line) => line.map(escapeCell).join(','))
  return `\uFEFF${lines.join('\r\n')}`
}

/** تنزيل الجدول كملف CSV — ${filename}-${YYYY-MM-DD}.csv */
export function exportTableToCsv({ filename, headers, rows }: ExportTableOptions): void {
  const csv = buildCsvContent({ headers, rows })
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}-${dateStamp()}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()

  // تحرير الذاكرة بعد اكتمال بدء التنزيل
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
