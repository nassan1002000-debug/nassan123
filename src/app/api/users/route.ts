import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { AR_ROLE, fmtDateTime } from '@/lib/format'
import { isUniqueViolation } from '@/lib/prisma-errors'
import { hashPassword } from '@/lib/password'
import { adminOrBootstrap, bootstrapOrSession } from '@/lib/api-guard'

// أدوار النظام الثلاثة — مطابقة لنموذج User
export const USER_ROLES = ['ADMIN', 'ACCOUNTANT', 'VIEWER'] as const
export type UserRole = (typeof USER_ROLES)[number]

// اسم المستخدم: 3–32 حرفاً لاتينياً/أرقاماً/شرطة سفلية فقط
const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/

// ==================== مساعدات مشتركة ====================

interface UserRecord {
  id: string
  username: string
  name: string
  role: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/** صف المستخدم الموحّد — بلا passwordHash إطلاقاً (select صريح دائماً) */
function toUserRow(u: UserRecord) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role as UserRole,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  }
}

/** قيم select الصريحة — passwordHash مستثنى عمداً ولا يغادر الخادم أبداً */
const USER_SELECT = {
  id: true,
  username: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const

// GET /api/users — قائمة المستخدمين + المؤشرات
// عند أول تشغيل (جدول فارغ) يُنشأ المدير الافتراضي idempotent داخل معاملة — مرة واحدة فقط
// الحماية: يمر من الـmiddleware بوضع التهيئة — هنا الحرس الفعلي (بلا جلسة يُسمح فقط بجدول فارغ)
export async function GET(req: NextRequest) {
  try {
    const denied = await bootstrapOrSession(req)
    if (denied) return denied

    const initialCount = await db.user.count()
    if (initialCount === 0) {
      try {
        await db.$transaction(async (tx) => {
          const admin = await tx.user.create({
            data: {
              username: 'admin',
              name: 'المدير',
              role: 'ADMIN',
              isActive: true,
              passwordHash: hashPassword('admin123'),
            },
          })
          await logAudit(tx, {
            action: 'SYSTEM',
            entity: 'USER',
            entityId: admin.id,
            entityNumber: admin.username,
            title: 'المدير الافتراضي',
            summary:
              'إنشاء المدير الافتراضي تلقائياً عند أول تشغيل — اسم المستخدم admin (كلمة المرور الافتراضية يجب تغييرها فوراً)',
            details: {
              'اسم المستخدم': admin.username,
              'الاسم': admin.name,
              'الدور': AR_ROLE[admin.role] ?? admin.role,
              'الحالة': 'نشط',
              'كلمة المرور': 'مُخزّنة بتجزئة scrypt — لا تُسجَّل قيمتها أبداً',
              'وقت الإنشاء': fmtDateTime(new Date()),
            },
          })
        })
      } catch (error) {
        // سباق نادر بين طلبين متوازيين على قاعدة فارغة — قيد التفرد يضمن المرة الواحدة
        if (!isUniqueViolation(error)) throw error
      }
    }

    const [users, total, active, admins] = await Promise.all([
      db.user.findMany({ select: USER_SELECT, orderBy: { createdAt: 'asc' } }),
      db.user.count(),
      db.user.count({ where: { isActive: true } }),
      db.user.count({ where: { role: 'ADMIN' } }),
    ])

    return NextResponse.json({
      users: users.map(toUserRow),
      stats: {
        total,
        active,
        admins,
        limited: total - admins, // محاسبون + مشاهدون
      },
    })
  } catch (error) {
    console.error('GET /api/users error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب المستخدمين' }, { status: 500 })
  }
}

// POST /api/users — إضافة مستخدم جديد (كلمة المرور إلزامية ≥ 6 وتُخزَّن مجزأة scrypt)
export async function POST(request: NextRequest) {
  try {
    // الحرس (P0-4): وضع التهيئة الأولى فقط بلا جلسة — وإلا يتطلب مديراً
    const denied = await adminOrBootstrap(request)
    if (denied) return denied

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'بيانات الطلب غير صالحة' }, { status: 400 })

    // اسم المستخدم — إلزامي بصيغة صارمة
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    if (!username) {
      return NextResponse.json({ error: 'اسم المستخدم مطلوب' }, { status: 400 })
    }
    if (!USERNAME_RE.test(username)) {
      return NextResponse.json(
        { error: 'اسم المستخدم يجب أن يكون 3–32 حرفاً لاتينياً أو أرقاماً أو شرطة سفلية فقط' },
        { status: 400 },
      )
    }

    // الاسم الكامل — إلزامي
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name.length < 2 || name.length > 80) {
      return NextResponse.json({ error: 'الاسم مطلوب (2–80 حرفاً)' }, { status: 400 })
    }

    // الدور — ضمن الثلاثة فقط
    const roleInput = body.role
    if (typeof roleInput !== 'string' || !USER_ROLES.includes(roleInput as UserRole)) {
      return NextResponse.json({ error: 'الدور مطلوب (مدير أو محاسب أو مشاهد)' }, { status: 400 })
    }
    const role = roleInput as UserRole

    // كلمة المرور — إلزامية ≥ 6 أحرف (رسالة عربية، والقيمة نفسها لا تُسجَّل في أي سجل)
    const password = typeof body.password === 'string' ? body.password : ''
    if (password.length < 6) {
      return NextResponse.json({ error: 'كلمة المرور مطلوبة (6 أحرف على الأقل)' }, { status: 400 })
    }

    const isActive = body.isActive === undefined ? true : Boolean(body.isActive)

    // فحص التفرّد قبل المعاملة (مع حرس سباق لاحق عبر قيد التفرد)
    const dup = await db.user.findUnique({ where: { username }, select: { id: true } })
    if (dup) {
      return NextResponse.json({ error: 'اسم المستخدم مستخدم مسبقاً' }, { status: 409 })
    }

    const passwordHash = hashPassword(password)
    const createdId = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { username, name, role, isActive, passwordHash },
      })
      // سجل التدقيق بلا كلمة المرور ولا هاشها إطلاقاً
      await logAudit(tx, {
        action: 'CREATE',
        entity: 'USER',
        entityId: u.id,
        entityNumber: u.username,
        title: `المستخدم ${u.username}`,
        summary: `إضافة مستخدم جديد «${u.name}» باسم المستخدم ${u.username} — الدور: ${AR_ROLE[u.role] ?? u.role} — الحالة: ${u.isActive ? 'نشط' : 'موقوف'}`,
        details: {
          'اسم المستخدم': u.username,
          'الاسم': u.name,
          'الدور': AR_ROLE[u.role] ?? u.role,
          'الحالة': u.isActive ? 'نشط' : 'موقوف',
          'كلمة المرور': 'مُخزّنة بتجزئة scrypt — لا تُسجَّل قيمتها أبداً',
          'وقت الإضافة': fmtDateTime(new Date()),
        },
      })
      return u.id
    })

    const user = await db.user.findUnique({ where: { id: createdId }, select: USER_SELECT })
    if (!user) {
      return NextResponse.json({ error: 'تعذر استرجاع المستخدم بعد إنشائه' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      user: toUserRow(user),
      message: `تمت إضافة المستخدم ${username}`,
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'اسم المستخدم مستخدم مسبقاً' }, { status: 409 })
    }
    console.error('POST /api/users error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء إضافة المستخدم' }, { status: 500 })
  }
}
