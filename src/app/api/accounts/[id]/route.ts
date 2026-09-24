import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { AR_ACCOUNT_NATURE, AR_ACCOUNT_TYPE } from '@/lib/accounts-link'
import { fmtDateTime } from '@/lib/format'

const VALID_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']
const VALID_NATURES = ['DEBIT', 'CREDIT']

// ==================== GET: تفاصيل حساب ====================
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const account = await db.account.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, code: true, name: true } },
        _count: { select: { children: true, journalLines: true } },
      },
    })
    if (!account) {
      return NextResponse.json({ error: 'الحساب غير موجود' }, { status: 404 })
    }
    return NextResponse.json(account)
  } catch (error) {
    console.error('Account GET error:', error)
    return NextResponse.json({ error: 'فشل جلب تفاصيل الحساب' }, { status: 500 })
  }
}

// ==================== PUT: تعديل حساب ====================
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const existing = await db.account.findUnique({
      where: { id },
      include: { _count: { select: { children: true } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'الحساب غير موجود' }, { status: 404 })
    }
    // حساب تحكم مقدس (القسم 0 البند 8): نظامي محجوز، أو تجميعي له حسابات فرعية
    const isControlAccount = existing.isSystem || existing._count.children > 0

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })
    }

    const data: {
      code?: string
      name?: string
      type?: string
      nature?: string
      openingBalance?: number
      isActive?: boolean
    } = {}

    // الكود: ممنوع تعديله في الحسابات النظامية، وممنوع الاصطدام بكود موجود
    if (body.code !== undefined && body.code !== null) {
      const code = String(body.code).trim()
      if (!code) {
        return NextResponse.json({ error: 'كود الحساب مطلوب' }, { status: 400 })
      }
      if (isControlAccount && code !== existing.code) {
        return NextResponse.json(
          { error: `لا يمكن تعديل كود حساب التحكم «${existing.name}» — الكود مرجع ثابت يعتمد عليه منطق النظام` },
          { status: 400 },
        )
      }
      if (code !== existing.code) {
        const duplicate = await db.account.findUnique({ where: { code } })
        if (duplicate) {
          return NextResponse.json(
            { error: `الكود "${code}" مستخدم مسبقاً في الحساب "${duplicate.name}"` },
            { status: 409 },
          )
        }
        data.code = code
      }
    }

    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) {
        return NextResponse.json({ error: 'اسم الحساب مطلوب' }, { status: 400 })
      }
      data.name = name
    }

    if (body.type !== undefined) {
      const type = String(body.type)
      if (!VALID_TYPES.includes(type)) {
        return NextResponse.json({ error: 'نوع الحساب غير صحيح' }, { status: 400 })
      }
      data.type = type
    }

    if (body.nature !== undefined) {
      const nature = String(body.nature)
      if (!VALID_NATURES.includes(nature)) {
        return NextResponse.json({ error: 'طبيعة الحساب غير صحيحة' }, { status: 400 })
      }
      data.nature = nature
    }

    if (body.openingBalance !== undefined) {
      const opening = Number(body.openingBalance)
      if (!Number.isFinite(opening)) {
        return NextResponse.json({ error: 'الرصيد الافتتاحي غير صالح' }, { status: 400 })
      }
      // حسابات التحكم مقدسة (القسم 0 البند 8): الرصيد الافتتاحي يدخل مباشرة في
      // كل رصيد مُقرَّر بالنظام (اللوحة، التقارير، دفتر الأستاذ) بلا أي قيد مقابل
      // — تعديله على حساب تحكم حركة غير مباشرة تُفلت تماماً من القيد المزدوج
      // ومن معادلة التوازن A3 (تُحسب من JournalEntryLine فقط، لا من هذا الحقل)
      if (isControlAccount && opening !== existing.openingBalance) {
        return NextResponse.json(
          {
            error: `لا يمكن تعديل الرصيد الافتتاحي لحساب التحكم «${existing.name}» يدوياً — رصيده يتحدث حصراً عبر قيوده ومستنداته المرحّلة`,
          },
          { status: 400 },
        )
      }
      data.openingBalance = opening
    }

    if (body.isActive !== undefined) {
      data.isActive = Boolean(body.isActive)
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(existing)
    }

    // منع تغيير النوع/الطبيعة لحساب عليه قيود مُرحّلة — تغييرهما يعيد تفسير رصيده التاريخي
    const typeOrNatureChanged =
      (data.type !== undefined && data.type !== existing.type) ||
      (data.nature !== undefined && data.nature !== existing.nature)
    if (typeOrNatureChanged) {
      const posted = await db.journalEntryLine.count({
        where: { accountId: id, entry: { status: 'POSTED' } },
      })
      if (posted > 0) {
        return NextResponse.json(
          { error: `لا يمكن تغيير النوع أو الطبيعة — الحساب مرتبط بـ ${posted} بند قيد مُرحّل يعتمد عليها` },
          { status: 409 },
        )
      }
    }

    // معاملة ذرّية واحدة: تعديل الحساب + توثيقه + مزامنة كل ملفاته وتوثيقها.
    // كانت كل مزامنة في معاملة مستقلة، فيمكن أن ينجح تعديل الحساب ويفشل انعكاسه
    // على ملفاته فيختلف الاسم بين الشجرة والشاشة بلا أثر يدل على ذلك
    const updated = await db.$transaction(async (tx) => {
      const account = await tx.account.update({ where: { id }, data })

      // توثيق تعديل الحساب نفسه — قبل ← بعد لكل حقل تغيّر فعلاً
      const changes: string[] = []
      if (data.code !== undefined && data.code !== existing.code)
        changes.push(`الكود: ${existing.code} ← ${data.code}`)
      if (data.name !== undefined && data.name !== existing.name)
        changes.push(`الاسم: ${existing.name} ← ${data.name}`)
      if (data.type !== undefined && data.type !== existing.type)
        changes.push(`النوع: ${AR_ACCOUNT_TYPE[existing.type] ?? existing.type} ← ${AR_ACCOUNT_TYPE[data.type] ?? data.type}`)
      if (data.nature !== undefined && data.nature !== existing.nature)
        changes.push(`الطبيعة: ${AR_ACCOUNT_NATURE[existing.nature] ?? existing.nature} ← ${AR_ACCOUNT_NATURE[data.nature] ?? data.nature}`)
      if (data.openingBalance !== undefined && data.openingBalance !== existing.openingBalance)
        changes.push(`الرصيد الافتتاحي: ${existing.openingBalance.toFixed(2)} ← ${data.openingBalance.toFixed(2)} ل.س`)
      if (data.isActive !== undefined && data.isActive !== existing.isActive)
        changes.push(`الحالة: ${existing.isActive ? 'نشط' : 'موقوف'} ← ${data.isActive ? 'نشط' : 'موقوف'}`)

      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'ACCOUNT',
        entityId: account.id,
        entityNumber: account.code,
        title: `حساب ${account.code} — ${account.name}`,
        summary: `تعديل حساب ${existing.code} «${existing.name}» — ${changes.length > 0 ? changes.join('؛ ') : 'حفظ دون تغيير قيم دالة'}`,
        details: {
          'الحساب': `${existing.code} — ${existing.name}`,
          'التغييرات': changes.length > 0 ? changes.join('؛ ') : 'لا شيء',
          'حساب نظامي': existing.isSystem ? 'نعم' : 'لا',
          'وقت التعديل': fmtDateTime(new Date()),
        },
      })

      // المزامنة العكسية: تعديل الاسم/الحالة من الشجرة ينعكس على كل ملفات العميل/المورد/الموظف المرتبطة
      // تعدد الأدوار: الحساب الواحد قد يحمل عدة ملفات أطراف (عميل + مورد) وملف موظف معاً
      if (data.name !== undefined || data.isActive !== undefined) {
        const [linkedPartners, linkedEmployee] = await Promise.all([
          tx.partner.findMany({ where: { accountId: id } }),
          tx.employee.findFirst({ where: { accountId: id } }),
        ])
        for (const linkedPartner of linkedPartners) {
          await tx.partner.update({
            where: { id: linkedPartner.id },
            data: {
              ...(data.name !== undefined ? { name: String(data.name) } : {}),
              ...(data.isActive !== undefined ? { isActive: Boolean(data.isActive) } : {}),
            },
          })
          await logAudit(tx, {
            action: 'UPDATE',
            entity: 'PARTNER',
            entityId: linkedPartner.id,
            entityNumber: linkedPartner.code,
            title: `ملف ${linkedPartner.type === 'SUPPLIER' ? 'مورد' : 'عميل'} ${linkedPartner.code}`,
            summary: `مزامنة من شجرة الحسابات — تعديل الحساب ${existing.code} انعكس على الملف${data.name !== undefined ? ` — الاسم: ${linkedPartner.name} ← ${String(data.name)}` : ''}${data.isActive !== undefined ? ` — الحالة: ${linkedPartner.isActive ? 'نشط' : 'موقوف'} ← ${Boolean(data.isActive) ? 'نشط' : 'موقوف'}` : ''}`,
            details: {
              'المصدر': 'شجرة الحسابات',
              'الحساب': `${existing.code} — ${account.name}`,
              'وقت المزامنة': fmtDateTime(new Date()),
            },
          })
        }
        if (linkedEmployee) {
          await tx.employee.update({
            where: { id: linkedEmployee.id },
            data: {
              ...(data.name !== undefined ? { name: String(data.name) } : {}),
              ...(data.isActive !== undefined ? { isActive: Boolean(data.isActive) } : {}),
            },
          })
          await logAudit(tx, {
            action: 'UPDATE',
            entity: 'EMPLOYEE',
            entityId: linkedEmployee.id,
            entityNumber: linkedEmployee.code,
            title: `ملف موظف ${linkedEmployee.code}`,
            summary: `مزامنة من شجرة الحسابات — تعديل الحساب ${existing.code} انعكس على الملف${data.name !== undefined ? ` — الاسم: ${linkedEmployee.name} ← ${String(data.name)}` : ''}${data.isActive !== undefined ? ` — الحالة: ${linkedEmployee.isActive ? 'نشط' : 'موقوف'} ← ${Boolean(data.isActive) ? 'نشط' : 'موقوف'}` : ''}`,
            details: {
              'المصدر': 'شجرة الحسابات',
              'الحساب': `${existing.code} — ${account.name}`,
              'وقت المزامنة': fmtDateTime(new Date()),
            },
          })
        }
      }

      return account
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Account PUT error:', error)
    return NextResponse.json({ error: 'فشل تعديل الحساب' }, { status: 500 })
  }
}

// ==================== DELETE: حذف حساب (مع حماية) ====================
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const existing = await db.account.findUnique({
      where: { id },
      include: { _count: { select: { children: true, journalLines: true } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'الحساب غير موجود' }, { status: 404 })
    }

    if (existing.isSystem) {
      return NextResponse.json(
        { error: `لا يمكن حذف "${existing.name}" — حساب نظامي أساسي في دليل الحسابات` },
        { status: 400 },
      )
    }
    if (existing._count.children > 0) {
      return NextResponse.json(
        {
          error: `لا يمكن حذف "${existing.name}" — يوجد ${existing._count.children} حساب فرعي تابع له، احذف الحسابات الفرعية أولاً`,
        },
        { status: 400 },
      )
    }
    if (existing._count.journalLines > 0) {
      return NextResponse.json(
        {
          error: `لا يمكن حذف "${existing.name}" — مرتبط بـ ${existing._count.journalLines} بند قيد محاسبي`,
        },
        { status: 400 },
      )
    }

    // حرس الملفات المرتبطة: حساب عميل/مورد/موظف لا يُحذف وحده — معه تُحذف ملفاته كلها،
    // وإن كان أي ملف عليه مستندات يُمنع الحذف كلياً (تتبع مالي مكتمل)
    // تعدد الأدوار: الحساب قد يحمل عدة ملفات أطراف (عميل + مورد) وملف موظف معاً — كلها تُحرس
    const [linkedPartners, linkedEmployee] = await Promise.all([
      db.partner.findMany({ where: { accountId: id } }),
      db.employee.findFirst({ where: { accountId: id } }),
    ])

    for (const linkedPartner of linkedPartners) {
      const [invCount, vchCount] = await Promise.all([
        db.invoice.count({ where: { partnerId: linkedPartner.id } }),
        db.payment.count({ where: { partnerId: linkedPartner.id } }),
      ])
      if (invCount > 0 || vchCount > 0) {
        const kindLabel = linkedPartner.type === 'SUPPLIER' ? 'المورد' : 'العميل'
        return NextResponse.json(
          {
            error: `لا يمكن حذف الحساب — مرتبط بملف ${kindLabel} ${linkedPartner.code} (${linkedPartner.name}) عليه ${invCount + vchCount} مستنداً. احذف الملف من شاشة العملاء والموردين بعد تسوية مستنداته`,
          },
          { status: 409 },
        )
      }
    }
    if (linkedEmployee) {
      const [salaries, advances, leaves, attendances, bonuses] = await Promise.all([
        db.salary.count({ where: { employeeId: linkedEmployee.id } }),
        db.advance.count({ where: { employeeId: linkedEmployee.id } }),
        db.leave.count({ where: { employeeId: linkedEmployee.id } }),
        db.attendance.count({ where: { employeeId: linkedEmployee.id } }),
        db.bonusDeduction.count({ where: { employeeId: linkedEmployee.id } }),
      ])
      const total = salaries + advances + leaves + attendances + bonuses
      if (total > 0) {
        return NextResponse.json(
          {
            error: `لا يمكن حذف الحساب — مرتبط بملف الموظف ${linkedEmployee.code} (${linkedEmployee.name}) عليه ${total} حركة. احذف الملف من شاشة الموظفون بعد تسوية حركاته`,
          },
          { status: 409 },
        )
      }
    }

    const result = await db.$transaction(async (tx) => {
      for (const linkedPartner of linkedPartners) {
        await tx.partner.delete({ where: { id: linkedPartner.id } })
        await logAudit(tx, {
          action: 'DELETE',
          entity: 'PARTNER',
          entityId: linkedPartner.id,
          entityNumber: linkedPartner.code,
          title: `ملف ${linkedPartner.type === 'SUPPLIER' ? 'مورد' : 'عميل'} ${linkedPartner.code}`,
          summary: `حُذف تلقائياً من شجرة الحسابات — حذف الحساب ${existing.code} (${existing.name}) حذف ملف ${linkedPartner.type === 'SUPPLIER' ? 'المورد' : 'العميل'} ${linkedPartner.code} — ${linkedPartner.name} معه`,
          details: {
            'المصدر': 'شجرة الحسابات',
            'الحساب المحذوف': `${existing.code} — ${existing.name}`,
            'الملف المحذوف': linkedPartner.code,
            'وقت الحذف': fmtDateTime(new Date()),
          },
        })
      }
      if (linkedEmployee) {
        await tx.employee.delete({ where: { id: linkedEmployee.id } })
        await logAudit(tx, {
          action: 'DELETE',
          entity: 'EMPLOYEE',
          entityId: linkedEmployee.id,
          entityNumber: linkedEmployee.code,
          title: `ملف موظف ${linkedEmployee.code}`,
          summary: `حُذف تلقائياً من شجرة الحسابات — حذف الحساب ${existing.code} (${existing.name}) حذف ملف الموظف ${linkedEmployee.code} — ${linkedEmployee.name} معه`,
          details: {
            'المصدر': 'شجرة الحسابات',
            'الحساب المحذوف': `${existing.code} — ${existing.name}`,
            'الملف المحذوف': linkedEmployee.code,
            'وقت الحذف': fmtDateTime(new Date()),
          },
        })
      }
      await tx.account.delete({ where: { id } })

      // توثيق حذف الحساب نفسه — لقطة كاملة لتعريفه قبل زواله من الشجرة
      await logAudit(tx, {
        action: 'DELETE',
        entity: 'ACCOUNT',
        entityId: existing.id,
        entityNumber: existing.code,
        title: `حساب ${existing.code} — ${existing.name}`,
        summary:
          `حُذف حساب ${existing.code} «${existing.name}» — ` +
          `${AR_ACCOUNT_TYPE[existing.type] ?? existing.type} بطبيعة ${AR_ACCOUNT_NATURE[existing.nature] ?? existing.nature}` +
          `${linkedPartners.length > 0 || linkedEmployee ? ' — ومعه ملفاته المرتبطة' : ''}`,
        details: {
          'الكود': existing.code,
          'الاسم': existing.name,
          'النوع': AR_ACCOUNT_TYPE[existing.type] ?? existing.type,
          'الطبيعة': AR_ACCOUNT_NATURE[existing.nature] ?? existing.nature,
          'الملفات المحذوفة معه': [
            ...linkedPartners.map((p) => `${p.type === 'SUPPLIER' ? 'مورد' : 'عميل'} ${p.code}`),
            ...(linkedEmployee ? [`موظف ${linkedEmployee.code}`] : []),
          ].join('، ') || 'لا شيء',
          'وقت الحذف': fmtDateTime(new Date()),
        },
      })

      return {
        linked: [
          ...linkedPartners.map((p) => `${p.type === 'SUPPLIER' ? 'مورد' : 'عميل'} ${p.code}`),
          ...(linkedEmployee ? [`موظف ${linkedEmployee.code}`] : []),
        ].join('، ') || null,
      }
    })

    return NextResponse.json({
      ok: true,
      message: `تم حذف الحساب "${existing.name}" بنجاح${result.linked ? ` مع الملف المرتبط (${result.linked})` : ''}`,
    })
  } catch (error) {
    console.error('Account DELETE error:', error)
    return NextResponse.json({ error: 'فشل حذف الحساب' }, { status: 500 })
  }
}
