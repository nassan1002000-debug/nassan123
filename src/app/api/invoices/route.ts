import { NextResponse, type NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { StockError } from '@/lib/stock-server'
import { bumpPurchaseInfoVersion } from '@/lib/items-server'
import { deleteInvoiceJournal, postInvoiceJournal } from '@/lib/invoice-journal'
import { CostError, applyInbound, costOfLines, reverseInbound } from '@/lib/cost-engine'
import { adjustBundleStats } from '@/lib/bundles-server'
import { awardInvoicePoints, redeemInvoicePoints } from '@/lib/loyalty-server'
import { AR_INVOICE_STATUS, fmtDateTime } from '@/lib/format'
import { auditMoney, logAudit } from '@/lib/audit-server'
import {
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

// ==================== GET: قائمة فواتير نوع واحد + إحصاءات + الرقم التالي ====================
// الترقيم الخادمي (نمط القيود/السندات): page + pageSize (افتراضي 50 — سقف 200) مع حفظ كل الفلاتر
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const rawType = sp.get('type') ?? ''
    if (!(INVOICE_TYPES as readonly string[]).includes(rawType)) {
      return NextResponse.json({ error: 'نوع الفاتورة غير صالح' }, { status: 400 })
    }
    const type = rawType

    const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(sp.get('pageSize') ?? '50', 10) || 50))
    const skip = (page - 1) * pageSize

    const where: Prisma.InvoiceWhereInput = { type, isDeleted: false } // المحذوفة (أرقامها محجوزة xx) خارج القائمة

    const q = sp.get('q')?.trim()
    if (q) {
      where.OR = [{ number: { contains: q } }, { notes: { contains: q } }, { partner: { name: { contains: q } } }]
    }

    const status = sp.get('status')
    if (status && ['PAID', 'PARTIAL', 'UNPAID'].includes(status)) where.status = status

    const fromStr = sp.get('from')
    const toStr = sp.get('to')
    if (fromStr || toStr) {
      const date: Prisma.DateTimeFilter = {}
      if (fromStr) {
        const d = new Date(`${fromStr}T00:00:00.000`)
        if (!Number.isNaN(d.getTime())) date.gte = d
      }
      if (toStr) {
        const d = new Date(`${toStr}T23:59:59.999`)
        if (!Number.isNaN(d.getTime())) date.lte = d
      }
      if (date.gte || date.lte) where.date = date
    }

    // نافذة النشطة تُجلب من البداية حتى نهاية الصفحة المطلوبة — كي يُدمج الشبح المحذوف في موضعه
    // الطبيعي من التسلسل تماماً كما كان (الدمج والترتيب بنفس المقارن، ثم تقطيع نافذة الصفحة)
    const [activeRows, activeCount, ghostRows, agg, nextNumber] = await Promise.all([
      db.invoice.findMany({
        where,
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        skip: 0,
        take: Math.min(skip + pageSize, 100_000),
        include: {
          partner: { select: { code: true, name: true, type: true } },
          costCenter: { select: { code: true, name: true } },
          _count: { select: { lines: true } },
        },
      }),
      db.invoice.count({ where }),
      // المحذوفة (أرقامها محجوزة xx) — تظهر صفوفاً شبحية باهتة حفاظاً على وضوح التسلسل
      db.invoice.findMany({
        where: { type, isDeleted: true },
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        select: {
          id: true,
          number: true,
          type: true,
          date: true,
          total: true,
          paid: true,
          status: true,
          partner: { select: { code: true, name: true, type: true } },
        },
      }),
      db.invoice.aggregate({ where: { type, isDeleted: false }, _count: { _all: true }, _sum: { total: true, paid: true } }),
      // الرقم التالي لكل الأنواع: نهائي للمبيعات — اقتراح تسلسلي قابل للتعديل للمشتريات
      nextInvoiceNumber(type as (typeof INVOICE_TYPES)[number]),
    ])

    // شارات السلال: أي فاتورة ضمن الصفحة تحمل بنود سلة — مجموعة من لقطات البنود الفعلية
    const activeIds = activeRows.map((r) => r.id)
    const bundleLines =
      activeIds.length > 0
        ? await db.invoiceLine.findMany({
            where: { invoiceId: { in: activeIds }, bundleId: { not: null } },
            select: { invoiceId: true, bundleName: true },
          })
        : []
    const bundleMap = new Map<string, Set<string>>()
    for (const bl of bundleLines) {
      const set = bundleMap.get(bl.invoiceId) ?? new Set<string>()
      if (bl.bundleName) set.add(bl.bundleName)
      bundleMap.set(bl.invoiceId, set)
    }

    const active = activeRows.map((r) => ({
      id: r.id,
      number: r.number,
      type: r.type,
      date: r.date.toISOString(),
      partner: r.partner,
      costCenter: r.costCenter,
      subtotal: r.subtotal,
      discount: r.discount,
      taxRate: r.taxRate,
      tax: r.tax,
      total: r.total,
      paid: r.paid,
      status: r.status,
      notes: r.notes,
      linesCount: r._count.lines,
      // وسوم إلكترونية دائمة: سلة عروض / استرداد نقاط ولاء
      hasBundle: bundleMap.has(r.id),
      bundleNames: [...(bundleMap.get(r.id) ?? [])],
      loyaltyPointsRedeemed: r.loyaltyPointsRedeemed,
      loyaltyPointsEarned: r.loyaltyPointsEarned,
    }))

    // الصفوف الشبحية — أرقام محجوزة xx بلا إجراءات ولا احتساب في الإحصاءات
    const ghosts = ghostRows.map((r) => ({
      id: r.id,
      number: r.number,
      type: r.type,
      date: r.date.toISOString(),
      partner: r.partner,
      subtotal: 0,
      discount: 0,
      taxRate: 0,
      tax: 0,
      total: r.total,
      paid: r.paid,
      status: r.status,
      notes: null as string | null,
      linesCount: 0,
      isGhost: true,
    }))

    // دمج بالترتيب: الأحدث أولاً ثم الرقم تنازلياً — الشبح يقع في موضعه الطبيعي من التسلسل
    const merged = [...active, ...ghosts].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1
      return b.number.localeCompare(a.number)
    })
    const invoices = merged.slice(skip, skip + pageSize)

    // الإجمالي الكلي = النشطة المطابقة للفلاتر + الشبحية (الشبح لا يخضع للفلاتر كما كان)
    const total = activeCount + ghosts.length

    const sumTotal = agg._sum.total ?? 0
    const paid = agg._sum.paid ?? 0

    return NextResponse.json({
      invoices,
      nextNumber,
      stats: {
        count: agg._count._all,
        total: sumTotal,
        paid,
        remaining: Math.max(0, sumTotal - paid),
      },
      // حقول التقسيم الخادمي — بنمط مسارات القيود والسندات
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasMore: skip + pageSize < total,
    })
  } catch (error) {
    console.error('GET /api/invoices error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب الفواتير' }, { status: 500 })
  }
}

// ==================== POST: إنشاء فاتورة — ترحيل فوري (لا مسودات) ====================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const d = await validateInvoiceBody(body)

    const partnerRow = (
      await db.partner.findUnique({
        where: { id: d.partnerId },
        select: { name: true, accountId: true, account: { select: { code: true } } },
      })
    )
    const partnerName = partnerRow?.name ?? ''
    const partnerAccountCode = partnerRow?.account?.code ?? null

    const attemptCreate = () => db.$transaction(async (tx) => {
      // الرقم: توليد تلقائي داخل المعاملة للمبيعات — فحص تفرد يدوي للمشتريات
      let number: string
      if (d.number) {
        const dup = await tx.invoice.findUnique({ where: { number: d.number }, select: { id: true } })
        if (dup) throw new InvoiceError(`رقم الفاتورة «${d.number}» مستخدم مسبقاً — اكتب رقماً آخر`, 409)
        number = d.number
      } else {
        number = await nextInvoiceNumber(d.type, tx)
      }

      const inv = await tx.invoice.create({
        data: {
          number,
          type: d.type,
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
          // نقاط الولاء — لقطة الاسترداد المالي لحظة الترحيل (المنح يُحسب أسفله داخل المعاملة)
          loyaltyPointsEarned: 0,
          loyaltyPointsRedeemed: d.redeemPoints,
          loyaltyRedeemValue: d.loyaltyRedeemValue,
        },
      })

      await tx.invoiceLine.createMany({
        data: d.lines.map((l) => ({
          invoiceId: inv.id,
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

      // الدفعات — سندات VCH مرتبطة بالفاتورة (قبض للمبيعات / دفع للمشتريات)
      const salesFamily = isSalesFamily(d.type)
      const voucherNumbers: string[] = []
      for (const p of d.payments) {
        voucherNumbers.push(
          await createInvoicePaymentVoucher(tx, {
            invoiceId: inv.id,
            partnerId: d.partnerId,
            salesFamily,
            payment: p,
          }),
        )
      }

      // ==================== التكلفة قبل أي حركة مخزون ====================
      // الترتيب حاكم: المتوسط المرجح «اللحظي» يعني الحالة قبل الحركة، فتُلتقط تكلفة
      // الخروج ويُحدَّث متوسط الدخول هنا — قبل أن تمس syncInvoiceStock الأرصدة.
      let cost = 0
      if (d.type === 'PURCHASE') {
        await applyInbound(tx, d.lines)
      } else if (d.type === 'PURCHASE_RETURN') {
        await reverseInbound(tx, d.lines)
        cost = 0 // مردود الشراء يخرج بسعر الفاتورة لا بالتكلفة الوسطية
      } else {
        // بيع أو مردود بيع — كلاهما يُقيَّم بالمتوسط المرجح لحظة الحركة
        cost = await costOfLines(tx, d.lines)
      }

      // أثر المخزون الفوري — حركات + أرصدة (يرفض سالب الرصيد برسالة عربية)
      await syncInvoiceStock(tx, {
        invoiceId: inv.id,
        type: d.type,
        date: d.date,
        number,
        partnerName,
        oldLines: [],
        newLines: d.lines,
      })

      // القيد المحاسبي التلقائي — قيد مزدوج مُرحّل فوراً مرتبط بالفاتورة
      // حسم السلال يمر ضمن الحسم الكلي إلى حساب «الحسم الممنوح» (4110) بحارس التوازن الصارم
      await postInvoiceJournal(tx, {
        invoiceId: inv.id,
        type: d.type,
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

      // إحصاءات سلال العروض — تحديث فوري داخل المعاملة نفسها (مبيعات/مرات بيع/حسومات)
      await adjustBundleStats(tx, d.bundleStats)

      // نقاط الولاء — داخل المعاملة الذرية نفسها (فواتير المبيعات حصراً):
      // 1) خصم النقاط المستردة من كشف العميل (حارس الرصيد يرفض الناقص ويلغي الفاتورة كاملة)
      // 2) منح النقاط المستحقة آلياً على إجمالي الفاتورة الصافي وفق المضاعفات الصارمة
      // توقيت مُفاضل بالميلي ثانية لترتيب ثابت في الكشف عند تعدد الحركات
      let earnedPoints = 0
      if (d.type === 'SALE') {
        const now = Date.now()
        if (d.redeemPoints > 0) {
          const redemption = await redeemInvoicePoints(tx, {
            invoiceId: inv.id,
            invoiceNumber: number,
            date: d.date,
            customerId: d.partnerId,
            points: d.redeemPoints,
            at: new Date(now),
          })
          // إلحاق نص التسوية بملاحظات الفاتورة (طلب صريح) — لا يمحو ما كتبه المستخدم
          if (redemption) {
            await tx.invoice.update({
              where: { id: inv.id },
              data: { notes: d.notes ? `${d.notes}\n${redemption.note}` : redemption.note },
            })
          }
        }
        earnedPoints = await awardInvoicePoints(tx, {
          invoiceId: inv.id,
          invoiceNumber: number,
          date: d.date,
          customerId: d.partnerId,
          invoiceValue: d.total,
          at: new Date(now + 1),
        })
        if (earnedPoints > 0) {
          await tx.invoice.update({ where: { id: inv.id }, data: { loyaltyPointsEarned: earnedPoints } })
        }
      }

      // التوثيق في سجل التدقيق — داخل المعاملة نفسها
      const sideLabel = salesFamily ? 'العميل' : 'المورد'
      await logAudit(tx, {
        action: 'CREATE',
        entity: 'INVOICE',
        entityId: inv.id,
        entityNumber: number,
        title: `${AR_DOC_LABEL[d.type]} ${number}`,
        summary: `إنشاء ${AR_DOC_LABEL[d.type]} ${number} — ${sideLabel}: ${partnerName} — ${d.lines.length} بنداً — إجمالي ${auditMoney(d.total)} ل.س — مسدد ${auditMoney(d.paid)} — الحالة: ${AR_INVOICE_STATUS[d.status] ?? d.status}`,
        details: {
          'النوع': AR_DOC_LABEL[d.type],
          [sideLabel]: partnerName,
          'مركز التكلفة': d.costCenterName ?? 'بدون',
          'عدد البنود': d.lines.length,
          'المجموع (ل.س)': auditMoney(d.subtotal),
          'الضريبة': d.taxRate > 0 ? `${auditMoney(d.tax)} (${d.taxRate}%)` : 'بدون',
          'الحسم': d.discount > 0 ? auditMoney(d.discount) : 'بدون',
          'سلال العروض': d.bundleNames.length > 0 ? d.bundleNames.join('، ') : 'لا يوجد',
          'حسم السلال (ل.س)': d.bundleDiscountTotal > 0 ? auditMoney(d.bundleDiscountTotal) : 'لا ينطبق',
          'نقاط الولاء المستردة': d.redeemPoints > 0 ? `${d.redeemPoints} نقطة (${auditMoney(d.loyaltyRedeemValue)} ل.س)` : 'لا ينطبق',
          'نقاط الولاء الممنوحة': earnedPoints > 0 ? `${earnedPoints} نقطة` : 'لا ينطبق',
          'الإجمالي (ل.س)': auditMoney(d.total),
          'المسدد (ل.س)': auditMoney(d.paid),
          'الحالة': AR_INVOICE_STATUS[d.status] ?? d.status,
          'سندات الدفع': voucherNumbers.length > 0 ? voucherNumbers.join('، ') : 'لا يوجد',
          'وقت الترحيل': fmtDateTime(new Date()),
        },
        amount: d.total,
      })

      // P2-2: إبطال كاش أسعار الشراء داخل المعاملة نفسها — فواتير الشراء فقط هي مصدر الأسعار
      if (d.type === 'PURCHASE') await bumpPurchaseInfoVersion(tx)

      return inv.id
    })

    // سباق الترقيم نادر جداً — عند P2002 لمتتالية تلقائية أعد المحاولة برقم جديد (×3)
    let createdId: string | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        createdId = await attemptCreate()
        break
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && !d.number && attempt < 2) {
          continue
        }
        throw e
      }
    }
    if (!createdId) throw new InvoiceError('تعذر حجز رقم الفاتورة بعد عدة محاولات — حاول مجدداً', 503)

    const full = await db.invoice.findUnique({
      where: { id: createdId },
      include: {
        partner: { select: { code: true, name: true, type: true } },
        costCenter: { select: { code: true, name: true } },
        _count: { select: { lines: true } },
      },
    })
    return NextResponse.json({ id: createdId, number: full?.number, invoice: full }, { status: 201 })
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
      return NextResponse.json({ error: 'رقم الفاتورة مستخدم مسبقاً — اكتب رقماً آخر' }, { status: 409 })
    }
    console.error('POST /api/invoices error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء إنشاء الفاتورة' }, { status: 500 })
  }
}
