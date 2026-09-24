import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import {
  AR_ACCOUNT_NATURE,
  AR_ACCOUNT_TYPE,
  backfillPartnerEmployeeAccounts,
  controlKindOfCode,
  createEmployeeForAccount,
  createPartnerForAccount,
  type LinkKind,
} from '@/lib/accounts-link'
import { computeAllDocBalances } from '@/lib/partner-statement-server'
import { fmtDateTime } from '@/lib/format'

const VALID_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']
const VALID_NATURES = ['DEBIT', 'CREDIT']

// ==================== GET: دليل الحسابات (مصفوفة flat مرتبة بالكود) ====================
export async function GET() {
  try {
    // تمهيد خامل: كل عميل/مورد/موظف بلا حساب فرعي يحصل على حسابه تحت حساب التحكم
    // (مكلفة صفراً بعد اكتمال الربط — استعلاما count فارغان)
    try {
      await backfillPartnerEmployeeAccounts()
    } catch (e) {
      console.error('accounts backfill skipped:', e)
    }

    const accounts = await db.account.findMany({ orderBy: { code: 'asc' } })

    // تجميع حركات القيود المُرحّلة لكل حساب (لحساب الأرصدة في الشاشة)
    const aggregates = await db.journalEntryLine.groupBy({
      by: ['accountId'],
      where: { entry: { status: 'POSTED' } },
      _sum: { debit: true, credit: true },
    })
    const aggMap = new Map(aggregates.map((a) => [a.accountId, a._sum]))

    // روابط الملفات: أي حساب فرعي تابع لعميل/مورد/موظف — لشارات الأدوار في الشجرة
    // تعدد الأدوار: الحساب الواحد قد يحمل عدة ملفات (عميل + مورد + موظف) — لذا links مصفوفة
    // وlink يبقى مفرداً بالأسبقية الموظف أولاً (للتوافق مع الفلاتر وشارة الشجرة)
    const [linkedPartners, linkedEmployees] = await Promise.all([
      db.partner.findMany({
        where: { accountId: { not: null } },
        select: { id: true, code: true, type: true, accountId: true },
      }),
      db.employee.findMany({
        where: { accountId: { not: null } },
        select: { id: true, code: true, accountId: true },
      }),
    ])
    const linksMap = new Map<string, { kind: LinkKind; id: string; code: string }[]>()
    for (const p of linkedPartners) {
      if (p.accountId) {
        const list = linksMap.get(p.accountId) ?? []
        // الشريك (رأس المال) دور قائم بذاته — لا يُسمّى عميلاً
        list.push({
          kind: p.type === 'SUPPLIER' ? 'SUPPLIER' : p.type === 'PARTNER' ? 'PARTNER' : 'CUSTOMER',
          id: p.id,
          code: p.code,
        })
        linksMap.set(p.accountId, list)
      }
    }
    for (const e of linkedEmployees) {
      if (e.accountId) {
        const list = linksMap.get(e.accountId) ?? []
        // الموظف أولاً — التوافق: link المفرد كان يعطيه الأسبقية (يُحدَّث أخيراً في linkMap القديم)
        list.unshift({ kind: 'EMPLOYEE', id: e.id, code: e.code })
        linksMap.set(e.accountId, list)
      }
    }

    // أرصدة الأطراف من مستنداتها (دفتر الفرع): حساب الطرف الفرعي المرتبط بملف يعرض رصيده
    // من فواتيره وسنداته الفعلية — لا من قيود التحكم المجمعة التاريخية
    const docBalances = await computeAllDocBalances()

    const data = accounts.map((a) => {
      const sum = aggMap.get(a.id)
      const links = linksMap.get(a.id) ?? []
      // link المفرد — بالأسبقية: الموظف ثم العميل ثم المورد (توافقاً مع السلوك السابق)
      const link = links.find((l) => l.kind === 'EMPLOYEE') ?? links[0] ?? null

      // الافتراضي: أرصدة القيود المُرحّلة
      let postedDebit = sum?.debit ?? 0
      let postedCredit = sum?.credit ?? 0

      // رصيد الطرف من مستندات ملفاته بصيغة مدين/دائن بالطبيعة
      // تعدد الأدوار: تُجمع مستندات كل ملفاته التجارية (عميل + مورد + موظف) على الحساب نفسه —
      // ودور الشريك (رأس المال) بلا مستندات تجارية فيبقى رصيده من القيود كما هو (تأسيس/مسحوبات)
      const docLinks = links.filter((l) => l.kind !== 'PARTNER')
      if (docLinks.length > 0) {
        let debit = 0
        let credit = 0
        for (const l of docLinks) {
          const t =
            l.kind === 'EMPLOYEE'
              ? docBalances.employee.get(l.id)
              : docBalances.partner.get(l.id)
          debit += t?.debit ?? 0
          credit += t?.credit ?? 0
        }
        if (a.nature === 'CREDIT') {
          const natural = credit - debit // موجب = دائن بالطبيعة (مورد مديونية لنا)
          postedDebit = natural < 0 ? Math.abs(natural) : 0
          postedCredit = natural >= 0 ? natural : 0
        } else {
          const natural = debit - credit // موجب = مدين بالطبيعة (عميل مديون لنا / سلفة موظف)
          postedDebit = natural >= 0 ? natural : 0
          postedCredit = natural < 0 ? Math.abs(natural) : 0
        }
      }

      return {
        id: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
        nature: a.nature,
        isSystem: a.isSystem,
        isActive: a.isActive,
        openingBalance: a.openingBalance,
        parentId: a.parentId,
        postedDebit,
        postedCredit,
        link,
        links,
      }
    })

    return NextResponse.json(data)
  } catch (error) {
    console.error('Accounts GET error:', error)
    return NextResponse.json({ error: 'فشل جلب دليل الحسابات' }, { status: 500 })
  }
}

// ==================== POST: إنشاء حساب جديد ====================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })
    }

    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const type = typeof body.type === 'string' ? body.type : ''
    const nature = typeof body.nature === 'string' ? body.nature : ''

    if (!code) {
      return NextResponse.json({ error: 'كود الحساب مطلوب' }, { status: 400 })
    }
    if (!name) {
      return NextResponse.json({ error: 'اسم الحساب مطلوب' }, { status: 400 })
    }
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: 'نوع الحساب غير صحيح' }, { status: 400 })
    }
    if (!VALID_NATURES.includes(nature)) {
      return NextResponse.json({ error: 'طبيعة الحساب غير صحيحة' }, { status: 400 })
    }

    // الأب اختياري — يجب أن يكون موجوداً إن أُرسل
    let parentId: string | null = null
    if (body.parentId !== undefined && body.parentId !== null && body.parentId !== '') {
      const parent = await db.account.findUnique({ where: { id: String(body.parentId) } })
      if (!parent) {
        return NextResponse.json({ error: 'الحساب الأب غير موجود' }, { status: 400 })
      }
      parentId = parent.id
    }

    // منع تكرار الكود
    const duplicate = await db.account.findUnique({ where: { code } })
    if (duplicate) {
      return NextResponse.json(
        { error: `كود الحساب "${code}" مستخدم مسبقاً في "${duplicate.name}" — اختر كوداً آخر` },
        { status: 409 },
      )
    }

    const openingBalance = body.openingBalance === undefined ? 0 : Number(body.openingBalance)
    if (!Number.isFinite(openingBalance)) {
      return NextResponse.json({ error: 'الرصيد الافتتاحي غير صالح' }, { status: 400 })
    }

    // معاملة ذرّية واحدة: الحساب + توثيقه + الملف المتولّد عنه وتوثيقه — أي فشل
    // يرجّع كل شيء، فلا يبقى حساب بلا توثيق ولا ملف بلا حسابه
    const { created, createdFile } = await db.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          code,
          name,
          type,
          nature,
          isSystem: false,
          isActive: body.isActive === undefined ? true : Boolean(body.isActive),
          openingBalance,
          parentId,
        },
      })

      const parent = parentId
        ? await tx.account.findUnique({ where: { id: parentId }, select: { code: true, name: true } })
        : null

      // توثيق إنشاء الحساب نفسه — شجرة الحسابات حركة مثل غيرها (القسم 0 — القاعدة 7)
      await logAudit(tx, {
        action: 'CREATE',
        entity: 'ACCOUNT',
        entityId: account.id,
        entityNumber: account.code,
        title: `حساب ${account.code} — ${account.name}`,
        summary:
          `أُنشئ حساب ${account.code} «${account.name}» — ` +
          `${AR_ACCOUNT_TYPE[account.type] ?? account.type} بطبيعة ${AR_ACCOUNT_NATURE[account.nature] ?? account.nature}` +
          `${parent ? ` تحت الحساب ${parent.code} «${parent.name}»` : ' كحساب جذر'}` +
          `${account.openingBalance ? ` — برصيد افتتاحي ${account.openingBalance.toFixed(2)} ل.س` : ''}`,
        amount: account.openingBalance || null,
        details: {
          'الكود': account.code,
          'الاسم': account.name,
          'النوع': AR_ACCOUNT_TYPE[account.type] ?? account.type,
          'الطبيعة': AR_ACCOUNT_NATURE[account.nature] ?? account.nature,
          'الأب': parent ? `${parent.code} — ${parent.name}` : 'جذر',
          'الرصيد الافتتاحي (ل.س)': account.openingBalance.toFixed(2),
          'وقت الإنشاء': fmtDateTime(new Date()),
        },
      })

      // الاتجاه المعاكس للمزامنة: حساب تحت حساب التحكم (1130/2110/1150) يُنشئ ملفه تلقائياً
      // عميل في شاشة الأطراف أو موظف في شاشة الموارد البشرية — بنفس الاسم والحالة
      let file: { kind: LinkKind; id: string; code: string } | null = null
      const kind = parent ? controlKindOfCode(parent.code) : null
      if (kind) {
        const payload = { id: account.id, name: account.name, isActive: account.isActive }
        file =
          kind === 'CUSTOMER' || kind === 'SUPPLIER'
            ? { kind, ...(await createPartnerForAccount(tx, kind, payload)) }
            : { kind, ...(await createEmployeeForAccount(tx, payload)) }

        const kindLabel =
          file.kind === 'CUSTOMER' ? 'عميل' : file.kind === 'SUPPLIER' ? 'مورداً' : 'موظفاً'
        await logAudit(tx, {
          action: 'CREATE',
          entity: file.kind === 'EMPLOYEE' ? 'EMPLOYEE' : 'PARTNER',
          entityId: file.id,
          entityNumber: file.code,
          title: `ملف ${kindLabel === 'موظفاً' ? 'موظف' : kindLabel} ${file.code}`,
          summary: `أُنشئ تلقائياً من شجرة الحسابات — الحساب ${account.code} ${account.name} أنشأ ملف ${kindLabel} ${file.code}`,
          details: {
            'المصدر': 'شجرة الحسابات',
            'الحساب': `${account.code} — ${account.name}`,
            'الملف المُنشأ': file.code,
            'وقت الإنشاء': fmtDateTime(new Date()),
          },
        })
      }

      return {
        created: account,
        createdFile: file ? { kind: file.kind as string, code: file.code } : null,
      }
    })

    return NextResponse.json({ ...created, createdFile }, { status: 201 })
  } catch (error) {
    console.error('Accounts POST error:', error)
    return NextResponse.json({ error: 'فشل إنشاء الحساب' }, { status: 500 })
  }
}
