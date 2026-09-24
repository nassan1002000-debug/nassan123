import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { AR_ROLE, fmtDateTime } from '@/lib/format'
import { isUniqueViolation } from '@/lib/prisma-errors'
import { hashPassword } from '@/lib/password'
import { requireAdmin } from '@/lib/api-guard'

// أدوار النظام الثلاثة — مطابقة لنموذج User
export const USER_ROLES = ['ADMIN', 'ACCOUNTANT', 'VIEWER'] as const
export type UserRole = (typeof USER_ROLES)[number]

interface UserRecord {
  id: string
  username: string
  name: string
  role: string
  isActive: boolean
  passwordHash: string | null
  createdAt: Date
  updatedAt: Date
}

/** صف المستخدم الموحّد — بلا passwordHash إطلاقاً (لا يغادر الخادم أبداً) */
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

/** قيم select الصريحة — passwordHash مستثنى عمداً */
const USER_SELECT = {
  id: true,
  username: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const

type Params = { params: Promise<{ id: string }> }

// PUT /api/users/[id] — تعديل name/role/isActive و/أو password (اختياري)
// • username لا يُعدل أبداً — يُتجاهل بهدوء إن أُرسل
// • كلمة المرور تُعاد تجزئتها فقط إن أُرسلت غير فارغة (الفارغة = الإبقاء على الحالية)
// • حرس آخر مدير نشط: لا إلغاء تفعيل ولا تنزيل دور للمدير النشط الوحيد — 409
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const denied = await requireAdmin(request) // P0-4: تعديل المستخدمين للمدير فقط
    if (denied) return denied
    const { id } = await params
    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 })
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'بيانات الطلب غير صالحة' }, { status: 400 })

    // الاسم — يُعدَّل فقط إن أُرسل
    let name = existing.name
    if (body.name !== undefined) {
      const v = typeof body.name === 'string' ? body.name.trim() : ''
      if (v.length < 2 || v.length > 80) {
        return NextResponse.json({ error: 'الاسم مطلوب (2–80 حرفاً)' }, { status: 400 })
      }
      name = v
    }

    // الدور — ضمن الثلاثة فقط إن أُرسل
    let role = existing.role
    if (body.role !== undefined) {
      const v = body.role
      if (typeof v !== 'string' || !USER_ROLES.includes(v as UserRole)) {
        return NextResponse.json({ error: 'الدور غير صالح (مدير أو محاسب أو مشاهد)' }, { status: 400 })
      }
      role = v
    }

    // الحالة — إن أُرسلت
    const isActive = body.isActive === undefined ? existing.isActive : Boolean(body.isActive)

    // كلمة المرور — تُعاد تجزئتها فقط إن أُرسلت غير فارغة (≥ 6) — بمحص الفراغات الطرفية
    // اتساقاً مع تسجيل الدخول وتغيير الكلمة الذاتي (فراغ لصق لا يصير قفلاً دائماً)
    const rawPassword = typeof body.password === 'string' ? body.password.trim() : ''
    let passwordHash = existing.passwordHash
    let passwordChanged = false
    if (rawPassword.length > 0) {
      if (rawPassword.length < 6) {
        return NextResponse.json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' }, { status: 400 })
      }
      passwordHash = hashPassword(rawPassword)
      passwordChanged = true
    }

    // P1-1: تعطيل المستخدم أو تغيير كلمته يزيد إصدار الجلسة — تسقط جلساته النشطة فوراً
    const deactivating = existing.isActive && !isActive
    const bumpSession = passwordChanged || deactivating

    // حرس آخر مدير نشط — يمنع إلغاء التفعيل أو تنزيل الدور للمدير النشط الوحيد
    if (existing.role === 'ADMIN' && existing.isActive && (role !== 'ADMIN' || !isActive)) {
      const otherActiveAdmins = await db.user.count({
        where: { id: { not: id }, role: 'ADMIN', isActive: true },
      })
      if (otherActiveAdmins === 0) {
        return NextResponse.json(
          { error: 'لا يمكن إلغاء تفعيل آخر مدير نشط في النظام' },
          { status: 409 },
        )
      }
    }

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: {
          name,
          role,
          isActive,
          passwordHash,
          // P1-3: كلمة مرور جديدة من المدير = انتهاء إجبارية التغيير الافتراضية
          mustChangePassword: passwordChanged ? false : existing.mustChangePassword,
          // P1-1: إسقاط فوري لجلسات المستخدم عند التعطيل أو تغيير كلمة المرور
          sessionVersion: bumpSession ? { increment: 1 } : existing.sessionVersion,
        },
      })

      // سجل التغييرات «قبل ← بعد» — بلا كلمات مرور أو تجزئات إطلاقاً
      const changes: string[] = []
      if (u.name !== existing.name) changes.push(`الاسم: ${existing.name} ← ${u.name}`)
      if (u.role !== existing.role)
        changes.push(`الدور: ${AR_ROLE[existing.role] ?? existing.role} ← ${AR_ROLE[u.role] ?? u.role}`)
      if (u.isActive !== existing.isActive)
        changes.push(`الحالة: ${existing.isActive ? 'نشط' : 'موقوف'} ← ${u.isActive ? 'نشط' : 'موقوف'}`)
      if (passwordChanged) changes.push('كلمة المرور: تغيّرت (قيمتها لا تُسجَّل أبداً)')
      if (bumpSession) changes.push('إصدار الجلسة: ارتفع — سقطت كل جلسات المستخدم النشطة فوراً')

      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'USER',
        entityId: id,
        entityNumber: u.username,
        title: `المستخدم ${u.username}`,
        summary: `تعديل المستخدم ${u.username} — ${u.name} — ${changes.length > 0 ? changes.join('؛ ') : 'تعديل دون تغيير قيم دالة'}`,
        details: {
          'اسم المستخدم': u.username,
          'الاسم': u.name,
          'الدور': AR_ROLE[u.role] ?? u.role,
          'الحالة': u.isActive ? 'نشط' : 'موقوف',
          'التغييرات': changes.length > 0 ? changes.join('؛ ') : 'لا تغييرات دالة',
          'وقت التعديل': fmtDateTime(new Date()),
        },
      })

      return u
    })

    return NextResponse.json({ ok: true, user: toUserRow(updated), message: 'تم حفظ التعديلات' })
  } catch (error) {
    console.error('PUT /api/users/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حفظ التعديلات' }, { status: 500 })
  }
}

// DELETE /api/users/[id] — حذف مستخدم (ممنوع حذف آخر مدير نشط — 409)
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const denied = await requireAdmin(_request) // P0-4: حذف المستخدمين للمدير فقط
    if (denied) return denied
    const { id } = await params
    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 })
    }

    // حرس آخر مدير نشط — لا يحذف نفسه النظام كله
    if (existing.role === 'ADMIN' && existing.isActive) {
      const otherActiveAdmins = await db.user.count({
        where: { id: { not: id }, role: 'ADMIN', isActive: true },
      })
      if (otherActiveAdmins === 0) {
        return NextResponse.json(
          { error: 'لا يمكن إلغاء تفعيل آخر مدير نشط في النظام' },
          { status: 409 },
        )
      }
    }

    await db.$transaction(async (tx) => {
      await tx.user.delete({ where: { id } })
      await logAudit(tx, {
        action: 'DELETE',
        entity: 'USER',
        entityId: id,
        entityNumber: existing.username,
        title: `المستخدم ${existing.name} (${existing.username})`,
        summary: `حذف المستخدم ${existing.username} — ${existing.name} (${AR_ROLE[existing.role] ?? existing.role}) — الحالة قبل الحذف: ${existing.isActive ? 'نشط' : 'موقوف'}`,
        details: {
          'اسم المستخدم': existing.username,
          'الاسم': existing.name,
          'الدور': AR_ROLE[existing.role] ?? existing.role,
          'الحالة قبل الحذف': existing.isActive ? 'نشط' : 'موقوف',
          'وقت الحذف': fmtDateTime(new Date()),
        },
      })
    })

    return NextResponse.json({ ok: true, message: `تم حذف المستخدم ${existing.username}` })
  } catch (error) {
    console.error('DELETE /api/users/[id] error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء حذف المستخدم' }, { status: 500 })
  }
}
