import { NextResponse, type NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { auditMoney, logAudit } from '@/lib/audit-server'
import { fmtDateTime } from '@/lib/format'
import { AR_BUNDLE_TYPE, isBundleActive, parseBundleBody } from '@/lib/bundles-server'

export const dynamic = 'force-dynamic'

/** شكل السلة للواجهة — بنودها مع بطاقة كل مادة */
function serializeBundle(b: {
  id: string
  name: string
  type: string
  discountPercent: number
  startsAt: Date
  endsAt: Date
  totalSales: number
  saleCount: number
  totalDiscount: number
  enabled: boolean
  items: {
    id: string
    itemId: string
    quantity: number
    isGift: boolean
    bundlePrice: number
    item: { code: string; name: string; salePrice: number }
  }[]
}) {
  return {
    id: b.id,
    name: b.name,
    type: b.type,
    typeLabel: AR_BUNDLE_TYPE[b.type as keyof typeof AR_BUNDLE_TYPE] ?? b.type,
    discountPercent: b.discountPercent,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    active: b.enabled && isBundleActive(b), // النشاط الفعلي = ضمن الفترة + غير موقوف يدوياً (Task 36)
    enabled: b.enabled,
    totalSales: b.totalSales,
    saleCount: b.saleCount,
    totalDiscount: b.totalDiscount,
    items: b.items.map((bi) => ({
      id: bi.id,
      itemId: bi.itemId,
      quantity: bi.quantity,
      isGift: bi.isGift,
      bundlePrice: bi.bundlePrice,
      item: { code: bi.item.code, name: bi.item.name, salePrice: bi.item.salePrice },
    })),
  }
}

// ==================== GET: بطاقة سلة واحدة ====================
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const b = await db.bundle.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: { id: 'asc' },
          include: { item: { select: { code: true, name: true, salePrice: true } } },
        },
      },
    })
    if (!b) return NextResponse.json({ error: 'سلة العروض غير موجودة' }, { status: 404 })
    return NextResponse.json({ bundle: serializeBundle(b) })
  } catch (error) {
    console.error('GET /api/bundles/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب سلة العروض' }, { status: 500 })
  }
}

// ==================== PATCH: مفتاح التفعيل اليدوي — إيقاف/تشغيل بغض النظر عن الفترة (Task 36) ====================
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null
    if (!body || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'قيمة المفتاح غير صالحة — أرسل enabled: true أو false' }, { status: 400 })
    }
    // التقاط القيمة في ثابت — تضييق النوع لا يعبر حدود دوال الاستدعاء
    const enabled: boolean = body.enabled
    const updated = await db.$transaction(async (tx) => {
      const bundle = await tx.bundle.update({
        where: { id },
        data: { enabled },
        include: {
          items: {
            orderBy: { id: 'asc' },
            include: { item: { select: { code: true, name: true, salePrice: true } } },
          },
        },
      })
      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'BUNDLE',
        entityId: bundle.id,
        entityNumber: bundle.name,
        title: `سلة عروض: ${bundle.name}`,
        summary: enabled
          ? `تفعيل يدوي لسلة العروض «${bundle.name}» — عادت للظهور في فواتير المبيعات وفق فترتها`
          : `إيقاف يدوي لسلة العروض «${bundle.name}» — اختفت من فواتير المبيعات بغض النظر عن فترتها`,
        details: {
          'المفتاح اليدوي': enabled ? 'مفعّلة' : 'موقوفة يدوياً',
          'وقت التبديل': fmtDateTime(new Date()),
        },
      })
      return bundle
    })
    return NextResponse.json({ bundle: serializeBundle(updated) })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'سلة العروض غير موجودة' }, { status: 404 })
    }
    console.error('PATCH /api/bundles/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء تبديل حالة سلة العروض' }, { status: 500 })
  }
}

// ==================== PUT: تعديل سلة قائمة — الحفظ كنموذج جديد يتم عبر POST /api/bundles ====================
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.bundle.findUnique({
      where: { id },
      select: { id: true, name: true, totalSales: true, saleCount: true, totalDiscount: true, enabled: true },
    })
    if (!existing) return NextResponse.json({ error: 'سلة العروض غير موجودة' }, { status: 404 })

    const body = await req.json().catch(() => null)
    const d = await parseBundleBody(body)

    const updated = await db.$transaction(async (tx) => {
      const bundle = await tx.bundle.update({
        where: { id },
        data: {
          name: d.name,
          type: d.type,
          discountPercent: d.discountPercent,
          startsAt: d.startsAt,
          endsAt: d.endsAt,
          // المفتاح اليدوي: يُعتمد ما وصل من النموذج — وإن لم يصل حُفظت القيمة القائمة (Task 36)
          enabled: d.enabled ?? existing.enabled,
          // البنود: استبدال كامل — القالب يُعاد بناؤه والفواتير السابقة تحمل لقطاتها
          items: {
            deleteMany: {},
            create: d.items.map((i) => ({
              itemId: i.itemId,
              quantity: i.quantity,
              isGift: i.isGift,
              bundlePrice: i.bundlePrice,
            })),
          },
        },
        include: {
          items: {
            orderBy: { id: 'asc' },
            include: { item: { select: { code: true, name: true, salePrice: true } } },
          },
        },
      })

      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'BUNDLE',
        entityId: bundle.id,
        entityNumber: bundle.name,
        title: `سلة عروض: ${bundle.name}`,
        summary: `تعديل سلة عروض «${bundle.name}» — النوع: ${AR_BUNDLE_TYPE[d.type]} — ${d.items.length} مادة — النشاط من ${fmtDateTime(d.startsAt)} إلى ${fmtDateTime(d.endsAt)} — الإحصاءات التاريخية محفوظة (${existing.saleCount} مرة بيع / حسم ${auditMoney(existing.totalDiscount)} ل.س)`,
        details: {
          'النوع': AR_BUNDLE_TYPE[d.type],
          'عدد المواد': d.items.length,
          'نسبة الحسم': d.type === 'PERCENT' ? `${d.discountPercent}%` : 'لا ينطبق',
          'المفتاح اليدوي': (d.enabled ?? existing.enabled) ? 'مفعّلة' : 'موقوفة يدوياً',
          'بداية النشاط': fmtDateTime(d.startsAt),
          'نهاية النشاط': fmtDateTime(d.endsAt),
          'وقت التعديل': fmtDateTime(new Date()),
        },
      })

      return bundle
    })

    return NextResponse.json({ bundle: serializeBundle(updated) })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'اسم السلة مستخدم مسبقاً — اختر اسماً مختلفاً' }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientValidationError) {
      return NextResponse.json({ error: 'بيانات السلة غير مكتملة' }, { status: 400 })
    }
    console.error('PUT /api/bundles/[id] error:', error)
    const status = (error as { status?: number })?.status ?? 500
    const message = (error as { message?: string })?.message
    if (status !== 500 && message) return NextResponse.json({ error: message }, { status })
    return NextResponse.json({ error: 'حدث خطأ أثناء تعديل سلة العروض' }, { status: 500 })
  }
}

// ==================== DELETE: حذف قالب سلة — فواتير التاريخ تحمل لقطات أسمائها ====================
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const deleted = await db.$transaction(async (tx) => {
      const b = await tx.bundle.delete({
        where: { id },
        include: { items: { include: { item: { select: { name: true } } } } },
      })
      await logAudit(tx, {
        action: 'DELETE',
        entity: 'BUNDLE',
        entityId: id,
        entityNumber: b.name,
        title: `سلة عروض: ${b.name}`,
        summary: `حذف قالب سلة العروض «${b.name}» — ${b.items.length} مادة — الفواتير السابقة التي استخدمتها تبقى سليمة باسم السلة في بنودها وحركات مخزونها`,
        details: {
          'النوع': AR_BUNDLE_TYPE[b.type as keyof typeof AR_BUNDLE_TYPE] ?? b.type,
          'عدد المواد': b.items.length,
          'إجمالي المبيعات التاريخية (ل.س)': auditMoney(b.totalSales),
          'عدد مرات البيع': b.saleCount,
          'إجمالي الحسومات (ل.س)': auditMoney(b.totalDiscount),
          'وقت الحذف': fmtDateTime(new Date()),
        },
      })
      return b
    })
    return NextResponse.json({ ok: true, name: deleted.name })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'سلة العروض غير موجودة' }, { status: 404 })
    }
    console.error('DELETE /api/bundles/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حذف سلة العروض' }, { status: 500 })
  }
}
