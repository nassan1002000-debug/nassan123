import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const MAX_LEVEL = 4

// ==================== PUT: تعديل مستودع (بيانات أو نقل ضمن الشجرة) ====================
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const existing = await db.warehouse.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'المستودع غير موجود' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })
    }

    const data: {
      code?: string
      name?: string
      keeperName?: string
      keeperPhone?: string | null
      location?: string | null
      notes?: string | null
      isActive?: boolean
      parentId?: string | null
      level?: number
    } = {}

    // الكود: مع فحص التفرد
    if (body.code !== undefined && body.code !== null) {
      const code = String(body.code).trim()
      if (!code) {
        return NextResponse.json({ error: 'كود المستودع مطلوب' }, { status: 400 })
      }
      if (code !== existing.code) {
        const duplicate = await db.warehouse.findUnique({ where: { code } })
        if (duplicate) {
          return NextResponse.json(
            { error: `الكود "${code}" مستخدم مسبقاً في المستودع "${duplicate.name}"` },
            { status: 409 },
          )
        }
        data.code = code
      }
    }

    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) {
        return NextResponse.json({ error: 'اسم المستودع مطلوب' }, { status: 400 })
      }
      data.name = name
    }

    if (body.keeperName !== undefined) {
      const keeperName = String(body.keeperName).trim()
      if (!keeperName) {
        return NextResponse.json(
          { error: 'أمين المستودع مطلوب — كل بطاقة مستودع يجب أن تتضمن أميناً للمستودع' },
          { status: 400 },
        )
      }
      data.keeperName = keeperName
    }

    if (body.keeperPhone !== undefined) {
      const phone = String(body.keeperPhone ?? '').trim()
      data.keeperPhone = phone ? phone : null
    }

    if (body.location !== undefined) {
      const location = String(body.location ?? '').trim()
      data.location = location ? location : null
    }

    if (body.notes !== undefined) {
      const notes = String(body.notes ?? '').trim()
      data.notes = notes ? notes : null
    }

    if (body.isActive !== undefined) {
      data.isActive = Boolean(body.isActive)
    }

    // نقل المستودع ضمن الشجرة (تغيير الأب) — مع تحقق الهرمية وإعادة حساب مستويات الفروع
    if (body.parentId !== undefined) {
      const hasNewParent = body.parentId !== null && body.parentId !== ''
      if (hasNewParent) {
        const newParentId = String(body.parentId)
        if (newParentId === existing.id) {
          return NextResponse.json({ error: 'لا يمكن جعل المستودع أباً لنفسه' }, { status: 400 })
        }
        const newParent = await db.warehouse.findUnique({ where: { id: newParentId } })
        if (!newParent) {
          return NextResponse.json({ error: 'المستودع الأب الجديد غير موجود' }, { status: 400 })
        }

        // منع النقل تحت أحد الأحفاد (حلقة في الشجرة)
        let ancestor: string | null = newParent.parentId
        const seen = new Set<string>()
        while (ancestor) {
          if (ancestor === existing.id) {
            return NextResponse.json(
              { error: 'لا يمكن نقل المستودع تحت أحد فروعه — يشكّل حلقة في الشجرة' },
              { status: 400 },
            )
          }
          if (seen.has(ancestor)) break
          seen.add(ancestor)
          const a = await db.warehouse.findUnique({ where: { id: ancestor } })
          ancestor = a?.parentId ?? null
        }

        // فحص العمق: أعمق فرع في الشجرة الفرعية المنقولة يجب ألا يتجاوز المستوى الرابع
        const all = await db.warehouse.findMany({ select: { id: true, parentId: true } })
        const childrenMap = new Map<string, string[]>()
        for (const w of all) {
          if (!w.parentId) continue
          const list = childrenMap.get(w.parentId) ?? []
          list.push(w.id)
          childrenMap.set(w.parentId, list)
        }
        const subtreeExtra = (startId: string): number => {
          let maxExtra = 0
          const queue: { id: string; depth: number }[] = [{ id: startId, depth: 0 }]
          while (queue.length > 0) {
            const cur = queue.shift()!
            maxExtra = Math.max(maxExtra, cur.depth)
            for (const childId of childrenMap.get(cur.id) ?? []) {
              queue.push({ id: childId, depth: cur.depth + 1 })
            }
          }
          return maxExtra
        }
        const newBase = newParent.level + 1
        if (newBase + subtreeExtra(existing.id) > MAX_LEVEL) {
          return NextResponse.json(
            {
              error: `لا يمكن النقل — سيجعل أعمق فرع يتجاوز المستوى الرابع (الحد الأقصى: المستودع الشامل ← مستودع عام ← مستودع فرعي ← قسم)`,
            },
            { status: 400 },
          )
        }

        data.parentId = newParentId
        data.level = newBase
      } else {
        // إعادة للجذر — مسموح فقط إن لم يوجد جذر آخر (جذر واحد)
        const rootExists = await db.warehouse.findFirst({
          where: { parentId: null, NOT: { id: existing.id } },
        })
        if (rootExists) {
          return NextResponse.json(
            { error: `يوجد مستودع شامل بالفعل («${rootExists.name}») — لا يمكن جعل مستودعين شاملين` },
            { status: 400 },
          )
        }
        data.parentId = null
        data.level = 1
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(existing)
    }

    const updated = await db.$transaction(async (tx) => {
      const result = await tx.warehouse.update({ where: { id }, data })

      // إعادة حساب مستويات الفروع بعد النقل
      if (data.parentId !== undefined) {
        const relevel = async (parentId: string, parentLevel: number) => {
          const kids = await tx.warehouse.findMany({ where: { parentId } })
          for (const kid of kids) {
            await tx.warehouse.update({ where: { id: kid.id }, data: { level: parentLevel + 1 } })
            await relevel(kid.id, parentLevel + 1)
          }
        }
        await relevel(id, result.level)
      }
      return result
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Warehouse PUT error:', error)
    return NextResponse.json({ error: 'فشل تعديل المستودع' }, { status: 500 })
  }
}

// ==================== DELETE: حذف مستودع (مع حماية كاملة) ====================
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const existing = await db.warehouse.findUnique({
      where: { id },
      include: {
        _count: { select: { children: true, itemBalances: true, movements: true, stocktakings: true } },
      },
    })
    if (!existing) {
      return NextResponse.json({ error: 'المستودع غير موجود' }, { status: 404 })
    }

    if (existing._count.children > 0) {
      return NextResponse.json(
        {
          error: `لا يمكن حذف «${existing.name}» — يوجد ${existing._count.children} مستودع فرعي تابع له، احذف الفروع أولاً`,
        },
        { status: 400 },
      )
    }
    if (existing._count.itemBalances > 0) {
      return NextResponse.json(
        { error: `لا يمكن حذف «${existing.name}» — مرتبط بـ ${existing._count.itemBalances} رصيد صنف` },
        { status: 400 },
      )
    }
    if (existing._count.movements > 0) {
      return NextResponse.json(
        { error: `لا يمكن حذف «${existing.name}» — مرتبط بـ ${existing._count.movements} حركة مخزون` },
        { status: 400 },
      )
    }
    if (existing._count.stocktakings > 0) {
      return NextResponse.json(
        { error: `لا يمكن حذف «${existing.name}» — مرتبط بـ ${existing._count.stocktakings} أمر جرد` },
        { status: 400 },
      )
    }

    await db.warehouse.delete({ where: { id } })
    return NextResponse.json({ ok: true, message: `تم حذف المستودع «${existing.name}» بنجاح` })
  } catch (error) {
    console.error('Warehouse DELETE error:', error)
    return NextResponse.json({ error: 'فشل حذف المستودع' }, { status: 500 })
  }
}
