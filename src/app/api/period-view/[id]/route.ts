// GET /api/period-view/[id] — بيانات تعريفية عن الفترة المقفلة قبل فتح الاستعراض
// (الاسم وتاريخا الإقفال والافتتاح ورقم سند الافتتاحي وحجم النسخة الأرشيفية)
import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/api-guard'
import { resolveViewPeriod } from '@/lib/period-view-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireApiSession(req)
  if (denied) return denied

  const { id } = await ctx.params
  try {
    const period = await resolveViewPeriod(id)
    if (!period) {
      return NextResponse.json({ error: 'الفترة المطلوبة أو نسختها الأرشيفية غير متاحة' }, { status: 404 })
    }
    return NextResponse.json({
      period: {
        id: period.id,
        label: period.label,
        closingDate: period.closingDate.toISOString().slice(0, 10),
        openingDate: period.openingDate.toISOString().slice(0, 10),
        openingEntryNumber: period.openingEntryNumber,
        snapshotFile: period.snapshotFile,
        snapshotBytes: period.snapshotBytes,
        rotatedEntries: period.rotatedEntries,
        closedBy: period.closedBy,
        createdAt: period.createdAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('GET /api/period-view/[id] error:', error)
    return NextResponse.json({ error: 'تعذر جلب بيانات الفترة' }, { status: 500 })
  }
}
