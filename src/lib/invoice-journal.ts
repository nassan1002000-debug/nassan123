// القيود المحاسبية التلقائية للفواتير — قيد مزدوج مُرحّل فوراً مع كل فاتورة
// يُنشأ داخل معاملة إنشاء/تعديل الفاتورة، ويُحذف ويعاد إنشاؤه عند التعديل، ويُحذف مع الفاتورة
//
// الدليل المحاسبي (مخزون دائم):
//   بيع:                مدين: الصندوق/البنك/العملاء (الصافي) + الحسم الممنوح — دائن: المبيعات + الضريبة
//                        وقيد التكلفة: مدين تكلفة المبيعات — دائن المخزون (بسعر شراء المواد)
//   مردود بيع:          عكس قيد البيع (مدين مردود المبيعات + الضريبة — دائن الطرف/الصندوق)
//   مشتريات:            مدين المخزون + الضريبة — دائن: الصندوق/البنك/الموردون (الصافي) + الحسم المكتسب
//   مردود مشتريات:      عكس قيد الشراء
//   الدفعات: نقداً → 1110 الصندوق | بنك → 1120 البنك | شيك → يبقى على ذمة الطرف حتى الصرف

import type { Prisma } from '@prisma/client'
import { nextEntryNumber, round2 } from '@/lib/journal-server'
import { AR_DOC_LABEL, InvoiceError, isSalesFamily, type InvoiceType } from '@/lib/invoices-server'
import { assertPeriodOpen } from '@/lib/period-server'

interface JLineSpec {
  code: string
  name: string
  type: string
  nature: string
  debit?: number
  credit?: number
  description: string
}

/** أكواد الحسابات النظامية المستخدمة في قيود الفواتير */
export const INVOICE_ACCOUNTS = {
  CASH: { code: '1110', name: 'الصندوق', type: 'ASSET', nature: 'DEBIT' },
  BANK: { code: '1120', name: 'البنك', type: 'ASSET', nature: 'DEBIT' },
  AR: { code: '1130', name: 'العملاء (ذمم مدينة)', type: 'ASSET', nature: 'DEBIT' },
  ADVANCES: { code: '1150', name: 'سلف الموظفين', type: 'ASSET', nature: 'DEBIT' },
  INVENTORY: { code: '1140', name: 'المخزون', type: 'ASSET', nature: 'DEBIT' },
  AP: { code: '2110', name: 'الموردون (ذمم دائنة)', type: 'LIABILITY', nature: 'CREDIT' },
  VAT: { code: '2120', name: 'ضريبة القيمة المضافة', type: 'LIABILITY', nature: 'CREDIT' },
  SALES: { code: '4100', name: 'إيرادات المبيعات', type: 'REVENUE', nature: 'CREDIT' },
  DISCOUNT_GIVEN: { code: '4110', name: 'الحسم الممنوح', type: 'REVENUE', nature: 'DEBIT' },
  SALES_RETURN: { code: '4120', name: 'مردود المبيعات', type: 'REVENUE', nature: 'DEBIT' },
  DISCOUNT_EARNED: { code: '4130', name: 'الحسم المكتسب', type: 'REVENUE', nature: 'CREDIT' },
  COGS: { code: '5100', name: 'تكلفة المبيعات', type: 'EXPENSE', nature: 'DEBIT' },
  SALARIES: { code: '5200', name: 'مصروف الرواتب والأجور', type: 'EXPENSE', nature: 'DEBIT' },
} as const

type Tx = Prisma.TransactionClient

/** الآباء المتوقعون لكل حساب نظامي — إن وُجد في الدليل يُربط به وإلا يبقى جذر */
const ACCOUNT_PARENT_CODE: Record<string, string> = {
  '1110': '1100',
  '1120': '1100',
  '1130': '1100',
  '1140': '1100',
  '1150': '1100',
  '2110': '2100',
  '2120': '2100',
  '4100': '4000',
  '4110': '4000',
  '4120': '4000',
  '4130': '4000',
  '5100': '5000',
  '5200': '5000',
}

/**
 * ضمان وجود كل حسابات النظام المستخدمة في قيود الفواتير — تُنشأ نظامية إن غابت
 * (حسابات الحسم والمردود غائبة عن البذرة وتُنشأ عند أول قيد)
 * يُعاد استعمالها من payment-journal لقيود السندات المستقلة — نفس الحسابات بالضبط
 */
export async function ensureInvoiceAccounts(tx: Tx): Promise<Map<string, string>> {
  const all = await tx.account.findMany({ select: { id: true, code: true } })
  const byCode = new Map(all.map((a) => [a.code, a.id]))

  for (const acc of Object.values(INVOICE_ACCOUNTS)) {
    if (!byCode.has(acc.code)) {
      const parentCode = ACCOUNT_PARENT_CODE[acc.code]
      const parentId = parentCode ? (byCode.get(parentCode) ?? null) : null
      const created = await tx.account.create({
        data: {
          code: acc.code,
          name: acc.name,
          type: acc.type,
          nature: acc.nature,
          isSystem: true,
          parentId,
        },
        select: { id: true },
      })
      byCode.set(acc.code, created.id)
    }
  }
  return byCode
}

export interface InvoiceJournalInput {
  invoiceId: string
  type: InvoiceType
  date: Date
  number: string
  partnerName: string
  subtotal: number
  tax: number
  discount: number
  netTotal: number
  /** الدفعات المصاحبة — طريقة كل دفعة تحدد الحساب (نقداً/بنك/ذمة الطرف) */
  payments: { amount: number; method: string }[]
  /** تكلفة البنود = Σ الكمية × سعر شراء المادة — لقيد تكلفة المبيعات */
  cost: number
  /** أسماء سلال العروض المطبقة — تُوثق في وصف سطر الحسم الممنوح (4110) */
  bundleNames?: string[]
  /** مركز التكلفة (اختياري) — يُنسب إليه القيد كاملاً (كل سطوره) عند اختياره */
  costCenterId?: string | null
  /** كود الحساب الفرعي للطرف (اختياري) — سطر الذمة يُقيّد على حساب العميل/المورد الفرعي
   *  تحت حساب التحكم بدلاً من حساب التحكم مباشرة — وإن غاب أو لم يوجد يُستخدم حساب التحكم */
  partnerAccountCode?: string | null
}

/** بناء سطور القيد حسب نوع الفاتورة — متوازنة رياضياً بشرط الصافي = المجموع + الضريبة − الحسم
 *  partnerAccountCode: كود الحساب الفرعي للطرف — سطور الذمة (AR/AP) تُقيّد عليه بدل حساب التحكم */
function buildLines(input: InvoiceJournalInput, partnerAccountCode: string | null): JLineSpec[] {
  const A = INVOICE_ACCOUNTS
  const salesFamily = isSalesFamily(input.type)
  // الحساب الفعلي لسطر الذمة: الفرعي للطرف إن توفر وإلا حساب التحكم — بنفس النوع والطبيعة
  const partnerAcc: Omit<JLineSpec, 'description'> = salesFamily
    ? { ...(partnerAccountCode ? { code: partnerAccountCode, name: A.AR.name, type: A.AR.type, nature: A.AR.nature } : A.AR) }
    : { ...(partnerAccountCode ? { code: partnerAccountCode, name: A.AP.name, type: A.AP.type, nature: A.AP.nature } : A.AP) }
  const paidCash = round2(input.payments.filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amount, 0))
  const paidBank = round2(input.payments.filter((p) => p.method === 'BANK').reduce((s, p) => s + p.amount, 0))
  // الشيك يبقى على ذمة الطرف حتى صرفه — والباقي آجل
  const partnerAmt = round2(input.netTotal - paidCash - paidBank)
  const tax = round2(input.tax)
  const discount = round2(input.discount)
  const cost = round2(input.cost)
  const doc = `${input.number} — ${input.partnerName}`
  // وصف الحسم الممنوح يوثق سلال العروض عند وجودها — الحسم كله يُرحّل إلى 4110
  const bundleNote = input.bundleNames?.length ? ` (سلال العروض: ${input.bundleNames.join('، ')})` : ''
  const lines: JLineSpec[] = []

  if (input.type === 'SALE') {
    if (paidCash > 0) lines.push({ ...A.CASH, debit: paidCash, description: `تحصيل نقدي مع الفاتورة ${doc}` })
    if (paidBank > 0) lines.push({ ...A.BANK, debit: paidBank, description: `تحصيل بنكي مع الفاتورة ${doc}` })
    if (partnerAmt > 0) lines.push({ ...partnerAcc, debit: partnerAmt, description: `مديونية العميل بالفاتورة ${doc}` })
    if (discount > 0) lines.push({ ...A.DISCOUNT_GIVEN, debit: discount, description: `الحسم الممنوح${bundleNote} — ${doc}` })
    lines.push({ ...A.SALES, credit: input.subtotal, description: `إيرادات المبيعات — ${doc}` })
    if (tax > 0) lines.push({ ...A.VAT, credit: tax, description: `ضريبة المخرجات — ${doc}` })
    if (cost > 0) {
      lines.push({ ...A.COGS, debit: cost, description: `تكلفة البضاعة المباعة — ${doc}` })
      lines.push({ ...A.INVENTORY, credit: cost, description: `صرف مخزون بالفاتورة ${doc}` })
    }
  } else if (input.type === 'SALES_RETURN') {
    lines.push({ ...A.SALES_RETURN, debit: input.subtotal, description: `مردود المبيعات — ${doc}` })
    if (tax > 0) lines.push({ ...A.VAT, debit: tax, description: `تخفيض ضريبة المخرجات — ${doc}` })
    if (paidCash > 0) lines.push({ ...A.CASH, credit: paidCash, description: `إرجاع نقدي — ${doc}` })
    if (paidBank > 0) lines.push({ ...A.BANK, credit: paidBank, description: `إرجاع بنكي — ${doc}` })
    if (partnerAmt > 0) lines.push({ ...partnerAcc, credit: partnerAmt, description: `إرجاع على حساب العميل — ${doc}` })
    if (discount > 0) lines.push({ ...A.DISCOUNT_GIVEN, credit: discount, description: `ردّ الحسم الممنوح — ${doc}` })
    if (cost > 0) {
      lines.push({ ...A.INVENTORY, debit: cost, description: `إرجاع مخزون بالفاتورة ${doc}` })
      lines.push({ ...A.COGS, credit: cost, description: `تخفيض تكلفة المبيعات — ${doc}` })
    }
  } else if (input.type === 'PURCHASE') {
    lines.push({ ...A.INVENTORY, debit: input.subtotal, description: `إدخال بضاعة للمخزون — ${doc}` })
    if (tax > 0) lines.push({ ...A.VAT, debit: tax, description: `ضريبة المدخلات — ${doc}` })
    if (discount > 0) lines.push({ ...A.DISCOUNT_EARNED, credit: discount, description: `الحسم المكتسب — ${doc}` })
    if (paidCash > 0) lines.push({ ...A.CASH, credit: paidCash, description: `سداد نقدي مع الفاتورة ${doc}` })
    if (paidBank > 0) lines.push({ ...A.BANK, credit: paidBank, description: `سداد بنكي مع الفاتورة ${doc}` })
    if (partnerAmt > 0) lines.push({ ...partnerAcc, credit: partnerAmt, description: `دائنية المورد بالفاتورة ${doc}` })
  } else {
    // PURCHASE_RETURN
    if (partnerAmt > 0) lines.push({ ...partnerAcc, debit: partnerAmt, description: `تخفيض دائنية المورد — ${doc}` })
    if (paidCash > 0) lines.push({ ...A.CASH, debit: paidCash, description: `استرداد نقدي — ${doc}` })
    if (paidBank > 0) lines.push({ ...A.BANK, debit: paidBank, description: `استرداد بنكي — ${doc}` })
    if (discount > 0) lines.push({ ...A.DISCOUNT_EARNED, debit: discount, description: `ردّ الحسم المكتسب — ${doc}` })
    lines.push({ ...A.INVENTORY, credit: input.subtotal, description: `إرجاع بضاعة من المخزون — ${doc}` })
    if (tax > 0) lines.push({ ...A.VAT, credit: tax, description: `تخفيض ضريبة المدخلات — ${doc}` })
  }

  return lines.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0)
}

/**
 * ترحيل القيد المحاسبي التلقائي للفاتورة داخل المعاملة — قيد مزدوج مُرحّل (POSTED)
 * مرتبط بالفاتورة بـ refType=INVOICE/refId — ويرمي InvoiceError إن لم يتوازن (حماية).
 */
export async function postInvoiceJournal(tx: Tx, input: InvoiceJournalInput): Promise<string> {
  // إنفاذ الفترات المقفلة: فاتورة مؤرّخة داخل فترة مقفلة ⇒ رفض الترحيل (يغطي الإنشاء والتعديل معاً)
  await assertPeriodOpen(tx, input.date, AR_DOC_LABEL[input.type], (m) => new InvoiceError(m))
  const byCode = await ensureInvoiceAccounts(tx)
  // التحقق من الحساب الفرعي للطرف: يُعتمد إن وُجد فعلاً في الدليل وإلا عاد لحساب التحكم
  let partnerAccountCode = input.partnerAccountCode ?? null
  if (partnerAccountCode && !byCode.has(partnerAccountCode)) partnerAccountCode = null
  const specs = buildLines(input, partnerAccountCode)
  if (specs.length < 2) throw new InvoiceError('لا يمكن ترحيل قيد فاتورة ببنود فارغة')

  const totalDebit = round2(specs.reduce((s, l) => s + (l.debit ?? 0), 0))
  const totalCredit = round2(specs.reduce((s, l) => s + (l.credit ?? 0), 0))
  if (Math.abs(totalDebit - totalCredit) >= 0.01) {
    throw new InvoiceError(
      `القيد التلقائي غير متوازن (مدين ${totalDebit.toFixed(2)} / دائن ${totalCredit.toFixed(2)}) — أعد التحقق من الحسم والضريبة`,
    )
  }

  const number = await nextEntryNumber(tx)
  const salesFamily = isSalesFamily(input.type)
  const entry = await tx.journalEntry.create({
    data: {
      number,
      date: input.date,
      description: `قيد ${AR_DOC_LABEL[input.type]} ${input.number} — ${input.partnerName}`,
      source: salesFamily ? 'SALES' : 'PURCHASE',
      status: 'POSTED',
      totalDebit,
      totalCredit,
      refType: 'INVOICE',
      refId: input.invoiceId,
      lines: {
        create: specs.map((l, i) => ({
          accountId: byCode.get(l.code)!,
          costCenterId: input.costCenterId ?? null,
          debit: round2(l.debit ?? 0),
          credit: round2(l.credit ?? 0),
          description: l.description,
          order: i,
        })),
      },
    },
    select: { id: true },
  })
  return entry.id
}

/** حذف القيد التلقائي للفاتورة (عند التعديل قبل إعادة الترحيل أو عند حذف الفاتورة) */
export async function deleteInvoiceJournal(tx: Tx, invoiceId: string): Promise<void> {
  await tx.journalEntry.deleteMany({ where: { refType: 'INVOICE', refId: invoiceId } })
}

/**
 * التكلفة الفعلية لكل مادة — نفس مصدر «سعر الشراء» في الواجهة:
 * آخر سعر شراء من بنود فواتير المشتريات (الأحدث أولاً)، وإلا سعر شراء البطاقة المخزّن.
 */
export async function effectiveItemCosts(tx: Tx, itemIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(itemIds)].filter(Boolean)
  const map = new Map<string, number>()
  if (ids.length === 0) return map

  const lines = await tx.invoiceLine.findMany({
    where: { invoice: { type: 'PURCHASE' }, itemId: { in: ids } },
    select: { itemId: true, unitPrice: true },
    orderBy: [{ invoice: { date: 'desc' } }, { id: 'desc' }],
  })
  for (const ln of lines) {
    if (!map.has(ln.itemId) && ln.unitPrice > 0) map.set(ln.itemId, ln.unitPrice)
  }

  const missing = ids.filter((id) => !map.has(id))
  if (missing.length > 0) {
    const items = await tx.item.findMany({
      where: { id: { in: missing } },
      select: { id: true, purchasePrice: true },
    })
    for (const it of items) {
      if (it.purchasePrice > 0) map.set(it.id, it.purchasePrice)
    }
  }
  return map
}
