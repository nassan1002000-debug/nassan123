// المزامنة الثنائية بين شجرة الحسابات وملفات الأطراف والموظفين — بطلب المستخدم
//
// المبدأ: كل عميل/مورد/موظف له حساب فرعي تحت حساب التحكم الخاص به:
//   العملاء   → تحت 1130 «العملاء (ذمم مدينة)»  — أصول مدينة
//   الموردون  → تحت 2110 «الموردون (ذمم دائنة)» — التزامات دائنة
//   الموظفون  → تحت 1150 «سلف الموظفين»         — أصول مدينة
// كود الحساب الفرعي = كود الأب + رقم تسلسلي خانتين (113001، 113002 …)
//
// الاتجاهان:
//   إنشاء/تعديل/حذف عميل أو مورد أو موظف ← يُنشأ/يُعدَّل/يُحذف حسابه في الشجرة
//   إنشاء حساب تحت حساب التحكم من الشجرة ← يُنشأ ملفه في الشاشة المعنية
//   تعديل/حذف الحساب من الشجرة ← يُعدَّل/يُحذف الملف المرتبط (مع حرس المستندات)

import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { INVOICE_ACCOUNTS } from '@/lib/invoice-journal'
import { nextPartnerCode } from '@/lib/partners-server'
import { nextEmployeeCode } from '@/lib/hr-server'

type Tx = Prisma.TransactionClient

/** أكواد حسابات التحكم — الأب الذي تتفرع منه ملفات الأطراف والموظفين */
export const CONTROL_PARENT_CODES = {
  CUSTOMER: INVOICE_ACCOUNTS.AR.code, // 1130
  SUPPLIER: INVOICE_ACCOUNTS.AP.code, // 2110
  EMPLOYEE: INVOICE_ACCOUNTS.ADVANCES.code, // 1150
} as const

/** حساب التحكم الافتراضي لملفات الشركاء (رأس المال) — لا مزامنة عكسية تلقائية له من الشجرة */
export const PARTNER_PARENT_CODE = '3100'

/** أنواع الملفات المرتبطة بحسابات — الشريك (رأس المال) يُعرض في الشجرة ولا يتولد تلقائياً */
export type LinkKind = 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE' | 'PARTNER'

/** تسميات عربية لنوع الحساب — تُستعمل في سجل التدقيق ووصف حركات الشجرة */
export const AR_ACCOUNT_TYPE: Record<string, string> = {
  ASSET: 'أصول',
  LIABILITY: 'التزامات',
  EQUITY: 'حقوق ملكية',
  REVENUE: 'إيرادات',
  EXPENSE: 'مصروفات',
}

/** تسميات عربية لطبيعة الحساب */
export const AR_ACCOUNT_NATURE: Record<string, string> = {
  DEBIT: 'مدينة',
  CREDIT: 'دائنة',
}

/** هل الكود أحد حسابات التحكم؟ وما نوع الملف الذي يتفرع عنه */
export function controlKindOfCode(code: string): LinkKind | null {
  if (code === CONTROL_PARENT_CODES.CUSTOMER) return 'CUSTOMER'
  if (code === CONTROL_PARENT_CODES.SUPPLIER) return 'SUPPLIER'
  if (code === CONTROL_PARENT_CODES.EMPLOYEE) return 'EMPLOYEE'
  return null
}

/** طبيعة الحساب الفرعي حسب النوع — موارثة حساب التحكم دائماً */
function specFor(kind: LinkKind): { type: string; nature: string; parentCode: string } {
  if (kind === 'CUSTOMER') return { type: 'ASSET', nature: 'DEBIT', parentCode: CONTROL_PARENT_CODES.CUSTOMER }
  if (kind === 'SUPPLIER') return { type: 'LIABILITY', nature: 'CREDIT', parentCode: CONTROL_PARENT_CODES.SUPPLIER }
  if (kind === 'PARTNER') return { type: 'EQUITY', nature: 'CREDIT', parentCode: PARTNER_PARENT_CODE }
  return { type: 'ASSET', nature: 'DEBIT', parentCode: CONTROL_PARENT_CODES.EMPLOYEE }
}

/**
 * ضمان وجود حساب التحكم نفسه (1130/2110/1150) — يُنشأ نظامياً إن غابت عن الدليل
 * (نفس آلية ensureInvoiceAccounts — حماية لدليل مقصوص)
 */
async function ensureControlAccount(tx: Tx, kind: LinkKind): Promise<string> {
  const spec = specFor(kind)
  const found = await tx.account.findUnique({ where: { code: spec.parentCode }, select: { id: true } })
  if (found) return found.id
  const created = await tx.account.create({
    data: {
      code: spec.parentCode,
      name:
        kind === 'CUSTOMER'
          ? INVOICE_ACCOUNTS.AR.name
          : kind === 'SUPPLIER'
            ? INVOICE_ACCOUNTS.AP.name
            : INVOICE_ACCOUNTS.ADVANCES.name,
      type: spec.type,
      nature: spec.nature,
      isSystem: true,
    },
    select: { id: true },
  })
  return created.id
}

/** الكود التالي للحساب الفرعي: كود الأب + تسلسل خانتين (113001 ثم 113002 …) */
async function nextSubCode(tx: Tx, parentCode: string): Promise<string> {
  const prefix = `${parentCode}`
  const children = await tx.account.findMany({
    where: { code: { startsWith: prefix } },
    select: { code: true },
  })
  let max = 0
  const re = new RegExp(`^${parentCode}(\\d{2,})$`)
  for (const c of children) {
    const m = re.exec(c.code)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`
}

interface PartnerLike {
  id: string
  code: string
  name: string
  type: string // CUSTOMER | SUPPLIER
  isActive: boolean
  accountId: string | null
}

/**
 * مزامنة الحساب الفرعي لملف طرف — تُستدعى داخل معاملة الإنشاء/التعديل:
 * • لا حساب بعد ← يُنشأ تحت حساب التحكم ويُربط بالملف
 * • حساب موجود ← يُزامن الاسم والحالة فقط (الكود لا يتغير بعد الإنشاء كالملفات)
 */
export async function syncPartnerAccount(tx: Tx, partner: PartnerLike): Promise<string | null> {
  const kind: LinkKind =
    partner.type === 'SUPPLIER'
      ? 'SUPPLIER'
      : partner.type === 'PARTNER'
        ? 'PARTNER'
        : 'CUSTOMER'
  if (partner.accountId) {
    await tx.account.update({
      where: { id: partner.accountId },
      data: { name: partner.name, isActive: partner.isActive },
      select: { id: true },
    })
    return partner.accountId
  }
  const parentId = await ensureControlAccount(tx, kind)
  const code = await nextSubCode(tx, specFor(kind).parentCode)
  const acc = await tx.account.create({
    data: {
      code,
      name: partner.name,
      type: specFor(kind).type,
      nature: specFor(kind).nature,
      isSystem: false,
      isActive: partner.isActive,
      parentId,
    },
    select: { id: true },
  })
  await tx.partner.update({ where: { id: partner.id }, data: { accountId: acc.id }, select: { id: true } })
  return acc.id
}

interface EmployeeLike {
  id: string
  code: string
  name: string
  isActive: boolean
  accountId: string | null
}

/** مزامنة الحساب الفرعي للموظف تحت «سلف الموظفين» — نفس آلية الأطراف */
export async function syncEmployeeAccount(tx: Tx, employee: EmployeeLike): Promise<string | null> {
  if (employee.accountId) {
    await tx.account.update({
      where: { id: employee.accountId },
      data: { name: employee.name, isActive: employee.isActive },
      select: { id: true },
    })
    return employee.accountId
  }
  const parentId = await ensureControlAccount(tx, 'EMPLOYEE')
  const code = await nextSubCode(tx, CONTROL_PARENT_CODES.EMPLOYEE)
  const acc = await tx.account.create({
    data: {
      code,
      name: employee.name,
      type: specFor('EMPLOYEE').type,
      nature: specFor('EMPLOYEE').nature,
      isSystem: false,
      isActive: employee.isActive,
      parentId,
    },
    select: { id: true },
  })
  await tx.employee.update({ where: { id: employee.id }, data: { accountId: acc.id }, select: { id: true } })
  return acc.id
}

/**
 * حذف الحساب الفرعي المرتبط بملف يُحذف — داخل معاملة حذف الملف
 * تعدد الأدوار: إن بقي على الحساب ملفات أخرى (موظف/عميل/مورد) لا يُحذف — يبقى لصاحبيها
 * الحساب بلا بنود قيد هنا بحكم حراسة الملف (بلا مستندات) — والحراسة الدفاعية تبقى
 * ترجع { ok, code } حيث code كود الحساب المحذوف أو null إن بقي/لم يوجد — أو { error } برسالة عربية جاهزة للـ409
 */
export async function deleteLinkedAccount(
  tx: Tx,
  accountId: string | null,
  opts?: { excludePartnerId?: string; excludeEmployeeId?: string },
): Promise<{ ok: true; code: string | null; kept: boolean } | { ok: false; error: string }> {
  if (!accountId) return { ok: true, code: null, kept: false }
  const acc = await tx.account.findUnique({
    where: { id: accountId },
    select: { code: true, _count: { select: { journalLines: true } } },
  })
  if (!acc) return { ok: true, code: null, kept: false }

  // تعدد الأدوار — ملفات أخرى ما زالت على الحساب؟ يبقى الحساب لها (قبل فحص القيود —
  // قيود الحساب قد تعود لدور آخر لم يُحذف بعد)
  const otherPartners = await tx.partner.count({
    where: {
      accountId,
      ...(opts?.excludePartnerId ? { id: { not: opts.excludePartnerId } } : {}),
    },
  })
  const otherEmployees = await tx.employee.count({
    where: {
      accountId,
      ...(opts?.excludeEmployeeId ? { id: { not: opts.excludeEmployeeId } } : {}),
    },
  })
  if (otherPartners > 0 || otherEmployees > 0) {
    return { ok: true, code: null, kept: true }
  }

  // الحساب عليه بنود قيد محاسبي؟ يبقى الحساب بتاريخه المالي — الملف يُحذف وحده
  // (الحذف الفعلي للحساب من الشجرة له مساره الخاص وحرسه في accounts/[id])
  if (acc._count.journalLines > 0) {
    return { ok: true, code: null, kept: true }
  }

  await tx.account.delete({ where: { id: accountId } })
  return { ok: true, code: acc.code, kept: false }
}

/**
 * إنشاء ملف طرف تلقائياً عند إضافة حساب تحت حساب التحكم من الشجرة — الاتجاه المعاكس
 * يُنشأ الملف بكود تسلسلي تلقائي ويرتبط بالحساب حصراً (بلا إعادة إنشاء حساب جديد)
 */
export async function createPartnerForAccount(
  tx: Tx,
  kind: Extract<LinkKind, 'CUSTOMER' | 'SUPPLIER'>,
  account: { id: string; name: string; isActive: boolean },
): Promise<{ id: string; code: string }> {
  const code = await nextPartnerCode(kind, tx)
  const partner = await tx.partner.create({
    data: {
      code,
      name: account.name,
      type: kind,
      isActive: account.isActive,
      accountId: account.id,
    },
    select: { id: true, code: true },
  })
  return partner
}

/** إنشاء ملف موظف تلقائياً عند إضافة حساب تحت «سلف الموظفين» من الشجرة — بيانات أساسية تُستكمل من الشاشة */
export async function createEmployeeForAccount(
  tx: Tx,
  account: { id: string; name: string; isActive: boolean },
): Promise<{ id: string; code: string }> {
  const rows = await tx.employee.findMany({ where: { code: { startsWith: 'EMP-' } }, select: { code: true } })
  const code = nextEmployeeCode(rows)
  const employee = await tx.employee.create({
    data: {
      code,
      name: account.name,
      position: 'موظف',
      hireDate: new Date(),
      baseSalary: 0,
      isActive: account.isActive,
      accountId: account.id,
    },
    select: { id: true, code: true },
  })
  return employee
}

/**
 * التمهيد الخامل: كل عميل/مورد/موظف بلا حساب فرعي يحصل على حسابه تحت حساب التحكم
 * تُستدعى من GET /api/accounts قبل بناء الشجرة — مكلفة صفراً حين يكتمل الربط
 */
export async function backfillPartnerEmployeeAccounts(): Promise<void> {
  const partners = await db.partner.findMany({
    where: { accountId: null },
    select: { id: true, code: true, name: true, type: true, isActive: true, accountId: true },
    orderBy: { code: 'asc' },
  })
  const employees = await db.employee.findMany({
    where: { accountId: null },
    select: { id: true, code: true, name: true, isActive: true, accountId: true },
    orderBy: { code: 'asc' },
  })
  for (const p of partners) {
    try {
      await db.$transaction(async (tx) => {
        await syncPartnerAccount(tx, p)
      })
    } catch (error) {
      console.error('backfill partner account failed:', p.code, error)
    }
  }
  for (const e of employees) {
    try {
      await db.$transaction(async (tx) => {
        await syncEmployeeAccount(tx, e)
      })
    } catch (error) {
      console.error('backfill employee account failed:', e.code, error)
    }
  }
}

/** كود حساب التحكم لملف طرف — لعرضه في الرسائل والتلميحات */
export function controlCodeForPartner(type: string): string {
  return type === 'SUPPLIER' ? CONTROL_PARENT_CODES.SUPPLIER : CONTROL_PARENT_CODES.CUSTOMER
}

// ==================== تعدد الأدوار — ربط ملف بحساب موجود من الشجرة ====================
// المبدأ: أي حساب فرعي (ورقة) في الشجرة يمكن أن يحمل أكثر من دور في آنٍ واحد:
//   موظف + عميل (115007 حساب أحمد ملف موظف وملف عميل معاً)
//   عميل + مورد (حساب واحد يحمل الملفين — مورد يصبح عميلاً وبالعكس)
// الحساب يبقى في مكانه تحت حساب التحكم الأصلي — الملفات تشترك فيه وتحمل كل منها مستنداتها

export interface LinkableAccount {
  id: string
  code: string
  name: string
}

/**
 * تدقيق الحساب المُراد ربط ملف به: موجود + نشط + ورقة (بلا أبناء) —
 * ترجع الحساب عند النجاح أو رسالة عربية جاهزة للرد 400
 */
export async function validateAccountForLink(
  tx: Tx,
  accountId: string,
): Promise<{ ok: true; account: LinkableAccount } | { ok: false; error: string }> {
  const acc = await tx.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      _count: { select: { children: true } },
    },
  })
  if (!acc) {
    return { ok: false, error: 'الحساب المحدد غير موجود في شجرة الحسابات' }
  }
  if (!acc.isActive) {
    return { ok: false, error: `الحساب ${acc.code} (${acc.name}) موقوف — فعّله من الشجرة أولاً أو اختر حساباً نشطاً` }
  }
  if (acc._count.children > 0) {
    return {
      ok: false,
      error: `لا يمكن الربط بالحساب ${acc.code} (${acc.name}) — هو حساب مجموعة له حسابات فرعية، اختر حساباً فرعياً ورقياً`,
    }
  }
  return { ok: true, account: { id: acc.id, code: acc.code, name: acc.name } }
}
