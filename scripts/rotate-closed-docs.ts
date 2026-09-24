/// <reference types="bun-types" />
// تدوير رجعي للمستندات التفصيلية للفترة المقفلة الأحدث — عزل السجلات التفصيلية (Data Isolation)
//
// الغرض: إغلاق الفجوة التاريخية للفترات التي أُقفلت قبل تفعيل تدوير المستندات — القيود
// دُوّرت حينها وحدها وبقيت الفواتير والسندات والحركة المخزنية وسجلات HR ظاهرة في الفترة
// الجديدة. هذا السكربت ينفّذ نفس محرك التدوير rotateClosedPeriodDocs (نفس القواعد حرفياً):
//   • حذف كل مستند مؤرَّخ <= نهاية يوم الإقفال من القاعدة الحية (يعيش كاملاً في النسخة
//     الأرشيفية للفترة — لا يُحذف أي تاريخ أصلي من قاعدة الفترة المغلقة)
//   • ترحيل نقاط الولاء المتبقية بحركات افتتاحية مربوطة بسند القيد الافتتاحي
//   • تثبيت أرضيات الترقيم — وأرضية المقاصات MC- تُقرأ من النسخة الأرشيفية نفسها
//     لأن قيود المقاصة القديمة دُوّرت سابقاً من القاعدة الحية
//
// الاستخدام: bun scripts/rotate-closed-docs.ts
// آمن للتكرار (idempotent): كل ما دُوّر سابقاً لا يطابق شرط التاريخ فتعيد الدورة صفراً
import { PrismaClient } from '@prisma/client'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { numericMaxOf, rotateClosedPeriodDocs } from '../src/lib/period-doc-rotation'

const ROOT = path.resolve(import.meta.dir, '..')
const db = new PrismaClient()

const dayEndIso = (day: string): Date => new Date(`${day}T23:59:59.999Z`)

async function main(): Promise<void> {
  const latest = await db.periodClose.findFirst({ orderBy: { closingDate: 'desc' } })
  if (!latest) {
    console.log('لا توجد فترة مقفلة — لا شيء للتدوير')
    return
  }
  const closingDate = latest.closingDate.toISOString().slice(0, 10)
  const closeEnd = dayEndIso(closingDate)

  // فحص مسبق — إن كان كل شيء نظيفاً فلا معاملة تُفتح
  const [inv, pay, mov, stk, att, bon, adv, lev, sal, loy] = await Promise.all([
    db.invoice.count({ where: { date: { lte: closeEnd } } }),
    db.payment.count({ where: { date: { lte: closeEnd } } }),
    db.stockMovement.count({ where: { date: { lte: closeEnd } } }),
    db.stocktaking.count({ where: { date: { lte: closeEnd } } }),
    db.attendance.count({ where: { date: { lte: closeEnd } } }),
    db.bonusDeduction.count({ where: { date: { lte: closeEnd } } }),
    db.advance.count({ where: { date: { lte: closeEnd } } }),
    db.leave.count({ where: { from: { lte: closeEnd } } }),
    db.salary.count({ where: { month: { lte: closingDate.slice(0, 7) } } }),
    db.loyaltyTransaction.count({ where: { createdAt: { lte: closeEnd } } }),
  ])
  const total = inv + pay + mov + stk + att + bon + adv + lev + sal + loy
  console.log(`الفترة «${latest.label}» — الإقفال: ${closingDate} — سند الافتتاحي: ${latest.openingEntryNumber}`)
  console.log(`سجلات تفصيلية على وشك التدوير: ${total} (فواتير ${inv} · سندات ${pay} · حركة مخزون ${mov} · جرد ${stk} · HR ${att + bon + adv + lev + sal} · نقاط ولاء ${loy})`)
  if (total === 0) {
    console.log('القاعدة الحية نظيفة مسبقاً — لا شيء للتنفيذ')
    return
  }

  // أرضية أرقام المقاصات MC- من النسخة الأرشيفية (قيود المقاصة القديمة دُوّرت من الحية سابقاً)
  const floorOverrides: Record<string, number> = {}
  const snapshotAbs = path.join(ROOT, 'db', 'periods', latest.snapshotFile)
  if (existsSync(snapshotAbs)) {
    const snapshot = new PrismaClient({ datasources: { db: { url: `file:${snapshotAbs}` } } })
    try {
      const mcRows = await snapshot.journalEntry.findMany({
        where: { number: { startsWith: 'MC-' } },
        select: { number: true },
      })
      floorOverrides['MC-'] = numericMaxOf('MC-', mcRows.map((r) => r.number))
      console.log(`أرضية MC- من الأرشيف: ${floorOverrides['MC-']}`)
    } finally {
      await snapshot.$disconnect()
    }
  } else {
    console.log(`تحذير: النسخة الأرشيفية ${latest.snapshotFile} غير موجودة — أرضية MC- من الحية فقط`)
  }

  const result = await db.$transaction((tx) =>
    rotateClosedPeriodDocs(tx, {
      closeEnd,
      closingMonth: closingDate.slice(0, 7),
      label: latest.label,
      openingEntryId: latest.openingEntryId,
      openingEntryNumber: latest.openingEntryNumber,
      openingDay: latest.openingDate,
      floorOverrides,
    }),
  )

  console.log('تم التدوير:', JSON.stringify(result, null, 2))

  // توثيق التدقيق في القاعدة الحية — نفس نمط توثيق الإقفال
  await db.auditLog.create({
    data: {
      action: 'SYSTEM',
      entity: 'PERIOD_ROTATION',
      entityId: latest.id,
      entityNumber: latest.label,
      title: 'تدوير رجعي للمستندات التفصيلية — عزل الفترة المقفلة',
      summary:
        `دُوّرت مستندات الفترة «${latest.label}» المؤرَّخة قبل ${closingDate} من القاعدة الحية ` +
        `(${result.invoices} فاتورة، ${result.payments} سنداً، ${result.stockMovements} حركة مخزون، ` +
        `${result.stocktakings} جرداً، ${result.salaries + result.advances + result.leaves + result.attendance + result.bonuses} سجل HR، ` +
        `${result.loyaltyDeleted} حركة نقاط ولاء مع ${result.loyaltyOpeningRows} رصيد افتتاحي) — ` +
        'تاريخها كامل محفوظ في النسخة الأرشيفية والفترة الجديدة نظيفة تعتمد على الأرصدة المدوّرة',
      details: JSON.stringify({
        'الفترة': latest.label,
        'تاريخ الإقفال': closingDate,
        'سند الافتتاحي': latest.openingEntryNumber,
        'فواتير دُوّرت': result.invoices,
        'سندات دُوّرت': result.payments,
        'حركات مخزون دُوّرت': result.stockMovements,
        'أوامر جرد دُوّرت': result.stocktakings,
        'سجلات HR دُوّرت': result.salaries + result.advances + result.leaves + result.attendance + result.bonuses,
        'حركات نقاط ولاء دُوّرت': result.loyaltyDeleted,
        'أرصدة ولاء افتتاحية أُنشئت': result.loyaltyOpeningRows,
        'أرضيات الترقيم': JSON.stringify(result.floors),
      }),
    },
  })
  console.log('وُثّقت العملية في سجل التدقيق')
}

main()
  .catch((error) => {
    console.error('فشل التدوير الرجعي — لم تُمس أي بيانات (المعاملة ذرّية):', error)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
