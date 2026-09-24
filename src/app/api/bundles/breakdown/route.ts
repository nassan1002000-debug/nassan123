// GET /api/bundles/breakdown — تفصيل مبيعات السلال
// ---------------------------------------------------------------------------------
// جدول الإحصائيات والاستبيان الذي يعرض تفصيلياً: اسم السلة، عدد المرات التي بُيعت فيها،
// وأسماء العملاء الذين اشتروها — محسوب من لقطات بنود الفواتير الفعلية (مصدر الحقيقة)،
// فلا تعتمد على عدادات القوالب ولا تختفي بحذف قالب السلة (الاسم لقطة دائمة بالبنود)
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const round2 = (n: number) => Math.round(n * 100) / 100

export interface BundleCustomerStat {
  code: string
  name: string
  count: number // عدد الفواتير التي اشتراها هذا العميل
}

export interface BundleBreakdownRow {
  bundleId: string
  bundleName: string
  saleCount: number // عدد مرات البيع — عدد فواتير المبيعات التي نزلت منها
  sales: number // قيمة بنود السلة كما رُحّلت (كمية × سعر البند)
  discount: number // الحسومات الممنوحة بسبب السلة
  customers: BundleCustomerStat[]
  lastSaleDate: string | null
}

/** صف حركة واحدة — سلة واحدة ضمن فاتورة واحدة (للجدول التفصيلي القابل للفلترة) */
export interface BundleTransactionRow {
  id: string
  bundleId: string
  bundleName: string
  bundleType: string | null // GIFT | PERCENT | PRICE — null إن حُذف قالب السلة
  invoiceId: string
  date: string
  customerCode: string
  customerName: string
  sales: number
  discount: number
}

export async function GET() {
  try {
    const [lines, bundles] = await Promise.all([
      db.invoiceLine.findMany({
        where: { bundleId: { not: null }, invoice: { isDeleted: false, type: 'SALE' } },
        select: {
          bundleId: true,
          bundleName: true,
          total: true,
          bundleDiscount: true,
          invoice: {
            select: { id: true, date: true, partner: { select: { code: true, name: true } } },
          },
        },
        orderBy: { invoice: { date: 'desc' } },
      }),
      db.bundle.findMany({ select: { id: true, type: true } }),
    ])
    const bundleTypeOf = new Map(bundles.map((b) => [b.id, b.type]))

    // تجميع الحركة على مستوى (سلة × فاتورة) — كل صف يمثل «مرة بيع» واحدة قابلة للفلترة
    // بالتاريخ واسم العميل ونوع السلة، مستقلة عن التجميع الإجمالي أدناه
    interface TxAcc {
      bundleId: string
      bundleName: string
      invoiceId: string
      date: string
      customerCode: string
      customerName: string
      sales: number
      discount: number
    }
    const txAcc = new Map<string, TxAcc>()
    for (const l of lines) {
      const bundleId = l.bundleId ?? 'unknown'
      const key = `${bundleId}:${l.invoice.id}`
      let t = txAcc.get(key)
      if (!t) {
        t = {
          bundleId,
          bundleName: l.bundleName ?? 'سلة محذوفة',
          invoiceId: l.invoice.id,
          date: l.invoice.date ? l.invoice.date.toISOString() : '',
          customerCode: l.invoice.partner.code,
          customerName: l.invoice.partner.name,
          sales: 0,
          discount: 0,
        }
        txAcc.set(key, t)
      }
      t.sales = round2(t.sales + l.total)
      t.discount = round2(t.discount + l.bundleDiscount)
    }
    const transactions: BundleTransactionRow[] = [...txAcc.entries()]
      .map(([key, t]) => ({
        id: key,
        bundleId: t.bundleId,
        bundleName: t.bundleName,
        bundleType: bundleTypeOf.get(t.bundleId) ?? null,
        invoiceId: t.invoiceId,
        date: t.date,
        customerCode: t.customerCode,
        customerName: t.customerName,
        sales: t.sales,
        discount: t.discount,
      }))
      .sort((a, b) => b.date.localeCompare(a.date))

    interface Acc {
      bundleName: string
      invoiceIds: Set<string>
      sales: number
      discount: number
      customers: Map<string, { code: string; name: string; invoiceIds: Set<string> }>
      lastDate: Date | null
    }
    const acc = new Map<string, Acc>()
    for (const l of lines) {
      const key = l.bundleId ?? l.bundleName ?? 'unknown'
      let a = acc.get(key)
      if (!a) {
        a = {
          bundleName: l.bundleName ?? 'سلة محذوفة',
          invoiceIds: new Set(),
          sales: 0,
          discount: 0,
          customers: new Map(),
          lastDate: null,
        }
        acc.set(key, a)
      }
      a.bundleName = l.bundleName ?? a.bundleName
      a.invoiceIds.add(l.invoice.id)
      a.sales = round2(a.sales + l.total)
      a.discount = round2(a.discount + l.bundleDiscount)
      if (l.invoice.date && (!a.lastDate || l.invoice.date > a.lastDate)) a.lastDate = l.invoice.date
      const cKey = l.invoice.partner.code
      const c =
        a.customers.get(cKey) ?? { code: cKey, name: l.invoice.partner.name, invoiceIds: new Set<string>() }
      c.invoiceIds.add(l.invoice.id) // العد بعدد الفواتير لا عدد البنود
      a.customers.set(cKey, c)
    }

    const rows: BundleBreakdownRow[] = [...acc.entries()]
      .map(([bundleId, a]) => ({
        bundleId,
        bundleName: a.bundleName,
        saleCount: a.invoiceIds.size,
        sales: a.sales,
        discount: a.discount,
        customers: [...a.customers.values()]
          .map((c) => ({ code: c.code, name: c.name, count: c.invoiceIds.size }))
          .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name, 'ar')),
        lastSaleDate: a.lastDate ? a.lastDate.toISOString() : null,
      }))
      .sort((x, y) => y.saleCount - x.saleCount || y.sales - x.sales || x.bundleName.localeCompare(y.bundleName, 'ar'))

    const totals = {
      saleCount: rows.reduce((s, r) => s + r.saleCount, 0),
      sales: round2(rows.reduce((s, r) => s + r.sales, 0)),
      discount: round2(rows.reduce((s, r) => s + r.discount, 0)),
    }

    return NextResponse.json({ rows, totals, transactions })
  } catch (error) {
    console.error('GET /api/bundles/breakdown error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب تفصيل مبيعات السلال' }, { status: 500 })
  }
}
