// منطق الخادم المشترك لقيود اليومية — التحقق من الصحة وتوليد رقم القيد
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { nextSequentialNumber, round2 } from '@/lib/math'

// round2 مصدرها math.ts — تُعاد تصديرها هنا لتبقى عقداً قائماً لمستهلكيها (invoice-journal وpayment-journal ومسار الترحيل)
export { round2 }

export const ENTRY_SOURCES = [
  'MANUAL',
  'SALES',
  'PURCHASE',
  'RECEIPT',
  'PAYMENT',
  'SALARY',
  'EXPENSE',
  'OPENING',
  'CLEARING', // سند المقاصة MC-xxxx — يُنشأ من /api/clearings حصراً (لا يُختار يدوياً من نموذج القيود)
] as const

export const ENTRY_STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'] as const

export interface ValidatedLine {
  accountId: string
  costCenterId: string | null
  debit: number
  credit: number
  description: string | null
}

export interface ValidatedEntry {
  date: Date
  description: string
  source: string
  status: 'DRAFT' | 'POSTED'
  lines: ValidatedLine[]
  totalDebit: number
  totalCredit: number
}

export type ValidationResult =
  | { ok: true; data: ValidatedEntry }
  | { ok: false; error: string }

export const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

/**
 * التحقق الشامل من بيانات القيد (إنشاء/تعديل):
 * البيان والتاريخ مطلوبان، بندين على الأقل، كل بند بحساب موجود وطرف واحد فقط،
 * والتوازن: |Σمدين - Σدائن| < 0.01
 */
export async function validateEntryBody(body: unknown): Promise<ValidationResult> {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'بيانات الطلب غير صالحة' }
  }
  const b = body as Record<string, unknown>

  const description = typeof b.description === 'string' ? b.description.trim() : ''
  if (!description) return { ok: false, error: 'بيان القيد مطلوب' }

  if (!b.date) return { ok: false, error: 'تاريخ القيد مطلوب' }
  const date = new Date(String(b.date))
  if (Number.isNaN(date.getTime())) return { ok: false, error: 'تاريخ القيد غير صالح' }

  const status: 'DRAFT' | 'POSTED' = b.status === 'POSTED' ? 'POSTED' : 'DRAFT'
  const source =
    typeof b.source === 'string' && (ENTRY_SOURCES as readonly string[]).includes(b.source)
      ? b.source
      : 'MANUAL'

  if (!Array.isArray(b.lines) || b.lines.length < 2) {
    return { ok: false, error: 'يجب أن يحتوي القيد على بندين على الأقل' }
  }

  const lines: ValidatedLine[] = []
  for (let i = 0; i < b.lines.length; i++) {
    const raw = b.lines[i] as Record<string, unknown>
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: `البند ${i + 1}: بيانات غير صالحة` }
    }
    const accountId = typeof raw.accountId === 'string' ? raw.accountId.trim() : ''
    if (!accountId) return { ok: false, error: `البند ${i + 1}: الحساب مطلوب` }

    const debit = round2(Number(raw.debit ?? 0))
    const credit = round2(Number(raw.credit ?? 0))
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
      return { ok: false, error: `البند ${i + 1}: المبالغ يجب أن تكون أرقاماً موجبة` }
    }
    if (debit === 0 && credit === 0) {
      return { ok: false, error: `البند ${i + 1}: يجب إدخال مبلغ في المدين أو الدائن` }
    }
    if (debit > 0 && credit > 0) {
      return { ok: false, error: `البند ${i + 1}: لا يمكن إدخال مبالغ في المدين والدائن معاً` }
    }
    lines.push({
      accountId,
      costCenterId:
        typeof raw.costCenterId === 'string' && raw.costCenterId.trim() ? raw.costCenterId.trim() : null,
      debit,
      credit,
      description: typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : null,
    })
  }

  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0))
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0))
  if (Math.abs(totalDebit - totalCredit) >= 0.01) {
    return {
      ok: false,
      error: `القيد غير متوازن: المدين ${fmt(totalDebit)} والدائن ${fmt(totalCredit)}`,
    }
  }

  // تحقق من وجود الحسابات + صلاحيتها للترحيل اليدوي المباشر
  const accountIds = [...new Set(lines.map((l) => l.accountId))]
  const foundAccounts = await db.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, code: true, name: true, isSystem: true, _count: { select: { children: true } } },
  })
  if (foundAccounts.length !== accountIds.length) {
    return { ok: false, error: 'أحد الحسابات المحددة غير موجود في دليل الحسابات' }
  }

  // حسابات التحكم مقدسة (القسم 0 البند 8): هذا المسار (POST/PUT /api/journal)
  // هو شاشة القيود اليومية اليدوية حصراً — كل قيد نظامي (فاتورة/سند/جرد/تلف/
  // إقفال فترة) يُنشأ مباشرة عبر Prisma في وحدته الخاصة ولا يمر من هنا أبداً.
  // فلا قيد يدوي على حساب تجميعي (له حسابات فرعية — الترحيل يكون على الفرع
  // المحدد لا على أبيه) ولا على حساب نظامي محجوز (isSystem) — رصيدهما يتحدث
  // حصراً من مستنداتهما الآلية.
  const blocked = foundAccounts.filter((a) => a._count.children > 0 || a.isSystem)
  if (blocked.length > 0) {
    const reasons = blocked.map((a) => {
      const why = a._count.children > 0 ? 'حساب تجميعي له حسابات فرعية' : 'حساب تحكم نظامي محجوز'
      return `${a.code} ${a.name} (${why})`
    })
    return {
      ok: false,
      error:
        `لا يمكن الترحيل اليدوي المباشر على: ${reasons.join('، ')} — رصيدها يتحدث حصراً من ` +
        `مستنداتها النظامية (فواتير/سندات/جرد/تلف/إقفال الفترة). اختر حساباً فرعياً محدداً بدلاً منه`,
    }
  }

  // تحقق من مراكز التكلفة إن وُجدت
  const costCenterIds = [...new Set(lines.map((l) => l.costCenterId).filter((v): v is string => !!v))]
  if (costCenterIds.length > 0) {
    const foundCCs = await db.costCenter.findMany({
      where: { id: { in: costCenterIds } },
      select: { id: true },
    })
    if (foundCCs.length !== costCenterIds.length) {
      return { ok: false, error: 'أحد مراكز التكلفة المحددة غير موجود' }
    }
  }

  return { ok: true, data: { date, description, source, status, lines, totalDebit, totalCredit } }
}

/**
 * توليد رقم القيد التالي JE-XXXX — مستقلة عن أي واجهة خارجية.
 * تعمل مع معاملة Prisma (tx) أو مع العميل db مباشرة.
 */
export async function nextEntryNumber(
  client: Pick<Prisma.TransactionClient, 'journalEntry'> = db,
): Promise<string> {
  const rows = await client.journalEntry.findMany({
    where: { number: { startsWith: 'JE-' } },
    select: { number: true },
  })
  return nextSequentialNumber(
    'JE-',
    rows.map((r) => r.number),
  )
}
