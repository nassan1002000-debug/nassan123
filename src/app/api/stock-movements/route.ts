import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ITEM_TABLE_SELECT, WAREHOUSE_TABLE_SELECT } from '@/lib/stock-server'

export const dynamic = 'force-dynamic'

// ==================== استعلام حركات المخزون (قراءة فقط) ====================
// الحركات تُنشأ تلقائياً من مستنداتها: ترحيل أوامر الجرد، حالات التلف، الفواتير —
// لا يوجد تسجيل يدوي هنا حفاظاً على أن لكل حركة مستند مصدر.

export async function GET() {
  try {
    const movements = await db.stockMovement.findMany({
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: {
        item: { select: ITEM_TABLE_SELECT },
        warehouse: { select: WAREHOUSE_TABLE_SELECT },
      },
    })

    // صفوف التحويل (refType=TRANSFER) تُخزّن OUT+IN مترابطان بـ refId واحد — الأقران لعرض (من → إلى)
    const transferRefIds = Array.from(
      new Set(
        movements
          .filter((m) => m.refType === 'TRANSFER' && m.refId)
          .map((m) => m.refId as string),
      ),
    )

    const peers =
      transferRefIds.length > 0
        ? await db.stockMovement.findMany({
            where: { refType: 'TRANSFER', refId: { in: transferRefIds } },
            select: { id: true, refId: true, warehouseId: true, warehouse: { select: { name: true } } },
          })
        : []

    const data = movements.map((m) => {
      let counterpart: { id: string; name: string } | null = null
      let displayType = m.type
      if (m.refType === 'TRANSFER' && m.refId) {
        // صفّا التحويل يُخزّنان بطبيعتهما المحاسبية (OUT بالمصدر / IN بالمستلم) —
        // وتُعرض هنا كنوع واحد «تحويل» مع القسم المقابل (من → إلى)
        displayType = 'TRANSFER'
        const peer = peers.find((p) => p.refId === m.refId && p.id !== m.id)
        if (peer) counterpart = { id: peer.warehouseId, name: peer.warehouse.name }
      }
      return {
        id: m.id,
        date: m.date,
        type: displayType,
        quantity: m.quantity,
        unitCost: m.unitCost,
        value: m.quantity * m.unitCost,
        reason: m.reason,
        refType: m.refType,
        item: {
          ...m.item,
          primaryImageUrl: m.item.images[0]?.url ?? null,
        },
        warehouse: m.warehouse,
        counterpart,
      }
    })

    return NextResponse.json(data)
  } catch (error) {
    console.error('StockMovements GET error:', error)
    return NextResponse.json({ error: 'فشل جلب حركات المخزون' }, { status: 500 })
  }
}
