// إعدادات منظومة نقاط الولاء — قراءة لكل المسجلين وتعديل للمدير حصراً
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireApiSession, requireAdmin } from '@/lib/api-guard'
import { getLoyaltySettings, validateLoyaltySettingsBody, LoyaltyError } from '@/lib/loyalty-server'
import { awardTableRows } from '@/lib/loyalty'
import { logAudit } from '@/lib/audit-server'
import { fmtDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

// GET /api/loyalty/settings — الإعدادات الحية + جدول المضاعفات التوضيحي
export async function GET(req: NextRequest) {
  const denied = await requireApiSession(req)
  if (denied) return denied
  try {
    const settings = await getLoyaltySettings()
    return NextResponse.json({
      settings,
      table: awardTableRows(settings),
    })
  } catch (error) {
    console.error('GET /api/loyalty/settings error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب إعدادات نقاط الولاء' }, { status: 500 })
  }
}

// PUT /api/loyalty/settings — تعديل وحفظ القيم — المدير حصراً
export async function PUT(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  try {
    const body = await req.json().catch(() => null)
    const patch = validateLoyaltySettingsBody(body)
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'لا توجد قيم لتعديلها' }, { status: 400 })
    }

    // معاملة ذرّية: الحفظ وتوثيقه معاً — كان المسار الوحيد في النظام الذي يكتب
    // خارج معاملة، فينجح الحفظ ويضيع أثره في سجل التدقيق عند أي تعثّر
    const after = await db.$transaction(async (tx) => {
      const before = await getLoyaltySettings(tx)
      await tx.loyaltySettings.upsert({
        where: { id: 1 },
        update: patch,
        create: { id: 1, ...patch },
      })
      const after = await getLoyaltySettings(tx)

      // توثيق التعديل في سجل التدقيق — قبل ← بعد لكل قيمة تغيرت
      const changes: string[] = []
    if (before.isEnabled !== after.isEnabled)
      changes.push(`التنشيط: ${before.isEnabled ? 'منشط' : 'متوقف'} ← ${after.isEnabled ? 'منشط' : 'متوقف'}`)
    if (before.minInvoiceValue !== after.minInvoiceValue)
      changes.push(`الحد الأدنى للفاتورة: ${before.minInvoiceValue.toLocaleString('en-US')} ← ${after.minInvoiceValue.toLocaleString('en-US')} ل.س`)
    if (before.cycleDays !== after.cycleDays) changes.push(`أيام الدورة: ${before.cycleDays} ← ${after.cycleDays}`)
    if (before.basePoints !== after.basePoints) changes.push(`النقاط الأساسية: ${before.basePoints} ← ${after.basePoints}`)
    if (before.pointPrice !== after.pointPrice)
      changes.push(`سعر النقطة: ${before.pointPrice.toLocaleString('en-US')} ← ${after.pointPrice.toLocaleString('en-US')} ل.س`)
      if (before.multiplicationFactor !== after.multiplicationFactor)
        changes.push(`نسبة المضاعفة الأسبوعية: ${before.multiplicationFactor} ← ${after.multiplicationFactor}`)

      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'SYSTEM',
        entityId: 'loyalty-settings',
        title: 'إعدادات نقاط الولاء',
        summary: `تعديل إعدادات نقاط الولاء — ${changes.length > 0 ? changes.join('؛ ') : 'حفظ دون تغيير قيم دالة'}`,
        details: {
          'الحالة بعد الحفظ': after.isEnabled ? 'منشط' : 'متوقف',
          'الحد الأدنى للفاتورة (ل.س)': after.minInvoiceValue.toLocaleString('en-US'),
          'أيام الدورة الأسبوعية': String(after.cycleDays),
          'النقاط الأساسية': String(after.basePoints),
          'سعر النقطة (ل.س)': after.pointPrice.toLocaleString('en-US'),
          'نسبة المضاعفة الأسبوعية': String(after.multiplicationFactor),
          'وقت الحفظ': fmtDateTime(new Date()),
        },
      })

      return after
    })

    return NextResponse.json({ ok: true, settings: after, table: awardTableRows(after) })
  } catch (error) {
    if (error instanceof LoyaltyError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('PUT /api/loyalty/settings error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حفظ الإعدادات' }, { status: 500 })
  }
}
