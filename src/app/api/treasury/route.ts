import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureBootstrap } from '@/lib/seed'
import { AR_MONTHS } from '@/lib/format'

export const dynamic = 'force-dynamic'

const METHODS = ['CASH', 'BANK', 'CHEQUE'] as const

export async function GET() {
  try {
    await ensureBootstrap()

    // ===== 1) أرصدة الصندوق والبنك: افتتاحي + Σ(مدين − دائن) على قيود مُرحّلة فقط =====
    const treasuryAccounts = await db.account.findMany({
      where: { code: { in: ['1110', '1120'] } },
      select: {
        code: true,
        openingBalance: true,
        journalLines: {
          where: { entry: { status: 'POSTED' } },
          select: { debit: true, credit: true },
        },
      },
    })

    const balanceOf = (code: string): number => {
      const acc = treasuryAccounts.find((a) => a.code === code)
      if (!acc) return 0
      const net = acc.journalLines.reduce((sum, l) => sum + (l.debit - l.credit), 0)
      return acc.openingBalance + net
    }

    const cash = balanceOf('1110')
    const bank = balanceOf('1120')
    const total = cash + bank

    // ===== حدود الشهر الحالي =====
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)

    // كل السندات (جدول Payment صغير — استعلام واحد يخدم الرسم والتوزيع)
    const allPayments = await db.payment.findMany({
      select: { date: true, type: true, amount: true, method: true },
    })

    // ===== 2) مؤشرات الشهر الحالي =====
    const inCurrentMonth = allPayments.filter((p) => p.date >= monthStart && p.date < monthEnd)
    const receipts = inCurrentMonth
      .filter((p) => p.type === 'RECEIPT')
      .reduce((s, p) => s + p.amount, 0)
    const payments = inCurrentMonth
      .filter((p) => p.type === 'PAYMENT')
      .reduce((s, p) => s + p.amount, 0)
    const net = receipts - payments

    // ===== 3) التدفق النقدي — 6 أشهر =====
    const cashflowChart: { month: string; receipts: number; payments: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
      const rows = allPayments.filter((p) => p.date >= start && p.date < end)
      cashflowChart.push({
        month: `${AR_MONTHS[start.getMonth()]}/${start.getFullYear()}`,
        receipts: rows.filter((r) => r.type === 'RECEIPT').reduce((s, r) => s + r.amount, 0),
        payments: rows.filter((r) => r.type === 'PAYMENT').reduce((s, r) => s + r.amount, 0),
      })
    }

    // ===== 4) توزيع الطرائق (سندات الشهر الحالي — وإن خلت فكل السندات) =====
    const distSource = inCurrentMonth.length > 0 ? inCurrentMonth : allPayments
    const methodDistribution = METHODS.map((m) => ({
      method: m,
      count: distSource.filter((p) => p.method === m).length,
      total: distSource.filter((p) => p.method === m).reduce((s, p) => s + p.amount, 0),
    }))

    // ===== 5) أحدث 8 سندات =====
    const recent = await db.payment.findMany({
      take: 8,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { partner: { select: { name: true } } },
    })
    const recentVouchers = recent.map((v) => ({
      id: v.id,
      number: v.number,
      type: v.type,
      partnerName: v.partner?.name ?? 'بدون شريك',
      amount: v.amount,
      method: v.method,
      date: v.date,
      notes: v.notes,
    }))

    return NextResponse.json({
      balances: { cash, bank, total },
      monthly: { receipts, payments, net },
      cashflowChart,
      methodDistribution,
      recentVouchers,
    })
  } catch (error) {
    console.error('GET /api/treasury error:', error)
    return NextResponse.json(
      { error: 'تعذر تحميل بيانات الصندوق' },
      { status: 500 },
    )
  }
}
