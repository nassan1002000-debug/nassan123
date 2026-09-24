// أنواع وأدوات مشتركة لشاشة دليل الحسابات — بناء الشجرة، الأرصدة التراكمية، اتجاه الرصيد، اقتراح الأكواد
import { AR_NATURE } from '@/lib/format'

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
export type AccountNature = 'DEBIT' | 'CREDIT'
export type BalanceDirection = 'DEBIT' | 'CREDIT' | 'ZERO'

// ==================== الأنواع ====================

export interface AccountLink {
  kind: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE' | 'PARTNER'
  id: string
  code: string
}

export interface AccountDTO {
  id: string
  code: string
  name: string
  type: AccountType
  nature: AccountNature
  isSystem: boolean
  isActive: boolean
  openingBalance: number
  parentId: string | null
  postedDebit: number
  postedCredit: number
  /** الملف المرتبط (عميل/مورد/موظف) — حساب فرعي مزامَن مع شاشته — مفرد للتوافق */
  link?: AccountLink | null
  /** تعدد الأدوار: كل ملفات الحساب (موظف + عميل + مورد) — شارات متعددة في الشجرة */
  links?: AccountLink[]
}

export interface TreeNode extends AccountDTO {
  level: number
  children: TreeNode[]
  /** رصيد موقّع باتجاه طبيعة الحساب (موجب = بالطبيعة، سالب = بالطبيعة المعاكسة) — تراكمي مع الأبناء */
  balanceRaw: number
}

export interface AccountIndex {
  roots: TreeNode[]
  /** كل العقد مرتبة DFS بالكود */
  nodes: TreeNode[]
  byId: Map<string, TreeNode>
}

export interface LedgerInvoiceItem {
  itemName: string
  quantity: number
  unitPrice: number
  total: number
}

export interface LedgerLine {
  id: string
  entryId: string
  entryNumber: string
  /** رقم المستند الأصلي الفعلي (فاتورة/سند) — يسقط لرقم القيد ذاته حين لا مستند مستقل */
  documentNumber?: string
  /** اسم الطرف الفعلي للحركة (عميل/مورد/موظف) — مستقل عن اسم الحساب الفرعي */
  partnerName?: string | null
  /** الحساب الفرعي الفعلي — يظهر فقط عند عرض حساب تجميعي يجمع شجرته الفرعية كاملة */
  accountCode?: string
  accountName?: string
  date: string
  description: string
  debit: number
  credit: number
  costCenterName: string | null
  source: string
  balance: number
  balanceDirection: BalanceDirection
  /** بنود المادة (Expandable Rows) — فقط لسطر مصدره فاتورة */
  items?: LedgerInvoiceItem[]
}

export interface LedgerTotals {
  opening: number
  openingDirection: BalanceDirection
  /** مرجع الرصيد الافتتاحي — «رصيد افتتاح الدورة — سند JE-xxxx» عند وجود ترحيل فترة */
  openingRef?: string | null
  totalDebit: number
  totalCredit: number
  closing: number
  closingDirection: BalanceDirection
  count: number
}

export interface LedgerResponse {
  mode: string
  /** مصدر الكشف: GL = حركة القيود المُرحّلة — DOCUMENTS = مستندات الطرف (دفتر الفرع) */
  basedOn?: 'GL' | 'DOCUMENTS'
  /** حساب تجميعي (له حسابات فرعية) — lines تجمع شجرته الفرعية كاملة */
  isAggregate?: boolean
  account: {
    id: string
    code: string
    name: string
    type: AccountType
    nature: AccountNature
    isSystem: boolean
    isActive: boolean
    openingBalance: number
  }
  lines: LedgerLine[]
  totals: LedgerTotals
}

export const ACCOUNT_TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']

/** حسابات التحكم التي تتفرع منها ملفات الأطراف والموظفين — للمزامنة الثنائية مع الشاشات */
export const CONTROL_PARENT_INFO: Record<string, { label: string; fileLabel: string }> = {
  '1130': { label: 'العملاء (ذمم مدينة)', fileLabel: 'عميل' },
  '2110': { label: 'الموردون (ذمم دائنة)', fileLabel: 'مورد' },
  '1150': { label: 'سلف الموظفين', fileLabel: 'موظف' },
}

// ==================== أدوات ====================

/** اشتقاق الطبيعة من النوع: أصول/مصروفات = مدين، الباقي = دائن */
export function natureForType(type: AccountType): AccountNature {
  return type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT'
}

/** هل الرصيد بالاتجاه المعاكس لطبيعة الحساب؟ (يُعرض بنص أحمر) */
export function isOppositeDirection(nature: AccountNature, dir: BalanceDirection): boolean {
  return dir !== 'ZERO' && dir !== nature
}

export function directionLabel(dir: BalanceDirection): string {
  if (dir === 'ZERO') return 'صفر'
  return AR_NATURE[dir] ?? ''
}

/** بناء الشجرة من المصفوفة flat + حساب الأرصدة (الورقيات أولاً ثم صعوداً) */
export function buildAccountIndex(flat: AccountDTO[]): AccountIndex {
  const byId = new Map<string, TreeNode>()
  for (const a of flat) {
    byId.set(a.id, { ...a, level: 0, children: [], balanceRaw: 0 })
  }

  const rawRoots: TreeNode[] = []
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (parent) parent.children.push(node)
    else rawRoots.push(node)
  }

  const byCode = (a: TreeNode, b: TreeNode) => a.code.localeCompare(b.code, 'en', { numeric: true })
  rawRoots.sort(byCode)
  for (const node of byId.values()) node.children.sort(byCode)

  const nodes: TreeNode[] = []
  // تُعيد زيارة كل عقدة إجماليها بفضاء «مدين-موجب» للترحيل للأب، وتعرض balanceRaw
  // بفضاء طبيعة العقدة (موجب = بالاتجاه الطبيعي) — كي تُخصم حسابات عكس الطبيعة
  // (مجاميع الإهلاك/الذمم الدائنة) من أبيها لا أن تضاف إليها إضافة موجبة خاطئة
  const visit = (node: TreeNode, level: number, parent: TreeNode | null): number => {
    node.level = level
    const sign = node.nature === 'DEBIT' ? 1 : -1
    const own = node.openingBalance + sign * (node.postedDebit - node.postedCredit)
    let totalDebit = sign * node.openingBalance + node.postedDebit - node.postedCredit
    for (const child of node.children) totalDebit += visit(child, level + 1, node)
    // حساب الطرف المرتبط (دفتر الفرع): رصيده من مستنداته ويبقى عليه حصراً —
    // ولا يُرحّل لأبيه حساب التحكم إن كان الأب ما يزال يحمل حركاته المجمعة الخاصة
    // (نمط ما قبل ترحيل الفترة) كي لا يتضاعف الرصيد.
    // بعد ترحيل الفترة صار حساب التحكم صفر حركة (الأرصدة على الحسابات الفرعية
    // في سند الافتتاحي) فيُرحّل رصيد الطرف لأبيه فيعود الإجمالي صحيحاً في الشجرة.
    const isParty = !!(node.link || (node.links && node.links.length > 0))
    const parentCarriesOwn = !!parent && (parent.postedDebit !== 0 || parent.postedCredit !== 0)
    if (isParty && parentCarriesOwn) {
      node.balanceRaw = own
      nodes.push(node)
      return 0
    }
    node.balanceRaw = sign * totalDebit
    nodes.push(node)
    return totalDebit
  }
  for (const root of rawRoots) visit(root, 0, null)

  return { roots: rawRoots, nodes, byId }
}

/** شجرة مصغّرة حسب مجموعة المعرفات المرئية (مع الاحتفاظ بالأرصدة الأصلية التراكمية) */
export function buildVisibleTree(nodes: TreeNode[], visible: Set<string> | null): TreeNode[] {
  if (!visible) return nodes
  const copies = new Map<string, TreeNode>()
  for (const n of nodes) {
    if (visible.has(n.id)) copies.set(n.id, { ...n, children: [] })
  }
  const roots: TreeNode[] = []
  for (const n of nodes) {
    const copy = copies.get(n.id)
    if (!copy) continue
    const parentCopy = n.parentId ? copies.get(n.parentId) : undefined
    if (parentCopy) parentCopy.children.push(copy)
    else roots.push(copy)
  }
  return roots
}

/**
 * اقتراح الكود التالي:
 * - مع أب: أكبر كود أخ للأب + 10 (ولو لا أبناء: كود الأب + 10)
 * - بدون أب: أكبر كود ضمن حسابات النوع المختار + 10
 * مع تجاوز أي تعارض بالزيادة 10 حتى كود حر
 */
export function suggestNextCode(
  accounts: AccountDTO[],
  parentId: string | null,
  type: AccountType,
): string {
  const parse = (code: string) => {
    const n = parseInt(code, 10)
    return Number.isFinite(n) ? n : 0
  }
  const exists = (code: string) => accounts.some((a) => a.code === code)

  let base: number
  if (parentId) {
    const siblings = accounts.filter((a) => a.parentId === parentId)
    const maxSibling = siblings.reduce((m, a) => Math.max(m, parse(a.code)), 0)
    if (maxSibling > 0) {
      base = maxSibling + 10
    } else {
      const parent = accounts.find((a) => a.id === parentId)
      base = parse(parent?.code ?? '') + 10
    }
  } else {
    const sameType = accounts.filter((a) => a.type === type)
    const maxOfType = sameType.reduce((m, a) => Math.max(m, parse(a.code)), 0)
    base = maxOfType > 0 ? maxOfType + 10 : 1000
  }

  let code = String(base)
  while (exists(code)) code = String(parse(code) + 10)
  return code
}

/** عمق الحساب في الشجرة (للمسافة البادئة في قائمة اختيار الأب) */
export function accountDepth(accounts: AccountDTO[], id: string): number {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  let depth = 0
  let current = byId.get(id) ?? null
  const seen = new Set<string>()
  while (current && current.parentId && !seen.has(current.parentId)) {
    const parent = byId.get(current.parentId)
    if (!parent) break
    seen.add(parent.id)
    depth += 1
    current = parent
  }
  return depth
}
