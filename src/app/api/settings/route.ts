import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { requireApiSession, ADMIN_ONLY_MESSAGE } from '@/lib/api-guard'
import { getSessionUser } from '@/lib/auth-server'
import { SESSION_COOKIE } from '@/lib/session'
import { normalizeLayoutValue } from '@/lib/print-template'
import { resolveCustomBackupDir } from '@/lib/backup-server'

export const dynamic = 'force-dynamic'

/** الإعدادات الافتراضية — تظهر إن غابت عن القاعدة (البذرة تكتبها أصلاً)
 *  printSubtitle هنا عمداً: صفه ضاع مع كارثة الاستعادة المتجمدة وغيابه يجعل
 *  normalize يقرأه فارغاً فيختفي سطر النظام من كل المطبوعات (Task 29) */
const DEFAULTS: Record<string, string> = {
  exchangeRate: '130',
  decimalPlaces: '2',
  printSubtitle: 'نظام المحاسبة والمخزون',
}

/** الحد الأقصى لحجم الشعار (data URL بالمحارف) — متزامن مع MAX_LOGO_LENGTH في company.ts */
const MAX_LOGO_LENGTH = 200_000

/** المفاتيح المقبولة في PUT مع تسمياتها العربية — أي مفتاح آخر يُرفض «إعداد غير معروف» */
const KNOWN_SETTINGS: Record<string, string> = {
  exchangeRate: 'سعر الصرف (ل.س لكل دولار)',
  decimalPlaces: 'الخانات العشرية للمبالغ',
  numeralMode: 'نمط عرض الأرقام',
  companyName: 'اسم الشركة',
  companyPhone: 'هاتف الشركة',
  companyAddress: 'عنوان الشركة',
  companyEmail: 'بريد الشركة الإلكتروني',
  companyLogo: 'شعار الشركة',
  // قالب الطباعة الموحد (Task 26) — الترويسة والتواقيع القابلة للتخصيص
  printSubtitle: 'سطر النظام في الترويسة',
  printLogoPosition: 'موضع الشعار في الطباعة',
  printLogoScale: 'حجم الشعار (نسبة مئوية)',
  printTextScale: 'حجم نصوص الترويسة (نسبة مئوية)',
  printHeaderGap: 'المسافة بين عناصر الترويسة (بكسل)',
  printHeaderPadding: 'الهامش السفلي للترويسة (بكسل)',
  printSignAccountant: 'مسمى توقيع المحاسب',
  printSignAccountantName: 'اسم توقيع المحاسب',
  printSignAccountantVisible: 'إظهار توقيع المحاسب',
  printSignManager: 'مسمى توقيع المدير المالي',
  printSignManagerName: 'اسم توقيع المدير المالي',
  printSignManagerVisible: 'إظهار توقيع المدير المالي',
  printPageNumbers: 'ترقيم الصفحات في الطباعة',
  printHeaderLayout: 'التخطيط الحر للترويسة (السحب والإفلات)',
  // النسخ الاحتياطي (P1-7) — مسار إضافي اختياري يُنسخ إليه كل نسخة يدوية بعد db/backups
  backupCustomDir: 'مسار حفظ نسخة إضافية من النسخ الاحتياطية',
}

/** تسمية عربية لقيم نمط الأرقام — تظهر في سجل التدقيق بدل latin/arabic الخام */
const NUMERAL_LABELS: Record<string, string> = {
  latin: 'لاتينية (012)',
  arabic: 'عربية (٠١٢)',
}

/** تسميات موضع الشعار في سجل التدقيق */
const LOGO_POSITION_LABELS: Record<string, string> = {
  right: 'يمين',
  center: 'وسط',
  left: 'يسار',
}

/** تسميات الخانات العشرية في سجل التدقيق */
const DECIMAL_LABELS: Record<string, string> = {
  '0': 'بدون (100)',
  '1': 'منزلة واحدة (100.1)',
  '2': 'منزلتان (100.01)',
}

/** بناء كائن الإعدادات الكامل { key: value } مع سدّ الفجوات بالافتراضيات */
async function loadSettings(): Promise<Record<string, string>> {
  const rows = await db.setting.findMany()
  const settings: Record<string, string> = { ...DEFAULTS }
  for (const row of rows) settings[row.key] = row.value
  return settings
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 })
}

/** قيمة جاهزة للعرض في سجل التدقيق — الفارغ «بدون» والأنماط بأسمائها العربية */
function auditValue(key: string, value: string): string {
  if (value === '') return 'بدون'
  if (key === 'numeralMode') return NUMERAL_LABELS[value] ?? value
  if (key === 'decimalPlaces') return DECIMAL_LABELS[value] ?? value
  if (key === 'companyLogo') return 'شعار مرفوع'
  if (key === 'printLogoPosition') return LOGO_POSITION_LABELS[value] ?? value
  if (key === 'printLogoScale' || key === 'printTextScale') return `${value}%`
  if (key === 'printHeaderGap' || key === 'printHeaderPadding') return `${value}px`
  if (key === 'printPageNumbers') return value === 'false' ? 'معطّل' : 'مفعّل'
  if (key === 'printHeaderLayout') {
    // ملخص عربي مختصر للسجل — التفاصيل (الإحداثيات) كبيرة فلا تُكتب كاملة
    try {
      const o = JSON.parse(value) as { enabled?: boolean; height?: number }
      return `${o.enabled ? 'مفعّل' : 'معطّل'} — خط الفصل ${o.height ?? '?'}px`
    } catch {
      return 'قيمة غير مفهومة'
    }
  }
  if (key === 'printSignAccountantVisible' || key === 'printSignManagerVisible') {
    return value === 'false' ? 'مخفي' : 'ظاهر'
  }
  return value
}

// GET /api/settings — كل الإعدادات ككائن { [key]: value } مع default لسعر الصرف
// ?stats=1 يضيف كائن stats بإحصاءات عامة (عدد السجلات) دون تغيير موضع مفاتيح الإعدادات
export async function GET(req: NextRequest) {
  try {
    const settings = await loadSettings()
    if (req.nextUrl.searchParams.get('stats') !== '1') {
      return NextResponse.json(settings)
    }
    const [invoices, journalEntries, items, partners, employees, users] = await Promise.all([
      db.invoice.count({ where: { isDeleted: false } }),
      db.journalEntry.count(),
      db.item.count(),
      db.partner.count(),
      db.employee.count(),
      db.user.count(),
    ])
    return NextResponse.json({
      ...settings,
      stats: { invoices, journalEntries, items, partners, employees, users },
    })
  } catch (error) {
    console.error('GET /api/settings error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب الإعدادات' }, { status: 500 })
  }
}

// PUT /api/settings — تحديث المفاتيح المعروفة (سعر الصرف/نمط الأرقام/بيانات الشركة)
// كل المفاتيح تُتحقق أولاً (فشل واحد يرفض الطلب كله) ثم تُحفظ وتُوثَّق التغييرات
// في سجل التدقيق داخل المعاملة نفسها (قاعدة المشروع): إن فشل التسجيل فشل الحفظ
export async function PUT(req: NextRequest) {
  try {
    // الحرس (P0-4): جلسة إلزامية — ومفاتيح هوية الشركة للمدير فقط
    const denied = await requireApiSession(req)
    if (denied) return denied

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return badRequest('بيانات غير صالحة')
    }
    const b = body as Record<string, unknown>

    const COMPANY_KEYS = new Set(['companyName', 'companyPhone', 'companyAddress', 'companyEmail', 'companyLogo'])
    // مفاتيح قالب الطباعة تؤثر على مستندات الشركة كلها — للمدير فقط كبيانات الهوية
    const PRINT_KEYS = new Set([
      'printSubtitle',
      'printLogoPosition',
      'printLogoScale',
      'printTextScale',
      'printHeaderGap',
      'printHeaderPadding',
      'printSignAccountant',
      'printSignAccountantName',
      'printSignAccountantVisible',
      'printSignManager',
      'printSignManagerName',
      'printSignManagerVisible',
      'printPageNumbers',
      'printHeaderLayout',
    ])
    // مسار النسخ الاحتياطي المخصص — للمدير فقط كباقي إعدادات النظام الحساسة
    const SYSTEM_KEYS = new Set(['backupCustomDir'])
    const touchesCompany = Object.keys(b).some(
      (k) => COMPANY_KEYS.has(k) || PRINT_KEYS.has(k) || SYSTEM_KEYS.has(k),
    )
    if (touchesCompany) {
      const me = await getSessionUser(req.cookies.get(SESSION_COOKIE)?.value)
      if (!me || me.role !== 'ADMIN') {
        return NextResponse.json({ error: ADMIN_ONLY_MESSAGE }, { status: 403 })
      }
    }

    // التحقق من كل المفاتيح وجمع القيم النهائية المقرر حفظها
    const planned: { key: string; value: string }[] = []
    for (const key of Object.keys(b)) {
      if (!KNOWN_SETTINGS[key]) {
        return badRequest(`إعداد غير معروف: ${key}`)
      }
      const raw = b[key]
      switch (key) {
        case 'exchangeRate': {
          const rate = Number(raw)
          if (!Number.isFinite(rate) || rate < 1 || rate > 1_000_000) {
            return badRequest('سعر الصرف يجب أن يكون رقماً بين 1 و 1,000,000')
          }
          planned.push({ key, value: String(rate) })
          break
        }
        case 'numeralMode': {
          if (raw !== 'latin' && raw !== 'arabic') {
            return badRequest('نمط الأرقام يجب أن يكون «latin» أو «arabic»')
          }
          planned.push({ key, value: raw })
          break
        }
        case 'decimalPlaces': {
          // تُقبل قيمة رقمية أو نصية من الواجهة — تُطبَّع إلى نص
          const s = String(raw)
          if (s !== '0' && s !== '1' && s !== '2') {
            return badRequest('الخانات العشرية يجب أن تكون 0 أو 1 أو 2')
          }
          planned.push({ key, value: s })
          break
        }
        case 'companyLogo': {
          if (typeof raw !== 'string') {
            return badRequest('شعار الشركة يجب أن يكون صورة بصيغة data URL')
          }
          const v = raw.trim()
          // الفارغ مسموح (إزالة الشعار) — ووجوده يستلزم data:image/ صحيح داخل الحد المسموح
          if (v && (!v.startsWith('data:image/') || v.length > MAX_LOGO_LENGTH)) {
            return badRequest('شعار الشركة غير صالح — يجب أن يكون صورة data:image/ بحجم لا يتجاوز 200KB')
          }
          planned.push({ key, value: v })
          break
        }
        case 'companyName': {
          if (typeof raw !== 'string') {
            return badRequest('اسم الشركة يجب أن يكون نصاً بين 2 و 80 حرفاً')
          }
          const v = raw.trim()
          if (v.length < 2 || v.length > 80) {
            return badRequest('اسم الشركة يجب أن يكون بين 2 و 80 حرفاً')
          }
          planned.push({ key, value: v })
          break
        }
        case 'companyPhone': {
          if (typeof raw !== 'string') {
            return badRequest('هاتف الشركة يجب أن يكون نصاً بحد أقصى 30 محرفاً')
          }
          const v = raw.trim()
          if (v.length > 30) {
            return badRequest('هاتف الشركة يجب ألا يتجاوز 30 محرفاً')
          }
          planned.push({ key, value: v })
          break
        }
        case 'companyAddress': {
          if (typeof raw !== 'string') {
            return badRequest('عنوان الشركة يجب أن يكون نصاً بحد أقصى 120 محرفاً')
          }
          const v = raw.trim()
          if (v.length > 120) {
            return badRequest('عنوان الشركة يجب ألا يتجاوز 120 محرفاً')
          }
          planned.push({ key, value: v })
          break
        }
        case 'companyEmail': {
          if (typeof raw !== 'string') {
            return badRequest('بريد الشركة يجب أن يكون نصاً بحد أقصى 80 محرفاً')
          }
          const v = raw.trim()
          if (v.length > 80) {
            return badRequest('بريد الشركة يجب ألا يتجاوز 80 محرفاً')
          }
          if (v && !v.includes('@')) {
            return badRequest('البريد الإلكتروني غير صالح — يجب أن يحتوي على @')
          }
          planned.push({ key, value: v })
          break
        }
        case 'printSubtitle': {
          if (typeof raw !== 'string') {
            return badRequest('سطر النظام يجب أن يكون نصاً بحد أقصى 60 محرفاً')
          }
          const v = raw.trim()
          if (v.length > 60) {
            return badRequest('سطر النظام يجب ألا يتجاوز 60 محرفاً')
          }
          planned.push({ key, value: v })
          break
        }
        case 'printLogoPosition': {
          if (raw !== 'right' && raw !== 'center' && raw !== 'left') {
            return badRequest('موضع الشعار يجب أن يكون right أو center أو left')
          }
          planned.push({ key, value: raw })
          break
        }
        case 'printLogoScale': {
          const scale = Number(raw)
          if (!Number.isInteger(scale) || scale < 60 || scale > 160) {
            return badRequest('حجم الشعار يجب أن يكون نسبة صحيحة بين 60% و 160%')
          }
          planned.push({ key, value: String(scale) })
          break
        }
        case 'printTextScale': {
          const scale = Number(raw)
          if (!Number.isInteger(scale) || scale < 60 || scale > 160) {
            return badRequest('حجم نصوص الترويسة يجب أن يكون نسبة صحيحة بين 60% و 160%')
          }
          planned.push({ key, value: String(scale) })
          break
        }
        case 'printHeaderGap': {
          const gap = Number(raw)
          if (!Number.isInteger(gap) || gap < 0 || gap > 40) {
            return badRequest('المسافة بين عناصر الترويسة يجب أن تكون رقماً صحيحاً بين 0 و 40 بكسل')
          }
          planned.push({ key, value: String(gap) })
          break
        }
        case 'printHeaderPadding': {
          const pad = Number(raw)
          if (!Number.isInteger(pad) || pad < 0 || pad > 30) {
            return badRequest('الهامش السفلي للترويسة يجب أن يكون رقماً صحيحاً بين 0 و 30 بكسل')
          }
          planned.push({ key, value: String(pad) })
          break
        }
        case 'printSignAccountant':
        case 'printSignManager': {
          if (typeof raw !== 'string') {
            return badRequest('مسمى التوقيع يجب أن يكون نصاً بين 1 و 40 محرفاً')
          }
          const v = raw.trim()
          if (v.length < 1 || v.length > 40) {
            return badRequest('مسمى التوقيع يجب أن يكون بين 1 و 40 محرفاً')
          }
          planned.push({ key, value: v })
          break
        }
        case 'printSignAccountantName':
        case 'printSignManagerName': {
          if (typeof raw !== 'string') {
            return badRequest('اسم التوقيع يجب أن يكون نصاً بحد أقصى 60 محرفاً')
          }
          const v = raw.trim()
          if (v.length > 60) {
            return badRequest('اسم التوقيع يجب ألا يتجاوز 60 محرفاً')
          }
          planned.push({ key, value: v })
          break
        }
        case 'printSignAccountantVisible':
        case 'printSignManagerVisible':
        case 'printPageNumbers': {
          if (raw !== true && raw !== false && raw !== 'true' && raw !== 'false') {
            return badRequest('قيمة الإظهار يجب أن تكون true أو false')
          }
          planned.push({ key, value: String(raw) })
          break
        }
        case 'printHeaderLayout': {
          // التخطيط الحر (Task 29): JSON واحد للترويسة كلها — يُطبَّع ويعاد تسلسله قننياً
          if (typeof raw !== 'string') {
            return badRequest('تخطيط الترويسة يجب أن يكون نص JSON')
          }
          if (raw.length > 4000) {
            return badRequest('تخطيط الترويسة أكبر من الحد المسموح')
          }
          const normalized = normalizeLayoutValue(raw)
          if (!normalized) {
            return badRequest('تخطيط الترويسة غير صالح — بنية JSON غير معروفة')
          }
          planned.push({ key, value: JSON.stringify(normalized) })
          break
        }
        case 'backupCustomDir': {
          if (typeof raw !== 'string') {
            return badRequest('مسار حفظ النسخ الاحتياطية يجب أن يكون نصاً')
          }
          const v = raw.trim()
          if (v) {
            try {
              resolveCustomBackupDir(v)
            } catch (error) {
              return badRequest(error instanceof Error ? error.message : 'مسار غير صالح')
            }
          }
          planned.push({ key, value: v })
          break
        }
      }
    }

    // الحفظ + التوثيق داخل معاملة واحدة — التغييرات فقط (القيم المطابقة تُتخطى)
    await db.$transaction(async (tx) => {
      const rows = await tx.setting.findMany()
      const current: Record<string, string> = { ...DEFAULTS }
      for (const row of rows) current[row.key] = row.value

      const changed: { key: string; before: string; after: string }[] = []
      for (const { key, value } of planned) {
        const before = current[key] ?? ''
        if (before === value) continue
        await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
        changed.push({ key, before, after: value })
      }

      if (changed.length > 0) {
        const details: Record<string, Record<string, string>> = {}
        for (const { key, before, after } of changed) {
          details[KNOWN_SETTINGS[key] ?? key] = {
            'قبل': auditValue(key, before),
            'بعد': auditValue(key, after),
          }
        }
        await logAudit(tx, {
          action: 'UPDATE',
          entity: 'SETTING',
          entityId: null,
          entityNumber: null,
          title: 'تعديل الإعدادات العامة',
          summary: `تحديث الإعدادات: ${changed.map((c) => KNOWN_SETTINGS[c.key] ?? c.key).join('، ')}`,
          details,
        })
      }
      return changed.length
    })

    const settings = await loadSettings()
    return NextResponse.json(settings)
  } catch (error) {
    console.error('PUT /api/settings error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حفظ الإعدادات' }, { status: 500 })
  }
}
