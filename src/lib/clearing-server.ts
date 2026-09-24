// منطق الخادم المشترك لسندات المقاصة MC-xxxx — Task 101
//
// سند المقاصة: مستند محاسبي رسمي يعوض أرصدة متقابلة لشخص واحد يجمع أكثر من صفة
// (عميل ↔ مورد، عميل ↔ موظف، مورد ↔ موظف…) دون مرور نقدي على الصندوق:
//   الحساب ذو الرصيد المدين (لنا عليه) يُدائَن — والحساب ذو الرصيد الدائن (علينا له) يُدينَ —
//   بالمبلغ المشترك الأصغر بينهما فيظل الدليل متوازناً وتبقى الذمم صافية.
//
// البنية: سند المقاصة = قيد يومية POSTED بمصدر CLEARING ورقم MC-xxxx — مستند واحد
// يحمل كل شيء (لا صفوف سندات وهمية في Payment فلا تلوث لإحصاءات الخزينة إطلاقاً)،
// ويظهر آلياً في: دفتر الأستاذ، ميزان المراجعة، كشوف الأطراف، وشجرة الحسابات
// (عبر دمج أسطر المقاصة في partner-statement-server).

import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { nextSequentialNumber, round2 } from '@/lib/math'
import { getSequenceFloor } from '@/lib/period-doc-rotation'
import { assertPeriodOpen } from '@/lib/period-server'
import { computeAllDocBalances } from '@/lib/partner-statement-server'

type Tx = Prisma.TransactionClient

export const CLEARING_SOURCE = 'CLEARING'

export const AR_ROLE: Record<string, string> = {
  CUSTOMER: 'عميل',
  SUPPLIER: 'مورد',
  EMPLOYEE: 'موظف',
}

/** توحيد اسم الشخص لتجميع الصفات: تقليم طرفي + طي المسافات المتكررة */
export const normalizePersonName = (name: string): string => name.trim().replace(/\s+/g, ' ')

export interface ClearingRole {
  kind: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE'
  label: string // عميل / مورد / موظف
  refId: string
  refCode: string
  refName: string
  accountId: string
  accountCode: string
  accountName: string
  /** رصيد موقّع بمصطلحات مدين: موجب = علينا أن نحصّله (مدين لنا) — سالب = علينا سداده (دائن له) */
  balance: number
}

export interface ClearingSuggestion {
  debitAccountId: string
  debitAccountCode: string
  debitAccountName: string
  creditAccountId: string
  creditAccountCode: string
  creditAccountName: string
  amount: number
}

export interface ClearingPerson {
  key: string
  name: string
  roles: ClearingRole[]
  suggestions: ClearingSuggestion[]
}

/** الرقم التالي MC-0001 — أعلى رقم موجود عددياً ضمن أرقام القيود ذات البادئة MC- */
export async function nextClearingNumber(
  client: Pick<Prisma.TransactionClient, 'journalEntry' | 'setting'> = db,
): Promise<string> {
  const rows = await client.journalEntry.findMany({
    where: { number: { startsWith: 'MC-' } },
    select: { number: true },
  })
  // الأرضية: أعلى رقم مقاصة دُوّر إلى أرشيف الفترة المغلقة — رقم دُوّر لا يُعاد أبداً
  const floor = await getSequenceFloor(client, 'MC-')
  return nextSequentialNumber('MC-', rows.map((r) => r.number), 4, floor)
}

/**
 * الأشخاص المرشحون للمقاصة: من يجمع صفةين فأكثر (أطراف + موظفون) باسم واحد موحد،
 * مع رصيد كل صفة موقّعاً ومصطلحات مدين، واقتراحات الأزواج المتقابلة آلياً.
 *
 * الرصيد المعتمد = رصيد المستندات (دفتر الفرع) نفسه الذي تعرضه شجرة الحسابات وكشوف
 * الأطراف — من computeAllDocBalances — فتبقى المقاصة متسقة مع ما يراه المستخدم في كل
 * الشاشات (الشيكات غير المصروفة مثلاً تبقى على ذمة الطرف ولا تدخل في المقاصة).
 */
export async function loadClearingCandidates(): Promise<ClearingPerson[]> {
  const [partners, employees, docBalances] = await Promise.all([
    db.partner.findMany({
      // المقاصة تجارة بين أطراف — ملفات الشركاء (رأس المال) ليست صفة مقاصة
      where: { isActive: true, accountId: { not: null }, type: { in: ['CUSTOMER', 'SUPPLIER'] } },
      select: {
        id: true, code: true, name: true, type: true,
        account: { select: { id: true, code: true, name: true, openingBalance: true } },
      },
      orderBy: { code: 'asc' },
    }),
    db.employee.findMany({
      where: { isActive: true, accountId: { not: null } },
      select: {
        id: true, code: true, name: true,
        account: { select: { id: true, code: true, name: true, openingBalance: true } },
      },
      orderBy: { code: 'asc' },
    }),
    computeAllDocBalances(),
  ])

  const roles: ClearingRole[] = []
  for (const p of partners) {
    if (!p.account) continue
    const t = docBalances.partner.get(p.id)
    roles.push({
      kind: p.type === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER',
      label: AR_ROLE[p.type === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER'],
      refId: p.id,
      refCode: p.code,
      refName: p.name,
      accountId: p.account.id,
      accountCode: p.account.code,
      accountName: p.account.name,
      // رصيد موقّع بمصطلحات مدين: مستنداته (مدين - دائن) + الافتتاحي إن وُجد
      balance: round2((t?.debit ?? 0) - (t?.credit ?? 0) + p.account.openingBalance),
    })
  }
  for (const e of employees) {
    if (!e.account) continue
    const t = docBalances.employee.get(e.id)
    roles.push({
      kind: 'EMPLOYEE',
      label: AR_ROLE.EMPLOYEE,
      refId: e.id,
      refCode: e.code,
      refName: e.name,
      accountId: e.account.id,
      accountCode: e.account.code,
      accountName: e.account.name,
      balance: round2((t?.debit ?? 0) - (t?.credit ?? 0) + e.account.openingBalance),
    })
  }
  if (roles.length === 0) return []

  // تجميع الصفات باسم شخص موحد
  const byName = new Map<string, ClearingRole[]>()
  for (const r of roles) {
    const key = normalizePersonName(r.refName)
    if (!key) continue
    const list = byName.get(key) ?? []
    list.push(r)
    byName.set(key, list)
  }

  const persons: ClearingPerson[] = []
  for (const [key, list] of byName) {
    if (list.length < 2) continue
    // الاقتراحات: كل زوج برصيدين متعاكسين — يُدين طرف الدائن ويُدائن طرف المدين بالأصغر
    const suggestions: ClearingSuggestion[] = []
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        if (Math.sign(a.balance) === 0 || Math.sign(b.balance) === 0) continue
        if (Math.sign(a.balance) === Math.sign(b.balance)) continue
        const debitSide = a.balance < 0 ? a : b // الرصيد الدائن (علينا له) يُدين
        const creditSide = a.balance < 0 ? b : a // الرصيد المدين (لنا عليه) يُدائن
        suggestions.push({
          debitAccountId: debitSide.accountId,
          debitAccountCode: debitSide.accountCode,
          debitAccountName: debitSide.accountName,
          creditAccountId: creditSide.accountId,
          creditAccountCode: creditSide.accountCode,
          creditAccountName: creditSide.accountName,
          amount: round2(Math.min(Math.abs(a.balance), Math.abs(b.balance))),
        })
      }
    }
    persons.push({ key, name: key, roles: list.sort((x, y) => x.accountCode.localeCompare(y.accountCode)), suggestions })
  }

  // ذوو الاقتراحات أولاً ثم بالاسم — الأكثر فائدة أعلى القائمة
  return persons.sort(
    (a, b) => b.suggestions.length - a.suggestions.length || a.name.localeCompare(b.name, 'ar'),
  )
}

// ==================== التحقق من جسم الإنشاء ====================

export interface ValidatedPair {
  debitAccountId: string
  creditAccountId: string
  amount: number
  description: string | null
}

export interface ValidatedClearing {
  date: Date
  notes: string | null
  pairs: ValidatedPair[]
  total: number
}

export type ClearingValidationResult =
  | { ok: true; data: ValidatedClearing }
  | { ok: false; error: string }

/** التحقق الشامل من طلب إنشاء سند مقاصة — أزواج مدين/دائن بين حسابات أطراف وموظفين مرتبطة بملفات */
export async function validateClearingBody(body: unknown): Promise<ClearingValidationResult> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'بيانات الطلب غير صالحة' }
  const b = body as Record<string, unknown>

  const dateStr = String(b.date ?? '')
  const date = new Date(dateStr)
  if (!dateStr || Number.isNaN(date.getTime())) return { ok: false, error: 'تاريخ السند غير صالح' }

  const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 500) || null : null

  if (!Array.isArray(b.pairs) || b.pairs.length < 1) {
    return { ok: false, error: 'يجب إضافة زوج مقاصة واحد على الأقل (مدين ↔ دائن)' }
  }
  if (b.pairs.length > 12) {
    return { ok: false, error: 'الحد الأقصى 12 زوج مقاصة في السند الواحد' }
  }

  const pairs: ValidatedPair[] = []
  for (let i = 0; i < b.pairs.length; i++) {
    const raw = b.pairs[i] as Record<string, unknown>
    if (!raw || typeof raw !== 'object') return { ok: false, error: `الزوج ${i + 1}: بيانات غير صالحة` }

    const debitAccountId = typeof raw.debitAccountId === 'string' ? raw.debitAccountId.trim() : ''
    const creditAccountId = typeof raw.creditAccountId === 'string' ? raw.creditAccountId.trim() : ''
    if (!debitAccountId || !creditAccountId) {
      return { ok: false, error: `الزوج ${i + 1}: يجب اختيار الحساب المدين والحساب الدائن` }
    }
    if (debitAccountId === creditAccountId) {
      return { ok: false, error: `الزوج ${i + 1}: لا يجوز أن يكون الطرفان الحساب نفسه` }
    }

    const amount = round2(Number(raw.amount))
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: `الزوج ${i + 1}: المبلغ يجب أن يكون رقماً أكبر من صفر` }
    }
    if (amount > 1_000_000_000) {
      return { ok: false, error: `الزوج ${i + 1}: المبلغ كبير جداً — تحقق من الرقم` }
    }

    const description =
      typeof raw.description === 'string' && raw.description.trim()
        ? raw.description.trim().slice(0, 200)
        : null

    pairs.push({ debitAccountId, creditAccountId, amount, description })
  }

  // التحقق من الحسابات: موجودة + مرتبطة بملف طرف أو موظف (انضباط دفتر الفرع)
  const accountIds = [...new Set(pairs.flatMap((p) => [p.debitAccountId, p.creditAccountId]))]
  const accounts = await db.account.findMany({
    where: { id: { in: accountIds } },
    select: {
      id: true, code: true, name: true,
      partner: { select: { id: true, name: true } }, // تعدد الأدوار: قد يحمل الحساب عدة ملفات أطراف
      employee: { select: { id: true, name: true } },
    },
  })
  const accMap = new Map(accounts.map((a) => [a.id, a]))
  for (const id of accountIds) {
    const a = accMap.get(id)
    if (!a) return { ok: false, error: 'أحد الحسابات المحددة غير موجود في دليل الحسابات' }
    if ((!a.partner || a.partner.length === 0) && !a.employee) {
      return {
        ok: false,
        error: `الحساب «${a.name}» (${a.code}) غير مرتبط بملف عميل أو مورد أو موظف — المقاصة تتم بين حسابات الأطراف المرتبطة بملفات حصراً`,
      }
    }
  }

  const total = round2(pairs.reduce((s, p) => s + p.amount, 0))

  return { ok: true, data: { date, notes, pairs, total } }
}

/**
 * ترحيل سند المقاصة داخل المعاملة: قيد مزدوج مُرحّل (POSTED) بمصدر CLEARING ورقم MC-xxxx —
 * كل زوج سطران (مدين/دائن) بالمبلغ نفسه فالتوازن مضمون بنيوياً.
 */
export async function postClearingJournal(
  tx: Tx,
  data: ValidatedClearing,
  accMap: Map<string, { code: string; name: string }>,
): Promise<{ id: string; number: string }> {
  // إنفاذ الفترات المقفلة: سند مؤرّخ داخل فترة مقفلة ⇒ رفض الترحيل
  await assertPeriodOpen(tx, data.date, 'سند مقاصة')

  const number = await nextClearingNumber(tx)

  const names = data.pairs
    .map((p) => {
      const d = accMap.get(p.debitAccountId)
      const c = accMap.get(p.creditAccountId)
      return d && c ? `${d.name} ↔ ${c.name}` : null
    })
    .filter((v): v is string => !!v)
  const description =
    (data.notes ? `${data.notes} — ` : '') +
    `سند مقاصة ذمم: ${names.join(' ، ') || 'مقاصة أرصدة متقابلة'}`

  const lineRows = data.pairs.flatMap((p, pairIndex) => {
    const d = accMap.get(p.debitAccountId)!
    const c = accMap.get(p.creditAccountId)!
    const reason = p.description || data.notes || null
    return [
      {
        accountId: p.debitAccountId,
        debit: p.amount,
        credit: 0,
        description: reason
          ? `مقاصة ذمم — ${reason} — ${d.name}`
          : `مقاصة ذمم — ${d.name}`,
        order: pairIndex * 2,
      },
      {
        accountId: p.creditAccountId,
        debit: 0,
        credit: p.amount,
        description: reason
          ? `مقاصة ذمم — ${reason} — ${c.name}`
          : `مقاصة ذمم — ${c.name}`,
        order: pairIndex * 2 + 1,
      },
    ]
  })

  const totalDebit = round2(lineRows.reduce((s, l) => s + l.debit, 0))
  const totalCredit = round2(lineRows.reduce((s, l) => s + l.credit, 0))
  if (Math.abs(totalDebit - totalCredit) >= 0.01 || totalDebit <= 0) {
    // حماية دفاعية — لا يُفترض الوصول إليها إطلاقاً (كل زوج سطران بمبلغ واحد)
    throw new Error(`سند المقاصة غير متوازن (مدين ${totalDebit.toFixed(2)} / دائن ${totalCredit.toFixed(2)})`)
  }

  const entry = await tx.journalEntry.create({
    data: {
      number,
      date: data.date,
      description: description.slice(0, 500),
      source: CLEARING_SOURCE,
      status: 'POSTED',
      totalDebit,
      totalCredit,
      refType: CLEARING_SOURCE,
      refId: null,
      lines: {
        create: lineRows.map((l) => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          description: l.description,
          order: l.order,
        })),
      },
    },
    select: { id: true, number: true },
  })
  return entry
}
