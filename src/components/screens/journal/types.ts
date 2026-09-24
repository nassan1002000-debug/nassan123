// أنواع بيانات شاشة القيود اليومية

/** حساب مسطّح جاهز للاختيار في القائمة المنسدلة */
export interface FlatAccount {
  id: string
  code: string
  name: string
  type: string
  isActive: boolean
  level: number
  /** المسار الكامل "الوالد › الابن" للبحث */
  label: string
}

export interface CostCenterOption {
  id: string
  code: string
  name: string
}

/** بند مختصر كما ترجعه قائمة القيود */
export interface JournalLineBrief {
  accountId: string
  account: { code: string; name: string }
  costCenterName: string | null
  debit: number
  credit: number
  description: string | null
}

/** قيد كما ترجعه قائمة القيود (للجدول) */
export interface JournalEntryRow {
  id: string
  number: string
  date: string
  description: string
  source: string
  status: string
  totalDebit: number
  totalCredit: number
  linesCount: number
  lines: JournalLineBrief[]
}

/** بند مفصّل كما ترجعه /api/journal/[id] */
export interface JournalLineDetail {
  id: string
  accountId: string
  account: { code: string; name: string; type: string }
  costCenter: { id: string; code: string; name: string } | null
  debit: number
  credit: number
  description: string | null
  order: number
}

/** قيد مفصّل كما ترجعه /api/journal/[id] */
export interface JournalEntryDetail {
  id: string
  number: string
  date: string
  description: string
  source: string
  status: string
  totalDebit: number
  totalCredit: number
  lines: JournalLineDetail[]
}
