// منطق الخادم المشترك لسندات القبض والدفع — التحقق من الصحة وتوليد رقم السند
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { nextSequentialNumber } from '@/lib/math'
import { getSequenceFloor } from '@/lib/period-doc-rotation'

export const PAYMENT_TYPES = ['RECEIPT', 'PAYMENT'] as const
export const PAYMENT_METHODS = ['CASH', 'BANK', 'CHEQUE'] as const

type Tx = Prisma.TransactionClient | Pick<typeof db, 'payment' | 'setting'>

/** الرقم التالي VCH-0009 — أعلى رقم موجود عددياً لا معجمياً (المتتالية مشتركة بين القبض والدفع) */
export async function nextPaymentNumber(tx?: Tx): Promise<string> {
  const client = tx ?? db
  // P2-3: فلترة البادئة بدل مسح جدول السندات كاملاً — nextSequentialNumber يعمل بنفس المنطق حرفياً
  const rows = await client.payment.findMany({
    where: { number: { startsWith: 'VCH-' } },
    select: { number: true },
  })
  // الأرضية: أعلى رقم دُوّر إلى أرشيف الفترة المغلقة — رقم سند دُوّر لا يُعاد أبداً
  const floor = await getSequenceFloor(client, 'VCH-')
  return nextSequentialNumber(
    'VCH-',
    rows.map((r) => r.number),
    4,
    floor,
  )
}

export interface ValidatedPayment {
  type: string
  date: Date
  amount: number
  method: string
  partnerId: string | null
  accountId: string | null // وضع المصروف: حساب من الدليل بدل الطرف — حصريان (Task 102)
  invoiceId: string | null
  notes: string | null
}

/** تحقق كامل من جسم الطلب — ترجع data عند النجاح أو error برسالة عربية */
export async function validatePaymentBody(
  body: unknown,
): Promise<{ ok: true; data: ValidatedPayment } | { ok: false; error: string }> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'بيانات غير صالحة' }
  const b = body as Record<string, unknown>

  const type = String(b.type ?? '')
  if (!(PAYMENT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: 'نوع السند غير صالح (قبض أو دفع)' }
  }

  const method = String(b.method ?? '')
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
    return { ok: false, error: 'طريقة الدفع غير صالحة (نقدية / بنك / شيك)' }
  }

  const dateStr = String(b.date ?? '')
  const date = new Date(dateStr)
  if (!dateStr || Number.isNaN(date.getTime())) {
    return { ok: false, error: 'التاريخ غير صالح' }
  }

  const amount = Number(b.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'المبلغ يجب أن يكون رقماً أكبر من صفر' }
  }
  if (amount > 1_000_000_000) {
    return { ok: false, error: 'المبلغ كبير جداً — تحقق من الرقم' }
  }

  let partnerId: string | null = null
  const rawPartner = String(b.partnerId ?? '').trim()
  if (rawPartner) {
    const partner = await db.partner.findUnique({ where: { id: rawPartner }, select: { id: true } })
    if (!partner) return { ok: false, error: 'الطرف المحدد غير موجود' }
    partnerId = rawPartner
  }

  // Task 102/104 — وضع الحساب: سند مُقيَّد على حساب من الدليل بدلاً من طرف
  // حصريان: طرف ⊕ حساب — لا يجتمعان أبداً. نوعان للوضع:
  //  • حساب مصروف (5xxx): سند دفع حصراً — الشيك مرفوض (المصروف لا يُقيَّد فوراً بالشيك)
  //  • حساب موظف شخصي (فرعي تحت 1150 ومرتبط بملف موظف): قبض ودفع — والشيك مسموح
  //    (يبقى على ذمة الموظف حتى الصرف بنفس منطق سندات الأطراف)
  let accountId: string | null = null
  const rawAccount = String(b.accountId ?? '').trim()
  if (rawAccount) {
    if (rawPartner) {
      return { ok: false, error: 'اختر طرفاً أو حساباً من الدليل — لا يمكن الجمع بينهما في سند واحد' }
    }
    const account = await db.account.findUnique({
      where: { id: rawAccount },
      select: {
        id: true,
        type: true,
        isActive: true,
        parentId: true,
        employee: { select: { id: true, isActive: true } },
      },
    })
    if (!account) return { ok: false, error: 'الحساب المحدد غير موجود في الدليل' }
    if (!account.isActive) return { ok: false, error: 'الحساب المحدد موقوف — اختر حساباً نشطاً' }

    if (account.employee) {
      // وضع حساب الموظف — يدعم القبض (ردّ موظف) والدفع (صرف لحساب الموظف)
      if (!account.employee.isActive) {
        return { ok: false, error: 'الموظف المرتبط بهذا الحساب موقوف — فعّل ملف الموظف أولاً' }
      }
    } else {
      if (type === 'RECEIPT') {
        return {
          ok: false,
          error: 'حسابات المصروف مدعومة في سندات الدفع فقط — سند القبض يُقيَّد على طرف أو على حساب موظف',
        }
      }
      if (account.type !== 'EXPENSE') {
        return { ok: false, error: 'الحساب المحدد ليس حساب مصروف ولا حساب موظف — اختر حساباً من دليل الحسابات' }
      }
      if (!account.parentId) {
        return { ok: false, error: 'لا يمكن القيد على حساب المجموعة الرئيسي — اختر حساب مصروف فرعي' }
      }
      if (method === 'CHEQUE') {
        return {
          ok: false,
          error: 'مصروف بشيك لا يُقيَّد فوراً — اختر نقدياً أو بنك، أو سجّل المصروف بقيد يدوي عند صرف الشيك',
        }
      }
    }
    accountId = rawAccount
  }

  const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 500) || null : null

  return {
    ok: true,
    data: { type, date, amount, method, partnerId, accountId, invoiceId: null, notes },
  }
}

