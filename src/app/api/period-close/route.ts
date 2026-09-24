// GET  /api/period-close — حالة الإقفال: قائمة الفترات المقفلة + آخر إقفال + المسودات الحالية
// POST /api/period-close — تنفيذ الإقفال والتدوير (مدير أو محاسب) — نسخة أرشيفية + سند افتتاحي + تدوير قيود
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth-server'
import { SESSION_COOKIE } from '@/lib/session'
import { requireRole } from '@/lib/api-guard'
import { CloseError, assertManagerPassword, countDraftEntriesBefore, executePeriodClose } from '@/lib/period-server'

export const dynamic = 'force-dynamic'

/** شكل الفترة المُعاد للواجهة — التواريخ نصوص ISO للتعرض مباشرة */
export function toPeriodRow(p: {
  id: string
  label: string
  closingDate: Date
  openingDate: Date
  openingEntryNumber: string
  snapshotFile: string
  snapshotBytes: number
  rotatedEntries: number
  closedBy: string
  createdAt: Date
}) {
  return {
    id: p.id,
    label: p.label,
    closingDate: p.closingDate.toISOString().slice(0, 10),
    openingDate: p.openingDate.toISOString().slice(0, 10),
    openingEntryNumber: p.openingEntryNumber,
    snapshotFile: p.snapshotFile,
    snapshotBytes: p.snapshotBytes,
    rotatedEntries: p.rotatedEntries,
    closedBy: p.closedBy,
    createdAt: p.createdAt.toISOString(),
  }
}

export async function GET() {
  try {
    const periods = await db.periodClose.findMany({ orderBy: { closingDate: 'desc' } })
    const today = new Date().toISOString().slice(0, 10)
    const drafts = await countDraftEntriesBefore(db, today)
    return NextResponse.json({
      periods: periods.map(toPeriodRow),
      latest: periods[0] ? toPeriodRow(periods[0]) : null,
      draftEntries: drafts,
    })
  } catch (error) {
    console.error('GET /api/period-close error:', error)
    return NextResponse.json({ error: 'تعذر جلب حالة الفترات المحاسبية' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireRole(req, 'ADMIN', 'ACCOUNTANT')
  if (denied) return denied

  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value
    const me = await getSessionUser(token)
    if (!me) return NextResponse.json({ error: 'الجلسة منتهية — سجّل الدخول من جديد' }, { status: 401 })

    const body = (await req.json().catch(() => null)) as
      | { closingDate?: unknown; label?: unknown; confirm?: unknown; password?: unknown; archivePath?: unknown }
      | null
    if (body?.confirm !== 'yes') {
      return NextResponse.json(
        { error: 'الإقفال عملية جوهرية — أرسل confirm=yes مع التاريخ والاسم للتأكيد الصريح' },
        { status: 400 },
      )
    }
    if (typeof body.closingDate !== 'string' || typeof body.label !== 'string') {
      return NextResponse.json({ error: 'أدخل تاريخ الإقفال واسم الفترة الجديدة' }, { status: 400 })
    }
    // شرط الأمان: كلمة سر المدير إلزامية مع كل إقفال — الجلسة وحدها لا تكفي
    await assertManagerPassword(body.password)

    const outcome = await executePeriodClose({
      closingDate: body.closingDate,
      label: body.label,
      username: me.username,
      archivePath: body.archivePath,
    })
    return NextResponse.json({ ok: true, period: outcome })
  } catch (error) {
    if (error instanceof CloseError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('POST /api/period-close error:', error)
    return NextResponse.json(
      { error: 'فشل تنفيذ الإقفال — لم تُمس البيانات (النسخة الأرشيفية تُلتقط قبل أي تعديل)' },
      { status: 500 },
    )
  }
}
