import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// ==================== تنبيهات المخزون (جرس التنبيهات) ====================
// يفحص أرصدة المواد النشطة مقابل الحد الأدنى/الأعلى المسجل في بطاقتها:
// • LOW  — الرصيد نزل تحت الحد الأدنى (خطورة عالية — يرن الجرس)
// • HIGH — الرصيد تجاوز الحد الأعلى (خطورة متوسطة — تنبيه تكدس)
// المرجع: رصيد المادة في القسم المُسند إليه (وبقسمه غائباً يُجمع رصيدها في كل الأقسام)

export async function GET() {
  try {
    const items = await db.item.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        minStock: true,
        maxStock: true,
        warehouseId: true,
        warehouse: { select: { name: true, code: true } },
        balances: { select: { warehouseId: true, quantity: true } },
        units: { orderBy: { name: 'asc' }, take: 1, select: { name: true } },
        images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1, select: { url: true } },
      },
    })

    const alerts: {
      id: string
      type: 'LOW' | 'HIGH'
      severity: 'high' | 'medium'
      itemId: string
      code: string
      name: string
      unitName: string | null
      warehouseName: string | null
      imageUrl: string | null
      balance: number
      min: number
      max: number
      shortfall: number
    }[] = []

    for (const it of items) {
      const min = it.minStock ?? 0
      const max = it.maxStock ?? 0
      if (min <= 0 && max <= 0) continue

      // الرصيد المرجعي: القسم المُسند إليه، وإلا مجموع أرصدة كل الأقسام
      const balance = it.warehouseId
        ? (it.balances.find((b) => b.warehouseId === it.warehouseId)?.quantity ?? 0)
        : it.balances.reduce((s, b) => s + b.quantity, 0)

      if (min > 0 && balance < min) {
        alerts.push({
          id: `low-${it.id}`,
          type: 'LOW',
          severity: 'high',
          itemId: it.id,
          code: it.code,
          name: it.name,
          unitName: it.units[0]?.name ?? null,
          warehouseName: it.warehouse?.name ?? null,
          imageUrl: it.images[0]?.url ?? null,
          balance,
          min,
          max,
          shortfall: min - balance,
        })
      } else if (max > 0 && balance > max) {
        alerts.push({
          id: `high-${it.id}`,
          type: 'HIGH',
          severity: 'medium',
          itemId: it.id,
          code: it.code,
          name: it.name,
          unitName: it.units[0]?.name ?? null,
          warehouseName: it.warehouse?.name ?? null,
          imageUrl: it.images[0]?.url ?? null,
          balance,
          min,
          max,
          shortfall: balance - max,
        })
      }
    }

    // الأخطر أولاً (نقص) ثم الأكبر عجزاً
    alerts.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1
      return b.shortfall - a.shortfall
    })

    return NextResponse.json({ alerts, count: alerts.length, checkedAt: new Date().toISOString() })
  } catch (error) {
    console.error('Notifications GET error:', error)
    return NextResponse.json({ error: 'فشل جلب التنبيهات' }, { status: 500 })
  }
}
