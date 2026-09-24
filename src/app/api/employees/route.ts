import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { syncEmployeeAccount } from '@/lib/accounts-link'
import { fmtDate, fmtDateTime, fmtQty, todayYMD } from '@/lib/format'
import { round2 } from '@/lib/journal-server'
import { isUniqueViolation } from '@/lib/prisma-errors'
import {
  bodyNumber,
  bodyString,
  bodyStringOrNull,
  EMPLOYEE_INCLUDE,
  getEmployeeRow,
  isValidYMD,
  nextEmployeeCode,
  toEmployeeRow,
  ymdStart,
  type EmployeeRow,
} from '@/lib/hr-server'

// GET /api/employees?q=&status=ALL|ACTIVE|INACTIVE — قائمة الموظفين + مؤشرات عامة
// البحث q يمسح الاسم/الكود/المسمى/القسم/الهاتف — والمؤشرات دائماً عامة (كل الموظفين) لا تتأثر بالفلاتر
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const q = (sp.get('q') ?? '').trim()
    const status = sp.get('status') ?? 'ALL'

    const where: Prisma.EmployeeWhereInput = {}
    if (status === 'ACTIVE') where.isActive = true
    else if (status === 'INACTIVE') where.isActive = false
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { code: { contains: q } },
        { position: { contains: q } },
        { department: { contains: q } },
        { phone: { contains: q } },
      ]
    }

    const [employees, total, active, payrollAgg, unpaidAgg] = await Promise.all([
      db.employee.findMany({ where, orderBy: { code: 'asc' }, include: EMPLOYEE_INCLUDE }),
      db.employee.count(),
      db.employee.count({ where: { isActive: true } }),
      db.employee.aggregate({ where: { isActive: true }, _sum: { baseSalary: true } }),
      db.advance.aggregate({ where: { status: 'UNPAID' }, _sum: { amount: true } }),
    ])

    const rows: EmployeeRow[] = employees.map(toEmployeeRow)
    const stats = {
      total,
      active,
      monthlyPayroll: round2(payrollAgg._sum.baseSalary ?? 0),
      unpaidAdvancesTotal: round2(unpaidAgg._sum.amount ?? 0),
    }

    return NextResponse.json({ employees: rows, stats })
  } catch (error) {
    console.error('GET /api/employees error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب الموظفين' }, { status: 500 })
  }
}

// POST /api/employees — إضافة ملف موظف (الكود تلقائي EMP-xxx تسلسلي حر إن أُهمل)
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'بيانات الطلب غير صالحة' }, { status: 400 })

    const name = bodyString(body, 'name')
    const position = bodyString(body, 'position')
    if (!name) return NextResponse.json({ error: 'اسم الموظف مطلوب' }, { status: 400 })
    if (!position) return NextResponse.json({ error: 'المسمى الوظيفي مطلوب' }, { status: 400 })

    const baseSalaryRaw = bodyNumber(body, 'baseSalary')
    if (baseSalaryRaw === null || baseSalaryRaw < 0) {
      return NextResponse.json({ error: 'الراتب الأساسي مطلوب (رقم ≥ 0)' }, { status: 400 })
    }
    const baseSalary = round2(baseSalaryRaw)

    // تاريخ التعيين — افتراضياً اليوم
    const hireDateStr = bodyString(body, 'hireDate') || todayYMD()
    if (!isValidYMD(hireDateStr)) {
      return NextResponse.json({ error: 'تاريخ التعيين غير صالح (YYYY-MM-DD)' }, { status: 400 })
    }

    const isActive = body.isActive === undefined ? true : Boolean(body.isActive)
    const codeInput = bodyString(body, 'code')

    // تعدد الأدوار — ربط الموظف بحساب موجود من الشجرة (مثل حساب عميل ليصبح موظفاً على حسابه نفسه)
    const linkAccountId = String(body.accountId ?? '').trim() || null

    // الكود: تلقائي تسلسلي حر EMP-xxx أو فحص تفرّد لكود المستخدم
    let code = codeInput
    if (!code) {
      const rows = await db.employee.findMany({
        where: { code: { startsWith: 'EMP-' } },
        select: { code: true },
      })
      code = nextEmployeeCode(rows)
    } else {
      const dup = await db.employee.findUnique({ where: { code }, select: { id: true } })
      if (dup) return NextResponse.json({ error: `الكود ${code} مستخدم مسبقاً` }, { status: 409 })
    }

    // تعدد الأدوار — تدقيق الحساب المُراد الربط به قبل المعاملة (موجود ونشط وورقي وبلا ملف موظف)
    let linkedAccountId: string | null = null
    if (linkAccountId) {
      const acc = await db.account.findUnique({
        where: { id: linkAccountId },
        select: { id: true, code: true, name: true, isActive: true, _count: { select: { children: true } } },
      })
      if (!acc) {
        return NextResponse.json({ error: 'الحساب المحدد غير موجود في شجرة الحسابات' }, { status: 400 })
      }
      if (!acc.isActive) {
        return NextResponse.json(
          { error: `الحساب ${acc.code} (${acc.name}) موقوف — فعّله من الشجرة أولاً أو اختر حساباً نشطاً` },
          { status: 400 },
        )
      }
      if (acc._count.children > 0) {
        return NextResponse.json(
          { error: `لا يمكن الربط بالحساب ${acc.code} (${acc.name}) — هو حساب مجموعة له حسابات فرعية، اختر حساباً فرعياً ورقياً` },
          { status: 400 },
        )
      }
      const empOn = await db.employee.findFirst({
        where: { accountId: linkAccountId },
        select: { code: true, name: true },
      })
      if (empOn) {
        return NextResponse.json(
          { error: `الحساب ${acc.code} (${acc.name}) مرتبط أصلاً بملف موظف ${empOn.code} — ${empOn.name}` },
          { status: 409 },
        )
      }
      linkedAccountId = linkAccountId
    }

    const createdId = await db.$transaction(async (tx) => {
      const e = await tx.employee.create({
        data: {
          code,
          name,
          position,
          department: bodyStringOrNull(body, 'department'),
          phone: bodyStringOrNull(body, 'phone'),
          hireDate: ymdStart(hireDateStr),
          baseSalary,
          isActive,
          accountId: linkedAccountId,
        },
      })

      // مزامنة شجرة الحسابات — حساب فرعي جديد تحت «سلف الموظفين» أو تحديث الاسم/الحالة على الحساب المُرتبط
      const subAccountId = await syncEmployeeAccount(tx, e)
      const subAcc = subAccountId
        ? await tx.account.findUnique({ where: { id: subAccountId }, select: { code: true } })
        : null

      await logAudit(tx, {
        action: 'CREATE',
        entity: 'EMPLOYEE',
        entityId: e.id,
        entityNumber: e.code,
        title: `ملف موظف ${e.code}`,
        summary: `إضافة ملف الموظف ${e.code} — ${e.name} (${e.position}) — الراتب الأساسي ${fmtQty(e.baseSalary)} ل.س — الحالة: ${e.isActive ? 'نشط' : 'موقوف'}${subAcc ? ` — ${linkedAccountId ? 'رُبط بالحساب الموجود' : 'أُنشئ له الحساب الفرعي'} ${subAcc.code} في شجرة الحسابات` : ''}`,
        details: {
          'الكود': e.code,
          'الاسم': e.name,
          'المسمى الوظيفي': e.position,
          'القسم': e.department ?? '—',
          'الهاتف': e.phone ?? '—',
          'تاريخ التعيين': fmtDate(e.hireDate),
          'الراتب الأساسي': fmtQty(e.baseSalary),
          'الحالة': e.isActive ? 'نشط' : 'موقوف',
          'الحساب الفرعي': subAcc?.code ?? '—',
          'مصدر الحساب': linkedAccountId ? 'ربط بحساب موجود (تعدد الأدوار)' : 'إنشاء حساب جديد',
          'وقت الإضافة': fmtDateTime(new Date()),
        },
        amount: e.baseSalary,
      })
      return e.id
    })

    const employee = await getEmployeeRow(createdId)
    return NextResponse.json({
      ok: true,
      employee,
      message: `تمت إضافة الموظف ${code}`,
    })
  } catch (error) {
    // سباق نادر على الكود التلقائي أو كود أُرسل بالتوازي
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'كود الموظف مستخدم مسبقاً' }, { status: 409 })
    }
    console.error('POST /api/employees error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء إضافة الموظف' }, { status: 500 })
  }
}
