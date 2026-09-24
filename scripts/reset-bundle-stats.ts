/// <reference types="bun-types" />
// تصفير رجعي لعدادات السلال التراكمية للفترة المقفلة الأحدث — شرط عزل الفترات (سلل العروض)
//
// الغرض: إغلاق الفجوة للفترة التي أُقفلت قبل تفعيل تصفير عدادات السلال داخل محرك التدوير —
// عدادات «إجمالي المبيعات / إجمالي الحسومات / عدد مرات البيع» مخزّنة على قالب السلة تراكمت
// من فواتير الفترة المغلقة وبقيت ظاهرة في شاشة السلال بالفترة الجديدة. هذا السكربت يصفّرها
// من القاعدة الحية (قيمها التاريخية محفوظة كاملة في النسخة الأرشيفية للفترة) ويوثّق العملية
// في سجل التدقيق.
//
// الاستخدام: bun scripts/reset-bundle-stats.ts
// آمن للتكرار (idempotent): الصفّار يعيد صفراً وما تكونت مبيعات جديدة في الفترة الحية
// (بعيد الإقفال) لا يُمسّ — الحارس: سلال بيعت بعد تاريخ سند الافتتاحي تُستثنى.
import { PrismaClient } from '@prisma/client'
import { logAudit } from '../src/lib/audit-server'

const db = new PrismaClient()

async function main(): Promise<void> {
  const latest = await db.periodClose.findFirst({ orderBy: { closingDate: 'desc' } })
  if (!latest) {
    console.log('لا توجد فترة مقفلة — لا شيء يُصفَّر')
    return
  }

  // الحارس: سلال بيعت بعد سند الافتتاحي (مبيعات حية للفترة الجديدة) لا تُمسّ
  const liveBundles = await db.bundle.findMany({
    where: { updatedAt: { gt: latest.openingDate }, OR: [{ totalSales: { not: 0 } }, { totalDiscount: { not: 0 } }, { saleCount: { not: 0 } }] },
    select: { id: true, name: true },
  })
  const liveIds = new Set(liveBundles.map((b) => b.id))

  const dirty = await db.bundle.findMany({
    where: { OR: [{ totalSales: { not: 0 } }, { totalDiscount: { not: 0 } }, { saleCount: { not: 0 } }] },
    select: { id: true, name: true, totalSales: true, totalDiscount: true, saleCount: true },
  })
  const targets = dirty.filter((b) => !liveIds.has(b.id))
  const totalSales = targets.reduce((s, b) => s + b.totalSales, 0)
  const totalDiscount = targets.reduce((s, b) => s + b.totalDiscount, 0)

  console.log(`الفترة «${latest.label}» — الإقفال: ${latest.closingDate.toISOString().slice(0, 10)} — سند الافتتاحي: ${latest.openingEntryNumber}`)
  console.log(`سلال بعدادات تراكمية غير صفورية: ${targets.length} (مبيعات ${totalSales} · حسومات ${totalDiscount}) — مستثنى (مبيعات حية): ${liveIds.size}`)
  if (targets.length === 0) {
    console.log('العدادات نظيفة مسبقاً — لا شيء للتنفيذ')
    return
  }

  const count = await db.$transaction(async (tx) => {
    const res = await tx.bundle.updateMany({
      where: { id: { in: targets.map((b) => b.id) } },
      data: { totalSales: 0, totalDiscount: 0, saleCount: 0 },
    })
    await logAudit(tx, {
      action: 'UPDATE',
      entity: 'BUNDLE',
      entityId: latest.id,
      entityNumber: latest.label,
      title: 'تصفير رجعي لعدادات السلال التراكمية بعد إقفال الفترة',
      summary:
        `صُفّرت عدادات المبيعات والحسومات وعدد البيع لـ${res.count} سلة في الفترة الجديدة بعد إقفال «${latest.label}» ` +
        `(سند الافتتاحي ${latest.openingEntryNumber}) — القيم التاريخية محفوظة كاملة في النسخة الأرشيفية`,
      details: {
        'الفترة': latest.label,
        'سلال صُفّرت': res.count,
        'إجمالي المبيعات المصفّر': totalSales,
        'إجمالي الحسومات المصفّرة': totalDiscount,
        'أسماء السلال': targets.map((b) => b.name).join('، '),
      },
    })
    return res.count
  })

  console.log(`صُفّرت عدادات ${count} سلة — شاشة السلال تبدأ الآن بصفر مبيعات في الفترة الجديدة والنماذج باقية مفعّلة`)
}

main()
  .catch((e) => {
    console.error('فشل تصفير عدادات السلال:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
