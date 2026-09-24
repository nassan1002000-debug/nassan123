// كشف حساب الطرف/الموظف من مستنداته — المصدر الواحد لثلاثة مستهلكين:
//   1) تقرير كشف الحساب في مركز التقارير (partner-statement)
//   2) كشوف دفتر الأستاذ/كشف الحساب/الكشف التفصيلي من شجرة الحسابات للحساب المرتبط بملف طرف
//   3) أرصدة حسابات الأطراف في شجرة الحسابات (رصيد الطرف من فواتيره وسنداته لا من قيود التحكم)
//
// المنهج المحاسبي: الحساب الفرعي المرتبط بملف طرف هو «دفتر الفرع» (Subledger) —
// كشفه يُبنى من مستنداته الفعلية: فواتيره ومردوداته وسندات القبض/الدفع الخاصة به وسلف الموظف.
// اتجاه الحركة بصيغة «مدين-موجب»: العميل الفاتورة مدين والقبض دائن — المورد الفاتورة دائن والدفع مدين.

import { db } from '@/lib/db'
import { getOpeningLinesByAccount } from '@/lib/period-server'

const round2 = (n: number) => Math.round(n * 100) / 100

const docDescription = (notes: string | null): string =>
  notes && notes.trim() ? notes.trim() : 'بدون بيان'

const DOCTYPE_LABELS: Record<string, string> = {
  SALE: 'فاتورة مبيعات',
  SALES_RETURN: 'مردود مبيعات',
  PURCHASE: 'فاتورة مشتريات',
  PURCHASE_RETURN: 'مردود مشتريات',
  RECEIPT: 'سند قبض',
  PAYMENT: 'سند دفع',
  ADVANCE: 'صرف سلفة',
  CLEARING: 'سند مقاصة',
  OPENING: 'قيد افتتاحي (ترحيل)',
}

export interface DocStatementLine {
  date: string
  docType: string
  number: string
  description: string
  debit: number
  credit: number
  balance: number
  balanceDirection: StmtDirection
  costCenterName: string | null
  /** معرف الفاتورة الأصلية — فقط لمستندات نوعها فاتورة، تُستخدم لجلب بنودها عند الطلب */
  invoiceId?: string
}

export type StmtDirection = 'DEBIT' | 'CREDIT' | 'ZERO'

export interface DocStatement {
  owner: { id: string; code: string; name: string; type: string }
  lines: DocStatementLine[]
  totals: {
    opening: number
    openingDirection: StmtDirection
    /** مرجع نصي للرصيد الافتتاحي — يُملأ فقط عند تفعيل مرشّح فترة تاريخ (from) */
    openingRef?: string | null
    totalDebit: number
    totalCredit: number
    closing: number
    closingDirection: StmtDirection
    count: number
  }
}

export interface RawDoc {
  date: Date
  docType: string
  number: string
  description: string
  debit: number
  credit: number
  costCenterName: string | null
  /** أولوية الترتيب عند تساوي التاريخ — أسطر الافتتاحي (−1) تسبق مستندات الفترة الجديدة */
  priority?: number
  /** معرف الفاتورة الأصلية — لمستندات الفواتير فقط (لجلب بنودها لاحقاً عند الطلب) */
  invoiceId?: string
}

function directionOf(signedInDebitTerms: number): StmtDirection {
  if (Math.abs(signedInDebitTerms) < 0.005) return 'ZERO'
  return signedInDebitTerms > 0 ? 'DEBIT' : 'CREDIT'
}

/**
 * تجميع المستندات بترتيب زمني ثم بناء الرصيد المتحرك (يبدأ من الرصيد الافتتاحي المرحّل إن وجد).
 * مرشّح فترة تاريخ اختياري (range): مستندات ما قبل from تُطوى في رصيد واحد سابق للفترة
 * (لا تظهر كأسطر) ومستندات ما بعد to تُهمل كلياً — دون كسر صحة الرصيد الجاري المعروض
 */
function buildStatement(
  owner: { id: string; code: string; name: string; type: string },
  docs: RawDoc[],
  range?: { from?: Date; to?: Date },
): DocStatement {
  docs.sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      (a.priority ?? 0) - (b.priority ?? 0) ||
      a.number.localeCompare(b.number, 'en', { numeric: true }),
  )
  let running = 0
  // طيّ ما قبل from في رصيد سابق واحد — لا يظهر كأسطر لكنه يبقى في أساس الرصيد الجاري
  if (range?.from) {
    for (const d of docs) {
      if (d.date.getTime() >= range.from.getTime()) break
      running = round2(running + d.debit - d.credit)
    }
  }
  const openingBeforeRange = running
  const visibleDocs = docs.filter(
    (d) =>
      (!range?.from || d.date.getTime() >= range.from.getTime()) &&
      (!range?.to || d.date.getTime() <= range.to.getTime()),
  )

  let totalDebit = 0
  let totalCredit = 0
  const lines: DocStatementLine[] = []
  for (const d of visibleDocs) {
    running = round2(running + d.debit - d.credit)
    totalDebit += d.debit
    totalCredit += d.credit
    lines.push({
      date: d.date.toISOString(),
      docType: d.docType,
      number: d.number,
      description: d.description,
      invoiceId: d.invoiceId,
      debit: round2(d.debit),
      credit: round2(d.credit),
      balance: Math.abs(running),
      balanceDirection: directionOf(running),
      costCenterName: d.costCenterName,
    })
  }
  return {
    owner,
    lines,
    totals: {
      opening: range?.from ? Math.abs(openingBeforeRange) : 0,
      openingDirection: range?.from ? directionOf(openingBeforeRange) : 'ZERO',
      openingRef: range?.from ? `الرصيد المتراكم حتى قبل ${range.from.toISOString().slice(0, 10)}` : null,
      totalDebit: round2(totalDebit),
      totalCredit: round2(totalCredit),
      closing: Math.abs(running),
      closingDirection: directionOf(running),
      count: lines.length,
    },
  }
}

// ==================== كشف عميل/مورد ====================

/** جمع مستندات طرف واحد خامًا — يُستخدم في كشف الطرف وفي الكشف الموحد للطرف الموحد (unified-party) */
export async function partnerRawDocs(partner: {
  id: string
  code: string
  name: string
  type: string
  accountId: string | null
}): Promise<RawDoc[]> {
  const isCustomer = partner.type === 'CUSTOMER'

  const [invoices, vouchers, clearingLines, openingLine] = await Promise.all([
    db.invoice.findMany({
      where: {
        partnerId: partner.id,
        isDeleted: false,
        type: { in: isCustomer ? ['SALE', 'SALES_RETURN'] : ['PURCHASE', 'PURCHASE_RETURN'] },
      },
      select: { id: true, number: true, type: true, date: true, total: true, notes: true, costCenter: { select: { name: true } } },
    }),
    db.payment.findMany({
      where: { partnerId: partner.id, type: isCustomer ? 'RECEIPT' : 'PAYMENT' },
      select: { number: true, type: true, date: true, amount: true, notes: true },
    }),
    // سندات المقاصة المرحّلة على الحساب الفرعي للطرف — بالاتجاه المثبت فعلياً في القيد
    partner.accountId
      ? db.journalEntryLine.findMany({
          where: { accountId: partner.accountId, entry: { source: 'CLEARING', status: 'POSTED' } },
          select: {
            debit: true,
            credit: true,
            description: true,
            entry: { select: { number: true, date: true, description: true } },
          },
        })
      : Promise.resolve([] as never[]),
    // الرصيد الافتتاحي المرحّل بسند القيد الافتتاحي — مصدر رصيد الطرف في الفترة الجديدة
    // بعد تدوير مستندات الفترة المغلقة (شرط عزل الفترات)
    partner.accountId
      ? (await getOpeningLinesByAccount(db)).get(partner.accountId) ?? null
      : Promise.resolve(null),
  ])

  const docs: RawDoc[] = []
  if (openingLine) {
    // سطر الافتتاحي أول مستندات الكشف — رصيد مرحّل من الفترة السابقة بسند القيد الافتتاحي
    docs.push({
      date: openingLine.entryDate,
      docType: DOCTYPE_LABELS.OPENING,
      number: openingLine.entryNumber,
      description: openingLine.description ?? `رصيد افتتاحي مرحّل بسند ${openingLine.entryNumber}`,
      debit: openingLine.debit,
      credit: openingLine.credit,
      costCenterName: null,
      priority: -1,
    })
  }
  for (const inv of invoices) {
    // العميل: فاتورة البيع تزيده مديناً ومردودها دائن — المورد: فاتورة الشراء تزيده دائناً ومردودها مدين
    const isReturn = inv.type === 'SALES_RETURN' || inv.type === 'PURCHASE_RETURN'
    docs.push({
      date: inv.date,
      docType: DOCTYPE_LABELS[inv.type] ?? inv.type,
      number: inv.number,
      description: docDescription(inv.notes),
      invoiceId: inv.id,
      debit: (isCustomer ? !isReturn : isReturn) ? round2(inv.total) : 0,
      credit: (isCustomer ? isReturn : !isReturn) ? round2(inv.total) : 0,
      costCenterName: inv.costCenter?.name ?? null,
    })
  }
  for (const v of vouchers) {
    // سند القبض (عميل) يزيده دائناً — سند الدفع (مورد) يزيده مديناً
    docs.push({
      date: v.date,
      docType: DOCTYPE_LABELS[v.type] ?? v.type,
      number: v.number,
      description: docDescription(v.notes),
      debit: !isCustomer ? round2(v.amount) : 0,
      credit: isCustomer ? round2(v.amount) : 0,
      costCenterName: null,
    })
  }
  for (const l of clearingLines) {
    // سند المقاصة: الاتجاه كما رُحّل فعلياً في القيد — مدين يزيده مديناً ودائن يزيده دائناً
    docs.push({
      date: l.entry.date,
      docType: DOCTYPE_LABELS.CLEARING,
      number: l.entry.number,
      description: docDescription(l.description ?? l.entry.description),
      debit: round2(l.debit),
      credit: round2(l.credit),
      costCenterName: null,
    })
  }
  return docs
}

export async function partnerDocStatement(partnerId: string): Promise<DocStatement | null> {
  const partner = await db.partner.findUnique({
    where: { id: partnerId },
    select: { id: true, code: true, name: true, type: true, accountId: true },
  })
  if (!partner) return null

  const docs = await partnerRawDocs(partner)
  return buildStatement(
    { id: partner.id, code: partner.code, name: partner.name, type: partner.type },
    docs,
  )
}

// ==================== كشف موظف (السلف المصروفة + السندات المباشرة على حسابه) ====================

/** جمع مستندات موظف واحد خامًا — يُستخدم في كشف الموظف وفي الكشف الموحد للطرف الموحد (unified-party) */
export async function employeeRawDocs(employee: {
  id: string
  code: string
  name: string
  accountId: string | null
}): Promise<RawDoc[]> {
  const [advances, clearingLines, directPayments, directReceipts, openingLine] = await Promise.all([
    db.advance.findMany({
      where: { employeeId: employee.id, status: 'PAID' },
      select: { date: true, amount: true, reason: true },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    }),
    // سندات المقاصة المرحّلة على الحساب الفرعي للموظف — بالاتجاه المثبت فعلياً في القيد
    employee.accountId
      ? db.journalEntryLine.findMany({
          where: { accountId: employee.accountId, entry: { source: 'CLEARING', status: 'POSTED' } },
          select: {
            debit: true,
            credit: true,
            description: true,
            entry: { select: { number: true, date: true, description: true } },
          },
        })
      : Promise.resolve([] as never[]),
    // سندات الدفع المُقيّدة مباشرة على حساب الموظف الشخصي (صرف له: أجر/سلفة بلا مستند سلفة)
    employee.accountId
      ? db.payment.findMany({
          where: { accountId: employee.accountId, partnerId: null, type: 'PAYMENT' },
          select: { number: true, type: true, date: true, amount: true, notes: true },
        })
      : Promise.resolve([] as never[]),
    // سندات القبض منه مباشرة (ردّ موظف)
    employee.accountId
      ? db.payment.findMany({
          where: { accountId: employee.accountId, partnerId: null, type: 'RECEIPT' },
          select: { number: true, type: true, date: true, amount: true, notes: true },
        })
      : Promise.resolve([] as never[]),
    // الرصيد الافتتاحي المرحّل بسند القيد الافتتاحي — مصدر رصيد الموظف في الفترة الجديدة
    employee.accountId
      ? (await getOpeningLinesByAccount(db)).get(employee.accountId) ?? null
      : Promise.resolve(null),
  ])

  const docs: RawDoc[] = []
  if (openingLine) {
    // سطر الافتتاحي أول مستندات الكشف — رصيد مرحّل من الفترة السابقة بسند القيد الافتتاحي
    docs.push({
      date: openingLine.entryDate,
      docType: DOCTYPE_LABELS.OPENING,
      number: openingLine.entryNumber,
      description: openingLine.description ?? `رصيد افتتاحي مرحّل بسند ${openingLine.entryNumber}`,
      debit: openingLine.debit,
      credit: openingLine.credit,
      costCenterName: null,
      priority: -1,
    })
  }
  docs.push(...advances.map((a, i) => ({
    date: a.date,
    docType: DOCTYPE_LABELS.ADVANCE,
    number: `ADV-${String(i + 1).padStart(3, '0')}`,
    description: a.reason && a.reason.trim() ? a.reason.trim() : 'صرف سلفة للموظف',
    debit: round2(a.amount), // السلفة المصروفة تزيد رصيد الموظف مديناً
    credit: 0,
    costCenterName: null,
  })))
  for (const v of directPayments) {
    // سند دفع على حسابه الشخصي: صرف له — يزيده مديناً (نفس اتجاه السلفة)
    docs.push({
      date: v.date,
      docType: DOCTYPE_LABELS[v.type] ?? v.type,
      number: v.number,
      description: docDescription(v.notes),
      debit: round2(v.amount),
      credit: 0,
      costCenterName: null,
    })
  }
  for (const v of directReceipts) {
    // سند قبض منه مباشرة: ردّ من الموظف — يزيده دائناً
    docs.push({
      date: v.date,
      docType: DOCTYPE_LABELS[v.type] ?? v.type,
      number: v.number,
      description: docDescription(v.notes),
      debit: 0,
      credit: round2(v.amount),
      costCenterName: null,
    })
  }
  for (const l of clearingLines) {
    // سند المقاصة: الاتجاه كما رُحّل فعلياً — مدين يزيد المدين ودائن يزيد الدائن
    docs.push({
      date: l.entry.date,
      docType: DOCTYPE_LABELS.CLEARING,
      number: l.entry.number,
      description: docDescription(l.description ?? l.entry.description),
      debit: round2(l.debit),
      credit: round2(l.credit),
      costCenterName: null,
    })
  }
  return docs
}

export async function employeeDocStatement(employeeId: string): Promise<DocStatement | null> {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, code: true, name: true, accountId: true },
  })
  if (!employee) return null

  const docs = await employeeRawDocs(employee)
  return buildStatement(
    { id: employee.id, code: employee.code, name: employee.name, type: 'EMPLOYEE' },
    docs,
  )
}

// ==================== كشف حساب موحد للحساب متعدد الأدوار ====================

/**
 * كشف حساب الحساب الفرعي من مستندات كل ملفاته المرتبطة (تعدد الأدوار):
 * حساب موظف له ملف عميل أيضاً — كشفه يجمع سلفه وسنداته المباشرة وفواتيره كسعميل وسنداته
 * ملفات الشركاء (رأس المال) لا تدخل هنا — حقيقتها في القيود حصراً (تأسيس/مسحوبات)
 * فيُرجع null إن لم يوجد عميل/مورد/موظف على الحساب — فيعود الكشف إلى حركة القيود (GL)
 */
export async function accountDocStatement(
  accountId: string,
  range?: { from?: Date; to?: Date },
): Promise<DocStatement | null> {
  const [account, partners, employee] = await Promise.all([
    db.account.findUnique({ where: { id: accountId }, select: { id: true, code: true, name: true } }),
    db.partner.findMany({
      where: { accountId },
      select: { id: true, code: true, name: true, type: true, accountId: true },
    }),
    db.employee.findFirst({ where: { accountId }, select: { id: true, code: true, name: true, accountId: true } }),
  ])
  if (!account) return null
  // دور الشريك (رأس المال) بلا مستندات تجارية — لا يجعل الكشف «من المستندات» أبداً
  const docPartners = partners.filter((p) => p.type === 'CUSTOMER' || p.type === 'SUPPLIER')
  if (docPartners.length === 0 && !employee) return null

  const docs: RawDoc[] = []
  for (const p of docPartners) docs.push(...(await partnerRawDocs(p)))
  if (employee) docs.push(...(await employeeRawDocs(employee)))

  return buildStatement(
    { id: account.id, code: account.code, name: account.name, type: 'ACCOUNT' },
    docs,
    range,
  )
}

// ==================== أرصدة المستندات للشجرة (دفعات مجمعة بلا N+1) ====================

export interface DocTotals {
  debit: number
  credit: number
}

export interface DocBalancesMaps {
  partner: Map<string, DocTotals> // partnerId → مجاميع مدين/دائن من مستنداته
  employee: Map<string, DocTotals> // employeeId → مجاميع سلفه وسندات حسابه المباشرة
}

/** تجميع حركة مستندات كل الأطراف والموظفين دفعة واحدة — تُستدعى من GET /api/accounts */
export async function computeAllDocBalances(): Promise<DocBalancesMaps> {
  const [
    sales,
    salesReturns,
    purchases,
    purchaseReturns,
    receipts,
    payments,
    advances,
    clearingLines,
    pLinks,
    eLinks,
    // Task 104 — سندات القبض/الدفع المُقيّدة مباشرة على حسابات الموظفين الشخصية (115xxx)
    acctPayments,
    acctReceipts,
  ] = await Promise.all([
      db.invoice.groupBy({ by: ['partnerId'], where: { isDeleted: false, type: 'SALE' }, _sum: { total: true } }),
      db.invoice.groupBy({ by: ['partnerId'], where: { isDeleted: false, type: 'SALES_RETURN' }, _sum: { total: true } }),
      db.invoice.groupBy({ by: ['partnerId'], where: { isDeleted: false, type: 'PURCHASE' }, _sum: { total: true } }),
      db.invoice.groupBy({ by: ['partnerId'], where: { isDeleted: false, type: 'PURCHASE_RETURN' }, _sum: { total: true } }),
      db.payment.groupBy({ by: ['partnerId'], where: { type: 'RECEIPT' }, _sum: { amount: true } }),
      db.payment.groupBy({ by: ['partnerId'], where: { type: 'PAYMENT' }, _sum: { amount: true } }),
      db.advance.groupBy({ by: ['employeeId'], where: { status: 'PAID' }, _sum: { amount: true } }),
      // أسطر المقاصة المرحّلة على كل الحسابات الفرعية — تُدمج في أرصدة أصحاب الملفات
      db.journalEntryLine.findMany({
        where: { entry: { source: 'CLEARING', status: 'POSTED' } },
        select: { accountId: true, debit: true, credit: true },
      }),
      // ملفات الشركاء (رأس المال) مستثناة — بلا مستندات تجارية فلا تنسب إليها المقاصات/الافتتاحي
      db.partner.findMany({
        where: { accountId: { not: null }, type: { not: 'PARTNER' } },
        select: { id: true, accountId: true },
      }),
      db.employee.findMany({ where: { accountId: { not: null } }, select: { id: true, accountId: true } }),
      db.payment.groupBy({
        by: ['accountId'],
        where: { accountId: { not: null }, partnerId: null, type: 'PAYMENT' },
        _sum: { amount: true },
      }),
      db.payment.groupBy({
        by: ['accountId'],
        where: { accountId: { not: null }, partnerId: null, type: 'RECEIPT' },
        _sum: { amount: true },
      }),
    ])

  const addTo = (map: Map<string, DocTotals>, key: string, debit: number, credit: number) => {
    const cur = map.get(key) ?? { debit: 0, credit: 0 }
    cur.debit += debit
    cur.credit += credit
    map.set(key, cur)
  }

  const partner = new Map<string, DocTotals>()
  for (const g of sales) addTo(partner, g.partnerId, round2(g._sum.total ?? 0), 0)
  for (const g of salesReturns) addTo(partner, g.partnerId, 0, round2(g._sum.total ?? 0))
  for (const g of purchases) addTo(partner, g.partnerId, 0, round2(g._sum.total ?? 0))
  for (const g of purchaseReturns) addTo(partner, g.partnerId, round2(g._sum.total ?? 0), 0)
  for (const g of receipts) addTo(partner, g.partnerId ?? '', 0, round2(g._sum.amount ?? 0))
  for (const g of payments) addTo(partner, g.partnerId ?? '', round2(g._sum.amount ?? 0), 0)

  const employee = new Map<string, DocTotals>()
  for (const g of advances) addTo(employee, g.employeeId, round2(g._sum.amount ?? 0), 0)

  // دمج المقاصات: أسطر الحساب الفرعي تُنسب لصاحب الملف (عميل/مورد/موظف) بالاتجاه المثبت
  const acctToPartner = new Map(
    pLinks.filter((l): l is { id: string; accountId: string } => !!l.accountId).map((l) => [l.accountId, l.id]),
  )
  const acctToEmployee = new Map(
    eLinks.filter((l): l is { id: string; accountId: string } => !!l.accountId).map((l) => [l.accountId, l.id]),
  )
  for (const l of clearingLines) {
    const d = round2(l.debit)
    const c = round2(l.credit)
    if (d === 0 && c === 0) continue
    const pid = acctToPartner.get(l.accountId)
    const eid = acctToEmployee.get(l.accountId)
    if (pid) addTo(partner, pid, d, c)
    else if (eid) addTo(employee, eid, d, c)
  }

  // دمج سندات الحسابات المباشرة (Task 104): سند دفع على حساب موظف = مدين له،
  // وسند قبض منه = دائن عليه — تحسب ضمن رصيد صاحب الملف في الشجرة والتقارير
  for (const g of acctPayments) {
    const eid = g.accountId ? acctToEmployee.get(g.accountId) : undefined
    if (eid) addTo(employee, eid, round2(g._sum.amount ?? 0), 0)
  }
  for (const g of acctReceipts) {
    const eid = g.accountId ? acctToEmployee.get(g.accountId) : undefined
    if (eid) addTo(employee, eid, 0, round2(g._sum.amount ?? 0))
  }

  // دمج أسطر سند القيد الافتتاحي — بعد تدوير مستندات الفترة المغلقة يصبح سطر الافتتاحي
  // مصدر رصيد كل طرف/موظف في الفترة الجديدة (شرط عزل الفترات): أرصدة مدوّرة من الافتتاحي فقط
  const openingLines = await getOpeningLinesByAccount(db)
  for (const [accountId, l] of openingLines) {
    const d = round2(l.debit)
    const c = round2(l.credit)
    if (d === 0 && c === 0) continue
    const pid = acctToPartner.get(accountId)
    const eid = acctToEmployee.get(accountId)
    if (pid) addTo(partner, pid, d, c)
    else if (eid) addTo(employee, eid, d, c)
  }

  return { partner, employee }
}
