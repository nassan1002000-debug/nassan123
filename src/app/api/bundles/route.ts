import { NextResponse, type NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
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

// ==================== GET: قائمة السلال — ?active=1 للسلال الصالحة للبيع الآن (ضمن الفترة + غير موقوفة يدوياً) ====================
export async function GET(req: NextRequest) {
  try {
    const activeOnly = req.nextUrl.searchParams.get('active') === '1'
    const rows = await db.bundle.findMany({
      orderBy: [{ createdAt: 'desc' }],
      include: {
        items: {
          orderBy: { id: 'asc' },
          include: { item: { select: { code: true, name: true, salePrice: true } } },
        },
      },
    })
    // ?active=1 يستبعد الموقوفة يدوياً مهما كانت فترتها — وموقوفة الكاشير لا تراها إطلاقاً (Task 36)
    const bundles = rows
      .filter((b) => !activeOnly || (b.enabled && isBundleActive(b)))
      .map(serializeBundle)
    return NextResponse.json({ bundles })
  } catch (error) {
    console.error('GET /api/bundles error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب سلال العروض' }, { status: 500 })
  }
}

// ==================== POST: إنشاء سلة جديدة (أو حفظ التعديل كنموذج جديد باسم مختلف) ====================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const d = await parseBundleBody(body)

    const created = await db.$transaction(async (tx) => {
      const bundle = await tx.bundle.create({
        data: {
          name: d.name,
          type: d.type,
          discountPercent: d.discountPercent,
          startsAt: d.startsAt,
          endsAt: d.endsAt,
          enabled: d.enabled ?? true, // السلة الجديدة مفعّلة افتراضياً — والمفتاح اليدوي يصل من النموذج (Task 36)
          items: {
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
        action: 'CREATE',
        entity: 'BUNDLE',
        entityId: bundle.id,
        entityNumber: bundle.name,
        title: `سلة عروض: ${bundle.name}`,
        summary: `إنشاء سلة عروض «${bundle.name}» — النوع: ${AR_BUNDLE_TYPE[d.type]} — ${d.items.length} مادة — النشاط من ${fmtDateTime(d.startsAt)} إلى ${fmtDateTime(d.endsAt)}`,
        details: {
          'النوع': AR_BUNDLE_TYPE[d.type],
          'عدد المواد': d.items.length,
          'نسبة الحسم': d.type === 'PERCENT' ? `${d.discountPercent}%` : 'لا ينطبق',
          'المفتاح اليدوي': (d.enabled ?? true) ? 'مفعّلة' : 'موقوفة يدوياً',
          'بداية النشاط': fmtDateTime(d.startsAt),
          'نهاية النشاط': fmtDateTime(d.endsAt),
          'وقت الإنشاء': fmtDateTime(new Date()),
        },
      })

      return bundle
    })

    return NextResponse.json({ bundle: serializeBundle(created) }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'اسم السلة مستخدم مسبقاً — اختر اسماً مختلفاً' }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientValidationError) {
      return NextResponse.json({ error: 'بيانات السلة غير مكتملة' }, { status: 400 })
    }
    console.error('POST /api/bundles error:', error)
    const status = (error as { status?: number })?.status ?? 500
    const message = (error as { message?: string })?.message
    if (status !== 500 && message) return NextResponse.json({ error: message }, { status })
    return NextResponse.json({ error: 'حدث خطأ أثناء إنشاء سلة العروض' }, { status: 500 })
  }
}
