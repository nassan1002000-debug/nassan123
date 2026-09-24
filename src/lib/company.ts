// بيانات الشركة لرأس الطباعة (الاسم/الهاتف/العنوان/البريد/الشعار)
// تُجلب من GET /api/settings وتُخزن في localStorage (مفتاح companyInfo) لتبقى متاحة
// متزامنةً للطباعة الفورية — getCachedCompanyInfo() تقرأ الكاش بلا انتظار الشبكة

export interface CompanyInfo {
  companyName: string
  companyPhone: string
  companyAddress: string
  companyEmail: string
  /** شعار الشركة بصيغة data URL (data:image/...) — الفارغ يعني بلا شعار */
  companyLogo: string
}

const COMPANY_INFO_KEY = 'companyInfo'

/** الحد الأقصى لحجم الشعار المحفوظ (data URL بالمحارف) — ~200KB */
export const MAX_LOGO_LENGTH = 200_000

/** الافتراضيات — اسم الشركة كما كان ثابتاً في رأس الطباعة قبل إضافة الإعدادات */
export const DEFAULT_COMPANY_INFO: CompanyInfo = {
  companyName: 'شركة الأمل التجارية 2026',
  companyPhone: '',
  companyAddress: '',
  companyEmail: '',
  companyLogo: '',
}

/** تطبيع بيانات غير موثوقة (من الخادم أو الكاش) إلى CompanyInfo سليمة */
function normalize(raw: Partial<Record<keyof CompanyInfo, unknown>> | null): CompanyInfo {
  const name =
    typeof raw?.companyName === 'string' && raw.companyName.trim()
      ? raw.companyName
      : DEFAULT_COMPANY_INFO.companyName
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  // الشعار: يقبل فقط data URL صحيح الصيغة وداخل الحد — وإلا يُهمل (بلا شعار)
  const logo = str(raw?.companyLogo)
  const validLogo =
    logo.startsWith('data:image/') && logo.length <= MAX_LOGO_LENGTH ? logo : ''
  return {
    companyName: name,
    companyPhone: str(raw?.companyPhone),
    companyAddress: str(raw?.companyAddress),
    companyEmail: str(raw?.companyEmail),
    companyLogo: validLogo,
  }
}

/** قراءة الكاش المحلي — null خارج المتصفح أو عند تعذر القراءة */
function readCache(): CompanyInfo | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(COMPANY_INFO_KEY)
    if (!raw) return null
    return normalize(JSON.parse(raw) as Partial<CompanyInfo> | null)
  } catch {
    return null
  }
}

function writeCache(info: CompanyInfo): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(COMPANY_INFO_KEY, JSON.stringify(info))
  } catch {
    // التخزين قد يكون ممتلئاً أو محظوراً — تعمل الطباعة بالقيم الحالية عندها
  }
}

/**
 * جلب بيانات الشركة من الخادم وتخزينها محلياً — تعيد دائماً بيانات مضمونة
 * (عند الفشل: آخر كاش محلي ثم الافتراضيات) فتصلح لتحديث واجهات الإعدادات مباشرة
 */
export async function loadCompanyInfo(): Promise<CompanyInfo> {
  const fallback = readCache() ?? DEFAULT_COMPANY_INFO
  try {
    const res = await fetch('/api/settings')
    const data = (await res.json().catch(() => null)) as Partial<
      Record<keyof CompanyInfo, unknown>
    > | null
    if (!res.ok || !data) return fallback
    const info = normalize(data)
    writeCache(info)
    return info
  } catch {
    return fallback
  }
}

/** قراءة متزامنة من localStorage — للطباعة الفورية بلا انتظار الشبكة */
export function getCachedCompanyInfo(): CompanyInfo {
  return readCache() ?? DEFAULT_COMPANY_INFO
}
