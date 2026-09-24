import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { accountDocStatement } from '@/lib/partner-statement-server'

const round2 = (n: number): number => Math.round(n * 100) / 100

type Direction = 'DEBIT' | 'CREDIT' | 'ZERO'

// اتجاه الرصيد بصيغة "مدين-موجب": موجب = مدين، سالب = دائن
function directionOf(signedInDebitTerms: number): Direction {
  if (Math.abs(signedInDebitTerms) < 0.005) return 'ZERO'
  return signedInDebitTerms > 0 ? 'DEBIT' : 'CREDIT'
}

export interface LedgerInvoiceItem {
  itemName: string
  quantity: number
  unitPrice: number
  total: number
}

/** بنود فواتير عدة دفعة واحدة (بلا N+1) — لتفكيك سطر الفاتورة إلى مواده عند الطلب */
async function fetchInvoiceItemsByInvoiceId(invoiceIds: string[]): Promise<Map<string, LedgerInvoiceItem[]>> {
  const out = new Map<string, LedgerInvoiceItem[]>()
  if (invoiceIds.length === 0) return out
  const rows = await db.invoiceLine.findMany({
    where: { invoiceId: { in: invoiceIds } },
    select: { invoiceId: true, quantity: true, unitPrice: true, total: true, item: { select: { name: true } } },
  })
  for (const r of rows) {
    const list = out.get(r.invoiceId) ?? []
    list.push({ itemName: r.item.name, quantity: r.quantity, unitPrice: r.unitPrice, total: r.total })
    out.set(r.invoiceId, list)
  }
  return out
}

// ==================== GET: دفتر الأستاذ / كشف الحساب ====================
// mode=summary: ملخص (افتتاحي/حركة/ختامي) — mode=detail: البنود كاملة مع الرصيد الجاري
//
// الحساب المرتبط بملف طرف (عميل/مورد/موظف — بشارة في الشجرة): كشفه يُبنى من مستنداته
// الفعلية (فواتيره ومردوداته وسنداته وسلفه) — منهج «دفتر الفرع» Subledger — مع basedOn=DOCUMENTS
// وبقية الحسابات: حركة القيود المُرحّلة كما هي (basedOn=GL)
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const sp = req.nextUrl.searchParams
    const mode = sp.get('mode') === 'summary' ? 'summary' : 'detail'

    // مرشّح فترة تاريخ اختياري (from/to — نفس تسمية بقية مسارات القوائم في المشروع):
    // مستندات ما قبل from تُطوى في رصيد سابق واحد لا تظهر كأسطر، وما بعد to يُهمل كلياً
    const fromStr = sp.get('from')
    const toStr = sp.get('to')
    const rangeFrom = fromStr ? new Date(`${fromStr}T00:00:00.000`) : undefined
    const rangeTo = toStr ? new Date(`${toStr}T23:59:59.999`) : undefined
    const range =
      (rangeFrom && !Number.isNaN(rangeFrom.getTime())) || (rangeTo && !Number.isNaN(rangeTo.getTime()))
        ? {
            from: rangeFrom && !Number.isNaN(rangeFrom.getTime()) ? rangeFrom : undefined,
            to: rangeTo && !Number.isNaN(rangeTo.getTime()) ? rangeTo : undefined,
          }
        : undefined

    const account = await db.account.findUnique({ where: { id } })
    if (!account) {
      return NextResponse.json({ error: 'الحساب غير موجود' }, { status: 404 })
    }

    const accountHead = {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      nature: account.nature,
      isSystem: account.isSystem,
      isActive: account.isActive,
      openingBalance: account.openingBalance,
    }

    // ===== الحساب المرتبط بملفات أطراف — كشف موحد من المستندات =====
    // تعدد الأدوار: الحساب الواحد قد يحمل ملف موظف وملف عميل/مورد معاً — الكشف يجمع مستنداتها كلها
    const docStmt = await accountDocStatement(id, range)
    if (docStmt) {
      // تفكيك بنود الفاتورة (Expandable Rows): يُجلب لكل سطر مصدره فاتورة — دفعة واحدة
      // بلا N+1 — ويُرفق items اختيارياً؛ الواجهة تطويه افتراضياً ولا يظهر إلا بطلب توسيعه
      const invoiceIds = [...new Set(docStmt.lines.map((l) => l.invoiceId).filter((v): v is string => !!v))]
      const itemsByInvoice = await fetchInvoiceItemsByInvoiceId(invoiceIds)

      return NextResponse.json({
        mode,
        basedOn: 'DOCUMENTS',
        // ليس تجميعياً بمعنى الشجرة الفرعية (docStmt.owner = صاحب الحساب نفسه دائماً) —
        // لكن accountCode/accountName ومساتير الطرف ما زالت تُعبَّأ أدناه لكل سطر بلا شرطة
        isAggregate: false,
        account: accountHead,
        lines: docStmt.lines.map((l) => ({
          id: `${l.number}-${l.date}`,
          entryId: '',
          entryNumber: l.number,
          // كشف المستندات مبنيّ من الفواتير/السندات نفسها فرقم المستند هنا هو الحقيقي
          // أصلاً (INV-/VCH-xxxx) لا رقم قيد داخلي — نفس الحقل بلا ازدواج
          documentNumber: l.number,
          // صاحب هذا الحساب هو طرف كل حركة هنا بالتعريف (دفتر فرعه الخاص)
          partnerName: docStmt.owner.name,
          accountCode: account.code,
          accountName: account.name,
          date: l.date,
          description: `${l.docType} — ${l.description}`,
          debit: l.debit,
          credit: l.credit,
          costCenterName: l.costCenterName,
          source: l.docType,
          balance: l.balance,
          balanceDirection: l.balanceDirection,
          ...(l.invoiceId && itemsByInvoice.has(l.invoiceId) ? { items: itemsByInvoice.get(l.invoiceId) } : {}),
        })),
        totals: {
          ...docStmt.totals,
          // نص المرجع يُبنى من fromStr الخام لا من تحويل UTC للتاريخ (كان يزيح يوماً كاملاً
          // في مناطق زمنية شرق UTC) — نفس المصدر المستخدم في فرع GL أدناه لثبات الصياغة
          openingRef: range?.from ? `الرصيد المتراكم حتى قبل ${fromStr}` : docStmt.totals.openingRef ?? null,
        },
      })
    }

    // ===== الشجرة الفرعية للحساب — تُبنى دائماً بصرف النظر عن حالة الإقفال =====
    // حساب رئيسي/تجميعي (كـ1000 الأصول) لا تُرحَّل عليه بنود مباشرة أبداً (الدفعة 4:
    // حسابات التحكم مقدسة — الترحيل اليدوي المباشر عليها ممنوع) فحركته الحقيقية هي
    // مجموع حركة كل حساباته الفرعية معاً؛ حساب ورقة (بلا أبناء) شجرته الفرعية = نفسه فقط
    const allAccountsForTree = await db.account.findMany({ select: { id: true, parentId: true } })
    const childrenOf = new Map<string, string[]>()
    for (const a of allAccountsForTree) {
      if (!a.parentId) continue
      const list = childrenOf.get(a.parentId) ?? []
      list.push(a.id)
      childrenOf.set(a.parentId, list)
    }
    const subtree = new Set<string>([id])
    const queue = [id]
    while (queue.length > 0) {
      const cur = queue.pop() as string
      for (const ch of childrenOf.get(cur) ?? []) {
        if (!subtree.has(ch)) {
          subtree.add(ch)
          queue.push(ch)
        }
      }
    }
    const isAggregate = subtree.size > 1
    const accountsById = new Map(
      isAggregate
        ? (
            await db.account.findMany({
              where: { id: { in: [...subtree] } },
              select: { id: true, code: true, name: true },
            })
          ).map((a) => [a.id, a] as const)
        : [],
    )

    // ===== الحساب العادي — حركة القيود المُرحّلة (لحساب تجميعي: كل شجرته الفرعية معاً) =====
    const allRows = await db.journalEntryLine.findMany({
      where: { accountId: { in: [...subtree] }, entry: { status: 'POSTED' } },
      include: {
        entry: {
          select: { id: true, number: true, date: true, description: true, source: true, refType: true, refId: true },
        },
        costCenter: { select: { name: true } },
      },
    })

    // ===== رصيد افتتاح الدورة من سند القيد الافتتاحي (ترحيل الفترة المغلقة) =====
    // القاعدة الذهبية: في الفترة الجديدة يكون سند الافتتاحي (JE المفتاح في سجل الإقفال) هو
    // المصدر الوحيد للأرصدة — أول سطر في كشف أي حساب هو «رصيد افتتاح الدورة — سند JE-xxxx»
    // بقيمة الرصيد المدوّر. رصيد الحسابات الأب يُجمع من أسطر أبنائه في السند (الشجرة الفرعية)،
    // وأسطر السند نفسه على الحساب تُستبعد من حركة الكشف كي لا تتضاعف (هي الافتتاح لا حركة).
    // حرس الأرشيف: إن وُجدت حركة أقدم من السند فنحن في سياق تاريخي (أرشيف فترة لاحقة) —
    // يبقى السند فيها حركة عادية بترتيبه الزمني كما كان.
    const sign = account.nature === 'DEBIT' ? 1 : -1
    interface OpeningBasis {
      entryId: string
      entryNumber: string
      debit: number
      credit: number
      term: number // قيمة الافتتاح في فضاء الجريان (الطبيعة + مدين − دائن)
      ref: string
    }
    let opening: OpeningBasis | null = null
    const latestClose = await db.periodClose.findFirst({ orderBy: { closingDate: 'desc' } })
    if (latestClose) {
      // الشجرة الفرعية محسوبة أعلاه مرة واحدة (تُستعمل أيضاً لحركة القيود العادية)
      const openLines = await db.journalEntryLine.findMany({
        where: { entryId: latestClose.openingEntryId, accountId: { in: [...subtree] }, entry: { status: 'POSTED' } },
        select: { debit: true, credit: true },
      })
      const openD = round2(openLines.reduce((s, l) => s + l.debit, 0))
      const openC = round2(openLines.reduce((s, l) => s + l.credit, 0))
      const term = round2(account.openingBalance * sign + openD - openC)
      const hasOlder = allRows.some(
        (r) =>
          r.entry.id !== latestClose.openingEntryId &&
          r.entry.date.getTime() < latestClose.openingDate.getTime(),
      )
      if (!hasOlder && (openD !== 0 || openC !== 0)) {
        opening = {
          entryId: latestClose.openingEntryId,
          entryNumber: latestClose.openingEntryNumber,
          debit: openD,
          credit: openC,
          term,
          ref: `رصيد افتتاح الدورة — سند ${latestClose.openingEntryNumber}`,
        }
      }
    }

    // حركة الكشف = القيود المُرحّلة باستثناء أسطر سند الافتتاحي (هي الرصيد الافتتاحي لا حركة)
    const openingExcluded = opening ? allRows.filter((r) => r.entry.id !== opening!.entryId) : allRows

    // ترتيب زمني: تاريخ القيد ثم رقمه ثم ترتيب البند
    openingExcluded.sort((a, b) => {
      const byDate = a.entry.date.getTime() - b.entry.date.getTime()
      if (byDate !== 0) return byDate
      const byNumber = a.entry.number.localeCompare(b.entry.number, 'en', { numeric: true })
      if (byNumber !== 0) return byNumber
      return a.order - b.order
    })

    // مرشّح فترة التاريخ: ما قبل from يُطوى في رصيد سابق واحد (لا يظهر كأسطر)، وما بعد to يُهمل
    let preRangeBalance = 0
    let rows = openingExcluded
    if (range) {
      if (range.from) {
        for (const r of openingExcluded) {
          if (r.entry.date.getTime() >= range.from.getTime()) break
          preRangeBalance += (r.debit ?? 0) - (r.credit ?? 0)
        }
      }
      rows = openingExcluded.filter(
        (r) =>
          (!range.from || r.entry.date.getTime() >= range.from.getTime()) &&
          (!range.to || r.entry.date.getTime() <= range.to.getTime()),
      )
    }

    // ===== فكّ البيان المركّب إلى حقول مستقلة: الطرف ورقم المستند الأصلي =====
    // الوصف الحالي نص واحد يحشر رقم المستند واسم الطرف معاً ("...بالفاتورة INV-0010 —
    // شركة النور للتجارة") — قراءتهما تحتاج تحليل نص. تُحل هنا من refType/refId الحقيقي
    // للقيد (لا الرقم المتسلسل JE-xxxx) وتُعاد كحقلين منفصلين documentNumber/partnerName
    // على كل سطر — مفيد خصوصاً على حسابات عامة كالصندوق/البنك/المخزون حيث اسم الحساب
    // الفرعي نفسه لا يدل على الطرف (بخلاف حساب عميل/مورد حيث accountName يطابقه أصلاً)
    const refIdsByType = new Map<string, Set<string>>()
    for (const r of rows) {
      if (!r.entry.refType || !r.entry.refId) continue
      const set = refIdsByType.get(r.entry.refType) ?? new Set<string>()
      set.add(r.entry.refId)
      refIdsByType.set(r.entry.refType, set)
    }
    const docInfoById = new Map<string, { documentNumber: string; partnerName: string | null }>()
    const [invoiceDocs, paymentDocs] = await Promise.all([
      refIdsByType.get('INVOICE')?.size
        ? db.invoice.findMany({
            where: { id: { in: [...refIdsByType.get('INVOICE')!] } },
            select: { id: true, number: true, partner: { select: { name: true } } },
          })
        : Promise.resolve([]),
      refIdsByType.get('PAYMENT')?.size
        ? db.payment.findMany({
            where: { id: { in: [...refIdsByType.get('PAYMENT')!] } },
            select: { id: true, number: true, partner: { select: { name: true } }, account: { select: { name: true } } },
          })
        : Promise.resolve([]),
    ])
    for (const inv of invoiceDocs) docInfoById.set(inv.id, { documentNumber: inv.number, partnerName: inv.partner.name })
    for (const p of paymentDocs) {
      docInfoById.set(p.id, { documentNumber: p.number, partnerName: p.partner?.name ?? p.account?.name ?? null })
    }
    // تفكيك بنود الفاتورة (Expandable Rows) — نفس مجموعة معرّفات الفواتير أعلاه بلا استعلام إضافي
    const itemsByInvoice = await fetchInvoiceItemsByInvoiceId([...(refIdsByType.get('INVOICE') ?? [])])
    /** رقم المستند واسم الطرف الفعليّين لسطر — يسقط لرقم القيد ذاته حين لا مستند مستقل (مقاصة/افتتاحي) */
    function docInfoOf(entry: { number: string; refType: string | null; refId: string | null }): {
      documentNumber: string
      partnerName: string | null
    } {
      const resolved = entry.refId ? docInfoById.get(entry.refId) : undefined
      return resolved ?? { documentNumber: entry.number, partnerName: null }
    }

    // ===== فكّ قيود الرواتب المجمّعة (بذرة تاريخية بلا refId فردي) =====
    // sourc='SALARY' مع refType=null يعني قيداً شهرياً واحداً يغطي كل الموظفين معاً
    // (الدفع الفردي الحالي عبر /api/salaries/[id]/pay يضع refType='SALARY' + refId
    // فيبقى سطراً واحداً واضحاً بلا حاجة فك). يُفكّ كل سطر من هذه إلى سطر لكل موظف
    // بحصته من صافي راتب الشهر — نفس النسبة على مدين ودائن القيد معاً (الطرف الفعلي
    // لحركة الصندوق هنا هو الموظفون السبعة أنفسهم لا حركة مجهولة الطرف)
    const bulkSalaryMonths = new Set(
      rows.filter((r) => r.entry.source === 'SALARY' && !r.entry.refType).map((r) => r.entry.date.toISOString().slice(0, 7)),
    )
    const salaryByMonth = new Map<string, { employeeName: string; net: number }[]>()
    if (bulkSalaryMonths.size > 0) {
      const salaryRows = await db.salary.findMany({
        where: { month: { in: [...bulkSalaryMonths] } },
        select: { month: true, net: true, employee: { select: { name: true } } },
      })
      for (const s of salaryRows) {
        const list = salaryByMonth.get(s.month) ?? []
        list.push({ employeeName: s.employee.name, net: s.net })
        salaryByMonth.set(s.month, list)
      }
    }

    // الرصيد الجاري: يبدأ من رصيد افتتاح الدورة المرحّل بسند الافتتاحي (حسب الطبيعة:
    // مدين يبدأ مديناً ودائن يبدأ دائناً) — الصيغة: رصيد = رصيد + مدين − دائن (مدين-موجب)
    // + كل ما طُوي قبل from عند تفعيل مرشّح فترة تاريخ (صفر بلا مرشّح)
    const baseOpening = opening ? opening.term : account.openingBalance * sign
    let running = round2(baseOpening + preRangeBalance)

    let totalDebit = 0
    let totalCredit = 0

    interface OutLine {
      id: string
      entryId: string
      entryNumber: string
      /** رقم المستند الأصلي الفعلي (فاتورة/سند) — يسقط لرقم القيد ذاته حين لا مستند مستقل */
      documentNumber: string
      /** اسم الطرف الفعلي للحركة (عميل/مورد/موظف) — مستقل عن اسم الحساب الفرعي */
      partnerName: string | null
      date: string
      description: string
      debit: number
      credit: number
      costCenterName: string | null
      source: string
      balance: number
      balanceDirection: Direction
      accountCode?: string
      accountName?: string
      /** بنود المادة (Expandable Rows) — فقط لسطر مصدره فاتورة، تُطلَب طياً افتراضياً بالواجهة */
      items?: LedgerInvoiceItem[]
    }
    const lines: OutLine[] = []

    for (const line of rows) {
      const ownDescription = line.description?.trim() || line.entry.description
      // حساب تجميعي يعرض حركة شجرته الفرعية كلها معاً — البيان يُصدَّر بكود الحساب
      // الفرعي الفعلي كي تبقى الحركة قابلة للتمييز دون عمود إضافي في الواجهة
      const sub = isAggregate ? accountsById.get(line.accountId) : undefined
      const description = sub ? `[${sub.code}] ${ownDescription}` : ownDescription
      const subInfo = sub ? { accountCode: sub.code, accountName: sub.name } : {}

      const month = line.entry.source === 'SALARY' && !line.entry.refType ? line.entry.date.toISOString().slice(0, 7) : null
      const perEmployee = month ? salaryByMonth.get(month) : undefined
      const monthTotal = perEmployee ? round2(perEmployee.reduce((s, e) => s + e.net, 0)) : 0

      if (perEmployee && monthTotal > 0) {
        // فكّ السطر الواحد إلى سطر لكل موظف — نفس نسبة صافي راتبه من إجمالي الشهر
        // مطبّقة على مدين/دائن هذا السطر بعينه (يحافظ على توازن القيد الأصلي تماماً)؛
        // آخر موظف يمتص باقي كسور التقريب كي يبقى مجموع الأسطر الفرعية مطابقاً تماماً
        // لمبلغ السطر الأصلي (لا فلساً يضيع ولا يُضاف)
        const lineDebit = line.debit ?? 0
        const lineCredit = line.credit ?? 0
        let allocatedDebit = 0
        let allocatedCredit = 0
        perEmployee.forEach((emp, i) => {
          const isLast = i === perEmployee.length - 1
          const share = emp.net / monthTotal
          const debit = isLast ? round2(lineDebit - allocatedDebit) : round2(lineDebit * share)
          const credit = isLast ? round2(lineCredit - allocatedCredit) : round2(lineCredit * share)
          allocatedDebit = round2(allocatedDebit + debit)
          allocatedCredit = round2(allocatedCredit + credit)

          totalDebit += debit
          totalCredit += credit
          running += debit - credit

          lines.push({
            id: `${line.id}-${i}`,
            entryId: line.entry.id,
            entryNumber: line.entry.number,
            documentNumber: line.entry.number,
            partnerName: emp.employeeName,
            date: line.entry.date.toISOString(),
            description: `${description} — ${emp.employeeName}`,
            debit,
            credit,
            costCenterName: line.costCenter?.name ?? null,
            source: line.entry.source,
            balance: Math.abs(running),
            balanceDirection: directionOf(running),
            ...subInfo,
          })
        })
        continue
      }

      const debit = line.debit ?? 0
      const credit = line.credit ?? 0
      totalDebit += debit
      totalCredit += credit
      running += debit - credit

      const docInfo = docInfoOf(line.entry)
      lines.push({
        id: line.id,
        entryId: line.entry.id,
        entryNumber: line.entry.number,
        documentNumber: docInfo.documentNumber,
        // اسم الطرف: المُستخرج من المستند الأصلي أولاً، وإلا اسم الحساب الفرعي إن كان
        // طرفاً فعلاً (عميل/مورد/موظف) — يبقى null لحساب عام (صندوق/بنك) بلا مستند مرتبط
        partnerName: docInfo.partnerName ?? sub?.name ?? null,
        date: line.entry.date.toISOString(),
        description,
        debit,
        credit,
        costCenterName: line.costCenter?.name ?? null,
        source: line.entry.source,
        balance: Math.abs(running),
        balanceDirection: directionOf(running),
        // معلومات الحساب الفرعي الفعلي — مفيدة لأي عرض مستقبلي دون كسر العملاء الحاليين
        ...(sub ? { accountCode: sub.code, accountName: sub.name } : {}),
        ...(line.entry.refType === 'INVOICE' && line.entry.refId && itemsByInvoice.has(line.entry.refId)
          ? { items: itemsByInvoice.get(line.entry.refId) }
          : {}),
      })
    }

    // الافتتاحي المعروض: الأساس (سند الفترة أو الحقل المخزَّن) + ما طُوي قبل from عند
    // تفعيل مرشّح فترة تاريخ — بلا مرشّح تبقى preRangeBalance صفراً فلا يتغيّر شيء
    const displayedOpening = round2(baseOpening + preRangeBalance)
    const openingDirection = directionOf(displayedOpening)
    const closingDirection = directionOf(running)

    return NextResponse.json({
      mode,
      basedOn: 'GL',
      // حساب تجميعي (له حسابات فرعية — كـ1000 الأصول): lines أعلاه مجموع شجرته الفرعية
      // كلها معاً، لا بنود مباشرة على الحساب نفسه (حسابات التحكم مقدسة — الدفعة 4)
      isAggregate,
      account: accountHead,
      lines,
      totals: {
        opening: Math.abs(displayedOpening),
        openingDirection,
        /** مرجع الرصيد الافتتاحي — سند الفترة، أو حتى قبل from عند تفعيل مرشّح فترة تاريخ */
        openingRef: range?.from
          ? `الرصيد المتراكم حتى قبل ${fromStr}`
          : opening?.ref ?? null,
        totalDebit,
        totalCredit,
        closing: Math.abs(running),
        closingDirection,
        count: lines.length,
      },
    })
  } catch (error) {
    console.error('Account ledger error:', error)
    return NextResponse.json({ error: 'فشل جلب كشف الحساب' }, { status: 500 })
  }
}
