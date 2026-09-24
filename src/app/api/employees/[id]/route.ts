import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { deleteLinkedAccount, syncEmployeeAccount } from '@/lib/accounts-link'
import { fmtDate, fmtDateTime, fmtQty, todayYMD } from '@/lib/format'
import { round2 } from '@/lib/journal-server'
import { isUniqueViolation } from '@/lib/prisma-errors'
import {
  bodyNumber,
  bodyString,
  bodyStringOrNull,
  getEmployeeRow,
  isValidYMD,
  ymdStart,
} from '@/lib/hr-server'

type Params = { params: Promise<{ id: string }> }

// GET /api/employees/[id] — بطاقة الموظف: الصف الموحد + أحدث حركاته (رواتب وسلف)
// نفس نمط بطاقة الطرف GET /api/partners/[id] (فاتورة/سند → هنا راتب/سلفة)
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const employee = await getEmployeeRow(id)
    if (!employee) {
      return NextResponse.json({ error: 'ملف الموظف غير موجود' }, { status: 404 })
    }

    const [salaries, advances] = await Promise.all([
      db.salary.findMany({
        where: { employeeId: id },
        orderBy: { month: 'desc' },
        take: 12,
        select: { id: true, month: true, base: true, bonuses: true, deductions: true, net: true, status: true, paidAt: true },
      }),
      db.advance.findMany({
        where: { employeeId: id },
        orderBy: { date: 'desc' },
        take: 10,
        select: { id: true, date: true, amount: true, reason: true, status: true },
      }),
    ])

    return NextResponse.json({
      employee,
      salaries: salaries.map((s) => ({ ...s, paidAt: s.paidAt ? s.paidAt.toISOString() : null })),
      advances: advances.map((a) => ({ ...a, date: a.date.toISOString() })),
    })
  } catch (error) {
    console.error('GET /api/employees/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب ملف الموظف' }, { status: 500 })
  }
}

// PUT /api/employees/[id] — تعديل الملف (جسم جزئي: الحقول الغائبة تبقى كما هي)
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const existing = await db.employee.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'ملف الموظف غير موجود' }, { status: 404 })
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'بيانات الطلب غير صالحة' }, { status: 400 })

    // الاسم والمسمى — إلزاميان إن أُرسلا
    const name = body.name === undefined ? existing.name : bodyString(body, 'name')
    const position = body.position === undefined ? existing.position : bodyString(body, 'position')
    if (!name) return NextResponse.json({ error: 'اسم الموظف مطلوب' }, { status: 400 })
    if (!position) return NextResponse.json({ error: 'المسمى الوظيفي مطلوب' }, { status: 400 })

    // الراتب الأساسي — إن أُرسل يجب أن يكون رقماً ≥ 0
    let baseSalary = existing.baseSalary
    if (body.baseSalary !== undefined) {
      const raw = bodyNumber(body, 'baseSalary')
      if (raw === null || raw < 0) {
        return NextResponse.json({ error: 'الراتب الأساسي مطلوب (رقم ≥ 0)' }, { status: 400 })
      }
      baseSalary = round2(raw)
    }

    // تاريخ التعيين — إن أُرسل يجب أن يكون تاريخاً حقيقياً
    let hireDate = existing.hireDate
    if (body.hireDate !== undefined) {
      const hireDateStr = bodyString(body, 'hireDate') || todayYMD()
      if (!isValidYMD(hireDateStr)) {
        return NextResponse.json({ error: 'تاريخ التعيين غير صالح (YYYY-MM-DD)' }, { status: 400 })
      }
      hireDate = ymdStart(hireDateStr)
    }

    const department = body.department === undefined ? existing.department : bodyStringOrNull(body, 'department')
    const phone = body.phone === undefined ? existing.phone : bodyStringOrNull(body, 'phone')
    const isActive = body.isActive === undefined ? existing.isActive : Boolean(body.isActive)

    // الكود — فحص تفرّد فقط إن تغيّر
    let code = existing.code
    if (body.code !== undefined) {
      const codeInput = bodyString(body, 'code')
      if (codeInput && codeInput !== existing.code) {
        const dup = await db.employee.findUnique({ where: { code: codeInput }, select: { id: true } })
        if (dup && dup.id !== id) {
          return NextResponse.json({ error: `الكود ${codeInput} مستخدم مسبقاً` }, { status: 409 })
        }
        code = codeInput
      }
    }

    const updated = await db.$transaction(async (tx) => {
      const e = await tx.employee.update({
        where: { id },
        data: { code, name, position, department, phone, hireDate, baseSalary, isActive },
      })

      // مزامنة الشجرة: الاسم/الحالة ينعكسان على الحساب الفرعي — وإن فُقد الربط يُعاد إنشاؤه
      const nameOrStateChanged =
        e.name !== existing.name || e.isActive !== existing.isActive
      const subAccountId =
        nameOrStateChanged || !e.accountId ? await syncEmployeeAccount(tx, e) : e.accountId
      const subAcc = subAccountId
        ? await tx.account.findUnique({ where: { id: subAccountId }, select: { code: true } })
        : null

      // سجل التغييرات «قبل ← بعد» للقيم الدالة فقط
      const changes: string[] = []
      if (e.code !== existing.code) changes.push(`الكود: ${existing.code} ← ${e.code}`)
      if (e.name !== existing.name) changes.push(`الاسم: ${existing.name} ← ${e.name}`)
      if (e.position !== existing.position) changes.push(`المسمى الوظيفي: ${existing.position} ← ${e.position}`)
      if ((e.department ?? null) !== (existing.department ?? null))
        changes.push(`القسم: ${existing.department ?? '—'} ← ${e.department ?? '—'}`)
      if ((e.phone ?? null) !== (existing.phone ?? null))
        changes.push(`الهاتف: ${existing.phone ?? '—'} ← ${e.phone ?? '—'}`)
      if (e.hireDate.getTime() !== existing.hireDate.getTime())
        changes.push(`تاريخ التعيين: ${fmtDate(existing.hireDate)} ← ${fmtDate(e.hireDate)}`)
      if (e.baseSalary !== existing.baseSalary)
        changes.push(`الراتب الأساسي: ${fmtQty(existing.baseSalary)} ← ${fmtQty(e.baseSalary)}`)
      if (e.isActive !== existing.isActive)
        changes.push(`الحالة: ${existing.isActive ? 'نشط' : 'موقوف'} ← ${e.isActive ? 'نشط' : 'موقوف'}`)
      if (subAcc?.code) changes.push(`الحساب الفرعي في الشجرة: ${subAcc.code}`)

      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'EMPLOYEE',
        entityId: id,
        entityNumber: e.code,
        title: `ملف موظف ${e.code}`,
        summary: `تعديل ملف الموظف ${e.code} — ${e.name} — ${changes.length > 0 ? changes.join('؛ ') : 'تعديل دون تغيير قيم دالة'}`,
        details: {
          'الكود': e.code,
          'الاسم': e.name,
          'المسمى الوظيفي': e.position,
          'الراتب الأساسي': fmtQty(e.baseSalary),
          'الحالة': e.isActive ? 'نشط' : 'موقوف',
          'التغييرات': changes.length > 0 ? changes.join('؛ ') : 'لا تغييرات دالة',
          'وقت التعديل': fmtDateTime(new Date()),
        },
      })

      return e
    })

    const employee = await getEmployeeRow(updated.id)
    return NextResponse.json({ ok: true, employee, message: 'تم حفظ التعديلات' })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'كود الموظف مستخدم مسبقاً' }, { status: 409 })
    }
    console.error('PUT /api/employees/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حفظ التعديلات' }, { status: 500 })
  }
}

// DELETE /api/employees/[id] — حذف الملف (ممنوع عند وجود أي حركات: رواتب/سلف/إجازات/دوام/مكافآت)
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const existing = await db.employee.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'ملف الموظف غير موجود' }, { status: 404 })
    }

    const [salaries, advances, leaves, attendances, bonuses] = await Promise.all([
      db.salary.count({ where: { employeeId: id } }),
      db.advance.count({ where: { employeeId: id } }),
      db.leave.count({ where: { employeeId: id } }),
      db.attendance.count({ where: { employeeId: id } }),
      db.bonusDeduction.count({ where: { employeeId: id } }),
    ])

    // أجزاء الرسالة من الأنواع ذات الحركات فقط — بنفس قالب العقد (N راتب، M سلفة، K إجازة…)
    const parts: string[] = []
    if (salaries > 0) parts.push(`${salaries} راتب`)
    if (advances > 0) parts.push(`${advances} سلفة`)
    if (leaves > 0) parts.push(`${leaves} إجازة`)
    if (attendances > 0) parts.push(`${attendances} سجل دوام`)
    if (bonuses > 0) parts.push(`${bonuses} مكافأة/حسم`)

    if (parts.length > 0) {
      return NextResponse.json(
        {
          error: `لا يمكن حذف الموظف — لديه حركات مسجلة (${parts.join('، ')}). يمكن إيقافه بدلاً من حذفه`,
        },
        { status: 409 },
      )
    }

    const guard = await db.$transaction(async (tx) => {
      const g = await deleteLinkedAccount(tx, existing.accountId, { excludeEmployeeId: existing.id })
      if (!g.ok) {
        throw new GuardError(g.error)
      }
      await tx.employee.delete({ where: { id } })
      await logAudit(tx, {
        action: 'DELETE',
        entity: 'EMPLOYEE',
        entityId: id,
        entityNumber: existing.code,
        title: `ملف موظف ${existing.code}`,
        summary: `حذف ملف الموظف ${existing.code} — ${existing.name} (${existing.position}) — بلا حركات مسجلة${g.code ? ` — حُذف حسابه الفرعي ${g.code} من الشجرة` : g.kept ? ' — بقي الحساب الفرعي في الشجرة لملفاته الأخرى عليه' : ''}`,
        details: {
          'الكود': existing.code,
          'الاسم': existing.name,
          'المسمى الوظيفي': existing.position,
          'الراتب الأساسي': fmtQty(existing.baseSalary),
          'الحالة قبل الحذف': existing.isActive ? 'نشط' : 'موقوف',
          'أثر الحذف': 'الموظف بلا أي حركات (رواتب/سلف/إجازات/دوام/مكافآت) — حذف نظيف',
          'الحساب الفرعي المحذوف': g.code ?? '—',
          'بقي الحساب لملفات أخرى': g.kept ? 'نعم' : 'لا',
          'وقت الحذف': fmtDateTime(new Date()),
        },
      })
      return g
    })

    const accMsg = guard.code
      ? ` مع حسابه الفرعي ${guard.code} من شجرة الحسابات`
      : guard.kept
        ? ' — بقي الحساب في الشجرة لملفاته الأخرى عليه'
        : ''
    return NextResponse.json({
      ok: true,
      message: `تم حذف الموظف ${existing.code}${accMsg}`,
    })
  } catch (error) {
    if (error instanceof GuardError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('DELETE /api/employees/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حذف الموظف' }, { status: 500 })
  }
}

/** خطأ حراسة داخلي — يحمل رسالة عربية جاهزة للرد 409 */
class GuardError extends Error {}
