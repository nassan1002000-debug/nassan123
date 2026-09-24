import { NextResponse, type NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '@/lib/audit-server'

export const dynamic = 'force-dynamic'

// ==================== GET: سجل التدقيق — كل حركات النظام موثقة يراها المدير ====================
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams

    const where: Prisma.AuditLogWhereInput = {}

    const q = sp.get('q')?.trim()
    if (q) {
      where.OR = [
        { title: { contains: q } },
        { summary: { contains: q } },
        { entityNumber: { contains: q } },
      ]
    }

    const action = sp.get('action')
    if (action && (AUDIT_ACTIONS as readonly string[]).includes(action)) where.action = action

    const entity = sp.get('entity')
    if (entity && (AUDIT_ENTITIES as readonly string[]).includes(entity)) where.entity = entity

    const fromStr = sp.get('from')
    const toStr = sp.get('to')
    if (fromStr || toStr) {
      const createdAt: Prisma.DateTimeFilter = {}
      if (fromStr) {
        const d = new Date(`${fromStr}T00:00:00.000`)
        if (!Number.isNaN(d.getTime())) createdAt.gte = d
      }
      if (toStr) {
        const d = new Date(`${toStr}T23:59:59.999`)
        if (!Number.isNaN(d.getTime())) createdAt.lte = d
      }
      if (createdAt.gte || createdAt.lte) where.createdAt = createdAt
    }

    const pageSize = Math.min(Math.max(parseInt(sp.get('pageSize') ?? '25', 10) || 25, 10), 100)
    const page = Math.max(parseInt(sp.get('page') ?? '1', 10) || 1, 1)

    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

    const [rows, total, todayCount, byAction] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.auditLog.count({ where }),
      db.auditLog.count({ where: { createdAt: { gte: startOfDay } } }),
      db.auditLog.groupBy({ by: ['action'], _count: { _all: true } }),
    ])

    const actionCount = (a: string) => byAction.find((r) => r.action === a)?._count._all ?? 0

    return NextResponse.json({
      entries: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        entityNumber: r.entityNumber,
        title: r.title,
        summary: r.summary,
        details: r.details ? (JSON.parse(r.details) as Record<string, unknown>) : null,
        amount: r.amount,
        createdAt: r.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      stats: {
        total: byAction.reduce((s, r) => s + r._count._all, 0),
        today: todayCount,
        creates: actionCount('CREATE'),
        updates: actionCount('UPDATE'),
        deletes: actionCount('DELETE'),
      },
    })
  } catch (error) {
    console.error('GET /api/audit-log error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب سجل التدقيق' }, { status: 500 })
  }
}
