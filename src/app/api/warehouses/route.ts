import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isUniqueViolation } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

const MAX_LEVEL = 4

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// ==================== GET: مصفوفة المستودعات flat مرتبة بالكود ====================
export async function GET() {
  try {
    const warehouses = await db.warehouse.findMany({
      orderBy: { code: 'asc' },
      include: {
        _count: { select: { children: true, itemBalances: true, movements: true, stocktakings: true } },
      },
    })

    const data = warehouses.map((w) => ({
      id: w.id,
      code: w.code,
      name: w.name,
      level: w.level,
      keeperName: w.keeperName,
      keeperPhone: w.keeperPhone,
      location: w.location,
      notes: w.notes,
      isActive: w.isActive,
      parentId: w.parentId,
      createdAt: w.createdAt,
      childrenCount: w._count.children,
      balancesCount: w._count.itemBalances,
      movementsCount: w._count.movements,
      stocktakingsCount: w._count.stocktakings,
    }))

    return NextResponse.json(data)
  } catch (error) {
    console.error('Warehouses GET error:', error)
    return NextResponse.json({ error: 'فشل جلب المستودعات' }, { status: 500 })
  }
}

// ==================== POST: إنشاء مستودع ====================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const keeperName = typeof body.keeperName === 'string' ? body.keeperName.trim() : ''

    if (!name) {
      return NextResponse.json({ error: 'اسم المستودع مطلوب' }, { status: 400 })
    }
    if (!keeperName) {
      return NextResponse.json(
        { error: 'أمين المستودع مطلوب — كل بطاقة مستودع يجب أن تتضمن أميناً للمستودع' },
        { status: 400 },
      )
    }

    // الأب: إن لم يُرسل فهو جذر (الشامل) — ويُسمح بجذر واحد فقط
    let parent: { id: string; code: string; level: number } | null = null
    const hasParent = body.parentId !== undefined && body.parentId !== null && body.parentId !== ''
    if (hasParent) {
      const found = await db.warehouse.findUnique({
        where: { id: String(body.parentId) },
        select: { id: true, code: true, level: true },
      })
      if (!found) {
        return NextResponse.json({ error: 'المستودع الأب غير موجود' }, { status: 400 })
      }
      parent = found
    } else {
      const rootExists = await db.warehouse.findFirst({ where: { parentId: null } })
      if (rootExists) {
        return NextResponse.json(
          {
            error: `يوجد مستودع شامل بالفعل («${rootExists.name}») — المستويات الجديدة تُنشأ تحت أحد الفروع`,
          },
          { status: 400 },
        )
      }
    }

    const level = parent ? parent.level + 1 : 1
    if (level > MAX_LEVEL) {
      return NextResponse.json(
        {
          error:
            'لا يمكن الإنشاء — الهيكل الهرمي أربعة مستويات فقط: المستودع الشامل ← مستودع عام ← مستودع فرعي ← قسم',
        },
        { status: 400 },
      )
    }

    // كود يدوي: فحص التفرد مبكراً برسالة واضحة تحمل الكود والاسم
    const manualCode = typeof body.code === 'string' ? body.code.trim() : ''
    if (manualCode) {
      const duplicate = await db.warehouse.findUnique({ where: { code: manualCode } })
      if (duplicate) {
        return NextResponse.json(
          { error: `كود المستودع "${manualCode}" مستخدم مسبقاً في "${duplicate.name}"` },
          { status: 409 },
        )
      }
    }

    // التوليد التلقائي (WH أو كود الأب + تسلسل) والإنشاء داخل معاملة — مع إعادة محاولة عند سباق الترقيم
    let created: Awaited<ReturnType<typeof db.warehouse.create>> | null = null
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await db.$transaction(async (tx) => {
          let code = manualCode
          if (!code) {
            if (parent) {
              const siblings = await tx.warehouse.findMany({
                where: { parentId: parent.id },
                select: { code: true },
              })
              let maxSeq = 0
              const prefix = `${parent.code}-`
              for (const s of siblings) {
                if (!s.code.startsWith(prefix)) continue
                const suffix = parseInt(s.code.slice(prefix.length), 10)
                if (Number.isFinite(suffix) && suffix > maxSeq) maxSeq = suffix
              }
              code = `${prefix}${pad2(maxSeq + 1)}`
            } else {
              code = 'WH'
            }
          }
          return tx.warehouse.create({
            data: {
              code,
              name,
              level,
              keeperName,
              keeperPhone:
                typeof body.keeperPhone === 'string' && body.keeperPhone.trim() ? body.keeperPhone.trim() : null,
              location:
                typeof body.location === 'string' && body.location.trim() ? body.location.trim() : null,
              notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
              isActive: body.isActive === undefined ? true : Boolean(body.isActive),
              parentId: parent ? parent.id : null,
            },
          })
        })
      } catch (e) {
        // سباق توليد الكود التلقائي → إعادة محاولة بكود جديد؛ كود يدوي مكرر يُرفع كما هو
        if (!manualCode && isUniqueViolation(e) && attempt < 2) continue
        throw e
      }
    }
    if (!created) {
      return NextResponse.json({ error: 'تعذر توليد كود مستودع فريد — حاول مجدداً' }, { status: 500 })
    }

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    console.error('Warehouses POST error:', error)
    return NextResponse.json({ error: 'فشل إنشاء المستودع' }, { status: 500 })
  }
}
