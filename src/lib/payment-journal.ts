// القيود المحاسبية التلقائية لسندات القبض/الدفع المستقلة — قيد مزدوج مُرحّل فوراً مع كل سند
// يُنشأ داخل معاملة إنشاء السند، ويُلغى (CANCELLED) عند حذف السند من payments/[id]
//
// الدليل المحاسبي (مطابق لآلية الفواتير في invoice-journal.ts — نفس الحسابات النظامية):
//   سند قبض (من عميل):   مدين: الصندوق (1110) أو البنك (1120) حسب method — دائن: العملاء (1130) بالمبلغ
//   سند دفع (لمورد):     مدين: الموردون (2110) بالمبلغ — دائن: الصندوق أو البنك حسب method
//   سند دفع مصروف:       مدين: حساب المصروف من الدليل (5xxx) بالمبلغ — دائن: الصندوق أو البنك حسب method  ← Task 102
//   سند دفع لحساب موظف:  مدين: الحساب الشخصي للموظف (115xxx) بالمبلغ — دائن: الصندوق أو البنك حسب method  ← Task 104
//   سند قبض من حساب موظف: مدين: الصندوق أو البنك حسب method — دائن: الحساب الشخصي للموظف (115xxx)      ← Task 104
//   شيك (CHEQUE):        لا قيد الآن — يبقى على ذمة الطرف حتى الصرف (ذهبية مستقبلية) — ووضع المصروف يرفض الشيك كلياً
//   بلا طرف ولا حساب (partnerId/accountId فارغان): لا قيد — حركة صندوق محضة
//   سند مرتبط بفاتورة (invoiceId غير فارغ): فاتورةٌ أنشأت قيدها عبر postInvoiceJournal —
//                         لا قيد مزدوج للسند (تخطٍ مقصود)
//
// التوازن مضمون بنيوياً: مبلغ واحد بطرفين (مدين = دائن = المبلغ)

import type { Prisma } from '@prisma/client'
import { nextEntryNumber, round2 } from '@/lib/journal-server'
import { ensureInvoiceAccounts, INVOICE_ACCOUNTS } from '@/lib/invoice-journal'
import { assertPeriodOpen } from '@/lib/period-server'

type Tx = Prisma.TransactionClient

/** سطر قيد — نفس بنية JLineSpec في invoice-journal */
interface JLineSpec {
  code: string
  name: string
  type: string
  nature: string
  debit?: number
  credit?: number
  description: string
}

export interface PaymentJournalInput {
  paymentId: string
  type: string // RECEIPT | PAYMENT
  date: Date
  number: string // VCH-xxxx
  amount: number
  method: string // CASH | BANK | CHEQUE
  partnerId: string | null
  partnerName: string
  /** كود الحساب الفرعي للطرف — سطر الذمة يُقيّد عليه تحت حساب التحكم إن توفر */
  partnerAccountCode?: string | null
  /** وضع المصروف (Task 102) — سند دفع بلا طرف مُقيَّد مباشرة على حساب مصروف من الدليل */
  accountId?: string | null
  accountCode?: string | null
  accountName?: string | null
  accountType?: string | null
  accountNature?: string | null
  /** نوع الحساب المُقيَّد عليه: EXPENSE مصروف | EMPLOYEE حساب موظف شخصي (Task 104) */
  accountKind?: string | null
  /** إن كان السند مولّداً من فاتورة — لا يُنشأ له قيد (قيد الفاتورة يغطي الدفعة) */
  invoiceId: string | null
}

/**
 * ترحيل القيد المحاسبي التلقائي للسند المستقل داخل المعاملة — قيد مزدوج مُرحّل (POSTED)
 * مرتبط بالسند بـ refType=PAYMENT/refId — ويرجع رقم القيد أو null إن لم يوجد قيد (شيك/بلا طرف/مرتبط بفاتورة)
 */
export async function postPaymentJournal(tx: Tx, input: PaymentJournalInput): Promise<string | null> {
  // سند مرتبط بفاتورة: قيد الفاتورة التلقائي يغطي الدفعة — تخطٍ مقصود لمنع القيد المزدوج
  if (input.invoiceId) return null

  // إنفاذ الفترات المقفلة: سند مؤرّخ داخل فترة مقفلة ⇒ رفض الترحيل
  await assertPeriodOpen(tx, input.date, input.type === 'RECEIPT' ? 'سند قبض' : 'سند دفع')

  // الشيك: يبقى على ذمة الطرف حتى صرفه — لا قيد الآن (وضع المصروف يرفض الشيك في التحقق أصلاً)
  if (input.method === 'CHEQUE') return null

  // بلا طرف: إما سند مُقيَّد على حساب من الدليل (مصروف/موظف) أو حركة صندوق محضة بلا قيد مزدوج
  if (!input.partnerId) {
    // Task 102/104 — سند على حساب من الدليل:
    //  مصروف (دفع حصراً):  مدين حساب المصروف / دائن الصندوق أو البنك
    //  حساب موظف (دفع):    مدين الحساب الشخصي للموظف / دائن الصندوق أو البنك
    //  حساب موظف (قبض):    مدين الصندوق أو البنك / دائن الحساب الشخصي للموظف
    if (input.accountId && input.accountCode) {
      const amount = round2(input.amount)
      if (!(amount > 0)) return null
      const byCode = await ensureInvoiceAccounts(tx)
      const targetId = byCode.get(input.accountCode)
      if (!targetId) {
        // حماية دفاعية — الحساب تحقق من وجوده في validatePaymentBody قبل المعاملة
        throw new Error(`الحساب ${input.accountCode} غير موجود في الدليل — تعذر ترحيل قيد السند ${input.number}`)
      }
      const cashBank = input.method === 'BANK' ? INVOICE_ACCOUNTS.BANK : INVOICE_ACCOUNTS.CASH
      const methodWord = input.method === 'BANK' ? 'بنكي' : 'نقدي'
      const isEmployee = input.accountKind === 'EMPLOYEE'
      const isReceipt = input.type === 'RECEIPT'
      const accName = input.accountName ?? (isEmployee ? 'حساب موظف' : 'مصروف')
      const doc = isEmployee
        ? `سند ${isReceipt ? 'قبض' : 'دفع'} رقم ${input.number} — حساب موظف: ${accName}`
        : `سند دفع رقم ${input.number} — مصروف: ${accName}`

      const accSpec: Omit<JLineSpec, 'description'> = {
        code: input.accountCode,
        name: accName,
        type: input.accountType ?? (isEmployee ? 'ASSET' : 'EXPENSE'),
        nature: input.accountNature ?? 'DEBIT',
      }

      // الطرفان: مدين واحد ودائن واحد بالمبلغ نفسه — التوازن مضمون بنيوياً
      const specs: JLineSpec[] =
        isEmployee && isReceipt
          ? [
              { ...cashBank, debit: amount, description: `استلام ${methodWord} — ${doc}` },
              { ...accSpec, credit: amount, description: `ردّ من حساب الموظف ${accName} — ${doc}` },
            ]
          : [
              {
                ...accSpec,
                debit: amount,
                description: isEmployee ? `صرف لحساب الموظف ${accName} — ${doc}` : `مصروف ${accName} — ${doc}`,
              },
              { ...cashBank, credit: amount, description: `دفع ${methodWord} — ${doc}` },
            ]

      const totalDebit = round2(specs.reduce((s, l) => s + (l.debit ?? 0), 0))
      const totalCredit = round2(specs.reduce((s, l) => s + (l.credit ?? 0), 0))
      if (Math.abs(totalDebit - totalCredit) >= 0.01) {
        throw new Error(`قيد السند ${input.number} غير متوازن (مدين ${totalDebit.toFixed(2)} / دائن ${totalCredit.toFixed(2)})`)
      }

      const number = await nextEntryNumber(tx)
      await tx.journalEntry.create({
        data: {
          number,
          date: input.date,
          description: doc,
          source: input.type, // PAYMENT | RECEIPT
          status: 'POSTED',
          totalDebit,
          totalCredit,
          refType: 'PAYMENT',
          refId: input.paymentId,
          lines: {
            create: specs.map((l, i) => ({
              accountId: byCode.get(l.code)!,
              debit: round2(l.debit ?? 0),
              credit: round2(l.credit ?? 0),
              description: l.description,
              order: i,
            })),
          },
        },
        select: { id: true },
      })
      return number
    }
    // بلا طرف ولا حساب: حركة صندوق محضة بلا قيد مزدوج
    return null
  }

  const amount = round2(input.amount)
  if (!(amount > 0)) return null

  const isReceipt = input.type === 'RECEIPT'
  const byCode = await ensureInvoiceAccounts(tx)

  // نفس آلية الفواتير: CASH → 1110 الصندوق | BANK → 1120 البنك | الطرف عبر حسابه الفرعي تحت 1130/2110
  const cashBank = input.method === 'BANK' ? INVOICE_ACCOUNTS.BANK : INVOICE_ACCOUNTS.CASH
  const control = isReceipt ? INVOICE_ACCOUNTS.AR : INVOICE_ACCOUNTS.AP
  // الحساب الفرعي للطرف يُعتمد إن وُجد فعلاً في الدليل وإلا عاد حساب التحكم — بنفس النوع والطبيعة
  const partnerCode =
    input.partnerAccountCode && byCode.has(input.partnerAccountCode)
      ? input.partnerAccountCode
      : control.code
  const partnerAccount: Omit<JLineSpec, 'description'> = {
    code: partnerCode,
    name: control.name,
    type: control.type,
    nature: control.nature,
  }
  const methodWord = input.method === 'BANK' ? 'بنكي' : 'نقدي'
  const doc = `سند ${isReceipt ? 'قبض' : 'دفع'} رقم ${input.number} — الطرف ${input.partnerName}`

  // الطرفان: مدين واحد ودائن واحد بالمبلغ نفسه — التوازن مضمون
  const specs: JLineSpec[] = isReceipt
    ? [
        { ...cashBank, debit: amount, description: `استلام ${methodWord} — ${doc}` },
        { ...partnerAccount, credit: amount, description: `تسديد العميل ${input.partnerName} — ${doc}` },
      ]
    : [
        { ...partnerAccount, debit: amount, description: `سداد للمورد ${input.partnerName} — ${doc}` },
        { ...cashBank, credit: amount, description: `دفع ${methodWord} — ${doc}` },
      ]

  const totalDebit = round2(specs.reduce((s, l) => s + (l.debit ?? 0), 0))
  const totalCredit = round2(specs.reduce((s, l) => s + (l.credit ?? 0), 0))
  if (Math.abs(totalDebit - totalCredit) >= 0.01) {
    // حماية دفاعية — لا يُفترض الوصول إليها إطلاقاً (مبلغ واحد بطرفين)
    throw new Error(`قيد السند ${input.number} غير متوازن (مدين ${totalDebit.toFixed(2)} / دائن ${totalCredit.toFixed(2)})`)
  }

  const number = await nextEntryNumber(tx)
  await tx.journalEntry.create({
    data: {
      number,
      date: input.date,
      description: doc,
      source: input.type, // RECEIPT | PAYMENT
      status: 'POSTED',
      totalDebit,
      totalCredit,
      refType: 'PAYMENT',
      refId: input.paymentId,
      lines: {
        create: specs.map((l, i) => ({
          accountId: byCode.get(l.code)!,
          debit: round2(l.debit ?? 0),
          credit: round2(l.credit ?? 0),
          description: l.description,
          order: i,
        })),
      },
    },
    select: { id: true },
  })
  return number
}

/**
 * إلغاء القيد المرتبط بسند مستقل (عند حذف السند) — نفس آلية الإلغاء في journal/[id]/cancel:
 * القيد POSTED بحالة refType=PAYMENT/refId يُحوَّل CANCELLED داخل معاملة الحذف نفسها
 */
export async function cancelPaymentJournal(tx: Tx, paymentId: string): Promise<string | null> {
  const linked = await tx.journalEntry.findFirst({
    where: { refType: 'PAYMENT', refId: paymentId, status: 'POSTED' },
    select: { id: true, number: true },
  })
  if (!linked) return null
  await tx.journalEntry.update({
    where: { id: linked.id },
    data: { status: 'CANCELLED' },
  })
  return linked.number
}
