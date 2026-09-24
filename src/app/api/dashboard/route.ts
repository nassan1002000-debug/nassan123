import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AR_MONTHS } from '@/lib/format'

export const dynamic = 'force-dynamic'

function r2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function GET() {
  try {
    const [accounts, postedLines, customersCount, suppliersCount, items, recentInvoices, recentEntriesRaw, recentMovementsRaw, invoiceGroups] =
      await Promise.all([
        db.account.findMany({ orderBy: { code: 'asc' } }),
        db.journalEntryLine.findMany({
          where: { entry: { status: 'POSTED' } },
          select: {
            accountId: true,
            debit: true,
            credit: true,
            entry: { select: { date: true } },
          },
        }),
        db.partner.count({ where: { type: 'CUSTOMER' } }),
        db.partner.count({ where: { type: 'SUPPLIER' } }),
        db.item.findMany({
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            unit: true,
            minStock: true,
            warehouseId: true,
            balances: { select: { warehouseId: true, quantity: true } },
          },
        }),
        db.invoice.findMany({
          where: { isDeleted: false }, // المحذوفة (أرقامها محجوزة xx) خارج اللوحة
          orderBy: [{ date: 'desc' }, { number: 'desc' }],
          take: 5,
          select: {
            id: true,
            number: true,
            type: true,
            total: true,
            status: true,
            date: true,
            partner: { select: { name: true } },
          },
        }),
        db.journalEntry.findMany({
          orderBy: [{ date: 'desc' }, { number: 'desc' }],
          take: 5,
          select: { id: true, number: true, description: true, totalDebit: true, status: true, date: true },
        }),
        db.stockMovement.findMany({
          orderBy: { date: 'desc' },
          take: 5,
          select: {
            id: true,
            type: true,
            quantity: true,
            date: true,
            reason: true,
            item: { select: { name: true } },
          },
        }),
        db.invoice.groupBy({ by: ['status'], _count: { _all: true }, where: { isDeleted: false } }),
      ])

    // ==================== أرصدة الحسابات ====================
    // رصيد الحساب = الرصيد الافتتاحي + مجموع (مدين - دائن) من القيود المرحّلة
    // لحسابات طبيعتها مدين، والعكس للدائن — ثم تُجمع أرصدة الأبناء داخل الآباء
    type Acc = (typeof accounts)[number]
    const byId = new Map<string, Acc>()
    const childrenOf = new Map<string, Acc[]>()
    for (const a of accounts) {
      byId.set(a.id, a)
      if (a.parentId) {
        const list = childrenOf.get(a.parentId) ?? []
        list.push(a)
        childrenOf.set(a.parentId, list)
      }
    }

    // حركة الحسابات من القيود المرحّلة + تجميع شهري للإيرادات/المصروفات
    const deltas = new Map<string, { d: number; c: number }>()
    const monthly = new Map<string, { revenue: number; expense: number }>()
    for (const line of postedLines) {
      const cur = deltas.get(line.accountId) ?? { d: 0, c: 0 }
      cur.d += line.debit
      cur.c += line.credit
      deltas.set(line.accountId, cur)

      const acc = byId.get(line.accountId)
      if (acc && (acc.type === 'REVENUE' || acc.type === 'EXPENSE')) {
        const key = monthKey(line.entry.date)
        const m = monthly.get(key) ?? { revenue: 0, expense: 0 }
        if (acc.type === 'REVENUE') m.revenue += line.credit - line.debit
        else m.expense += line.debit - line.credit
        monthly.set(key, m)
      }
    }

    const ownBalance = (a: Acc): number => {
      const dv = deltas.get(a.id) ?? { d: 0, c: 0 }
      return a.openingBalance + (a.nature === 'CREDIT' ? dv.c - dv.d : dv.d - dv.c)
    }

    const compCache = new Map<string, number>()
    const compBalance = (id: string): number => {
      const cached = compCache.get(id)
      if (cached !== undefined) return cached
      const a = byId.get(id)
      if (!a) {
        compCache.set(id, 0)
        return 0
      }
      let total = ownBalance(a)
      for (const child of childrenOf.get(id) ?? []) total += compBalance(child.id)
      total = r2(total)
      compCache.set(id, total)
      return total
    }
    const balanceByCode = (code: string): number => {
      const acc = accounts.find((x) => x.code === code)
      return acc ? compBalance(acc.id) : 0
    }

    // ==================== مؤشرات KPI ====================
    // الإيراد يزيد بالدائن ويخفض بالمدين (يشمل الحسم الممنوح والمردودات بطبيعة معاكسة)
    // والمصروف يزيد بالمدين — تُجمع الحركات لكل حسابات النوع مباشرة بلا رصيد مركّب بالطبيعة
    let totalRevenue = 0
    let totalExpense = 0
    for (const a of accounts) {
      const dv = deltas.get(a.id)
      if (!dv) continue
      if (a.type === 'REVENUE') totalRevenue += dv.c - dv.d
      else if (a.type === 'EXPENSE') totalExpense += dv.d - dv.c
    }
    totalRevenue = r2(totalRevenue)
    totalExpense = r2(totalExpense)
    const netProfit = r2(totalRevenue - totalExpense)
    const liquidity = r2(balanceByCode('1110') + balanceByCode('1120'))
    const inventoryValue = r2(balanceByCode('1140'))

    // ==================== نقص المخزون ====================
    // نفس مرجعية جرس التنبيهات: رصيد القسم المُسند إليه، وبقسمه غائباً يُجمع رصيدها في كل الأقسام
    const lowStock = items
      .map((it) => {
        const available = it.warehouseId
          ? (it.balances.find((b) => b.warehouseId === it.warehouseId)?.quantity ?? 0)
          : it.balances.reduce((s, b) => s + b.quantity, 0)
        return {
          itemId: it.id,
          itemName: it.name,
          unit: it.unit,
          minStock: it.minStock,
          available: r2(available),
        }
      })
      .filter((it) => it.available < it.minStock)
      .sort((a, b) => a.available - b.available)

    // ==================== الرسم المركب — آخر 6 أشهر ====================
    const now = new Date()
    const chart: { month: string; label: string; revenue: number; expense: number; profit: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = monthKey(d)
      const agg = monthly.get(key) ?? { revenue: 0, expense: 0 }
      const revenue = r2(agg.revenue)
      const expense = r2(agg.expense)
      chart.push({
        month: key,
        label: `${AR_MONTHS[d.getMonth()]}/${d.getFullYear()}`,
        revenue,
        expense,
        profit: r2(revenue - expense),
      })
    }

    // ==================== توزيع الأصول ====================
    const assetsDistribution = [
      { name: 'الصندوق والبنك', value: r2(balanceByCode('1110') + balanceByCode('1120')) },
      { name: 'العملاء', value: r2(balanceByCode('1130')) },
      { name: 'المخزون', value: r2(balanceByCode('1140')) },
      { name: 'أصول ثابتة', value: r2(balanceByCode('1200')) },
    ].filter((s) => s.value > 0.009)

    // ==================== حالات الفواتير ====================
    const invoiceStatusCounts = { PAID: 0, PARTIAL: 0, UNPAID: 0 }
    for (const g of invoiceGroups) {
      if (g.status === 'PAID' || g.status === 'PARTIAL' || g.status === 'UNPAID') {
        invoiceStatusCounts[g.status] = g._count._all
      }
    }

    return NextResponse.json({
      kpis: {
        totalRevenue,
        totalExpense,
        netProfit,
        liquidity,
        inventoryValue,
        customersCount,
        suppliersCount,
        lowStockCount: lowStock.length,
      },
      chart,
      assetsDistribution,
      recentInvoices: recentInvoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        type: inv.type,
        partnerName: inv.partner.name,
        total: r2(inv.total),
        status: inv.status,
        date: inv.date,
      })),
      recentEntries: recentEntriesRaw.map((e) => ({
        id: e.id,
        number: e.number,
        description: e.description,
        totalDebit: r2(e.totalDebit),
        status: e.status,
        date: e.date,
      })),
      recentMovements: recentMovementsRaw.map((mv) => ({
        id: mv.id,
        itemName: mv.item.name,
        type: mv.type,
        quantity: mv.quantity,
        date: mv.date,
        reason: mv.reason,
      })),
      lowStock,
      invoiceStatusCounts,
    })
  } catch (error) {
    console.error('Dashboard API error:', error)
    return NextResponse.json(
      { error: 'تعذر تحميل لوحة التحكم — أعد المحاولة' },
      { status: 500 },
    )
  }
}
