// تدوير المستندات التفصيلية عند إقفال الفترة المحاسبية — عزل السجلات التفصيلية (Data Isolation)
//
// المبدأ الحاكم (نفس منهج تدوير القيود المعتمد في period-server):
//  • كل مستند مؤرَّخ <= تاريخ الإقفال يُحذف من القاعدة الحية ويبقى محفوظاً كاملاً
//    في النسخة الأرشيفية (period-*.db) التي التُقطت قبل أي تعديل — فلا يُحذف أي تاريخ أصلي
//  • الفترة الجديدة تبدأ بسجلات تفصيلية جافة ونظيفة تعتمد حصراً على الأرصدة المدوّرة
//    بسند القيد الافتتاحي (فواتير/سندات/حركة مخزون/جرد/تلف/رواتب/سلف/إجازات/دوام/مكافآت)
//  • دليل الحسابات والأطراف والموظفين والمواد والمستودعات والسلال يبقى كاملاً
//  • نقاط الولاء المتبقية تُرحَّل كأرصدة افتتاحية حية: حركات الفترة المغلقة تُدوَّر
//    ويُنشأ لكل عميل ذي رصيد حركة «OPENING» واحدة مربوطة بسند القيد الافتتاحي
//  • أرضيات الترقيم (Sequence Floors): أعلى رقم لدُوِّر يُحفظ في الإعدادات كي لا يعاد
//    استخدامه في الفترة الجديدة — فلا خلط بين أرقام الأرشيف وأرقام الفترة الحية
//
// الدالة نقية (تعمل مع أي TransactionClient) — تُستدعى من executePeriodClose داخل
// معاملة الإقفال، ومن سكربت التدوير الرجعي scripts/rotate-closed-docs.ts
import type { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

/** عميل قراءة يصلح للمعاملة أو للعميل المباشر — بأقل حاجة للجداول */
type ReaderClient = Pick<Tx, 'invoice' | 'payment' | 'stocktaking' | 'journalEntry' | 'setting'>

// ==================== أرضيات الترقيم (Sequence Floors) ====================

/** مفتاح إعداد أرضية الترقيم لبادئة معينة — seq_floor:VCH- مثلها */
export const seqFloorKey = (prefix: string): string => `seq_floor:${prefix}`

/** أعلى رقم عددي بنمط PREFIX-123 (مع احتمال لاحقة xx لأرقام الفواتير المحجوزة) */
export function numericMaxOf(prefix: string, numbers: string[]): number {
  let max = 0
  const re = new RegExp(`^${prefix}(\\d+)(?:xx)?$`)
  for (const raw of numbers) {
    const m = re.exec(raw)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return max
}

/** قراءة أرضية الترقيم المحفوظة لبادئة معينة — صفر إن لم توجد */
export async function getSequenceFloor(
  client: Pick<Tx, 'setting'>,
  prefix: string,
): Promise<number> {
  const row = await client.setting.findUnique({ where: { key: seqFloorKey(prefix) } })
  const n = row ? Number(row.value) : 0
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** حفظ أرضية الترقيم — تُحفظ الأعلى فقط (لا تتراجع أبداً) */
async function storeFloor(tx: Tx, prefix: string, max: number): Promise<void> {
  if (max <= 0) return
  const current = await getSequenceFloor(tx, prefix)
  if (max <= current) return
  await tx.setting.upsert({
    where: { key: seqFloorKey(prefix) },
    update: { value: String(max) },
    create: { key: seqFloorKey(prefix), value: String(max) },
  })
}

// ==================== محرك التدوير ====================

export interface RotationCounts {
  payments: number
  invoices: number
  stockMovements: number
  stocktakings: number
  attendance: number
  bonuses: number
  advances: number
  leaves: number
  salaries: number
  loyaltyDeleted: number
  loyaltyOpeningRows: number
  /** سلال عروض صُفّرت عداداتها التراكمية (المبيعات/الحسومات/عدد البيع) للفترة الجديدة */
  bundlesReset: number
}

export interface RotationResult extends RotationCounts {
  /** أرضيات الترقيم المثبتة (بادئة → أعلى رقم دُوِّر) */
  floors: Record<string, number>
}

export interface RotationOptions {
  /** نهاية يوم الإقفال (23:59:59.999) — كل ما هو مؤرَّخ قبله يُدوَّر */
  closeEnd: Date
  /** شهر الإقفال YYYY-MM — رواتب هذا الشهر وما قبله تُدوَّر */
  closingMonth: string
  /** اسم الفترة المقفلة — يدخل في بيانات حركات الافتتاح */
  label: string
  /** سند القيد الافتتاحي — تُربط به حركات نقاط الولاء الافتتاحية */
  openingEntryId: string
  openingEntryNumber: string
  /** تاريخ سند القيد الافتتاحي (أول يوم من الفترة الجديدة) */
  openingDay: Date
  /**
   * أرضيات محسوبة مسبقاً تُدمج بالأعلى — للسكربت الرجعي حين تكون بعض
   * المستندات قد دُوِّرت سابقاً بلا أرضيات (تُقرأ حينها من النسخة الأرشيفية)
   */
  floorOverrides?: Record<string, number>
}

/**
 * تدوير المستندات التفصيلية للفترة المقفلة — تُستدعى داخل معاملة ذرية:
 *  1) تثبيت أرضيات الترقيم لكل البادئات المدوَّرة (INV-/SRN-/PINV-/PRN-/VCH-/ST-/MC-)
 *  2) حذف المستندات المؤرَّخة <= نهاية يوم الإقفال من القاعدة الحية
 *  3) ترحيل نقاط الولاء المتبقية بحركات افتتاحية مربوطة بسند القيد الافتتاحي
 * النتيجة عدّادات التوثيق — وأي فشل يرجع معاملة الإقفال كاملة
 */
export async function rotateClosedPeriodDocs(
  tx: Tx,
  opts: RotationOptions,
): Promise<RotationResult> {
  const { closeEnd, closingMonth, label, openingEntryId, openingEntryNumber, openingDay } = opts

  // ---- 1) أرضيات الترقيم — من المستندات على وشك التدوير (لا يزال الاسم ظاهراً في ترقيمها) ----
  const [invoiceRows, paymentRows, stocktakingRows, mcRows] = await Promise.all([
    tx.invoice.findMany({ where: { date: { lte: closeEnd } }, select: { number: true } }),
    tx.payment.findMany({ where: { date: { lte: closeEnd } }, select: { number: true } }),
    tx.stocktaking.findMany({ where: { date: { lte: closeEnd } }, select: { number: true } }),
    tx.journalEntry.findMany({
      where: { date: { lte: closeEnd }, number: { startsWith: 'MC-' } },
      select: { number: true },
    }),
  ])

  const invoiceNumbers = invoiceRows.map((r) => r.number)
  const paymentNumbers = paymentRows.map((r) => r.number)
  const stocktakingNumbers = stocktakingRows.map((r) => r.number)
  const mcNumbers = mcRows.map((r) => r.number)

  const candidateFloors: Record<string, number> = {
    'INV-': numericMaxOf('INV-', invoiceNumbers),
    'SRN-': numericMaxOf('SRN-', invoiceNumbers),
    'PINV-': numericMaxOf('PINV-', invoiceNumbers),
    'PRN-': numericMaxOf('PRN-', invoiceNumbers),
    'VCH-': numericMaxOf('VCH-', paymentNumbers),
    'ST-': numericMaxOf('ST-', stocktakingNumbers),
    'MC-': numericMaxOf('MC-', mcNumbers),
  }
  // دمج أرضيات السكربت الرجعي والأرضيات المحفوظة سابقاً — الأعلى حصراً
  const floors: Record<string, number> = {}
  for (const [prefix, computed] of Object.entries(candidateFloors)) {
    const override = opts.floorOverrides?.[prefix] ?? 0
    const stored = await getSequenceFloor(tx, prefix)
    const max = Math.max(computed, override, stored)
    await storeFloor(tx, prefix, max)
    floors[prefix] = max
  }

  // ---- 2) حذف المستندات التفصيلية المؤرَّخة <= نهاية يوم الإقفال (تعيش كاملة في الأرشيف) ----
  // السندات أولاً ثم الفواتير — وإن بقي سند فترة جديدة مرتبط بفاتورة قديمة
  // فالمفتاح الأجنبي SET NULL يحوّله سنداً مستقلاً دون إخلال
  const payments = await tx.payment.deleteMany({ where: { date: { lte: closeEnd } } })
  const invoices = await tx.invoice.deleteMany({ where: { date: { lte: closeEnd } } })
  const stockMovements = await tx.stockMovement.deleteMany({ where: { date: { lte: closeEnd } } })
  const stocktakings = await tx.stocktaking.deleteMany({ where: { date: { lte: closeEnd } } })
  const attendance = await tx.attendance.deleteMany({ where: { date: { lte: closeEnd } } })
  const bonuses = await tx.bonusDeduction.deleteMany({ where: { date: { lte: closeEnd } } })
  const advances = await tx.advance.deleteMany({ where: { date: { lte: closeEnd } } })
  // بشرط النهاية (to) لا البداية (from): إجازة بدأت قبل الإقفال وتمتد بعده ما تزال
  // فعلية في الفترة الجديدة — تدويرها بشرط from وحده كان يحذفها من الحية بالكامل
  // وهي لم تنتهِ بعد، فتفقد الفترة الجديدة أثرها (على الدوام والرواتب) بصمت
  const leaves = await tx.leave.deleteMany({ where: { to: { lte: closeEnd } } })
  const salaries = await tx.salary.deleteMany({ where: { month: { lte: closingMonth } } })

  // ---- 2-ب) تصفير عدادات السلال التراكمية (شرط عزل الفترات — سلل العروض) ----
  // إجمالي المبيعات والحسومات وعدد البيع عدادات مخزّنة على قالب السلة تراكمت من فواتير
  // الفترة المغلقة — تُصفَّر هنا لتبدأ الفترة الجديدة بصفر مبيعات مع بقاء النماذج نفسها
  // كاملة ومفعّلة وجاهزة للبيع، وقيمها التاريخية محفوظة في النسخة الأرشيفية
  const bundlesReset = await tx.bundle.updateMany({
    data: { totalSales: 0, totalDiscount: 0, saleCount: 0 },
  })

  // ---- 3) نقاط الولاء: تدوير حركات الفترة المغلقة + أرصدة افتتاحية حية مربوطة بسند الافتتاحي ----
  const preClose = await tx.loyaltyTransaction.groupBy({
    by: ['customerId'],
    where: { createdAt: { lte: closeEnd } },
    _sum: { points: true },
  })
  const loyaltyDeleted = await tx.loyaltyTransaction.deleteMany({
    where: { createdAt: { lte: closeEnd } },
  })
  let loyaltyOpeningRows = 0
  for (const g of preClose) {
    const pts = g._sum.points ?? 0
    if (pts === 0) continue
    await tx.loyaltyTransaction.create({
      data: {
        customerId: g.customerId,
        type: 'OPENING',
        points: pts,
        balanceAfter: pts,
        reason: `رصيد افتتاحي — ترحيل نقاط الولاء المتبقية من فترة «${label}» (سند ${openingEntryNumber})`,
        refType: 'PERIOD_OPEN',
        refId: openingEntryId,
        refNumber: openingEntryNumber,
        createdAt: openingDay,
      },
    })
    loyaltyOpeningRows++
  }

  return {
    payments: payments.count,
    invoices: invoices.count,
    stockMovements: stockMovements.count,
    stocktakings: stocktakings.count,
    attendance: attendance.count,
    bonuses: bonuses.count,
    advances: advances.count,
    leaves: leaves.count,
    salaries: salaries.count,
    loyaltyDeleted: loyaltyDeleted.count,
    loyaltyOpeningRows,
    bundlesReset: bundlesReset.count,
    floors,
  }
}
