// منطق الخادم المشترك لملفات العملاء والموردين — التحقق + توليد الكود + حساب الأرصدة
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { round2 } from '@/lib/math'

const PARTNER_TYPES = ['CUSTOMER', 'SUPPLIER'] as const

export function isPrismaError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError
}

/** رسالة عربية دقيقة جاهزة لانتهاك الفريدية على حقل Partner */
export function partnerUniqueTarget(error: Prisma.PrismaClientKnownRequestError): string | null {
  if (error.code !== 'P2002') return null
  const target = Array.isArray(error.meta?.target) ? (error.meta?.target as string[]).join(',') : ''
  if (target.includes('accountId'))
    return 'هذا الحساب مرتبط بملف آخر بنفس الدور (عميل أو مورد) — اختر حساباً آخر أو دوراً مختلفاً'
  if (target.includes('code')) return 'كود الطرف مستخدم مسبقاً'
  return 'قيمة مكررة مستخدمة مسبقاً'
}

/** هل الاصطدام على كود الطرف فقط (يُعاد المحاولة تلقائياً) — لا يُعاد المحاولة على اصطدام الحساب */
export function isPartnerCodeCollision(error: Prisma.PrismaClientKnownRequestError): boolean {
  if (error.code !== 'P2002') return false
  const target = Array.isArray(error.meta?.target) ? (error.meta?.target as string[]) : []
  return target.includes('code') && !target.includes('accountId')
}

/**
 * الكود التالي حسب النوع — C-004 / S-003 — أعلى رقم موجود عددياً (لا معجمياً)
 * المتتالية مستقلة لكل نوع
 */
export async function nextPartnerCode(type: string, tx?: Prisma.TransactionClient): Promise<string> {
  const client = tx ?? db
  const prefix = type === 'SUPPLIER' ? 'S' : 'C'
  const rows = await client.partner.findMany({
    where: { code: { startsWith: `${prefix}-` } },
    select: { code: true },
  })
  let max = 0
  for (const r of rows) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(r.code)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`
}

export interface ValidatedPartner {
  type: string
  name: string
  phone: string | null
  address: string | null
  notes: string | null
  isActive: boolean
  /** تعدد الأدوار — ربط الملف بحساب موجود من الشجرة بدل إنشاء حساب جديد (اختياري) */
  accountId: string | null
}

/** تحقق كامل من جسم الطلب — يفحص النوع والاسم والهاتف والعنوان والملاحظات */
export async function validatePartnerBody(
  body: unknown,
  opts: { requireAll: boolean; currentId?: string },
): Promise<{ ok: true; data: ValidatedPartner } | { ok: false; error: string }> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'بيانات غير صالحة' }
  const b = body as Record<string, unknown>

  // النوع — عند التعديل يُتجاهل غيابه (لا يتغير النوع صمتاً)
  const rawType = b.type === undefined || b.type === null ? '' : String(b.type)
  if (rawType || opts.requireAll) {
    if (!(PARTNER_TYPES as readonly string[]).includes(rawType)) {
      return { ok: false, error: 'نوع الطرف غير صالح (عميل أو مورد)' }
    }
  }

  // الاسم — إلزامي دائماً
  const name = String(b.name ?? '').trim().replace(/\s+/g, ' ')
  if (!name) return { ok: false, error: 'اسم الطرف إلزامي' }
  if (name.length < 2) return { ok: false, error: 'اسم الطرف قصير جداً — حرفان على الأقل' }
  if (name.length > 120) return { ok: false, error: 'اسم الطرف طويل جداً — 120 حرفاً كحد أقصى' }

  // الاسم مكرر لنفس النوع؟ (الشركات قد تتشابه، لذا نحذر فقط عبر الكود الفريد — الاسم يبقى حراً)

  // الهاتف — اختياري بأرقام ومسافات ورموز + - فقط
  let phone: string | null = null
  const rawPhone = String(b.phone ?? '').trim()
  if (rawPhone) {
    if (!/^[0-9+\-\s()]{5,20}$/.test(rawPhone)) {
      return { ok: false, error: 'رقم الهاتف غير صالح — أرقام ورموز + - والمسافات فقط (5 إلى 20 خانة)' }
    }
    phone = rawPhone
  }

  const address = String(b.address ?? '').trim().slice(0, 200) || null
  const notes = String(b.notes ?? '').trim().slice(0, 500) || null
  const isActive = b.isActive === undefined ? true : Boolean(b.isActive)

  // الحساب الموجود — اختياري: ربط الطرف بحساب من الشجرة (مثل حساب موظف ليصبح عميلاً على حسابه نفسه)
  const accountId = String(b.accountId ?? '').trim() || null

  return {
    ok: true,
    data: {
      type: rawType || 'CUSTOMER',
      name,
      phone,
      address,
      notes,
      isActive,
      accountId,
    },
  }
}

export interface PartnerStats {
  invoicesCount: number
  invoicesTotal: number
  invoicesPaid: number
  vouchersCount: number
  vouchersTotal: number
  /** الرصيد الصافي: الفواتير − المسدد ضمنها − السندات المستقلة (غير المرتبطة بفاتورة) */
  balance: number
}

/**
 * إحصاءات طرف واحدة — استعلامان مجمّعان
 * المبدأ المحاسبي: الفاتورة تحمل ما سُدد ضمنها (paid)، والسند غير المرتبط بفاتورة يسدد الحساب العام
 * — لا عدّ مزدوج: السند المرتبط بفاتورة لا يُحسب مستقلاً
 * openingNet: الرصيد الافتتاحي المرحّل بسند القيد الافتتاحي بعد تدوير مستندات الفترة
 * المغلقة (بمصطلحات رصيد الطرف: موجب = مدين للعميل / دائن ملك المورد) — صفر إن لم يوجد
 */
export async function computePartnerStats(
  partnerId: string,
  type: string,
  openingNet = 0,
): Promise<PartnerStats> {
  const invoiceType = type === 'SUPPLIER' ? 'PURCHASE' : 'SALE'
  const voucherType = type === 'SUPPLIER' ? 'PAYMENT' : 'RECEIPT'

  const [invAgg, vchAgg] = await Promise.all([
    db.invoice.aggregate({
      where: { partnerId, type: invoiceType, isDeleted: false }, // المحذوفة (xx) خارج الأرصدة
      _count: { _all: true },
      _sum: { total: true, paid: true },
    }),
    db.payment.aggregate({
      where: { partnerId, type: voucherType, invoiceId: null },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ])

  const invoicesTotal = invAgg._sum.total ?? 0
  const invoicesPaid = invAgg._sum.paid ?? 0
  const vouchersTotal = vchAgg._sum.amount ?? 0

  return {
    invoicesCount: invAgg._count._all,
    invoicesTotal,
    invoicesPaid,
    vouchersCount: vchAgg._count._all,
    vouchersTotal,
    balance: round2(invoicesTotal - invoicesPaid - vouchersTotal + openingNet),
  }
}
