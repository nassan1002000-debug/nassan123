import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  computePartnerStats,
  isPartnerCodeCollision,
  isPrismaError,
  nextPartnerCode,
  partnerUniqueTarget,
  validatePartnerBody,
} from '@/lib/partners-server'
import { logAudit } from '@/lib/audit-server'
import { syncPartnerAccount, validateAccountForLink } from '@/lib/accounts-link'
import { getOpeningLinesByAccount } from '@/lib/period-server'
import { AR_PARTNER_TYPE, fmtDateTime } from '@/lib/format'
import { toWhatsappUrl } from '@/lib/whatsapp'

// GET /api/partners — القائمة الكاملة مع الإحصاءات والأرصدة + كتلة مؤشرات + الكود القادم
// فلاتر: type=CUSTOMER|SUPPLIER · status=ACTIVE|INACTIVE · q=بحث في الكود/الاسم/الهاتف/العنوان
// السجل صغير — الجلب الكامل مرة واحدة مع الفلترة في الذاكرة (المؤشرات دائماً على كل الملفات)
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const type = sp.get('type') ?? 'ALL'
    const status = sp.get('status') ?? 'ALL'
    const q = (sp.get('q') ?? '').trim().toLowerCase()

    const partners = await db.partner.findMany({
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
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
        account: { select: { code: true } }, // كود الحساب المرتبط في الشجرة — تعدد الأدوار
      },
    })

    // أرصدة الافتتاحي المرحّلة بسند القيد الافتتاحي — مصدر رصيد كل طرف في الفترة الجديدة
    // بعد تدوير مستندات الفترة المغلقة (شرط عزل الفترات)
    const openingLines = await getOpeningLinesByAccount(db)

    // إحصاءات كل الأطراف بالتوازي
    const withStats = await Promise.all(
      partners.map(async (p) => {
        // صافي سطر الافتتاحي بمصطلحات رصيد الطرف: العميل مدينه موجب، والمورد دائنه موجب
        const line = p.accountId ? openingLines.get(p.accountId) : undefined
        const net = line ? line.debit - line.credit : 0
        const openingNet = p.type === 'SUPPLIER' ? -net : net
        const stats = await computePartnerStats(p.id, p.type, openingNet)
        const { account, accountId, ...rest } = p
        return {
          ...rest,
          accountCode: account?.code ?? null,
          accountId,
          stats,
          whatsappUrl: toWhatsappUrl(p.phone),
        }
      }),
    )

    // كتلة المؤشرات — على كل الملفات دائماً (لا تتأثر بالفلترة)
    let customersCount = 0
    let suppliersCount = 0
    let customersDebt = 0
    let suppliersDue = 0
    for (const p of withStats) {
      if (p.type === 'CUSTOMER') {
        customersCount++
        if (p.stats.balance > 0) customersDebt += p.stats.balance
      } else {
        suppliersCount++
        if (p.stats.balance > 0) suppliersDue += p.stats.balance
      }
    }

    // الفلترة في الذاكرة
    const filtered = withStats.filter((p) => {
      if (type === 'CUSTOMER' || type === 'SUPPLIER') {
        if (p.type !== type) return false
      }
      if (status === 'ACTIVE' && !p.isActive) return false
      if (status === 'INACTIVE' && p.isActive) return false
      if (q) {
        const hay = `${p.code} ${p.name} ${p.phone ?? ''} ${p.address ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    const [nextCustomerCode, nextSupplierCode] = await Promise.all([
      nextPartnerCode('CUSTOMER'),
      nextPartnerCode('SUPPLIER'),
    ])

    return NextResponse.json({
      partners: filtered,
      stats: { customersCount, suppliersCount, customersDebt, suppliersDue },
      nextCustomerCode,
      nextSupplierCode,
    })
  } catch (error) {
    console.error('GET /api/partners error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب ملفات الأطراف' }, { status: 500 })
  }
}

// POST /api/partners — إنشاء ملف طرف جديد (عميل أو مورد) بكود تلقائي
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const parsed = await validatePartnerBody(body, { requireAll: true })
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    // التوليد داخل معاملة مع إعادة محاولة عند اصطدام الكود التلقائي فقط
    let created: { id: string; code: string; accountId: string | null } | null = null
    let linkError: string | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const row = await db.$transaction(async (tx) => {
          // تعدد الأدوار — ربط الملف بحساب موجود من الشجرة (مثل حساب موظف ليصبح عميلاً على حسابه نفسه)
          let linkedAccountId: string | null = null
          if (parsed.data.accountId) {
            const link = await validateAccountForLink(tx, parsed.data.accountId)
            if (!link.ok) {
              linkError = link.error
              throw new LinkValidationError(link.error)
            }
            const sameType = await tx.partner.findFirst({
              where: { accountId: parsed.data.accountId, type: parsed.data.type },
              select: { code: true, name: true },
            })
            if (sameType) {
              linkError = `الحساب ${link.account.code} (${link.account.name}) مرتبط أصلاً بملف ${parsed.data.type === 'SUPPLIER' ? 'مورد' : 'عميل'} ${sameType.code} — ${sameType.name}`
              throw new LinkValidationError(linkError)
            }
            linkedAccountId = parsed.data.accountId
          }

          const code = await nextPartnerCode(parsed.data.type, tx)
          const partner = await tx.partner.create({
            data: { ...parsed.data, accountId: linkedAccountId, code },
            select: { id: true, code: true, name: true, type: true, isActive: true, accountId: true },
          })

          // مزامنة شجرة الحسابات — حساب فرعي جديد تحت حساب التحكم، أو تحديث الاسم/الحالة على الحساب المُرتبط
          const subAccountId = await syncPartnerAccount(tx, partner)

          // التوثيق في سجل التدقيق — داخل المعاملة نفسها (نمط الفواتير)
          const typeLabel = AR_PARTNER_TYPE[parsed.data.type] ?? parsed.data.type
          const subAcc = subAccountId
            ? await tx.account.findUnique({ where: { id: subAccountId }, select: { code: true } })
            : null
          await logAudit(tx, {
            action: 'CREATE',
            entity: 'PARTNER',
            entityId: partner.id,
            entityNumber: partner.code,
            title: `ملف ${typeLabel} ${partner.code}`,
            summary: `إنشاء ملف ${typeLabel} ${partner.code} — ${parsed.data.name}${parsed.data.phone ? ` — هاتف ${parsed.data.phone}` : ''}${subAcc ? ` — ${linkedAccountId ? 'رُبط بالحساب الموجود' : 'أُنشئ له الحساب الفرعي'} ${subAcc.code} في شجرة الحسابات` : ''}`,
            details: {
              'النوع': typeLabel,
              'الكود': partner.code,
              'الاسم': parsed.data.name,
              'الهاتف': parsed.data.phone ?? 'بدون',
              'العنوان': parsed.data.address ?? 'بدون',
              'الحالة': parsed.data.isActive ? 'نشط' : 'موقوف',
              'الحساب الفرعي': subAcc?.code ?? '—',
              'مصدر الحساب': linkedAccountId ? 'ربط بحساب موجود (تعدد الأدوار)' : 'إنشاء حساب جديد',
              'وقت الإنشاء': fmtDateTime(new Date()),
            },
          })

          return partner
        })
        created = row
        break
      } catch (e) {
        if (e instanceof LinkValidationError) break
        if (isPrismaError(e) && isPartnerCodeCollision(e) && attempt < 2) continue
        throw e
      }
    }

    if (linkError && !created) {
      return NextResponse.json({ error: linkError }, { status: 409 })
    }
    if (!created) {
      return NextResponse.json({ error: 'تعذر إنشاء الملف — حاول مجدداً' }, { status: 500 })
    }

    // كود الحساب المرتبط — لرسالة النجاح وعرض فوري في الواجهة
    const accCode = created.accountId
      ? (await db.account.findUnique({ where: { id: created.accountId }, select: { code: true } }))?.code ?? null
      : null

    return NextResponse.json(
      {
        id: created.id,
        code: created.code,
        accountCode: accCode,
        message: `تم إنشاء ملف ${parsed.data.type === 'SUPPLIER' ? 'المورد' : 'العميل'} ${created.code}${accCode ? ` — رُبط بالحساب ${accCode} في الشجرة (بلا حساب جديد)` : ''}`,
      },
      { status: 201 },
    )
  } catch (error) {
    console.error('POST /api/partners error:', error)
    if (isPrismaError(error)) {
      const target = partnerUniqueTarget(error)
      if (target) return NextResponse.json({ error: `${target} مستخدم مسبقاً` }, { status: 409 })
    }
    return NextResponse.json({ error: 'حدث خطأ أثناء إنشاء الملف' }, { status: 500 })
  }
}

/** خطأ تحقق ربط داخلي — رسالته ترجع للواجهة كما هي */
class LinkValidationError extends Error {}
