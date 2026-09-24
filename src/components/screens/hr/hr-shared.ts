// أنواع وقواميس ومساعدات مشتركة لشاشات الموارد البشرية الست
// (الموظفون — الرواتب — السلف — الإجازات — الدوام — المكافآت والحسم)
// الأنواع تطابق عقد الـAPI الخلفي: الأخطاء دائماً { error: string } مع 400/404/409/500

// ==================== صفوف الجداول والاستجابات ====================

/** صف ملف الموظف — GET /api/employees */
export interface EmployeeRow {
  id: string
  code: string
  name: string
  position: string
  department: string | null
  phone: string | null
  hireDate: string // ISO
  baseSalary: number
  isActive: boolean
  salariesCount: number
  unpaidAdvancesTotal: number
  /** تعدد الأدوار — كود الحساب المرتبط في الشجرة (إن وُجد) */
  accountCode?: string | null
  createdAt: string
  /** رابط واتساب جاهز من رقم الهاتف — null إن كان الهاتف غائباً أو غير منطقي */
  whatsappUrl: string | null
}

/** صف قسط راتب داخل بطاقة الموظف — GET /api/employees/[id] (بلا employee، بطاقة موظف واحد) */
export interface EmployeeSalaryHistoryRow {
  id: string
  month: string
  base: number
  bonuses: number
  deductions: number
  net: number
  status: 'PENDING' | 'PAID'
  paidAt: string | null
}

/** صف سلفة داخل بطاقة الموظف — GET /api/employees/[id] */
export interface EmployeeAdvanceHistoryRow {
  id: string
  date: string
  amount: number
  reason: string | null
  status: string
}

/** بطاقة الموظف الكاملة — GET /api/employees/[id] */
export interface EmployeeDetailResponse {
  employee: EmployeeRow
  salaries: EmployeeSalaryHistoryRow[]
  advances: EmployeeAdvanceHistoryRow[]
}

export interface EmployeesStats {
  total: number
  active: number
  monthlyPayroll: number
  unpaidAdvancesTotal: number
}

export interface EmployeesResponse {
  employees: EmployeeRow[]
  stats: EmployeesStats
}

/** صف قسط راتب — GET /api/salaries?month=YYYY-MM */
export interface SalaryRow {
  id: string
  month: string // YYYY-MM
  base: number
  bonuses: number
  deductions: number
  net: number
  status: 'PENDING' | 'PAID'
  paidAt: string | null
  employee: { id: string; code: string; name: string; position: string }
}

export interface SalariesStats {
  count: number
  totalBase: number
  totalBonuses: number
  totalDeductions: number
  totalNet: number
  paidCount: number
  paidTotal: number
  pendingCount: number
  pendingTotal: number
}

export interface SalariesResponse {
  salaries: SalaryRow[]
  stats: SalariesStats
}

/** صف سلفة — GET /api/advances */
export interface AdvanceRow {
  id: string
  date: string // ISO
  amount: number
  reason: string | null
  status: 'UNPAID' | 'PAID'
  employee: { id: string; code: string; name: string }
}

export interface AdvancesStats {
  count: number
  unpaidCount: number
  unpaidTotal: number
  paidTotal: number
}

export interface AdvancesResponse {
  advances: AdvanceRow[]
  stats: AdvancesStats
}

/** صف طلب إجازة — GET /api/leaves */
export type LeaveType = 'ANNUAL' | 'SICK' | 'UNPAID' | 'EMERGENCY'

export interface LeaveRow {
  id: string
  type: LeaveType
  from: string // ISO
  to: string // ISO
  days: number
  reason: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  employee: { id: string; code: string; name: string }
}

export interface LeavesStats {
  count: number
  pending: number
  approvedDays: number
  rejected: number
}

export interface LeavesResponse {
  leaves: LeaveRow[]
  stats: LeavesStats
}

/** صف دوام — GET /api/attendance?date=YYYY-MM-DD */
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE'

export interface AttendanceRow {
  id: string
  date: string // ISO
  checkIn: string | null // HH:MM
  checkOut: string | null // HH:MM
  status: AttendanceStatus
  employee: { id: string; code: string; name: string; position: string }
}

export interface AttendanceStats {
  present: number
  absent: number
  late: number
  leave: number
  total: number
}

export interface AttendanceResponse {
  attendance: AttendanceRow[]
  stats: AttendanceStats
}

/** صف مكافأة/حسم — GET /api/bonuses */
export type BonusType = 'BONUS' | 'DEDUCTION'

export interface BonusRow {
  id: string
  type: BonusType
  date: string // ISO
  amount: number
  reason: string | null
  employee: { id: string; code: string; name: string }
}

export interface BonusesStats {
  bonusTotal: number
  deductionTotal: number
  count: number
}

export interface BonusesResponse {
  records: BonusRow[]
  stats: BonusesStats
}

// ==================== قواميس التسميات الخاصة بالموارد البشرية ====================

/** حالة قسط الراتب — PENDING/PAID (غير الموجودة في format.ts) */
export const AR_SALARY_STATUS: Record<string, string> = {
  PENDING: 'قيد الصرف',
  PAID: 'مصروف',
}

/** نوع سجل المكافآت والحسم */
export const AR_BONUS_TYPE: Record<string, string> = {
  BONUS: 'مكافأة',
  DEDUCTION: 'حسم',
}

// ==================== مساعدات مشتركة ====================

/** طريقة الصرف — قسط رواتب أو سلفة */
export type PayMethod = 'CASH' | 'BANK'

/** خيار الموظف في قوائم Select داخل نوافذ النماذج */
export interface EmployeeOption {
  id: string
  code: string
  name: string
}

/**
 * جلب الموظفين النشطين لتعبئة قوائم الاختيار في نوافذ النماذج
 * (سلف/إجازات/دوام/مكافآت) — يرمي خطأ برسالة عربية عند الفشل
 */
export async function fetchEmployeeOptions(): Promise<EmployeeOption[]> {
  const res = await fetch('/api/employees?status=ACTIVE')
  const data = (await res.json().catch(() => null)) as EmployeesResponse | { error?: string } | null
  if (!res.ok || !data || !('employees' in data)) {
    throw new Error((data as { error?: string } | null)?.error ?? 'تعذر جلب قائمة الموظفين')
  }
  return data.employees.map((e) => ({ id: e.id, code: e.code, name: e.name }))
}
