import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { fmtDateTime, fmtQty } from '@/lib/format'
import { round2 } from '@/lib/journal-server'
import { bodyNumber, HrHttpError, type SalaryRow } from '@/lib/hr-server'

type Params = { params: Promise<{ id: string }> }

// PUT /api/salaries/[id] — تعديل المكافآت/الاحتسابات للقسط المعلق فقط (المصروف محصّن)
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const salary = await db.salary.findUnique({
      where: { id },
      include: { employee: { select: { id: true, code: true, name: true } } },
    })
    if (!salary) {
      return NextResponse.json({ error: 'قسط الراتب غير موجود' }, { status: 404 })
    }
    if (salary.status === 'PAID') {
      return NextResponse.json({ error: 'لا يمكن تعديل قسط مصروف' }, { status: 409 })
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'بيانات الطلب غير صالحة' }, { status: 400 })

    // المكافآت/الاحتسابات — أرقام ≥ 0، والغائب يبقى بقيمته
    let bonuses = salary.bonuses
    if (body.bonuses !== undefined) {
      const raw = bodyNumber(body, 'bonuses')
      if (raw === null || raw < 0) {
        return NextResponse.json({ error: 'المكافآت يجب أن تكون رقماً ≥ 0' }, { status: 400 })
      }
      bonuses = round2(raw)
    }
    let deductions = salary.deductions
    if (body.deductions !== undefined) {
      const raw = bodyNumber(body, 'deductions')
      if (raw === null || raw < 0) {
        return NextResponse.json({ error: 'الاحتسابات يجب أن تكون رقماً ≥ 0' }, { status: 400 })
      }
      deductions = round2(raw)
    }

    const net = round2(salary.base + bonuses - deductions)

    const updated = await db.$transaction(async (tx) => {
      const s = await tx.salary.update({
        where: { id },
        data: { bonuses, deductions, net },
        include: { employee: { select: { id: true, code: true, name: true, position: true } } },
      })

      const changes: string[] = []
      if (s.bonuses !== salary.bonuses)
        changes.push(`المكافآت: ${fmtQty(salary.bonuses)} ← ${fmtQty(s.bonuses)}`)
      if (s.deductions !== salary.deductions)
        changes.push(`الاحتسابات: ${fmtQty(salary.deductions)} ← ${fmtQty(s.deductions)}`)
      if (s.net !== salary.net) changes.push(`الصافي: ${fmtQty(salary.net)} ← ${fmtQty(s.net)}`)

      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'SALARY',
        entityId: id,
        entityNumber: `${salary.month}/${salary.employee.code}`,
        title: `راتب ${salary.employee.name} — شهر ${salary.month}`,
        summary: `تعديل قسط راتب ${salary.employee.name} (${salary.employee.code}) — شهر ${salary.month} — ${changes.length > 0 ? changes.join('؛ ') : 'تعديل دون تغيير قيم دالة'}`,
        details: {
          'الموظف': `${salary.employee.name} (${salary.employee.code})`,
          'الشهر': salary.month,
          'الراتب الأساسي': fmtQty(salary.base),
          'المكافآت': fmtQty(bonuses),
          'الاحتسابات': fmtQty(deductions),
          'الصافي': fmtQty(net),
          'التغييرات': changes.length > 0 ? changes.join('؛ ') : 'لا تغييرات دالة',
          'وقت التعديل': fmtDateTime(new Date()),
        },
        amount: net,
      })

      return s
    })

    const row: SalaryRow = {
      id: updated.id,
      month: updated.month,
      base: updated.base,
      bonuses: updated.bonuses,
      deductions: updated.deductions,
      net: updated.net,
      status: updated.status === 'PAID' ? 'PAID' : 'PENDING',
      paidAt: updated.paidAt ? updated.paidAt.toISOString() : null,
      employee: updated.employee,
      // هذا المسار يعدّل قسطاً معلقاً فقط (الحرس أعلاه يرفض المصروف) — فلا قيد مرتبط بعد أبداً
      journalEntryNumber: null,
    }

    return NextResponse.json({ ok: true, salary: row, message: 'تم حفظ تعديلات القسط' })
  } catch (error) {
    if (error instanceof HrHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('PUT /api/salaries/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حفظ تعديلات القسط' }, { status: 500 })
  }
}

// DELETE /api/salaries/[id] — حذف القسط المعلق فقط (المصروف محصّن)
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const salary = await db.salary.findUnique({
      where: { id },
      include: { employee: { select: { id: true, code: true, name: true } } },
    })
    if (!salary) {
      return NextResponse.json({ error: 'قسط الراتب غير موجود' }, { status: 404 })
    }
    if (salary.status === 'PAID') {
      return NextResponse.json({ error: 'لا يمكن حذف قسط مصروف' }, { status: 409 })
    }

    await db.$transaction(async (tx) => {
      await tx.salary.delete({ where: { id } })
      await logAudit(tx, {
        action: 'DELETE',
        entity: 'SALARY',
        entityId: id,
        entityNumber: `${salary.month}/${salary.employee.code}`,
        title: `راتب ${salary.employee.name} — شهر ${salary.month}`,
        summary: `حذف قسط راتب ${salary.employee.name} (${salary.employee.code}) — شهر ${salary.month} — كان معلقاً بصافي ${fmtQty(salary.net)} ل.س`,
        details: {
          'الموظف': `${salary.employee.name} (${salary.employee.code})`,
          'الشهر': salary.month,
          'الأساسي': fmtQty(salary.base),
          'المكافآت': fmtQty(salary.bonuses),
          'الاحتسابات': fmtQty(salary.deductions),
          'الصافي قبل الحذف': fmtQty(salary.net),
          'الحالة قبل الحذف': 'معلق',
          'وقت الحذف': fmtDateTime(new Date()),
        },
        amount: salary.net,
      })
    })

    return NextResponse.json({ ok: true, message: 'تم حذف القسط' })
  } catch (error) {
    console.error('DELETE /api/salaries/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حذف القسط' }, { status: 500 })
  }
}
