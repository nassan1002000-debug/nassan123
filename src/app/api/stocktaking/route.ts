import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  StockError,
  nextStocktakingNumber,
  parseOptionalDate,
  requireLeafWarehouse,
  WAREHOUSE_TABLE_SELECT,
} from '@/lib/stock-server'
import { computePurchaseInfo, purchaseCostOf } from '@/lib/items-server'
import { getSequenceFloor } from '@/lib/period-doc-rotation'
import { isUniqueViolation, uniqueTarget } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

interface IncomingLine {
  itemId?: unknown
  countedQty?: unknown
}

// ==================== GET: قائمة أوامر الجرد (الأحدث أولاً) ====================
// نمطان متوافقان:
// • بلا page/pageSize: القائمة الكاملة مصفوفة (كما هي — السلوك الأصلي)
// • مع page/pageSize: ترقيم خادمي (نمط القيود/السندات) مع فلاتر وإحصاءات من كل الأوامر
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const wantsPage = sp.has('page') || sp.has('pageSize')

    // فلاتر التقسيم الخادمي — تُطبق بعد الفلترة كالسلوك الحالي
    const where: Prisma.StocktakingWhereInput = {}
    let page = 1
    let pageSize = 50
    let skip = 0
    if (wantsPage) {
      page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1)
      pageSize = Math.min(200, Math.max(1, Number.parseInt(sp.get('pageSize') ?? '50', 10) || 50))
      skip = (page - 1) * pageSize

      const status = sp.get('status')
      if (status && ['DRAFT', 'POSTED'].includes(status)) where.status = status

      // البحث النصي — نفس حقول بحث الواجهة: رقم الأمر / القسم / الملاحظات
      const q = sp.get('q')?.trim()
      if (q) {
        where.OR = [
          { number: { contains: q } },
          { notes: { contains: q } },
          { warehouse: { name: { contains: q } } },
        ]
      }

      // فلتر المدى التاريخي — نفس منطق /api/invoices بالحرف (from شامل من بدايته، to شامل لنهايته)
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
    }

    const orders = wantsPage
      ? await db.stocktaking.findMany({
          where,
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          skip,
          take: pageSize,
          include: {
            warehouse: { select: WAREHOUSE_TABLE_SELECT },
            _count: { select: { lines: true } },
          },
        })
      : await db.stocktaking.findMany({
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          include: {
            warehouse: { select: WAREHOUSE_TABLE_SELECT },
            _count: { select: { lines: true } },
          },
        })

    // إحصاء الفروقات وقيمتها (بسعر الشراء التلقائي: آخر فاتورة شراء ← الوسطي ← الحقل المخزن)
    // الأسطر لكل الأوامر دائماً — قيمة الفروقات الكلية (KPI) تحتاج كل السجلات لا الصفحة المعروضة فقط
    const [allLines, purchaseMap, total, byStatus] = await Promise.all([
      db.stocktakingLine.findMany({
        select: { stocktakingId: true, itemId: true, difference: true, item: { select: { purchasePrice: true, avgCost: true } } },
      }),
      computePurchaseInfo(),
      wantsPage ? db.stocktaking.count({ where }) : Promise.resolve(0),
      wantsPage ? db.stocktaking.groupBy({ by: ['status'], _count: { _all: true } }) : Promise.resolve([] as { status: string; _count: { _all: number } }[]),
    ])

    const buildStats = () => {
      const map = new Map<string, { increases: number; decreases: number; varianceValue: number }>()
      for (const ln of allLines) {
        const s = map.get(ln.stocktakingId) ?? { increases: 0, decreases: 0, varianceValue: 0 }
        if (ln.difference > 0) s.increases += 1
        if (ln.difference < 0) s.decreases += 1
        s.varianceValue += ln.difference * purchaseCostOf(purchaseMap.get(ln.itemId), ln.item.avgCost)
        map.set(ln.stocktakingId, s)
      }
      return map
    }
    const stats = buildStats()

    const data = orders.map((o) => ({
      id: o.id,
      number: o.number,
      date: o.date,
      status: o.status,
      notes: o.notes,
      warehouse: o.warehouse,
      linesCount: o._count.lines,
      ...(stats.get(o.id) ?? { increases: 0, decreases: 0, varianceValue: 0 }),
    }))

    // ===== الاستدعاء الكامل — نفس الاستجابة الأصلية مصفوفة =====
    if (!wantsPage) return NextResponse.json(data)

    // ===== التقسيم الخادمي — مع إحصاءات كل الأوامر بلا فلاتر (كأرقام KPI قبل التقسيم) =====
    const countOf = (st: string) => byStatus.find((r) => r.status === st)?._count._all ?? 0

    return NextResponse.json({
      orders: data,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasMore: skip + pageSize < total,
      stats: {
        total: byStatus.reduce((s, r) => s + r._count._all, 0),
        drafts: countOf('DRAFT'),
        posted: countOf('POSTED'),
        variance: Array.from(stats.values()).reduce((s, v) => s + v.varianceValue, 0),
      },
    })
  } catch (error) {
    console.error('Stocktaking GET error:', error)
    return NextResponse.json({ error: 'فشل جلب أوامر الجرد' }, { status: 500 })
  }
}

// ==================== POST: إنشاء أمر جرد (مسودة) على قسم نهائي ====================
// systemQty يُحتسب من الخادم من الأرصدة الحالية (مصدر الحقيقة) — لا يُقبل من العميل
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })
    }

    const warehouse = await requireLeafWarehouse(body.warehouseId, 'قسم الجرد')
    const date = parseOptionalDate(body.date)
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 300) : null

    const rawLines = Array.isArray(body.lines) ? (body.lines as IncomingLine[]) : []
    if (rawLines.length === 0) {
      return NextResponse.json({ error: 'لا توجد أسطر جرد — اختر قسماً يحتوي مواداً أولاً' }, { status: 400 })
    }

    // أسطر صالحة فقط مع منع تكرار المادة
    const seen = new Set<string>()
    const parsed: { itemId: string; countedQty: number }[] = []
    for (const ln of rawLines) {
      const itemId = typeof ln.itemId === 'string' ? ln.itemId : ''
      if (!itemId || seen.has(itemId)) continue
      const counted = typeof ln.countedQty === 'number' ? ln.countedQty : parseFloat(String(ln.countedQty ?? ''))
      if (!Number.isFinite(counted) || counted < 0) {
        return NextResponse.json(
          { error: 'الكمية المجرودة يجب أن تكون رقماً صحيحاً (صفر أو أكثر) في كل الأسطر' },
          { status: 400 },
        )
      }
      seen.add(itemId)
      parsed.push({ itemId, countedQty: counted })
    }
    if (parsed.length === 0) {
      return NextResponse.json({ error: 'لا توجد أسطر جرد صالحة' }, { status: 400 })
    }

    // التحقق من وجود المواد دفعة واحدة
    const items = await db.item.findMany({
      where: { id: { in: parsed.map((p) => p.itemId) } },
      select: { id: true, name: true },
    })
    if (items.length !== parsed.length) {
      return NextResponse.json({ error: 'إحدى المواد غير موجودة — حدّث الصفحة وأعد المحاولة' }, { status: 400 })
    }

    // أرصدة القسم الحالية — مصدر الحقيقة لكمية النظام
    const balances = await db.itemBalance.findMany({
      where: { warehouseId: warehouse.id, itemId: { in: parsed.map((p) => p.itemId) } },
      select: { itemId: true, quantity: true },
    })
    const balanceMap = new Map(balances.map((b) => [b.itemId, b.quantity]))

    // الإنشاء داخل معاملة ذرية — الترقيم ST-xxx داخلها مع إعادة محاولة عند سباق الترقيم
    let created: Prisma.StocktakingGetPayload<{ include: { lines: true } }> | null = null
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await db.$transaction(async (tx) => {
          const existing = await tx.stocktaking.findMany({ select: { number: true } })
          // أرضية الترقيم: أعلى رقم جرد دُوّر إلى أرشيف الفترة المغلقة — رقم دُوّر لا يُعاد أبداً
          const floor = await getSequenceFloor(tx, 'ST-')
          const number = nextStocktakingNumber(existing.map((o) => o.number), floor)
          return tx.stocktaking.create({
            data: {
              number,
              date,
              warehouseId: warehouse.id,
              status: 'DRAFT',
              notes,
              lines: {
                create: parsed.map((p) => {
                  const systemQty = balanceMap.get(p.itemId) ?? 0
                  return {
                    itemId: p.itemId,
                    systemQty,
                    countedQty: p.countedQty,
                    difference: p.countedQty - systemQty,
                  }
                }),
              },
            },
            include: { lines: true },
          })
        })
      } catch (e) {
        if (isUniqueViolation(e) && uniqueTarget(e).includes('number') && attempt < 2) continue
        throw e
      }
    }
    if (!created) {
      return NextResponse.json({ error: 'تعذر توليد رقم أمر جرد فريد — حاول مجدداً' }, { status: 500 })
    }

    return NextResponse.json({ ...created, linesCount: created.lines.length }, { status: 201 })
  } catch (error) {
    if (error instanceof StockError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Stocktaking POST error:', error)
    return NextResponse.json({ error: 'فشل إنشاء أمر الجرد' }, { status: 500 })
  }
}
