// العمليات الجماعية — إهداء أو خصم نقاط لجميع العملاء المسجلين دفعة واحدة بسبب موحد
// المدير حصراً — ومعاملة ذرية واحدة: إما أن تنجح الدفعة كاملة أو يُلغى كل شيء
// الخصم الجماعي يتخطى من لا يملك رصيداً كافياً ويوثق ذلك في الرد (لا يفشل الباقي بسببه)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/api-guard'
import { applyLoyaltyMovement, getLoyaltySettings, LoyaltyError } from '@/lib/loyalty-server'
import { logAudit } from '@/lib/audit-server'
import { fmtDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

// POST /api/loyalty/bulk — { mode: 'GIFT' | 'DEDUCT', points, reason }
export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  try {
    const body = (await req.json().catch(() => null)) as {
      mode?: string
      points?: unknown
      reason?: string
    } | null
    if (!body) return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })

    const mode = String(body.mode ?? '')
    if (!['GIFT', 'DEDUCT'].includes(mode)) {
      return NextResponse.json({ error: 'نوع العملية غير صالح — إهداء أو خصم' }, { status: 400 })
    }

    const points = Number(body.points)
    if (!Number.isInteger(points) || points <= 0) {
      return NextResponse.json({ error: 'عدد النقاط يجب أن يكون عدداً صحيحاً أكبر من صفر' }, { status: 400 })
    }
    if (points > 1_000_000) {
      return NextResponse.json({ error: 'عدد النقاط كبير جداً — الحد الأقصى مليون نقطة للعملية' }, { status: 400 })
    }

    const reason = String(body.reason ?? '').trim()
    if (!reason) {
      return NextResponse.json(
        { error: 'السبب الموحد إلزامي — سيظهر في كشف حساب كل عميل تأثر بالعملية' },
        { status: 400 },
      )
    }
    if (reason.length > 400) {
      return NextResponse.json({ error: 'السبب طويل جداً — 400 خانة كحد أقصى' }, { status: 400 })
    }

    const settings = await getLoyaltySettings()
    if (!settings.isEnabled) {
      return NextResponse.json(
        { error: 'نظام نقاط الولاء غير منشط — فعّله من تبويب الإعدادات أولاً' },
        { status: 409 },
      )
    }

    const customers = await db.partner.findMany({
      where: { type: 'CUSTOMER' },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    })
    if (customers.length === 0) {
      return NextResponse.json({ error: 'لا يوجد عملاء مسجلون في النظام' }, { status: 400 })
    }

    const result = await db.$transaction(async (tx) => {
      const affected: string[] = []
      const skipped: string[] = []
      // توقيت مُفاضل بالميلي ثانية — ترتيب ثابت للكشوف عند تعدد الحركات بالمعاملة الواحدة
      const base = Date.now()
      for (let i = 0; i < customers.length; i++) {
        const c = customers[i]
        if (mode === 'DEDUCT') {
          // الخصم الجماعي يتخطى من لا يملك الرصيد الكافي — بدل إفشال الدفعة كلها
          const agg = await tx.loyaltyTransaction.aggregate({
            where: { customerId: c.id },
            _sum: { points: true },
          })
          if ((agg._sum.points ?? 0) < points) {
            skipped.push(`${c.name} (${c.code})`)
            continue
          }
        }
        await applyLoyaltyMovement(tx, {
          customerId: c.id,
          points: mode === 'GIFT' ? points : -points,
          type: mode === 'GIFT' ? 'GIFT' : 'DEDUCT',
          reason: `${mode === 'GIFT' ? 'إهداء جماعي لجميع العملاء' : 'خصم جماعي من جميع العملاء'} — ${reason}`,
          refType: 'BULK',
          refId: null,
          refNumber: null,
          at: new Date(base + i),
        })
        affected.push(`${c.name} (${c.code})`)
      }

      await logAudit(tx, {
        action: 'CREATE',
        entity: 'SYSTEM',
        entityId: 'loyalty-bulk',
        title: 'عملية جماعية على نقاط الولاء',
        summary:
          mode === 'GIFT'
            ? `إهداء جماعي ${points} نقطة لـ ${affected.length} عميلاً من أصل ${customers.length} — السبب: ${reason}`
            : `خصم جماعي ${points} نقطة من ${affected.length} عميلاً (تخطي ${skipped.length} لعدم كفاية الرصيد من أصل ${customers.length}) — السبب: ${reason}`,
        details: {
          'نوع العملية': mode === 'GIFT' ? 'إهداء جماعي' : 'خصم جماعي',
          'عدد النقاط': String(points),
          'العملاء المتأثرون': String(affected.length),
          'المتخطون (عدم كفاية الرصيد)': String(skipped.length),
          'السبب الموحد': reason,
          'أسماء المتأثرين': affected.slice(0, 50).join('، ') || 'لا أحد',
          ...(skipped.length > 0 ? { 'أسماء المتخطين': skipped.slice(0, 50).join('، ') } : {}),
          'وقت العملية': fmtDateTime(new Date()),
        },
      })
      return { affectedCount: affected.length, skippedCount: skipped.length, skippedNames: skipped.slice(0, 10) }
    })

    return NextResponse.json({ ok: true, ...result, totalCustomers: customers.length })
  } catch (error) {
    if (error instanceof LoyaltyError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('POST /api/loyalty/bulk error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء العملية الجماعية' }, { status: 500 })
  }
}
