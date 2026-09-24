// منطق «الطرف الموحد» — لمّ شمل أدوار الشخص المتفرقة في منظومة واحدة
// ---------------------------------------------------------------------------------
// المبدأ: الشخص الواحد قد يجمع أدواراً متعددة لكل منها حساب مستقل في الشجرة:
//   محمد نعسان    → شريك (310001) + عميل (113007)
//   عبد الرحمن بركات → شريك (310002) + مورد (211008) + عميل (113006)
//   احمد الاحمد   → موظف + عميل (على الحساب نفسه 115007)
// الربط بالتطابق الحرفي للاسم بعد تطبيع عربي (توحيد الهمزات وإزالة التشكيل والتاء المربوطة)
// — نفس مبدأ تجميع صفات المقاصة في clearing-server لكن بتطبيع أوسع وأدوار أشمل (شريك).
//
// منهج كشف الحركة الموحد = «دفتر الفرع» لكل دور:
//   عميل/مورد  → مستنداته (فواتير + سندات + مقاصات + افتتاحي) عبر partnerRawDocs
//   موظف       → سلفه وسنداته المباشرة والمقاصات عبر employeeRawDocs
//   شريك       → حركة قيود حساب رأس ماله (تأسيس/مسحوبات) — فلا يملك مستندات تجارية

import { db } from '@/lib/db'
import { AR_SOURCE } from '@/lib/format'
import { AR_DOC_LABEL } from '@/lib/invoices-server'
import { employeeRawDocs, partnerRawDocs, type RawDoc } from '@/lib/partner-statement-server'
import type {
  UnifiedAdvanceRow,
  UnifiedDocRow,
  UnifiedInvoiceRow,
  UnifiedLoyaltySummary,
  UnifiedPersonSummary,
  UnifiedRoleBalance,
  UnifiedRoleKind,
  UnifiedStatement,
} from './unified-party-types'

const round2 = (n: number) => Math.round(n * 100) / 100

type BalanceDirection = 'DEBIT' | 'CREDIT' | 'ZERO'

// اتجاه الرصيد بصيغة "مدين-موجب" — نفس منطق دفتر الأستاذ العادي (accounts/[id]/ledger)
function directionOf(signedInDebitTerms: number): BalanceDirection {
  if (Math.abs(signedInDebitTerms) < 0.005) return 'ZERO'
  return signedInDebitTerms > 0 ? 'DEBIT' : 'CREDIT'
}

export const AR_ROLE_LABEL: Record<UnifiedRoleKind, string> = {
  PARTNER: 'شريك',
  CUSTOMER: 'عميل',
  SUPPLIER: 'مورد',
  EMPLOYEE: 'موظف',
}

/** مصادر القيود على حساب رأس مال الشريك — تأسيس/مسحوبات/مقاصات */
function glSourceLabel(source: string): string {
  if (source === 'MANUAL') return 'قيد يومية'
  return AR_SOURCE[source] ?? source
}

/**
 * تطبيع الاسم العربي للمطابقة: إزالة التشكيل والتطويل، توحيد الهمزات والألف المقصورة،
 * توحيد التاء المربوطة والياء، وطي المسافات — «أحمد» و«احمد» صارا واحدًا
 */
export function normalizeArabicName(name: string): string {
  return name
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // الحركات والتطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
}

// ==================== ملفات الأدوار ====================

interface FileSeed {
  kind: UnifiedRoleKind
  fileId: string
  fileCode: string
  fileName: string
  fileActive: boolean
  accountId: string | null
  accountCode: string | null
  accountName: string | null
}

/** كل ملفات الأدوار المرتبطة بحسابات — عملاء وموردون وشركاء وموظفون */
async function loadPartyFiles(): Promise<FileSeed[]> {
  const [partners, employees] = await Promise.all([
    db.partner.findMany({
      where: { accountId: { not: null } },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        isActive: true,
        accountId: true,
        account: { select: { code: true, name: true } },
      },
      orderBy: { code: 'asc' },
    }),
    db.employee.findMany({
      where: { accountId: { not: null } },
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        accountId: true,
        account: { select: { code: true, name: true } },
      },
      orderBy: { code: 'asc' },
    }),
  ])

  const files: FileSeed[] = []
  for (const p of partners) {
    const kind: UnifiedRoleKind =
      p.type === 'SUPPLIER' ? 'SUPPLIER' : p.type === 'PARTNER' ? 'PARTNER' : 'CUSTOMER'
    files.push({
      kind,
      fileId: p.id,
      fileCode: p.code,
      fileName: p.name,
      fileActive: p.isActive,
      accountId: p.accountId,
      accountCode: p.account?.code ?? null,
      accountName: p.account?.name ?? null,
    })
  }
  for (const e of employees) {
    files.push({
      kind: 'EMPLOYEE',
      fileId: e.id,
      fileCode: e.code,
      fileName: e.name,
      fileActive: e.isActive,
      accountId: e.accountId,
      accountCode: e.account?.code ?? null,
      accountName: e.account?.name ?? null,
    })
  }
  return files
}

// ==================== فهرس الأطراف الموحدة ====================

/**
 * الأشخاص ذوو الأدوار المتعددة — تجميع ملفات الأدوار بالاسم المطبّع.
 * يُرجع فقط من جمع دورين فأكثر (وحيد الدور له شارته المعتادة في الشجرة)
 */
export async function buildUnifiedIndex(): Promise<UnifiedPersonSummary[]> {
  const files = await loadPartyFiles()
  const byName = new Map<string, FileSeed[]>()
  for (const f of files) {
    const key = normalizeArabicName(f.fileName)
    if (!key) continue
    const list = byName.get(key) ?? []
    list.push(f)
    byName.set(key, list)
  }

  const persons: UnifiedPersonSummary[] = []
  for (const [id, list] of byName) {
    if (list.length < 2) continue
    // أطول اسم هو الأدق («محمد نعسان» أفضل من صيغة مختصرة لو وُجدت)
    const name = list.reduce((a, b) => (b.fileName.length > a.fileName.length ? b : a)).fileName
    const accountIds = [...new Set(list.map((f) => f.accountId).filter((x): x is string => !!x))]
    persons.push({
      id,
      name,
      multiRole: true,
      accountIds,
      roles: list
        .sort((a, b) => (a.accountCode ?? '').localeCompare(b.accountCode ?? '', 'en', { numeric: true }))
        .map((f) => ({
          kind: f.kind,
          label: AR_ROLE_LABEL[f.kind],
          fileCode: f.fileCode,
          fileId: f.fileId,
          fileActive: f.fileActive,
          accountId: f.accountId,
          accountCode: f.accountCode,
          accountName: f.accountName,
        })),
    })
  }
  // الأكثر أدواراً أولاً ثم بالاسم
  return persons.sort(
    (a, b) => b.roles.length - a.roles.length || a.name.localeCompare(b.name, 'ar'),
  )
}

// ==================== حلّ مجموعة الطرف الموحد ====================

export interface PartySeed {
  accountId?: string | null
  partnerId?: string | null
  employeeId?: string | null
}

/** حلّ مجموعة الشخص انطلاقاً من حساب أو ملف — كل ملفات الاسم المطبّع نفسه */
export async function resolvePartyGroup(seed: PartySeed): Promise<FileSeed[] | null> {
  const files = await loadPartyFiles()
  let seeds: FileSeed[]
  if (seed.partnerId) {
    seeds = files.filter((f) => f.kind !== 'EMPLOYEE' && f.fileId === seed.partnerId)
  } else if (seed.employeeId) {
    seeds = files.filter((f) => f.kind === 'EMPLOYEE' && f.fileId === seed.employeeId)
  } else if (seed.accountId) {
    seeds = files.filter((f) => f.accountId === seed.accountId)
  } else {
    return null
  }
  if (seeds.length === 0) return null

  const keys = new Set(seeds.map((f) => normalizeArabicName(f.fileName)).filter(Boolean))
  const group = files.filter((f) => keys.has(normalizeArabicName(f.fileName)))
  return group.length > 0 ? group : null
}

// ==================== كشف الحركة الموحد ====================

interface MergedDoc extends RawDoc {
  roleLabel: string
  fileCode: string
  accountCode: string | null
  /** يُحسب بعد اللمّ — تمريرة زمنية صاعدة مستقلة عن ترتيب العرض النهائي (الأحدث أولاً) */
  balance: number
}

const DOCS_TAG = (f: FileSeed) => ({
  roleLabel: AR_ROLE_LABEL[f.kind],
  fileCode: f.fileCode,
  accountCode: f.accountCode,
  balance: 0, // مبدئي — يُستبدل بالرصيد التراكمي الفعلي بعد لمّ كل الأدوار في buildUnifiedStatement
})

/**
 * حركة القيود المُرحّلة على حساب رأس مال الشريك — تأسيس ومسحوبات ومقاصات.
 * دور الشريك بلا مستندات تجارية فحقيقة حسابه تعيش في القيود حصراً
 */
async function partnerCapitalDocs(f: FileSeed): Promise<MergedDoc[]> {
  if (!f.accountId) return []
  const lines = await db.journalEntryLine.findMany({
    where: { accountId: f.accountId, entry: { status: 'POSTED' } },
    select: {
      debit: true,
      credit: true,
      description: true,
      entry: { select: { number: true, date: true, description: true, source: true } },
    },
  })
  return lines.map((l) => ({
    date: l.entry.date,
    docType: glSourceLabel(l.entry.source),
    number: l.entry.number,
    description: (l.description ?? '').trim() || l.entry.description,
    debit: round2(l.debit),
    credit: round2(l.credit),
    costCenterName: null,
    ...DOCS_TAG(f),
  }))
}

export async function buildUnifiedStatement(seed: PartySeed): Promise<UnifiedStatement | null> {
  const group = await resolvePartyGroup(seed)
  if (!group) return null

  // ===== 1) حركة كل دور بمنهجه الصحيح =====
  const merged: MergedDoc[] = []
  // بطاقات الأرصدة: رصيد كل دور موقّع بمصطلحات مدين = افتتاحي + (مدين − دائن)
  const balances: UnifiedRoleBalance[] = []
  let combinedOpening = 0

  for (const f of group) {
    let docs: MergedDoc[]
    let opening = 0
    if (f.kind === 'PARTNER') {
      docs = await partnerCapitalDocs(f)
      if (f.accountId) {
        const acc = await db.account.findUnique({
          where: { id: f.accountId },
          select: { openingBalance: true },
        })
        opening = acc?.openingBalance ?? 0
      }
    } else if (f.kind === 'EMPLOYEE') {
      const raw = await employeeRawDocs({
        id: f.fileId,
        code: f.fileCode,
        name: f.fileName,
        accountId: f.accountId,
      })
      docs = raw.map((d) => ({ ...d, ...DOCS_TAG(f) }))
      if (f.accountId) {
        const acc = await db.account.findUnique({
          where: { id: f.accountId },
          select: { openingBalance: true },
        })
        opening = acc?.openingBalance ?? 0
      }
    } else {
      const raw = await partnerRawDocs({
        id: f.fileId,
        code: f.fileCode,
        name: f.fileName,
        type: f.kind,
        accountId: f.accountId,
      })
      docs = raw.map((d) => ({ ...d, ...DOCS_TAG(f) }))
      if (f.accountId) {
        const acc = await db.account.findUnique({
          where: { id: f.accountId },
          select: { openingBalance: true },
        })
        opening = acc?.openingBalance ?? 0
      }
    }
    merged.push(...docs)
    combinedOpening += opening
    const debit = round2(docs.reduce((s, d) => s + d.debit, 0))
    const credit = round2(docs.reduce((s, d) => s + d.credit, 0))
    balances.push({
      kind: f.kind,
      label: AR_ROLE_LABEL[f.kind],
      fileCode: f.fileCode,
      accountId: f.accountId,
      accountCode: f.accountCode,
      accountName: f.accountName,
      balance: round2(opening + debit - credit),
    })
  }

  // الرصيد التراكمي الموحد لكل سطر: تمريرة زمنية صاعدة (الأقدم أولاً) مستقلة عن
  // ترتيب العرض النهائي — تبدأ من مجموع أرصدة افتتاح كل الأدوار معاً وتتحرك حركة
  // بحركة بغض النظر عن الدور، فتنتهي عند نفس محصلة الأدوار مجموعة (balances)
  const chronological = [...merged].sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      a.number.localeCompare(b.number, 'en', { numeric: true }),
  )
  let running = round2(combinedOpening)
  for (const d of chronological) {
    running = round2(running + d.debit - d.credit)
    d.balance = running
  }
  const combinedBalance = round2(balances.reduce((s, b) => s + b.balance, 0))

  // الأحدث أولاً — وعند تساوي التاريخ الرقم الأكبر أولاً
  merged.sort(
    (a, b) =>
      b.date.getTime() - a.date.getTime() ||
      b.number.localeCompare(a.number, 'en', { numeric: true }),
  )

  const docs: UnifiedDocRow[] = merged.map((d) => ({
    date: d.date.toISOString(),
    docType: d.docType,
    number: d.number,
    description: d.description,
    debit: d.debit,
    credit: d.credit,
    roleLabel: d.roleLabel,
    fileCode: d.fileCode,
    accountCode: d.accountCode,
    balance: Math.abs(d.balance),
    balanceDirection: directionOf(d.balance),
  }))

  const totals = {
    debit: round2(docs.reduce((s, d) => s + d.debit, 0)),
    credit: round2(docs.reduce((s, d) => s + d.credit, 0)),
    count: docs.length,
  }

  // ===== 2) فواتير الشخص كلها (بكل أنواعها) مع شارات السلة والولاء =====
  const partnerIds = group.filter((f) => f.kind !== 'EMPLOYEE').map((f) => f.fileId)
  const invoiceRows =
    partnerIds.length > 0
      ? await db.invoice.findMany({
          where: { partnerId: { in: partnerIds }, isDeleted: false },
          select: {
            id: true,
            number: true,
            type: true,
            date: true,
            total: true,
            paid: true,
            status: true,
            loyaltyPointsRedeemed: true,
            loyaltyPointsEarned: true,
            partner: { select: { code: true } },
          },
          orderBy: [{ date: 'desc' }, { number: 'desc' }],
        })
      : []

  const invoiceIds = invoiceRows.map((i) => i.id)
  const bundleLines =
    invoiceIds.length > 0
      ? await db.invoiceLine.findMany({
          where: { invoiceId: { in: invoiceIds }, bundleId: { not: null } },
          select: { invoiceId: true, bundleName: true },
        })
      : []
  const bundleMap = new Map<string, Set<string>>()
  for (const bl of bundleLines) {
    const set = bundleMap.get(bl.invoiceId) ?? new Set<string>()
    if (bl.bundleName) set.add(bl.bundleName)
    bundleMap.set(bl.invoiceId, set)
  }

  const invoices: UnifiedInvoiceRow[] = invoiceRows.map((i) => ({
    id: i.id,
    number: i.number,
    type: i.type,
    typeLabel: AR_DOC_LABEL[i.type as keyof typeof AR_DOC_LABEL] ?? i.type,
    date: i.date.toISOString(),
    total: round2(i.total),
    paid: round2(i.paid),
    status: i.status,
    partnerCode: i.partner.code,
    hasBundle: bundleMap.has(i.id),
    bundleNames: [...(bundleMap.get(i.id) ?? [])],
    loyaltyPointsRedeemed: i.loyaltyPointsRedeemed,
    loyaltyPointsEarned: i.loyaltyPointsEarned,
  }))

  const invoicesTotals = {
    count: invoices.length,
    total: round2(invoices.reduce((s, i) => s + i.total, 0)),
    paid: round2(invoices.reduce((s, i) => s + i.paid, 0)),
  }

  // ===== 3) الموارد البشرية للأدوار الموظفية =====
  const employeeIds = group.filter((f) => f.kind === 'EMPLOYEE').map((f) => f.fileId)
  const advances: UnifiedAdvanceRow[] =
    employeeIds.length > 0
      ? (
          await db.advance.findMany({
            where: { employeeId: { in: employeeIds } },
            select: { date: true, amount: true, status: true, reason: true },
            orderBy: [{ date: 'desc' }, { id: 'desc' }],
          })
        ).map((a) => ({
          date: a.date.toISOString(),
          amount: round2(a.amount),
          status: a.status,
          reason: a.reason,
        }))
      : []
  const salariesAgg =
    employeeIds.length > 0
      ? await db.salary.aggregate({
          where: { employeeId: { in: employeeIds }, status: 'PAID' },
          _count: { _all: true },
          _sum: { net: true },
        })
      : null

  // ===== 4) نقاط الولاء لملفات العملاء =====
  const customerFiles = group.filter((f) => f.kind === 'CUSTOMER')
  const customerIds = customerFiles.map((f) => f.fileId)
  const loyaltyTxs =
    customerIds.length > 0
      ? await db.loyaltyTransaction.findMany({
          where: { customerId: { in: customerIds } },
          select: { customerId: true, points: true, createdAt: true },
        })
      : []
  const loyaltyByCustomer = new Map<string, { balance: number; movements: number; last: Date | null }>()
  for (const t of loyaltyTxs) {
    const cur = loyaltyByCustomer.get(t.customerId) ?? { balance: 0, movements: 0, last: null }
    cur.balance += t.points
    cur.movements += 1
    if (!cur.last || t.createdAt > cur.last) cur.last = t.createdAt
    loyaltyByCustomer.set(t.customerId, cur)
  }
  const loyalty: UnifiedLoyaltySummary[] = customerFiles
    .map((f) => {
      const t = loyaltyByCustomer.get(f.fileId)
      return {
        fileCode: f.fileCode,
        customerName: f.fileName,
        balance: t?.balance ?? 0,
        movements: t?.movements ?? 0,
        lastDate: t?.last ? t.last.toISOString() : null,
      }
    })
    .sort((a, b) => b.balance - a.balance)

  // أطول اسم هو الأدق — وأدوار المجموعة مرتبة بأكواد الحسابات
  const name = group.reduce((a, b) => (b.fileName.length > a.fileName.length ? b : a)).fileName

  return {
    person: {
      name,
      multiRole: group.length > 1,
      roles: balances.sort((a, b) =>
        (a.accountCode ?? '').localeCompare(b.accountCode ?? '', 'en', { numeric: true }),
      ),
      combinedBalance,
    },
    docs,
    totals,
    invoices,
    invoicesTotals,
    hr: {
      isEmployee: employeeIds.length > 0,
      salaries: {
        count: salariesAgg?._count._all ?? 0,
        totalPaid: round2(salariesAgg?._sum.net ?? 0),
      },
      advances,
    },
    loyalty,
  }
}
