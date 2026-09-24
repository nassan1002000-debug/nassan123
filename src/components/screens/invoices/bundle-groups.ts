// تجميع بنود السلال في فاتورة لمجموعات مُجملة — وحدة نقية مشتركة (Task 36)
// تستعملها: نافذة عرض الفاتورة + الطباعة (القسم العلوي المجمل والملحق السفلي) وملء نموذج التعديل
// كل بند سلة في جدول المواد يظهر سطراً واحداً مجملاً: «سلة عروض: [الاسم]» بعدد السلال
// وفي خانة الإجمالي: إجمالي سعر السلة بعد الخصومات — مع الاحتفاظ بالتفصيل للملحق
import { round2 } from '@/lib/math'

/** الحد الأدنى المشترك لبنود الفاتورة المجمعة — كما تصل من GET /api/invoices/[id] */
export interface GroupableLine {
  /** معرف سطر الفاتورة — يُستعمل مفتاحاً للعرض إن وُجد */
  id?: string
  itemId: string
  itemCode: string
  itemName: string
  warehouseName: string | null
  unitName: string | null
  unitFactor: number
  quantity: number
  unitPrice: number
  total: number
  bundleId: string | null
  bundleName: string | null
  bundleDiscount: number
  bundleQty: number
  bundleGift: boolean
}

/** مادة داخل سلة مجمعة — كميتها لكل سلة واحدة وقيمتها الفعلية (الخارجة من المخزون) */
export interface BundleGroupItem {
  itemId: string
  code: string
  name: string
  warehouseName: string | null
  unitName: string | null
  unitFactor: number
  /** كمية المادة داخل السلة الواحدة */
  qtyPerUnit: number
  /** سعر الوحدة المعتمد في الفاتورة */
  price: number
  /** القيمة الكلية الفعلية = الكمية الكلية (لكل السلال) × السعر — الخارج من المخزون حرفياً */
  lineTotal: number
  /** هل كانت هذه المادة هدية السلة */
  gift: boolean
}

/** مجموعة سلة مجمعة — كما تُعرض في الجداول والطباعة */
export interface BundleGroup {
  bundleId: string
  name: string
  /** عدد السلال */
  qty: number
  /** إجمالي قيمة مواد السلال بأسعار الفاتورة (قبل حسم السلة) */
  gross: number
  /** سعر السلة الواحدة الكلي بموادها */
  grossPerUnit: number
  /** حسم السلة الممنوح لهذه المجموعة */
  discount: number
  /** الصافي بعد الحسم — ما يظهر في خانة الإجمالي */
  net: number
  items: BundleGroupItem[]
}

/** صف عرض مدمج: بند عادي تقليدي أو مجموعة سلة مجملة — بترتيب الفاتورة نفسه */
export type BundleAwareRow =
  | { kind: 'line'; line: GroupableLine }
  | { kind: 'bundle'; group: BundleGroup }

/**
 * تجميع بنود الفاتورة بالترتيب: كل بند بلا سلة يمر كما هو، وبنود كل سلة تتكوم
 * في مجموعة واحدة عند أول بند منها. عدد السلال يُقرأ من لقطة bundleQty المخزنة
 * (كل بنود المجموعة تحمل القيمة نفسها)، وكمية كل مادة داخل السلة = الكمية ÷ عدد السلال.
 */
export function groupBundleLines(lines: GroupableLine[]): BundleAwareRow[] {
  const rows: BundleAwareRow[] = []
  const openGroups = new Map<string, BundleGroup>()

  for (const l of lines) {
    if (!l.bundleId) {
      rows.push({ kind: 'line', line: l })
      continue
    }
    let g = openGroups.get(l.bundleId)
    if (!g) {
      const qty = l.bundleQty >= 1 ? l.bundleQty : 1
      g = {
        bundleId: l.bundleId,
        name: l.bundleName ?? 'سلة عروض',
        qty,
        gross: 0,
        grossPerUnit: 0,
        discount: 0,
        net: 0,
        items: [],
      }
      openGroups.set(l.bundleId, g)
      rows.push({ kind: 'bundle', group: g })
    }
    const qtyPerUnit = g.qty > 0 ? round2(l.quantity / g.qty) : l.quantity
    g.items.push({
      itemId: l.itemId,
      code: l.itemCode,
      name: l.itemName,
      warehouseName: l.warehouseName,
      unitName: l.unitName,
      unitFactor: l.unitFactor,
      qtyPerUnit,
      price: l.unitPrice,
      lineTotal: round2(l.quantity * l.unitPrice),
      gift: l.bundleGift,
    })
    g.gross = round2(g.gross + l.quantity * l.unitPrice)
    g.discount = round2(g.discount + l.bundleDiscount)
  }

  for (const g of openGroups.values()) {
    g.grossPerUnit = g.qty > 0 ? round2(g.gross / g.qty) : g.gross
    g.net = round2(g.gross - g.discount)
  }
  return rows
}

/** عدد مجموعات السلال في بنود الفاتورة — للشارات والتقارير */
export function countBundleGroups(lines: GroupableLine[]): number {
  return new Set(lines.map((l) => l.bundleId).filter((x): x is string => !!x)).size
}
