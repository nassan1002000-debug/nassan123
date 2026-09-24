// سجل التدقيق — كل حركة تُوثَّق (القسم 0 — القاعدة 7)
// ----------------------------------------------------------------------------
// التوقيع الحاكم: logAudit(client, data) — المعامل الأول عميل المعاملة (tx) أو
// العميل الحي (db)، فيُكتب سطر التدقيق **داخل المعاملة الذرية نفسها** التي أنشأت
// المستند؛ أي فشل يرجّع المستند وتوثيقه معاً ولا يبقى توثيق ليتيم بلا مستند.
//
// حقول data تطابق أعمدة جدول AuditLog حرفياً — لا حقول مخترعة:
//   action | entity | entityId | entityNumber | title | summary | details | amount
// (title و summary إلزاميان في المخطط — لا يجوز إغفالهما)

import type { Prisma } from '@prisma/client'

/** أي عميل Prisma يملك مفوّض auditLog — معاملة كانت أو العميل الحي */
type AuditClient = Pick<Prisma.TransactionClient, 'auditLog'>

// قوائم القيم المسموحة — تُستعمل كحارس ترشيح في GET /api/audit-log
// (مصفوفات لا كائنات: المستهلك ينادي .includes عليها)

/** الإجراءات المعتمدة — مطابقة لتعليق العمود في المخطط */
export const AUDIT_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'SYSTEM'] as const

/** الكيانات الموثَّقة — مقاسة من سجل التدقيق الحي (1,064 سطراً) */
export const AUDIT_ENTITIES = [
  'ADVANCE',
  'ATTENDANCE',
  'BONUS',
  'BUNDLE',
  'CLEARING',
  'COST_CENTER',
  'DAMAGE',
  'EMPLOYEE',
  'INVOICE',
  'ITEM',
  'JOURNAL',
  'LEAVE',
  'PARTNER',
  'PAYMENT',
  'PERIOD',
  'PERIOD_CLOSE',
  'SALARY',
  'SETTING',
  'STOCKTAKING',
  'SYSTEM',
  'USER',
  'ACCOUNT',
  'WAREHOUSE',
] as const

export interface AuditEntry {
  /** CREATE | UPDATE | DELETE | SYSTEM */
  action: string
  /** INVOICE | PAYMENT | JOURNAL | USER … */
  entity: string
  entityId?: string | null
  /** رقم المستند — يبقى محفوظاً حتى بعد حذف الفاتورة برقمها المحجوز */
  entityNumber?: string | null
  /** عنوان مختصر: «فاتورة مبيعات INV-0012» */
  title: string
  /** وصف عربي كامل للحركة */
  summary: string
  /** كائن بمفاتيح عربية — يُسلسل إلى JSON ويُعرض في نافذة التفاصيل */
  details?: unknown
  /** القيمة المالية الدالة إن وُجدت */
  amount?: number | null
}

/**
 * كتابة سطر تدقيق داخل معاملة المستند.
 *
 * لا تبتلع الأخطاء: فشل التوثيق يُرجّع المعاملة كاملة عمداً — سطر مفقود من سجل
 * التدقيق عطلٌ رقابي لا يقل عن فقدان المستند نفسه، والفشل الصامت هو ما جعل
 * السجل معطّلاً دون أن يلاحظ أحد.
 */
export async function logAudit(client: AuditClient, data: AuditEntry): Promise<void> {
  await client.auditLog.create({
    data: {
      action: data.action,
      entity: data.entity,
      entityId: data.entityId ?? null,
      entityNumber: data.entityNumber ?? null,
      title: data.title,
      summary: data.summary,
      details: data.details === undefined || data.details === null ? null : JSON.stringify(data.details),
      amount: typeof data.amount === 'number' && Number.isFinite(data.amount) ? data.amount : null,
    },
  })
}

/** تطبيع قيمة مالية للتوثيق — غير الرقمي يصبح صفراً */
export function auditMoney(val: unknown): number {
  const n = Number(val)
  return Number.isFinite(n) ? n : 0
}
