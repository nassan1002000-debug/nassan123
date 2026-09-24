// GET /api/period-view/[id]/data — قراءة بيانات الفترة المقفلة من نسختها الأرشيفية (قراءة فقط)
// التبويبات: overview نظرة عامة · trial ميزان المراجعة · income قائمة الدخل · balance الميزانية
//            journal القيود · invoices الفواتير · payments السندات · partners الأطراف · items المخزون
// كل الحسابات تُحتسب من قيود الأرشيف المرحّلة حتى نهاية يوم الإقفال — مطابقة لحظة الإقفال بالضبط
import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/api-guard'
import { getSnapshotClient, resolveViewPeriod } from '@/lib/period-view-server'

export const dynamic = 'force-dynamic'

type Snap = ReturnType<typeof getSnapshotClient>
type Params = { params: Promise<{ id: string }> }

const round2 = (n: number): number => Math.round(n * 100) / 100
const PAGE_SIZE = 25

export async function GET(req: NextRequest, ctx: Params) {
  const denied = await requireApiSession(req)
  if (denied) return denied

  const { id } = await ctx.params
  const period = await resolveViewPeriod(id)
  if (!period) {
    return NextResponse.json({ error: 'الفترة المطلوبة أو نسختها الأرشيفية غير متاحة' }, { status: 404 })
  }

  const url = new URL(req.url)
  const tab = url.searchParams.get('tab') ?? 'overview'
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80)
  const entryId = url.searchParams.get('entryId') ?? ''
  const closeEnd = new Date(period.closingDate.getTime() + 86_399_999)

  try {
    const snap = getSnapshotClient(period.snapshotFile)

    // أرصدة الحسابات — الأساس المشترك للتبويبات المالية
    const balances = async () => {
      const accounts = await snap.account.findMany({
        select: { id: true, code: true, name: true, type: true, nature: true },
        orderBy: { code: 'asc' },
      })
      const grouped = await snap.journalEntryLine.groupBy({
        by: ['accountId'],
        where: { entry: { status: 'POSTED', date: { lte: closeEnd } } },
        _sum: { debit: true, credit: true },
      })
      const net = new Map<string, number>()
      for (const g of grouped) {
        net.set(g.accountId, round2((g._sum.debit ?? 0) - (g._sum.credit ?? 0)))
      }
      return accounts.map((a) => ({
        code: a.code,
        name: a.name,
        type: a.type,
        nature: a.nature,
        balance: round2(net.get(a.id) ?? 0),
      }))
    }

    if (tab === 'overview') {
      const [accounts, entryCount, invoiceCount, paymentCount, itemCount, partnerCount, employeeCount] =
        await Promise.all([
          balances(),
          snap.journalEntry.count({ where: { date: { lte: closeEnd } } }),
          snap.invoice.count({ where: { isDeleted: false, date: { lte: closeEnd } } }),
          snap.payment.count({ where: { date: { lte: closeEnd } } }),
          snap.item.count(),
          snap.partner.count(),
          snap.employee.count(),
        ])
      const byCode = new Map(accounts.map((a) => [a.code, a.balance]))
      const sumType = (type: string) =>
        round2(
          accounts.filter((a) => a.type === type).reduce((s, a) => s + a.balance, 0),
        )
      const sales = await snap.invoice.aggregate({
        where: { isDeleted: false, type: { in: ['SALE', 'SALES_RETURN'] }, date: { lte: closeEnd } },
        _sum: { total: true },
      })
      const purchases = await snap.invoice.aggregate({
        where: { isDeleted: false, type: { in: ['PURCHASE', 'PURCHASE_RETURN'] }, date: { lte: closeEnd } },
        _sum: { total: true },
      })
      return NextResponse.json({
        meta: {
          label: period.label,
          closingDate: period.closingDate.toISOString().slice(0, 10),
          openingEntryNumber: period.openingEntryNumber,
          rotatedEntries: period.rotatedEntries,
          closedBy: period.closedBy,
        },
        counts: {
          entries: entryCount,
          invoices: invoiceCount,
          payments: paymentCount,
          items: itemCount,
          partners: partnerCount,
          employees: employeeCount,
        },
        salesTotal: round2(sales._sum.total ?? 0),
        purchasesTotal: round2(purchases._sum.total ?? 0),
        netProfit: round2(-sumType('REVENUE') - sumType('EXPENSE')),
        cash: byCode.get('1110') ?? 0,
        bank: byCode.get('1120') ?? 0,
        inventory: byCode.get('1140') ?? 0,
      })
    }

    if (tab === 'trial') {
      const accounts = await balances()
      const rows = accounts
        .filter((a) => a.balance !== 0)
        .map((a) => ({
          code: a.code,
          name: a.name,
          type: a.type,
          debit: a.balance > 0 ? a.balance : 0,
          credit: a.balance < 0 ? round2(-a.balance) : 0,
        }))
      return NextResponse.json({
        rows,
        totalDebit: round2(rows.reduce((s, r) => s + r.debit, 0)),
        totalCredit: round2(rows.reduce((s, r) => s + r.credit, 0)),
      })
    }

    if (tab === 'income' || tab === 'balance') {
      const accounts = await balances()
      const typeFilter = tab === 'income' ? ['REVENUE', 'EXPENSE'] : ['ASSET', 'LIABILITY', 'EQUITY']
      const rows = accounts
        .filter((a) => typeFilter.includes(a.type) && a.balance !== 0)
        .map((a) => ({ code: a.code, name: a.name, type: a.type, balance: a.balance }))
      const revenues = round2(rows.filter((r) => r.type === 'REVENUE').reduce((s, r) => s - r.balance, 0))
      const expenses = round2(rows.filter((r) => r.type === 'EXPENSE').reduce((s, r) => s + r.balance, 0))
      return NextResponse.json({
        rows,
        ...(tab === 'income'
          ? { totalRevenue: revenues, totalExpense: expenses, netProfit: round2(revenues - expenses) }
          : {
              totalAssets: round2(rows.filter((r) => r.type === 'ASSET').reduce((s, r) => s + r.balance, 0)),
              totalLiabilities: round2(
                rows.filter((r) => r.type === 'LIABILITY').reduce((s, r) => s - r.balance, 0),
              ),
              totalEquity: round2(rows.filter((r) => r.type === 'EQUITY').reduce((s, r) => s - r.balance, 0)),
              // نتيجة الفترة ما تزال ضمن حسابات الإيرادات/المصروفات في الأرشيف (قيد الإقفال
              // يُنشأ في القاعدة الحية فقط) — تُعرض للقارئ ليكتمل التوازن في ذهنه
              netProfit: round2(revenues - expenses),
            }),
      })
    }

    if (tab === 'journal') {
      if (entryId) {
        const entry = await snap.journalEntry.findUnique({
          where: { id: entryId },
          include: {
            lines: {
              orderBy: { order: 'asc' },
              include: { account: { select: { code: true, name: true } } },
            },
          },
        })
        if (!entry) return NextResponse.json({ error: 'القيد غير موجود في الأرشيف' }, { status: 404 })
        return NextResponse.json({
          entry: {
            id: entry.id,
            number: entry.number,
            date: entry.date.toISOString().slice(0, 10),
            description: entry.description,
            status: entry.status,
            totalDebit: entry.totalDebit,
            totalCredit: entry.totalCredit,
            lines: entry.lines.map((l) => ({
              code: l.account.code,
              accountName: l.account.name,
              debit: l.debit,
              credit: l.credit,
              description: l.description,
            })),
          },
        })
      }
      const where = q
        ? { date: { lte: closeEnd }, OR: [{ number: { contains: q } }, { description: { contains: q } }] }
        : { date: { lte: closeEnd } }
      const [total, entries] = await Promise.all([
        snap.journalEntry.count({ where }),
        snap.journalEntry.findMany({
          where,
          orderBy: [{ date: 'desc' }, { number: 'desc' }],
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
          select: {
            id: true,
            number: true,
            date: true,
            description: true,
            status: true,
            totalDebit: true,
            totalCredit: true,
          },
        }),
      ])
      return NextResponse.json({
        rows: entries.map((e) => ({ ...e, date: e.date.toISOString().slice(0, 10) })),
        total,
        page,
        pageSize: PAGE_SIZE,
      })
    }

    if (tab === 'invoices') {
      const where = {
        isDeleted: false,
        date: { lte: closeEnd },
        ...(q ? { OR: [{ number: { contains: q } }, { partner: { name: { contains: q } } }] } : {}),
      }
      const [total, rows] = await Promise.all([
        snap.invoice.count({ where }),
        snap.invoice.findMany({
          where,
          orderBy: { date: 'desc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
          select: {
            number: true,
            date: true,
            type: true,
            total: true,
            paid: true,
            status: true,
            partner: { select: { name: true } },
          },
        }),
      ])
      return NextResponse.json({
        rows: rows.map((r) => ({ ...r, date: r.date.toISOString().slice(0, 10), partnerName: r.partner.name })),
        total,
        page,
        pageSize: PAGE_SIZE,
      })
    }

    if (tab === 'payments') {
      const where = {
        date: { lte: closeEnd },
        ...(q ? { OR: [{ number: { contains: q } }, { partner: { name: { contains: q } } }] } : {}),
      }
      const [total, rows] = await Promise.all([
        snap.payment.count({ where }),
        snap.payment.findMany({
          where,
          orderBy: { date: 'desc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
          select: {
            number: true,
            date: true,
            type: true,
            amount: true,
            method: true,
            partner: { select: { name: true } },
          },
        }),
      ])
      return NextResponse.json({
        rows: rows.map((r) => ({
          number: r.number,
          date: r.date.toISOString().slice(0, 10),
          type: r.type,
          amount: r.amount,
          method: r.method,
          partnerName: r.partner?.name ?? '—',
        })),
        total,
        page,
        pageSize: PAGE_SIZE,
      })
    }

    if (tab === 'partners') {
      const partners = await snap.partner.findMany({ orderBy: { name: 'asc' } })
      const rows = await Promise.all(
        partners.map(async (p) => {
          const [invoicesAgg, paymentsAgg] = await Promise.all([
            snap.invoice.aggregate({
              where: {
                partnerId: p.id,
                isDeleted: false,
                date: { lte: closeEnd },
                // فواتير الطرف بنوعه — بيع/مردود بيع للعميل، شراء/مردود شراء للمورد
                ...(p.type === 'CUSTOMER'
                  ? { type: { in: ['SALE', 'SALES_RETURN'] } }
                  : { type: { in: ['PURCHASE', 'PURCHASE_RETURN'] } }),
              },
              _sum: { total: true },
            }),
            snap.payment.aggregate({
              where: {
                partnerId: p.id,
                date: { lte: closeEnd },
                // قبض من العميل يخفض مديونيته، دفع للمورد يخفض ديننا له
                ...(p.type === 'CUSTOMER' ? { type: 'RECEIPT' } : { type: 'PAYMENT' }),
              },
              _sum: { amount: true },
            }),
          ])
          const docs = round2(invoicesAgg._sum.total ?? 0)
          const cash = round2(paymentsAgg._sum.amount ?? 0)
          // مدين-موجب: العميل الفاتورة مدين، المورد الفاتورة دائن
          const balance = p.type === 'CUSTOMER' ? round2(docs - cash) : round2(cash - docs)
          return { code: p.code, name: p.name, type: p.type, docs, cash, balance }
        }),
      )
      return NextResponse.json({ rows: rows.filter((r) => r.docs !== 0 || r.cash !== 0) })
    }

    if (tab === 'items') {
      const where = q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }] } : {}
      const [total, items] = await Promise.all([
        snap.item.count({ where }),
        snap.item.findMany({
          where,
          orderBy: { code: 'asc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
          select: {
            code: true,
            name: true,
            salePrice: true,
            warehouse: { select: { name: true, code: true } },
            balances: { select: { quantity: true, warehouse: { select: { name: true } } } },
            units: { where: { isActive: true }, select: { name: true, factor: true } },
          },
        }),
      ])
      return NextResponse.json({
        rows: items.map((i) => ({
          code: i.code,
          name: i.name,
          salePrice: i.salePrice,
          warehouse: i.warehouse ? `${i.warehouse.name} (${i.warehouse.code})` : 'غير مسندة',
          quantity: round2(i.balances.reduce((s, b) => s + b.quantity, 0)),
          locations: i.balances.filter((b) => b.quantity !== 0).map((b) => `${b.warehouse.name}: ${b.quantity}`),
          units: i.units.map((u) => `${u.name}×${u.factor}`).join('، '),
        })),
        total,
        page,
        pageSize: PAGE_SIZE,
      })
    }

    return NextResponse.json({ error: 'تبويب غير معروف' }, { status: 400 })
  } catch (error) {
    console.error('GET /api/period-view/[id]/data error:', error)
    return NextResponse.json({ error: 'تعذر قراءة بيانات الفترة من الأرشيف' }, { status: 500 })
  }
}
