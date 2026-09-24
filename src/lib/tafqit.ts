// التفقيط — تحويل المبالغ إلى كلمات عربية فصيحة بقواعد التمييز الصحيحة
// مثال: 12535540.50 → «اثنا عشر مليوناً وخمسمائة وخمسة وثلاثون ألفاً وخمسمائة وأربعون ليرة سورية وخمسون قرشاً لا غير.»
// القواعد المطبقة لكل مجموعة ثلاثية (حسب موقع جزء العشرات من المجموعة):
//   1  → مفرد مضاف (ألف / مليون) — 1,000 «ألف»
//   2  → مثنى (ألفان / مليونان)
//   3..10  → جمع (آلاف / ملايين) — «ثلاثة آلاف»
//   11..99 → مفرد منصوب بالفتح (ألفاً / مليوناً) — «اثنا عشر مليوناً» و«خمسة وثلاثون ألفاً»
//   المئات الصرفة (100..900) → مفرد مضاف — «خمسمائة ألف»

/** المفرد/المثنى/الجمع/المنصوب لأسماء المراتب */
const SCALES: { s: string; d: string; p: string; a: string }[] = [
  { s: '', d: '', p: '', a: '' }, // المرتبة 0 — الوحدات (بلا اسم مرتبة)
  { s: 'ألف', d: 'ألفان', p: 'آلاف', a: 'ألفاً' },
  { s: 'مليون', d: 'مليونان', p: 'ملايين', a: 'مليوناً' },
  { s: 'مليار', d: 'ملياران', p: 'مليارات', a: 'ملياراً' },
]

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة']

const TEENS = [
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر',
  'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر',
]

const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']

/** العشرات الكاملة 10..19 (عشرة + المركبات) */
function tenToNineteen(rest: number): string {
  return rest === 10 ? 'عشرة' : TEENS[rest - 11]
}

const HUNDREDS = [
  '', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة',
  'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة',
]

/** تفقيط مجموعة ثلاثية (1..999) كلماتٍ فقط بلا اسم مرتبة — تُربط مكوّناتها بالواو */
function groupWords(g: number): string {
  const parts: string[] = []
  const h = Math.floor(g / 100)
  const rest = g % 100
  if (h > 0) parts.push(HUNDREDS[h])
  if (rest > 0) {
    if (rest < 10) parts.push(ONES[rest])
    else if (rest < 20) parts.push(tenToNineteen(rest))
    else {
      const o = rest % 10
      const t = Math.floor(rest / 10)
      if (o > 0) parts.push(ONES[o])
      parts.push(TENS[t])
    }
  }
  return parts.join(' و')
}

/** تفقيط عدد صحيح غير سالب (0..999,999,999,999) بكامل قواعد التمييز */
export function tafqitWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return 'صفر'
  const int = Math.floor(n)
  if (int === 0) return 'صفر'
  if (int >= 1_000_000_000_000) return 'عدد كبير جداً'

  // تقسيم لثلاثيات من اليمين ثم القراءة من الأعلى
  const groups: number[] = []
  let rest = int
  while (rest > 0) {
    groups.push(rest % 1000)
    rest = Math.floor(rest / 1000)
  }

  const phrases: string[] = []
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]
    if (g === 0) continue
    if (i === 0) {
      phrases.push(groupWords(g))
      continue
    }
    const scale = SCALES[Math.min(i, SCALES.length - 1)]
    const last = g % 100
    if (g === 1) phrases.push(scale.s)
    else if (g === 2) phrases.push(scale.d)
    else if (last >= 3 && last <= 10) phrases.push(`${groupWords(g)} ${scale.p}`)
    else if (last === 1 || last === 0) phrases.push(`${groupWords(g)} ${scale.s}`)
    else phrases.push(`${groupWords(g)} ${scale.a}`)
  }
  return phrases.join(' و')
}

/** عبارة القروش — 1 «قرش واحد» / 2 «قرشان» / 3..10 «X قروش» / 11+ «X قرشاً» */
function centsPhrase(c: number): string {
  if (c === 1) return 'قرش واحد'
  if (c === 2) return 'قرشان'
  const w = tafqitWords(c)
  if (c <= 10) return `${w} قروش`
  return `${w} قرشاً`
}

/**
 * تفقيط مبلغ بالليرة السورية والقروش — بصيغة الفواتير المعتمدة:
 * tafqitSYP(12535540.50) → «اثنا عشر مليوناً وخمسمائة وخمسة وثلاثون ألفاً
 * وخمسمائة وأربعون ليرة سورية وخمسون قرشاً لا غير.»
 * والصحيحان 1 و2 يُصرَّفان (ليرة سورية واحدة / ليرتان سوريتان — قرشان)
 */
export function tafqitSYP(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) amount = 0
  let int = Math.floor(amount)
  // تصحيح تقريب الفواصل العائمة: 0.999999 → 100 قرشاً تصير ليرة وبدون قروش
  let cents = Math.round((amount - int) * 100)
  if (cents >= 100) {
    int += 1
    cents = 0
  }

  let money: string
  if (int === 0) money = 'صفر ليرة سورية'
  else if (int === 1) money = 'ليرة سورية واحدة'
  else if (int === 2) money = 'ليرتان سوريتان'
  else {
    // التمييز بالجزء الأخير: 3..10 جمع (ليرات) وما عداه مفرد (ليرة) — قاعدة 11..99 والمئات مفردة
    const r = int % 100
    const noun = r >= 3 && r <= 10 ? 'ليرات سورية' : 'ليرة سورية'
    money = `${tafqitWords(int)} ${noun}`
  }

  const centsPart = cents > 0 ? ` و${centsPhrase(cents)}` : ''
  return `${money}${centsPart} لا غير.`
}
