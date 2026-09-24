// أدوات رياضية وتسلسلية مشتركة (خادم + عميل) — بلا أي اعتماديات خارجية
// المصدر الوحيد لـ round2 ومسح «أعلى رقم + 1» في ترقيم المستندات (VCH/JE/ST/I…)

/** تقريب لأقرب قرش (منزلتان) — يوحّد حساب المبالغ في كل الشاشات والخادميات */
export const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * الرقم التالي للمتتالية = أعلى رقم موجود عددياً (لا معجمياً) بنفس البادئة + 1.
 * floor: أرضية دنيا للأرقام المدوَّرة إلى الأرشيف عند إقفال الفترة — رقم دُوِّر لا يُعاد أبداً
 * أمثلة: nextSequentialNumber('VCH-', numbers) → 'VCH-0010'
 *        nextSequentialNumber('ST-', numbers, 3) → 'ST-007'
 */
export function nextSequentialNumber(prefix: string, numbers: string[], pad = 4, floor = 0): string {
  let max = floor
  const re = new RegExp(`^${prefix}(\\d+)$`)
  for (const raw of numbers) {
    const m = re.exec(raw)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return `${prefix}${String(max + 1).padStart(pad, '0')}`
}
