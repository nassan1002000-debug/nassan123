// القيود المحاسبية للتسويات المخزنية (مرحلة صفر P0-3) — جرد وتلف
// القاعدة: أي خروج أو تسوية مخزون يجب أن يصل إلى دفتر الأستاذ — حساب المخزون (1140)
// لا يتحرك إلا بقيد مقابل، والفرق (عجز/زيادة/تلف) يظهر في قائمة الدخل فوراً
//
// الدليل المحاسبي:
//   جرد بعجز (المجرود أقل من الدفترية):   مدين: 5800 مصروف فروق الجرد — دائن: 1140 المخزون
//   جرد بزيادة (المجرود أكثر من الدفترية): مدين: 1140 المخزون — دائن: 4140 إيراد فروق الجرد
//   تلف مخزون:                             مدين: 5700 مصروف التلف والهالك — دائن: 1140 المخزون
//
// تُنشأ الحسابات الثلاثة الجديدة نظاميةً عند أول قيد (نفس منهج ensureInvoiceAccounts)

import type { Prisma } from '@prisma/client'
import { nextEntryNumber, round2 } from '@/lib/journal-server'
import { StockError } from '@/lib/stock-server'
import { assertPeriodOpen } from '@/lib/period-server'

type Tx = Prisma.TransactionClient

interface StockAccountSpec {
  code: string
  name: string
  type: string
  nature: string
  parent: string | null
}

/** حسابات التسويات المخزنية — 1140 موجود بالدليل الأساسي والثلاثة الباقية تُنشأ عند أول حاجة */
const STOCK_ACCOUNTS: Record<string, StockAccountSpec> = {
  INVENTORY: { code: '1140', name: 'المخزون', type: 'ASSET', nature: 'DEBIT', parent: '1100' },
  DAMAGE_EXPENSE: { code: '5700', name: 'مصروف تلف وهالك المخزون', type: 'EXPENSE', nature: 'DEBIT', parent: '5000' },
  VARIANCE_EXPENSE: { code: '5800', name: 'مصروف فروق الجرد', type: 'EXPENSE', nature: 'DEBIT', parent: '5000' },
  VARIANCE_REVENUE: { code: '4140', name: 'إيراد فروق الجرد', type: 'REVENUE', nature: 'CREDIT', parent: '4000' },
}

/** ضمان وجود حسابات التسويات المخزنية — تُنشأ نظاميةً تحت آبائها إن غابت */
async function ensureStockAccounts(tx: Tx): Promise<Map<string, string>> {
  const all = await tx.account.findMany({ select: { id: true, code: true } })
  const byCode = new Map(all.map((a) => [a.code, a.id]))

  for (const acc of Object.values(STOCK_ACCOUNTS)) {
    if (!byCode.has(acc.code)) {
      const parentId = acc.parent ? (byCode.get(acc.parent) ?? null) : null
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

export interface StocktakingVarianceLine {
  itemId: string
  itemName: string
  difference: number // موجب = زيادة على الدفترية / سالب = عجز
  unitCost: number
}

/**
 * قيد تسوية الجرد داخل معاملة الترحيل — سطر لكل مادة بفرق (لا قيد إطلاقاً بلا فروقات)
 * يرجع معرف القيد ورقمه أو null إن لم توجد فروقات
 */
export async function postStocktakingJournal(
  tx: Tx,
  input: {
    orderId: string
    number: string
    date: Date
    lines: StocktakingVarianceLine[]
  },
): Promise<{ id: string; number: string } | null> {
  // إنفاذ الفترات المقفلة أولاً وبلا شرط — قبل أي فحص على القيمة. كان الترتيب
  // معكوساً فيتجاوز الحرس أي أمر جرد فروقه كلها بلا قيمة محاسبية (مواد بلا تكلفة
  // معروفة): الكمية تتغير فعلياً عبر setBalance في المسار الذي يستدعي هذه
  // الدالة داخل نفس المعاملة، فسقوط الحرس هنا كان يعني ترحيل فروق كمية حقيقية
  // في فترة مقفلة بصفر قيد وبصفر رفض
  await assertPeriodOpen(tx, input.date, 'ترحيل أمر الجرد')

  const variances = input.lines
    .map((ln) => ({ ...ln, value: round2(ln.difference * ln.unitCost) }))
    .filter((ln) => ln.value !== 0)
  if (variances.length === 0) return null

  const byCode = await ensureStockAccounts(tx)
  const specs: {
    accountId: string
    debit: number
    credit: number
    description: string
  }[] = []

  for (const ln of variances) {
    if (ln.value > 0) {
      // زيادة: المخزون مدين بمقابله إيراد فروق الجرد
      specs.push({
        accountId: byCode.get(STOCK_ACCOUNTS.INVENTORY.code)!,
        debit: ln.value,
        credit: 0,
        description: `زيادة جرد — ${ln.itemName}`,
      })
      specs.push({
        accountId: byCode.get(STOCK_ACCOUNTS.VARIANCE_REVENUE.code)!,
        debit: 0,
        credit: ln.value,
        description: `زيادة جرد — ${ln.itemName}`,
      })
    } else {
      // عجز: مصروف فروق الجرد مدين بمقابله المخزون
      const abs = round2(Math.abs(ln.value))
      specs.push({
        accountId: byCode.get(STOCK_ACCOUNTS.VARIANCE_EXPENSE.code)!,
        debit: abs,
        credit: 0,
        description: `عجز جرد — ${ln.itemName}`,
      })
      specs.push({
        accountId: byCode.get(STOCK_ACCOUNTS.INVENTORY.code)!,
        debit: 0,
        credit: abs,
        description: `عجز جرد — ${ln.itemName}`,
      })
    }
  }

  const totalDebit = round2(specs.reduce((s, l) => s + l.debit, 0))
  const totalCredit = round2(specs.reduce((s, l) => s + l.credit, 0))
  if (Math.abs(totalDebit - totalCredit) >= 0.01 || totalDebit === 0) {
    throw new StockError(
      `قيد تسوية الجرد غير متوازن (مدين ${totalDebit.toFixed(2)} / دائن ${totalCredit.toFixed(2)})`,
    )
  }

  const number = await nextEntryNumber(tx)
  const entry = await tx.journalEntry.create({
    data: {
      number,
      date: input.date,
      description: `قيد تسوية جرد ${input.number} — ${variances.length} مادة بفروقات`,
      source: 'STOCK',
      status: 'POSTED',
      totalDebit,
      totalCredit,
      refType: 'STOCKTAKING',
      refId: input.orderId,
      lines: {
        create: specs.map((l, i) => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          description: l.description,
          order: i,
        })),
      },
    },
    select: { id: true, number: true },
  })
  return entry
}

/**
 * قيد التلف المخزني داخل معاملة التسجيل — مدين مصروف التلف والهالك / دائن المخزون
 * بقيمة الحركة (الكمية × التكلفة) — يربط القيد بالحركة refType=DAMAGE/refId
 */
export async function postDamageJournal(
  tx: Tx,
  input: {
    movementId: string
    date: Date
    itemName: string
    value: number
    reasonText: string
  },
): Promise<{ id: string; number: string } | null> {
  // إنفاذ الفترات المقفلة أولاً وبلا شرط — قبل فحص القيمة. كان الترتيب معكوساً
  // فيتجاوز الحرس تلفاً على مادة بلا تكلفة معروفة (value=0): الكمية تخرج
  // فعلياً من الرصيد عبر applyBalanceDelta في نفس معاملة الاستدعاء، فسقوط
  // الحرس هنا كان يعني إخراج كمية حقيقية من فترة مقفلة بصفر قيد وبصفر رفض
  await assertPeriodOpen(tx, input.date, 'حركة التلف')

  const value = round2(input.value)
  if (value <= 0) return null

  const byCode = await ensureStockAccounts(tx)
  const totalDebit = round2(value)
  const totalCredit = round2(value)

  const number = await nextEntryNumber(tx)
  const entry = await tx.journalEntry.create({
    data: {
      number,
      date: input.date,
      description: `قيد تلف مخزون — ${input.itemName} (${input.reasonText})`,
      source: 'STOCK',
      status: 'POSTED',
      totalDebit,
      totalCredit,
      refType: 'DAMAGE',
      refId: input.movementId,
      lines: {
        create: [
          {
            accountId: byCode.get(STOCK_ACCOUNTS.DAMAGE_EXPENSE.code)!,
            debit: totalDebit,
            credit: 0,
            description: `تلف وهالك — ${input.itemName}`,
            order: 0,
          },
          {
            accountId: byCode.get(STOCK_ACCOUNTS.INVENTORY.code)!,
            debit: 0,
            credit: totalCredit,
            description: `إخراج تالف من المخزون — ${input.itemName}`,
            order: 1,
          },
        ],
      },
    },
    select: { id: true, number: true },
  })
  return entry
}

/**
 * عكس قيد التلف المرتبط عند حذف حالة التلف — إلغاء لا حذف (نفس نمط
 * cancelPaymentJournal): الحركة قد تكون بلا قيد أصلاً إن كانت قيمتها صفرية
 * (postDamageJournal لا ينشئ قيداً حينها) فتُعاد null بأمان
 */
export async function cancelDamageJournal(tx: Tx, movementId: string): Promise<string | null> {
  const linked = await tx.journalEntry.findFirst({
    where: { refType: 'DAMAGE', refId: movementId, status: 'POSTED' },
    select: { id: true, number: true },
  })
  if (!linked) return null
  await tx.journalEntry.update({ where: { id: linked.id }, data: { status: 'CANCELLED' } })
  return linked.number
}
