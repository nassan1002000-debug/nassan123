import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  computePartnerStats,
  isPrismaError,
  partnerUniqueTarget,
  validatePartnerBody,
} from '@/lib/partners-server'
import { logAudit } from '@/lib/audit-server'
import { deleteLinkedAccount, syncPartnerAccount } from '@/lib/accounts-link'
import { getOpeningLinesByAccount } from '@/lib/period-server'
import { AR_PARTNER_TYPE, fmtDateTime } from '@/lib/format'
import { toWhatsappUrl } from '@/lib/whatsapp'

type Params = { params: Promise<{ id: string }> }

// GET /api/partners/[id] — بطاقة الطرف: البيانات + الإحصاءات + أحدث الفواتير والسندات
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const partner = await db.partner.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        phone: true,
        address: true,
        notes: true,
        isActive: true,
        createdAt: true,
        accountId: true,
        account: { select: { code: true, name: true } }, // كود الحساب المرتبط — تعدد الأدوار
      },
    })
    if (!partner) {
      return NextResponse.json({ error: 'ملف الطرف غير موجود' }, { status: 404 })
    }

    // الرصيد الافتتاحي المرحّل بسند القيد الافتتاحي — مصدر رصيد الطرف في الفترة الجديدة
    const openingLines = await getOpeningLinesByAccount(db)
    const openingLine = partner.accountId ? openingLines.get(partner.accountId) : undefined
    const openingNet = openingLine
      ? partner.type === 'SUPPLIER'
        ? -(openingLine.debit - openingLine.credit)
        : openingLine.debit - openingLine.credit
      : 0
    const stats = await computePartnerStats(partner.id, partner.type, openingNet)

    const invoiceType = partner.type === 'SUPPLIER' ? 'PURCHASE' : 'SALE'
    const voucherType = partner.type === 'SUPPLIER' ? 'PAYMENT' : 'RECEIPT'

    const [invoices, vouchers] = await Promise.all([
      db.invoice.findMany({
        where: { partnerId: partner.id, type: invoiceType, isDeleted: false },
        orderBy: { date: 'desc' },
        take: 10,
        select: { id: true, number: true, date: true, total: true, paid: true, status: true },
      }),
      db.payment.findMany({
        where: { partnerId: partner.id, type: voucherType },
        orderBy: { date: 'desc' },
        take: 10,
        select: {
          id: true,
          number: true,
          date: true,
          amount: true,
          method: true,
          notes: true,
          invoice: { select: { number: true } },
        },
      }),
    ])

    return NextResponse.json({
      partner: { ...partner, whatsappUrl: toWhatsappUrl(partner.phone) },
      stats,
      invoices,
      vouchers,
    })
  } catch (error) {
    console.error('GET /api/partners/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب بطاقة الطرف' }, { status: 500 })
  }
}

// PUT /api/partners/[id] — تعديل البيانات (النوع لا يتغير إن وُجدت فواتير أو سندات)
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const existing = await db.partner.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'ملف الطرف غير موجود' }, { status: 404 })
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const parsed = await validatePartnerBody(body, { requireAll: false, currentId: id })
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    // تغيير النوع ممنوع عند وجود مستندات — النوع يحكم اتجاه الأرصدة والفواتير
    const newType =
      body && body.type !== undefined && body.type !== null ? parsed.data.type : existing.type
    if (newType !== existing.type) {
      const [invCount, vchCount] = await Promise.all([
        db.invoice.count({ where: { partnerId: id } }),
        db.payment.count({ where: { partnerId: id } }),
      ])
      if (invCount > 0 || vchCount > 0) {
        return NextResponse.json(
          {
            error: `لا يمكن تغيير نوع الطرف — توجد مستندات مسجلة عليه (${invCount} فاتورة و${vchCount} سنداً)`,
          },
          { status: 409 },
        )
      }
    }

    // التعديل + مزامنة الحساب الفرعي + التوثيق داخل المعاملة نفسها (نمط الفواتير)
    const updated = await db.$transaction(async (tx) => {
      const u = await tx.partner.update({
        where: { id },
        data: {
          type: newType,
          name: parsed.data.name,
          phone: parsed.data.phone,
          address: parsed.data.address,
          notes: parsed.data.notes,
          isActive:
            body && body.isActive !== undefined ? parsed.data.isActive : existing.isActive,
        },
        select: { id: true, code: true, name: true, type: true, isActive: true, accountId: true },
      })

      // مزامنة الشجرة: تعديل الاسم/الحالة ينعكس على الحساب الفرعي — وإن فُقد الربط يُعاد إنشاؤه
      const finalActive = body && body.isActive !== undefined ? parsed.data.isActive : existing.isActive
      const nameOrStateChanged = parsed.data.name !== existing.name || finalActive !== existing.isActive
      const subAccountId =
        nameOrStateChanged || !u.accountId ? await syncPartnerAccount(tx, u) : u.accountId
      const subAcc = subAccountId
        ? await tx.account.findUnique({ where: { id: subAccountId }, select: { code: true } })
        : null

      // التوثيق — تغييرات «قبل ← بعد» (النوع لا يتغير إلا بلا مستندات — فُحص أعلاه)
      const changes: string[] = []
      if (newType !== existing.type)
        changes.push(
          `النوع: ${AR_PARTNER_TYPE[existing.type] ?? existing.type} ← ${AR_PARTNER_TYPE[newType] ?? newType}`,
        )
      if (parsed.data.name !== existing.name) changes.push(`الاسم: ${existing.name} ← ${parsed.data.name}`)
      if ((parsed.data.phone ?? null) !== existing.phone)
        changes.push(`الهاتف: ${existing.phone ?? 'بدون'} ← ${parsed.data.phone ?? 'بدون'}`)
      if ((parsed.data.address ?? null) !== existing.address)
        changes.push(`العنوان: ${existing.address ?? 'بدون'} ← ${parsed.data.address ?? 'بدون'}`)
      if ((parsed.data.notes ?? null) !== existing.notes)
        changes.push(`الملاحظات: ${existing.notes ?? 'بدون'} ← ${parsed.data.notes ?? 'بدون'}`)
      if (finalActive !== existing.isActive)
        changes.push(`الحالة: ${existing.isActive ? 'نشط' : 'موقوف'} ← ${finalActive ? 'نشط' : 'موقوف'}`)
      if (subAcc && subAcc.code) changes.push(`الحساب الفرعي في الشجرة: ${subAcc.code}`)

      const typeLabel = AR_PARTNER_TYPE[u.type] ?? u.type
      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'PARTNER',
        entityId: id,
        entityNumber: u.code,
        title: `ملف ${typeLabel} ${u.code}`,
        summary: `تعديل ملف ${typeLabel} ${u.code} — ${u.name} — ${changes.length > 0 ? changes.join('؛ ') : 'تعديل بيانات دون تغيير قيم دالة'}`,
        details: {
          'النوع': typeLabel,
          'الكود': u.code,
          'التغييرات': changes.length > 0 ? changes.join('؛ ') : 'لا تغييرات دالة',
          'وقت التعديل': fmtDateTime(new Date()),
        },
      })

      return u
    })

    return NextResponse.json({ ok: true, partner: updated, message: 'تم حفظ التعديلات' })
  } catch (error) {
    console.error('PUT /api/partners/[id] error:', error)
    if (isPrismaError(error)) {
      const target = partnerUniqueTarget(error)
      if (target) return NextResponse.json({ error: target }, { status: 409 })
    }
    return NextResponse.json({ error: 'حدث خطأ أثناء حفظ التعديلات' }, { status: 500 })
  }
}

// DELETE /api/partners/[id] — حذف الملف (ممنوع عند وجود فواتير أو سندات)
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const existing = await db.partner.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'ملف الطرف غير موجود' }, { status: 404 })
    }

    const [invCount, vchCount] = await Promise.all([
      db.invoice.count({ where: { partnerId: id } }),
      db.payment.count({ where: { partnerId: id } }),
    ])
    if (invCount > 0 || vchCount > 0) {
      return NextResponse.json(
        {
          error: `لا يمكن حذف الملف — توجد مستندات مسجلة عليه (${invCount} فاتورة و${vchCount} سنداً). يمكن إيقاف الملف بدلاً من حذفه`,
        },
        { status: 409 },
      )
    }

    // الحذف + حذف الحساب الفرعي من الشجرة (إن لم تبق عليه ملفات أخرى — تعدد الأدوار) + التوثيق في المعاملة نفسها
    const sub = await db.$transaction(async (tx) => {
      const guard = await deleteLinkedAccount(tx, existing.accountId, { excludePartnerId: existing.id })
      if (!guard.ok) {
        throw new GuardError(guard.error)
      }
      await tx.partner.delete({ where: { id } })

      const typeLabel = AR_PARTNER_TYPE[existing.type] ?? existing.type
      const accNote = guard.code
        ? ` — حُذف حسابه الفرعي ${guard.code} من الشجرة`
        : guard.kept
          ? ` — بقي الحساب الفرعي في الشجرة لملفاته الأخرى عليه`
          : ''
      await logAudit(tx, {
        action: 'DELETE',
        entity: 'PARTNER',
        entityId: id,
        entityNumber: existing.code,
        title: `ملف ${typeLabel} ${existing.code}`,
        summary: `حذف ملف ${typeLabel} ${existing.code} — ${existing.name}${existing.phone ? ` — هاتف ${existing.phone}` : ''}${accNote}`,
        details: {
          'النوع': typeLabel,
          'الكود': existing.code,
          'الاسم': existing.name,
          'الهاتف': existing.phone ?? 'بدون',
          'الحالة قبل الحذف': existing.isActive ? 'نشط' : 'موقوف',
          'أثر الحذف': 'الملف بلا فواتير أو سندات — حذف نظيف',
          'الحساب الفرعي المحذوف': guard.code ?? '—',
          'بقي الحساب لملفات أخرى': guard.kept ? 'نعم' : 'لا',
          'وقت الحذف': fmtDateTime(new Date()),
        },
      })
      return guard
    })

    const accMsg = sub.code
      ? ` مع حسابه الفرعي ${sub.code} من شجرة الحسابات`
      : sub.kept
        ? ` — بقي الحساب في الشجرة لملفاته الأخرى عليه`
        : ''
    return NextResponse.json({ ok: true, message: `تم حذف الملف ${existing.code}${accMsg}` })
  } catch (error) {
    if (error instanceof GuardError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('DELETE /api/partners/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حذف الملف' }, { status: 500 })
  }
}

/** خطأ حراسة داخلي — يحمل رسالة عربية جاهزة للرد 409 */
class GuardError extends Error {}
