// أنواع وأدوات شاشة المستودعات — بناء الشجرة الهرمية (4 مستويات) + اقتراح الأكواد + المسار الأبوي
// تمييز الأب عن الأبناء بالألوان: الشامل ذهبي ← مستودع عام برتقالي ← مستودع فرعي أخضر ← قسم أزرق

import type { LucideIcon } from 'lucide-react'
import { Building2, Landmark, Network, Warehouse } from 'lucide-react'

export type WarehouseLevel = 1 | 2 | 3 | 4

export interface WarehouseDTO {
  id: string
  code: string
  name: string
  level: number
  keeperName: string | null
  keeperPhone: string | null
  location: string | null
  notes: string | null
  isActive: boolean
  parentId: string | null
  createdAt: string
  childrenCount: number
  balancesCount: number
  movementsCount: number
  stocktakingsCount: number
}

export interface WarehouseNode extends WarehouseDTO {
  children: WarehouseNode[]
}

export interface WarehouseIndex {
  roots: WarehouseNode[]
  /** كل العقد مرتبة DFS بالكود */
  nodes: WarehouseNode[]
  byId: Map<string, WarehouseNode>
}

// ==================== بيانات المستويات الأربعة ====================

export const LEVEL_META: Record<number, { label: string; short: string; hint: string }> = {
  1: { label: 'المستوى الأول — المستودع الشامل', short: 'المستودع الشامل', hint: 'الجذر الذي يضم جميع مستودعات المؤسسة' },
  2: { label: 'المستوى الثاني — مستودع عام (مدينة)', short: 'مستودع عام', hint: 'مستودع المدينة أو الفرع الإقليمي' },
  3: { label: 'المستوى الثالث — مستودع فرعي (أقسام)', short: 'مستودع فرعي', hint: 'مستودع الأقسام داخل المدينة (مثل قسم المظفات)' },
  4: { label: 'المستوى الرابع — قسم', short: 'قسم', hint: 'القسم النهائي الذي تُسند إليه المواد' },
}

export const MAX_LEVEL = 4

// ==================== الهوية البصرية للمستويات (كما بالصورة المرجعية) ====================

export const LEVEL_ICONS: Record<number, LucideIcon> = {
  1: Landmark, // الشامل — المبنى المؤسسي
  2: Building2, // مستودع عام (مدينة)
  3: Warehouse, // مستودع فرعي (أقسام)
  4: Network, // قسم — أيقونة التفرع
}

export interface LevelStyle {
  /** نقطة المفتاح اللوني */
  dot: string
  /** شارة المستوى على البطاقة */
  badge: string
  /** صندوق الأيقونة الدائري */
  iconBox: string
  /** خلفية البطاقة وإطارها */
  card: string
  /** حلقة التحديد */
  ring: string
}

export const LEVEL_STYLES: Record<number, LevelStyle> = {
  1: {
    dot: 'bg-amber-500',
    badge: 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300',
    iconBox: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    card: 'border-amber-500/40 bg-amber-500/[0.05] hover:border-amber-500/70',
    ring: 'ring-amber-500/50',
  },
  2: {
    dot: 'bg-orange-500',
    badge: 'border-orange-500/40 bg-orange-500/15 text-orange-700 dark:text-orange-300',
    iconBox: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    card: 'border-orange-500/35 bg-orange-500/[0.04] hover:border-orange-500/60',
    ring: 'ring-orange-500/50',
  },
  3: {
    dot: 'bg-emerald-500',
    badge: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    iconBox: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    card: 'border-emerald-500/35 bg-emerald-500/[0.04] hover:border-emerald-500/60',
    ring: 'ring-emerald-500/50',
  },
  4: {
    dot: 'bg-sky-500',
    badge: 'border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300',
    iconBox: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    card: 'border-sky-500/35 bg-sky-500/[0.04] hover:border-sky-500/60',
    ring: 'ring-sky-500/50',
  },
}

// ==================== بناء الشجرة ====================

export function buildWarehouseIndex(flat: WarehouseDTO[]): WarehouseIndex {
  const byId = new Map<string, WarehouseNode>()
  for (const w of flat) {
    byId.set(w.id, { ...w, children: [] })
  }

  const roots: WarehouseNode[] = []
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const byCode = (a: WarehouseNode, b: WarehouseNode) => a.code.localeCompare(b.code, 'en', { numeric: true })
  roots.sort(byCode)
  for (const node of byId.values()) node.children.sort(byCode)

  const nodes: WarehouseNode[] = []
  const visit = (node: WarehouseNode) => {
    nodes.push(node)
    for (const child of node.children) visit(child)
  }
  for (const root of roots) visit(root)

  return { roots, nodes, byId }
}

/** المسار الأبوي من الجذر حتى العقدة (للبطاقة التعريفية) */
export function pathOf(index: WarehouseIndex, id: string): WarehouseNode[] {
  const path: WarehouseNode[] = []
  let current = index.byId.get(id) ?? null
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId ? (index.byId.get(current.parentId) ?? null) : null
  }
  return path
}

// ==================== اقتراح الكود ====================

/** كود الجذر: WH — أبناء الأب: كود الأب + تسلسل (-01, -02, …) */
export function suggestWarehouseCode(flat: WarehouseDTO[], parentId: string | null): string {
  const pad2 = (n: number) => String(n).padStart(2, '0')
  if (!parentId) return 'WH'
  const parent = flat.find((w) => w.id === parentId)
  if (!parent) return ''
  const prefix = `${parent.code}-`
  let maxSeq = 0
  for (const w of flat) {
    if (w.parentId !== parentId || !w.code.startsWith(prefix)) continue
    const suffix = parseInt(w.code.slice(prefix.length), 10)
    if (Number.isFinite(suffix) && suffix > maxSeq) maxSeq = suffix
  }
  return `${prefix}${pad2(maxSeq + 1)}`
}

