import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { computePurchaseInfo, nextCodeFrom, parsePayload, type PurchaseInfo } from '@/lib/items-server'
import { isUniqueViolation, uniqueTarget } from '@/lib/prisma-errors'
import { logAudit, auditMoney } from '@/lib/audit-server'
import { fmtDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

/** علاقات المادة المشتركة بين الاستدعاء الكامل (القوائم الحوارية) والمقسّم صفحياً */
const ITEM_INCLUDE: Prisma.ItemInclude = {
  warehouse: { select: { id: true, code: true, name: true, level: true } },
  images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
  units: { orderBy: { name: 'asc' } },
  balances: { select: { warehouseId: true, quantity: true } },
  _count: { select: { balances: true, movements: true, invoiceLines: true, stocktakingLines: true } },
}

type ItemWithRelations = Prisma.ItemGetPayload<{ include: typeof ITEM_INCLUDE }>

/** تحويل صف المادة إلى شكل الواجهة — مشترك بين الاستدعاء الكامل (القوائم الحوارية) والمقسّم صفحياً */
function mapItem(it: ItemWithRelations, purchase: PurchaseInfo | null) {
  return {
    id: it.id,
    code: it.code,
    name: it.name,
    barcode: it.barcode,
    unit: it.unit, // ملغى — للتوافق فقط
    description: it.description,
    // سعر الشراء يُحتسب تلقائياً من آخر فاتورة مشتريات (لا يُعدل من البطاقة)
    purchasePrice: purchase?.last ?? 0,
    purchaseInfo: purchase,
    // السعر المخزن بالبطاقة — الحلقة الأخيرة في تقدير التكلفة (تلف/جرد) عميلياً مثل الخادم
    storedPurchasePrice: it.purchasePrice,
    salePrice: it.salePrice,
    taxRate: it.taxRate,
    minStock: it.minStock,
    maxStock: it.maxStock,
    location: it.location,
    isActive: it.isActive,
    warehouseId: it.warehouseId,
    warehouse: it.warehouse,
    balances: it.balances,
    images: it.images.map((img) => ({
      id: img.id,
      url: img.url,
      fileName: img.fileName,
      isPrimary: img.isPrimary,
      sortOrder: img.sortOrder,
    })),
    units: it.units.map((u) => ({
      id: u.id,
      name: u.name,
      factor: u.factor,
      barcode: u.barcode,
      isActive: u.isActive,
    })),
    primaryImageUrl: it.images.find((i) => i.isPrimary)?.url ?? it.images[0]?.url ?? null,
    counts: it._count,
    createdAt: it.createdAt,
    updatedAt: it.updatedAt,
  }
}

// ==================== GET: قائمة المواد ====================
// نمطان متوافقان:
// • بلا page/pageSize: القائمة الكاملة مصفوفة (كما هي — تعتمد عليها قوائم الاختيار في النوافذ الحوارية)
// • مع page/pageSize: ترقيم خادمي (نمط القيود/السندات) مع فلاتر وإحصاءات من كل السجلات
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const wantsPage = sp.has('page') || sp.has('pageSize')

    if (!wantsPage) {
      // ===== الاستدعاء الكامل (السلوك الأصلي بلا تغيير) — قوائم الاختيار في النماذج الحوارية =====
      const [items, purchaseMap] = await Promise.all([
        db.item.findMany({
          // الأحدث أولاً — آخر بطاقة أُضيفت تظهر في أعلى الجدول
          orderBy: { code: 'desc' },
          include: ITEM_INCLUDE,
        }),
        computePurchaseInfo(),
      ])
      return NextResponse.json(items.map((it) => mapItem(it, purchaseMap.get(it.id) ?? null)))
    }

    // ===== الترقيم الخادمي =====
    const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(sp.get('pageSize') ?? '50', 10) || 50))
    const skip = (page - 1) * pageSize

    const where: Prisma.ItemWhereInput = {}

    // البحث النصي — نفس حقول بحث الواجهة: الاسم/الكود/الباركود/الموقع/باركود الوحدات
    const q = sp.get('q')?.trim()
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { code: { contains: q } },
        { barcode: { contains: q } },
        { location: { contains: q } },
        { units: { some: { barcode: { contains: q } } } },
      ]
    }

    // فلتر القسم النهائي
    const warehouseId = sp.get('warehouseId')?.trim()
    if (warehouseId) where.warehouseId = warehouseId

    // إظهار الموقوفة: يُرسل active=1 لعرض النشطة فقط — غيابه يعني الكل (كالواجهة)
    if (sp.get('active') === '1') where.isActive = true

    const [rows, total, purchaseMap] = await Promise.all([
      db.item.findMany({
        where,
        // الأحدث أولاً — نفس ترتيب القائمة الكاملة
        orderBy: { code: 'desc' },
        skip,
        take: pageSize,
        include: ITEM_INCLUDE,
      }),
      db.item.count({ where }),
      computePurchaseInfo(),
    ])

    // الإحصاءات من كل السجلات بلا فلاتر — كأرقام الواجهة قبل التقسيم (بطاقات عدّادات المواد)
    const [allCount, activeCount, withImagesCount, warehouses] = await Promise.all([
      db.item.count(),
      db.item.count({ where: { isActive: true } }),
      db.item.count({ where: { images: { some: {} } } }),
      db.warehouse.findMany({ select: { id: true, isActive: true, _count: { select: { children: true } } } }),
    ])
    const leafIds = warehouses.filter((w) => w._count.children === 0 && w.isActive).map((w) => w.id)
    const leafAssigned = leafIds.length
      ? await db.item.count({ where: { warehouseId: { in: leafIds } } })
      : 0

    // كود البطاقة التالي واقتراحات المواقع — من كل المواد (كما كانت تحتسبها الواجهة من القائمة الكاملة)
    const codeRows = await db.item.findMany({ select: { code: true, location: true }, orderBy: { code: 'desc' } })
    const nextCode = nextCodeFrom(codeRows.map((r) => r.code))
    const locations = Array.from(
      new Set(codeRows.map((r) => r.location).filter((l): l is string => Boolean(l && l.trim()))),
    )

    return NextResponse.json({
      items: rows.map((it) => mapItem(it, purchaseMap.get(it.id) ?? null)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasMore: skip + pageSize < total,
      stats: { total: allCount, active: activeCount, withImages: withImagesCount, leafAssigned },
      nextCode,
      locations,
    })
  } catch (error) {
    console.error('Items GET error:', error)
    return NextResponse.json({ error: 'فشل جلب المواد' }, { status: 500 })
  }
}

// ==================== POST: إنشاء بطاقة مادة ====================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })
    }

    const parsed = await parsePayload(body)
    if (!parsed.data) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status ?? 400 })
    }
    const d = parsed.data

    // الترقيم التلقائي + الإنشاء داخل معاملة ذرية — مع إعادة محاولة عند سباق الترقيم
    let created: Awaited<ReturnType<typeof db.item.create>> | null = null
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await db.$transaction(async (tx) => {
          const existing = await tx.item.findMany({ select: { code: true } })
          const code = nextCodeFrom(existing.map((i) => i.code))
          const item = await tx.item.create({
            data: {
              code,
              name: d.name,
              barcode: d.barcode,
              description: d.description,
              // سعر الشراء يبقى صفراً عند الإنشاء — يُحتسب تلقائياً من فواتير المشتريات
              salePrice: d.salePrice,
              taxRate: d.taxRate,
              minStock: d.minStock,
              maxStock: d.maxStock,
              location: d.location,
              isActive: d.isActive,
              warehouseId: d.warehouseId,
              images: {
                create: d.images.map((img, i) => ({
                  url: img.url,
                  fileName: img.fileName,
                  isPrimary: img.isPrimary,
                  sortOrder: i,
                })),
              },
              units: { create: d.units },
            },
            include: { images: true, units: true },
          })

          // التوثيق في سجل التدقيق — داخل المعاملة نفسها (نمط الفواتير)
          await logAudit(tx, {
            action: 'CREATE',
            entity: 'ITEM',
            entityId: item.id,
            entityNumber: code,
            title: `بطاقة مادة ${code}`,
            summary: `إنشاء بطاقة مادة ${code} — ${d.name} — سعر بيع ${auditMoney(d.salePrice)} ل.س — الحد الأدنى ${d.minStock} / الأعلى ${d.maxStock}`,
            details: {
              'كود البطاقة': code,
              'اسم المادة': d.name,
              'الباركود': d.barcode ?? 'بدون',
              'سعر البيع (ل.س)': auditMoney(d.salePrice),
              'نسبة الضريبة': `${d.taxRate}%`,
              'الحد الأدنى/الأعلى': `${d.minStock} / ${d.maxStock}`,
              'الحالة': d.isActive ? 'نشطة' : 'موقوفة',
              'عدد الصور': d.images.length,
              'عدد الوحدات': d.units.length,
              'وقت الإنشاء': fmtDateTime(new Date()),
            },
          })

          return item
        })
      } catch (e) {
        // سباق ترقيم كود البطاقة → إعادة محاولة برقم جديد؛ غير ذلك ارفع الخطأ
        if (isUniqueViolation(e) && uniqueTarget(e).includes('code') && attempt < 2) continue
        throw e
      }
    }
    if (!created) {
      return NextResponse.json({ error: 'تعذر توليد رقم بطاقة فريد — حاول مجدداً' }, { status: 500 })
    }

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    // خرق قيد التفرد — الرسالة بحسب الحقل الفعلي لا افتراض الباركود دائماً
    if (isUniqueViolation(error)) {
      const target = uniqueTarget(error)
      if (target.includes('barcode')) {
        return NextResponse.json({ error: 'رمز الباركود مستخدم مسبقاً في مادة أخرى' }, { status: 409 })
      }
      return NextResponse.json({ error: 'تعذر الحفظ — إحدى القيم الفريدة (كود البطاقة/الباركود) مستخدمة مسبقاً' }, { status: 409 })
    }
    console.error('Items POST error:', error)
    return NextResponse.json({ error: 'فشل إنشاء بطاقة المادة' }, { status: 500 })
  }
}
