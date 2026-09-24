import { NextResponse, type NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { StockError } from '@/lib/stock-server'
import { bumpPurchaseInfoVersion } from '@/lib/items-server'
import { deleteInvoiceJournal, postInvoiceJournal } from '@/lib/invoice-journal'
import { CostError, applyInbound, costOfLines, reverseInbound } from '@/lib/cost-engine'
import { adjustBundleStats, oldLinesStatsDelta } from '@/lib/bundles-server'
import {
  awardInvoicePoints,
  redeemInvoicePoints,
  restoreInvoiceRedemption,
  revokeInvoicePoints,
} from '@/lib/loyalty-server'
import { assertPeriodOpen } from '@/lib/period-server'
import { AR_INVOICE_STATUS, fmtDateTime } from '@/lib/format'
import { auditMoney, logAudit } from '@/lib/audit-server'
import {
  AUTO_NUMBER_PREFIX,
  INVOICE_TYPES,
  InvoiceError,
  AR_DOC_LABEL,
  createInvoicePaymentVoucher,
  isSalesFamily,
  nextInvoiceNumber,
  syncInvoiceStock,
  validateInvoiceBody,
} from '@/lib/invoices-server'

export const dynamic = 'force-dynamic'

// ==================== GET: بطاقة فاتورة كاملة (بنود + دفعات) ====================
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const inv = await db.invoice.findUnique({
      where: { id },
      include: {
        partner: { select: { id: true, code: true, name: true, type: true, phone: true, address: true } },
        costCenter: { select: { id: true, code: true, name: true } },
        lines: {
          orderBy: { id: 'asc' },
          include: {
            item: { select: { code: true, name: true } },
            warehouse: { select: { name: true } },
          },
        },
        payments: { orderBy: [{ date: 'asc' }, { number: 'asc' }] },
      },
    })
    if (!inv) return NextResponse.json({ error: 'الفاتورة غير موجودة' }, { status: 404 })

    // القيد المحاسبي التلقائي المرتبط بالفاتورة (إن وُجد)
    const journal = await db.journalEntry.findFirst({
      where: { refType: 'INVOICE', refId: inv.id },
      orderBy: { createdAt: 'desc' },
      include: {
        lines: {
          orderBy: { order: 'asc' },
          include: {
            account: { select: { code: true, name: true } },
            costCenter: { select: { code: true, name: true } },
          },
        },
      },
    })

    return NextResponse.json({
      id: inv.id,
      number: inv.number,
      type: inv.type,
      date: inv.date.toISOString(),
      partner: inv.partner,
      costCenter: inv.costCenter,
      subtotal: inv.subtotal,
      discount: inv.discount,
      taxRate: inv.taxRate,
      tax: inv.tax,
      total: inv.total,
      paid: inv.paid,
      status: inv.status,
      notes: inv.notes,
      // نقاط الولاء — لقطة أثر الفاتورة على رصيد نقاط العميل (العرض وإعادة ملء النموذج والطباعة)
      loyaltyPointsEarned: inv.loyaltyPointsEarned,
      loyaltyPointsRedeemed: inv.loyaltyPointsRedeemed,
      loyaltyRedeemValue: inv.loyaltyRedeemValue,
      lines: inv.lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        itemCode: l.item.code,
        itemName: l.item.name,
        warehouseId: l.warehouseId,
        warehouseName: l.warehouse?.name ?? null,
        unitName: l.unitName,
        unitFactor: l.unitFactor,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        total: l.total,
        // سلال العروض — لقطة البند لعرضها وإعادة ملء نموذج التعديل
        bundleId: l.bundleId,
        bundleName: l.bundleName,
        bundleDiscount: l.bundleDiscount,
        bundleQty: l.bundleQty,
        bundleGift: l.bundleGift,
      })),
      payments: inv.payments.map((p) => ({
        id: p.id,
        number: p.number,
        date: p.date.toISOString(),
        amount: p.amount,
        method: p.method,
        notes: p.notes,
      })),
      journal: journal
        ? {
            id: journal.id,
            number: journal.number,
            date: journal.date.toISOString(),
            description: journal.description,
            source: journal.source,
            totalDebit: journal.totalDebit,
            totalCredit: journal.totalCredit,
            lines: journal.lines.map((l) => ({
              id: l.id,
              accountCode: l.account.code,
              accountName: l.account.name,
              costCenterName: l.costCenter?.name ?? null,
              debit: l.debit,
              credit: l.credit,
              description: l.description,
            })),
          }
        : null,
    })
  } catch (error) {
    console.error('GET /api/invoices/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب الفاتورة' }, { status: 500 })
  }
}

// ==================== PUT: تعديل فاتورة مُرحّلة — إعادة ضبط المخزون والدفعات عكسياً ====================
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.invoice.findUnique({
      where: { id },
      include: { lines: true, partner: { select: { name: true, account: { select: { code: true } } } }, costCenter: { select: { name: true } } },
    })
    if (!existing) return NextResponse.json({ error: 'الفاتورة غير موجودة' }, { status: 404 })
    if (existing.isDeleted) {
      return NextResponse.json(
        { error: `لا يمكن تعديل الفاتورة ${existing.number} — محذوفة مسبقاً ورقمها محجوز بلاحقة xx` },
        { status: 409 },
      )
    }
    if (!(INVOICE_TYPES as readonly string[]).includes(existing.type)) {
      return NextResponse.json({ error: 'نوع الفاتورة المخزنة غير صالح' }, { status: 500 })
    }
    const currentType = existing.type as (typeof INVOICE_TYPES)[number]

    const body = await req.json().catch(() => null)
    const d = await validateInvoiceBody(body, { currentType })

    // الرقم: المتتالية التلقائية مقفولة — اليدوي قابل للتصحيح مع فحص التفرد
    let number = existing.number
    if (!AUTO_NUMBER_PREFIX[currentType]) {
      const rawNumber = d.number ?? ''
      if (rawNumber !== existing.number) {
        const dup = await db.invoice.findUnique({ where: { number: rawNumber }, select: { id: true } })
        if (dup && dup.id !== id) {
          throw new InvoiceError(`رقم الفاتورة «${rawNumber}» مستخدم مسبقاً في فاتورة أخرى`, 409)
        }
        number = rawNumber
      }
    }

    const partnerInfo: { name: string; accountCode: string | null } | null =
      d.partnerId === existing.partnerId
        ? { name: existing.partner.name, accountCode: existing.partner.account?.code ?? null }
        : await db.partner
            .findUnique({
              where: { id: d.partnerId },
              select: { name: true, account: { select: { code: true } } },
            })
            .then((r) => (r ? { name: r.name, accountCode: r.account?.code ?? null } : null))
    const partnerName = partnerInfo?.name ?? ''
    const partnerAccountCode = partnerInfo?.accountCode ?? null

    // لقطة «قبل» لسجل التدقيق
    const before = {
      number: existing.number,
      partnerName: existing.partner.name,
      costCenterName: existing.costCenter?.name ?? 'بدون',
      linesCount: existing.lines.length,
      total: existing.total,
      paid: existing.paid,
      status: existing.status,
    }

    await db.$transaction(async (tx) => {
      // نقاط الولاء — عكس أثر الفاتورة القديمة ذرياً قبل تطبيق الجديد:
      // إلغاء الاستحقاق القديم من العميل الأصلي + إرجاع النقاط المستردة القديمة إليه
      await revokeInvoicePoints(tx, {
        invoiceId: id,
        invoiceNumber: existing.number,
        customerId: existing.partnerId,
        earnedPoints: existing.loyaltyPointsEarned,
        cause: 'تعديل الفاتورة',
      })
      await restoreInvoiceRedemption(tx, {
        invoiceId: id,
        invoiceNumber: existing.number,
        customerId: existing.partnerId,
        redeemedPoints: existing.loyaltyPointsRedeemed,
        cause: 'تعديل الفاتورة',
      })

      await tx.invoice.update({
        where: { id },
        data: {
          number,
          date: d.date,
          partnerId: d.partnerId,
          costCenterId: d.costCenterId,
          subtotal: d.subtotal,
          discount: d.discount,
          taxRate: d.taxRate,
          tax: d.tax,
          total: d.total,
          paid: d.paid,
          status: d.status,
          notes: d.notes,
          // لقطة الاسترداد الجديدة — الاستحقاق الجديد يُحسب أسفله داخل المعاملة
          loyaltyPointsEarned: 0,
          loyaltyPointsRedeemed: d.redeemPoints,
          loyaltyRedeemValue: d.loyaltyRedeemValue,
        },
      })

      // البنود: استبدال كامل
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } })
      await tx.invoiceLine.createMany({
        data: d.lines.map((l) => ({
          invoiceId: id,
          itemId: l.itemId,
          warehouseId: l.warehouseId,
          unitName: l.unitName,
          unitFactor: l.unitFactor,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          total: l.total,
          // سلال العروض — لقطة دائمة للمعرف والاسم وحسم كل سطر وعدد السلال والهدية
          bundleId: l.bundleId,
          bundleName: l.bundleName,
          bundleDiscount: l.bundleDiscount,
          bundleQty: l.bundleQty,
          bundleGift: l.bundleGift,
        })),
      })

      // إحصاءات سلال العروض: رجوع أثر البنود القديمة + تطبيق أثر الجديدة داخل المعاملة نفسها
      await adjustBundleStats(tx, [
        ...oldLinesStatsDelta(existing.lines),
        ...d.bundleStats,
      ])

      // الدفعات: حذف سندات الفاتورة القديمة وإنشاء البدل — بأرقام VCH جديدة
      await tx.payment.deleteMany({ where: { invoiceId: id } })
      const salesFamily = isSalesFamily(currentType)
      const voucherNumbers: string[] = []
      for (const p of d.payments) {
        voucherNumbers.push(
          await createInvoicePaymentVoucher(tx, {
            invoiceId: id,
            partnerId: d.partnerId,
            salesFamily,
            payment: p,
          }),
        )
      }

      // ==================== التكلفة قبل أي حركة مخزون ====================
      // التعديل يُعكس أثر البنود القديمة على المتوسط المرجح أولاً ثم يُطبَّق أثر
      // الجديدة — وإلا تراكم أثر النسخة القديمة في المتوسط بعد زوالها من الفاتورة
      let cost = 0
      if (currentType === 'PURCHASE') {
        await reverseInbound(
          tx,
          existing.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice })),
        )
        await applyInbound(tx, d.lines)
      } else if (currentType === 'PURCHASE_RETURN') {
        await applyInbound(
          tx,
          existing.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice })),
        )
        await reverseInbound(tx, d.lines)
      } else {
        cost = await costOfLines(tx, d.lines)
      }

      // المخزون: أثر القديم يُعكس وأثر الجديد يُطبق — والرصيد النهائي لا يكون سالباً
      await syncInvoiceStock(tx, {
        invoiceId: id,
        type: currentType,
        date: d.date,
        number,
        partnerName,
        oldLines: existing.lines.map((l) => ({
          itemId: l.itemId,
          warehouseId: l.warehouseId ?? '',
          quantity: l.quantity,
        })).filter((l) => l.warehouseId !== ''),
        newLines: d.lines,
      })

      // القيد المحاسبي: حذف القيد القديم وترحيل قيد جديد بالبيانات المعدلة
      await deleteInvoiceJournal(tx, id)
      await postInvoiceJournal(tx, {
        invoiceId: id,
        type: currentType,
        date: d.date,
        number,
        partnerName,
        partnerAccountCode,
        subtotal: d.subtotal,
        tax: d.tax,
        discount: d.discount,
        netTotal: d.total,
        payments: d.payments,
        cost,
        costCenterId: d.costCenterId,
        bundleNames: d.bundleNames,
      })

      // نقاط الولاء — تطبيق أثر الفاتورة المعدلة داخل المعاملة نفسها:
      // خصم الاسترداد الجديد من كشف العميل (بحارس رصيد صارم) ثم منح المستحق على الإجمالي الصافي
      let earnedPoints = 0
      if (currentType === 'SALE') {
        const now = Date.now()
        if (d.redeemPoints > 0) {
          const redemption = await redeemInvoicePoints(tx, {
            invoiceId: id,
            invoiceNumber: number,
            date: d.date,
            customerId: d.partnerId,
            points: d.redeemPoints,
            at: new Date(now),
          })
          // إلحاق نص التسوية بملاحظات الفاتورة (طلب صريح) — لا يمحو ما كتبه المستخدم
          if (redemption) {
            await tx.invoice.update({
              where: { id },
              data: { notes: d.notes ? `${d.notes}\n${redemption.note}` : redemption.note },
            })
          }
        }
        earnedPoints = await awardInvoicePoints(tx, {
          invoiceId: id,
          invoiceNumber: number,
          date: d.date,
          customerId: d.partnerId,
          invoiceValue: d.total,
          at: new Date(now + 1),
        })
        if (earnedPoints > 0) {
          await tx.invoice.update({ where: { id }, data: { loyaltyPointsEarned: earnedPoints } })
        }
      }

      // التوثيق في سجل التدقيق — مع تغييرات «قبل ← بعد»
      const sideLabel = salesFamily ? 'العميل' : 'المورد'
      const changes: string[] = []
      const afterCC = d.costCenterName ?? 'بدون'
      if (before.costCenterName !== afterCC) changes.push(`مركز التكلفة: ${before.costCenterName} ← ${afterCC}`)
      if (number !== before.number) changes.push(`الرقم: ${before.number} ← ${number}`)
      if (partnerName !== before.partnerName) changes.push(`${sideLabel}: ${before.partnerName} ← ${partnerName}`)
      if (d.lines.length !== before.linesCount) changes.push(`عدد البنود: ${before.linesCount} ← ${d.lines.length}`)
      if (d.total !== before.total) changes.push(`الإجمالي: ${auditMoney(before.total)} ← ${auditMoney(d.total)} ل.س`)
      if (d.paid !== before.paid) changes.push(`المسدد: ${auditMoney(before.paid)} ← ${auditMoney(d.paid)} ل.س`)
      if (d.status !== before.status)
        changes.push(`الحالة: ${AR_INVOICE_STATUS[before.status] ?? before.status} ← ${AR_INVOICE_STATUS[d.status] ?? d.status}`)
      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'INVOICE',
        entityId: id,
        entityNumber: number,
        title: `${AR_DOC_LABEL[currentType]} ${number}`,
        summary: `تعديل ${AR_DOC_LABEL[currentType]} ${number} — ${sideLabel}: ${partnerName} — ${changes.length > 0 ? changes.join('؛ ') : 'تعديل بيانات دون تغيير قيم دالة'}`,
        details: {
          'النوع': AR_DOC_LABEL[currentType],
          'التغييرات': changes.length > 0 ? changes.join('؛ ') : 'لا تغييرات دالة',
          'قبل التعديل': {
            'الرقم': before.number,
            [sideLabel]: before.partnerName,
            'مركز التكلفة': before.costCenterName,
            'عدد البنود': before.linesCount,
            'الإجمالي (ل.س)': auditMoney(before.total),
            'المسدد (ل.س)': auditMoney(before.paid),
            'الحالة': AR_INVOICE_STATUS[before.status] ?? before.status,
          },
          'بعد التعديل': {
            'الرقم': number,
            [sideLabel]: partnerName,
            'مركز التكلفة': afterCC,
            'عدد البنود': d.lines.length,
            'الحسم': d.discount > 0 ? auditMoney(d.discount) : 'بدون',
            'سلال العروض': d.bundleNames.length > 0 ? d.bundleNames.join('، ') : 'لا يوجد',
            'حسم السلال (ل.س)': d.bundleDiscountTotal > 0 ? auditMoney(d.bundleDiscountTotal) : 'لا ينطبق',
            'نقاط الولاء المستردة':
              d.redeemPoints > 0 ? `${d.redeemPoints} نقطة (${auditMoney(d.loyaltyRedeemValue)} ل.س)` : 'لا ينطبق',
            'نقاط الولاء الممنوحة': earnedPoints > 0 ? `${earnedPoints} نقطة` : 'لا ينطبق',
            'نقاط الولاء قبل التعديل':
              existing.loyaltyPointsEarned > 0 || existing.loyaltyPointsRedeemed > 0
                ? `ممنوحة ${existing.loyaltyPointsEarned} — مستردة ${existing.loyaltyPointsRedeemed}`
                : 'لا ينطبق',
            'الإجمالي (ل.س)': auditMoney(d.total),
            'المسدد (ل.س)': auditMoney(d.paid),
            'الحالة': AR_INVOICE_STATUS[d.status] ?? d.status,
            'سندات الدفع': voucherNumbers.length > 0 ? voucherNumbers.join('، ') : 'لا يوجد',
          },
          'وقت التعديل': fmtDateTime(new Date()),
        },
        amount: d.total,
      })

      // P2-2: إبطال كاش أسعار الشراء داخل المعاملة نفسها
      if (currentType === 'PURCHASE') await bumpPurchaseInfoVersion(tx)
    })

    return NextResponse.json({ ok: true, number })
  } catch (error) {
    if (error instanceof InvoiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof StockError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof CostError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'رقم الفاتورة مستخدم مسبقاً في فاتورة أخرى' }, { status: 409 })
    }
    console.error('PUT /api/invoices/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء تعديل الفاتورة' }, { status: 500 })
  }
}

// ==================== DELETE: حذف فاتورة — استرجاع المخزون وحذف سنداتها ====================
// الحذف ناعم: رقم الفاتورة يُحجز بلاحقة xx فلا يُعاد أبداً (حماية تسلسل المبيعات من تشابه الأرقام)
// والفاتورة تبقى موثقة في سجل التدقيق يراها المدير
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.invoice.findUnique({
      where: { id },
      include: {
        lines: true,
        partner: { select: { name: true } },
      },
    })
    if (!existing) return NextResponse.json({ error: 'الفاتورة غير موجودة' }, { status: 404 })
    if (existing.isDeleted) {
      return NextResponse.json(
        { error: `الفاتورة ${existing.number} محذوفة مسبقاً ورقمها محجوز بلاحقة xx — لا يُقبل حذف ثانٍ` },
        { status: 409 },
      )
    }
    if (!(INVOICE_TYPES as readonly string[]).includes(existing.type)) {
      return NextResponse.json({ error: 'نوع الفاتورة المخزنة غير صالح' }, { status: 500 })
    }
    const type = existing.type as (typeof INVOICE_TYPES)[number]
    const salesFamily = isSalesFamily(type)

    // إنفاذ الفترات المقفلة: حذف فاتورة مؤرّخة داخل فترة مقفلة ⇒ رفض (الفترة المحاسبية بلا تغيير)
    try {
      await assertPeriodOpen(db, existing.date, `حذف ${AR_DOC_LABEL[type]}`)
    } catch {
      return NextResponse.json(
        { error: `لا يمكن حذف ${AR_DOC_LABEL[type]} ${existing.number} — تاريخها داخل فترة محاسبية مقفلة` },
        { status: 409 },
      )
    }

    const reservedNumber = await db.$transaction(async (tx) => {
      // عكس أثر الفاتورة على المتوسط المرجح — قبل مسّ الأرصدة (المعادلة تحتاج ما قبل الحركة).
      // حذف فاتورة مشتريات يُخرج قيمتها من وعاء التكلفة كما لو لم تُدخل قط.
      if (type === 'PURCHASE') {
        await reverseInbound(
          tx,
          existing.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice })),
        )
      } else if (type === 'PURCHASE_RETURN') {
        await applyInbound(
          tx,
          existing.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice })),
        )
      }

      // عكس أثر الفاتورة على الأرصدة — يرفض إن كان المخزون قد استُهلك (رسالة عربية)
      await syncInvoiceStock(tx, {
        invoiceId: id,
        type,
        date: existing.date,
        number: existing.number,
        partnerName: existing.partner.name,
        oldLines: existing.lines.map((l) => ({
          itemId: l.itemId,
          warehouseId: l.warehouseId ?? '',
          quantity: l.quantity,
        })).filter((l) => l.warehouseId !== ''),
        newLines: [],
      })

      // حذف القيد المحاسبي التلقائي المرتبط بالفاتورة
      await deleteInvoiceJournal(tx, id)

      await tx.payment.deleteMany({ where: { invoiceId: id } })

      // إحصاءات سلال العروض: رجوع أثر بنود الفاتورة المحذوفة داخل المعاملة نفسها
      await adjustBundleStats(tx, oldLinesStatsDelta(existing.lines))

      // نقاط الولاء: عكس أثر الفاتورة المحذوفة على رصيد نقاط العميل داخل المعاملة نفسها —
      // إلغاء ما مُنح من نقاط + إرجاع ما استُرد منها كحسم، كل ذلك موثق في كشف حساب العميل
      await revokeInvoicePoints(tx, {
        invoiceId: id,
        invoiceNumber: existing.number,
        customerId: existing.partnerId,
        earnedPoints: existing.loyaltyPointsEarned,
        cause: 'حذف الفاتورة',
      })
      await restoreInvoiceRedemption(tx, {
        invoiceId: id,
        invoiceNumber: existing.number,
        customerId: existing.partnerId,
        redeemedPoints: existing.loyaltyPointsRedeemed,
        cause: 'حذف الفاتورة',
      })

      // حجز الرقم: لاحقة xx — لا يُولَّد لأي فاتورة جديدة بعدها
      const reservedNumber = existing.number.endsWith('xx') ? existing.number : `${existing.number}xx`
      await tx.invoice.update({
        where: { id },
        data: { number: reservedNumber, isDeleted: true, deletedAt: new Date() },
      })

      // التوثيق في سجل التدقيق — الحذف محفوظ برقمه المحجوز يراها المدير
      const sideLabel = salesFamily ? 'العميل' : 'المورد'
      await logAudit(tx, {
        action: 'DELETE',
        entity: 'INVOICE',
        entityId: id,
        entityNumber: reservedNumber,
        title: `${AR_DOC_LABEL[type]} ${existing.number}`,
        summary: `حذف ${AR_DOC_LABEL[type]} ${existing.number} — ${sideLabel}: ${existing.partner.name} — إجمالي ${auditMoney(existing.total)} ل.س — استُرجعت الكميات إلى الأرصدة وحُذفت سنداتها وقيدها — الرقم محجوز كـ ${reservedNumber} ولن يُستخدم مجدداً`,
        details: {
          'النوع': AR_DOC_LABEL[type],
          [sideLabel]: existing.partner.name,
          'عدد البنود': existing.lines.length,
          'سلال العروض':
            [...new Set(existing.lines.map((l) => l.bundleName).filter(Boolean))].join('، ') || 'لا يوجد',
          'الإجمالي (ل.س)': auditMoney(existing.total),
          'المسدد (ل.س)': auditMoney(existing.paid),
          'الحالة قبل الحذف': AR_INVOICE_STATUS[existing.status] ?? existing.status,
          'نقاط الولاء المعكوسة':
            existing.loyaltyPointsEarned > 0 || existing.loyaltyPointsRedeemed > 0
              ? `أُلغي استحقاق ${existing.loyaltyPointsEarned} نقطة وأُرجعت ${existing.loyaltyPointsRedeemed} نقطة مستردة إلى كشف حساب العميل`
              : 'لا ينطبق',
          'الرقم المحجوز': reservedNumber,
          'أثر الحذف': 'استرجاع كميات الأقسام + حذف السندات والقيد والحركات المخزنية',
          'وقت الحذف': fmtDateTime(new Date()),
        },
        amount: existing.total,
      })

      // P2-2: إبطال كاش أسعار الشراء داخل المعاملة نفسها
      if (type === 'PURCHASE') await bumpPurchaseInfoVersion(tx)

      return reservedNumber
    })

    return NextResponse.json({ ok: true, reservedNumber })
  } catch (error) {
    if (error instanceof StockError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof CostError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('DELETE /api/invoices/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حذف الفاتورة' }, { status: 500 })
  }
}
