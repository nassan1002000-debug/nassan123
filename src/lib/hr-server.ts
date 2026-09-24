// منطق الخادم المشترك للموارد البشرية — أنواع الصفوف الموحدة ومساعدات التحقق والتواريخ
// يستهلكه: /api/employees و /api/salaries و /api/advances و /api/leaves و /api/attendance و /api/bonuses
// الأنماط المتبعة (نمط cost-centers): أخطاء عربية 400/404/409/500 · logAudit داخل معاملة العملية نفسها · كل المبالغ round2

import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { round2 } from '@/lib/journal-server'
import { toWhatsappUrl } from '@/lib/whatsapp'

// ==================== خطأ موجّه للعميل ====================

/**
 * خطأ بحالة HTTP محددة ورسالة عربية — يُرمى قبل المعاملة أو داخلها (فيلغيها بأمان)
 * ويُلتقط في catch كل مسار ليعود للعميل كما هو بدل رسالة 500 العامة
 */
export class HrHttpError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'HrHttpError'
    this.status = status
  }
}

// ==================== ثوابت المجال ====================

export const LEAVE_TYPES = ['ANNUAL', 'SICK', 'UNPAID', 'EMERGENCY'] as const
export type LeaveType = (typeof LEAVE_TYPES)[number]

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export const BONUS_TYPES = ['BONUS', 'DEDUCTION'] as const
export type BonusType = (typeof BONUS_TYPES)[number]

export const PAY_METHODS = ['CASH', 'BANK'] as const
export type PayMethod = (typeof PAY_METHODS)[number]

// ==================== أنواع الصفوف الموحدة (عقد الواجهات) ====================

export interface EmployeeRow {
  id: string
  code: string
  name: string
  position: string
  department: string | null
  phone: string | null
  hireDate: string
  baseSalary: number
  isActive: boolean
  salariesCount: number
  unpaidAdvancesTotal: number
  /** تعدد الأدوار — كود الحساب المرتبط في الشجرة (إن وُجد) */
  accountCode?: string | null
  createdAt: string
  whatsappUrl: string | null
}

export interface SalaryRow {
  id: string
  month: string
  base: number
  bonuses: number
  deductions: number
  net: number
  status: 'PENDING' | 'PAID'
  paidAt: string | null
  employee: { id: string; code: string; name: string; position: string }
  /** رقم القيد المحاسبي المرتبط (refType=SALARY) — null لقسط لم يُصرف بعد أو صُرف بقيمة صفرية بلا قيد */
  journalEntryNumber: string | null
}

export interface AdvanceRow {
  id: string
  date: string
  amount: number
  reason: string | null
  status: string // UNPAID | PAID | SETTLED (بذرة قديمة محتملة)
  employee: { id: string; code: string; name: string }
}

export interface LeaveRow {
  id: string
  type: string // ANNUAL | SICK | UNPAID | EMERGENCY
  from: string
  to: string
  days: number
  reason: string | null
  status: string // PENDING | APPROVED | REJECTED
  employee: { id: string; code: string; name: string }
}

export interface AttendanceRow {
  id: string
  date: string
  checkIn: string | null // HH:MM
  checkOut: string | null // HH:MM
  status: string // PRESENT | ABSENT | LATE | LEAVE
  employee: { id: string; code: string; name: string; position: string }
}

export interface BonusRow {
  id: string
  type: string // BONUS | DEDUCTION
  date: string
  amount: number
  reason: string | null
  employee: { id: string; code: string; name: string }
}

// ==================== التواريخ ====================

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-\d{2}$/
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** بداية اليوم من نص YYYY-MM-DD (منتصف الليل بتوقيت الخادم) */
export function ymdStart(d: string): Date {
  return new Date(`${d}T00:00:00.000`)
}

/** نهاية اليوم من نص YYYY-MM-DD — لفلاتر المدى العلوية */
export function ymdEnd(d: string): Date {
  return new Date(`${d}T23:59:59.999`)
}

/** مدى يوم كامل — القاعدة قد تحفظ تواريخ بتوقيت غير منتصف الليل (بذرة الدوام 10:00) */
export function ymdRange(d: string): { gte: Date; lte: Date } {
  return { gte: ymdStart(d), lte: ymdEnd(d) }
}

/** هل النص تاريخ حقيقي بصيغة YYYY-MM-DD — يرفض 2026-02-30 وما شابه */
export function isValidYMD(s: string): boolean {
  if (!YMD_RE.test(s)) return false
  const d = ymdStart(s)
  if (Number.isNaN(d.getTime())) return false
  const [y, m, day] = s.split('-').map(Number)
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day
}

/** هل النص شهر صالح بصيغة YYYY-MM */
export function isValidMonth(s: string): boolean {
  if (!MONTH_RE.test(s)) return false
  const m = Number(s.slice(5, 7))
  return m >= 1 && m <= 12
}

/** هل النص وقت صالح HH:MM (00:00–23:59) */
export function isValidHHMM(s: string): boolean {
  return HHMM_RE.test(s)
}

/** بداية الشهر YYYY-MM — منتصف ليل أول يوم فيه */
export function monthStart(month: string): Date {
  return ymdStart(`${month}-01`)
}

/** بداية الشهر التالي — حد علوي حصري لفلاتر حركات الشهر (يتجاوز السنوات تلقائياً) */
export function monthEndExclusive(month: string): Date {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return new Date(y, m, 1, 0, 0, 0, 0)
}

/** عدد أيام مدى شامل الطرفين من نصّي YMD — يُحسب من قيم YMD لا من ISO كاملة */
export function daysInclusive(fromYMD: string, toYMD: string): number {
  const diff = ymdStart(toYMD).getTime() - ymdStart(fromYMD).getTime()
  return Math.round(diff / 86_400_000) + 1
}

// ==================== الأكواد التسلسلية ====================

/** الكود التسلسلي الحر التالي لموظف EMP-xxx — نفس منطق CC- في مراكز التكلفة */
export function nextEmployeeCode(existing: { code: string }[]): string {
  let max = 0
  for (const { code } of existing) {
    if (!code.startsWith('EMP-')) continue
    const n = parseInt(code.slice(4), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return `EMP-${String(max + 1).padStart(3, '0')}`
}

// ==================== مساعدات قراءة جسم الطلب ====================

/** نص من الجسم — مقصوص، أو قيمة بديلة إن لم يكن نصاً */
export function bodyString(body: Record<string, unknown>, key: string, fallback = ''): string {
  const v = body[key]
  return typeof v === 'string' ? v.trim() : fallback
}

/** نص اختياري من الجسم — null إن غاب أو كان فارغاً أو ليس نصاً */
export function bodyStringOrNull(body: Record<string, unknown>, key: string): string | null {
  const v = body[key]
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

/** رقم من الجسم — يقبل رقماً أو نصاً رقمياً، وnull إن لم يكن رقماً محدوداً */
export function bodyNumber(body: Record<string, unknown>, key: string): number | null {
  const v = body[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

// ==================== الموظفون — جلب موحد ====================

/** تضمينات صف الموظف: عدّاد الرواتب + سلفه غير المصروفة + الحساب المرتبط (تعدد الأدوار) */
export const EMPLOYEE_INCLUDE = {
  _count: { select: { salaries: true } },
  advances: { where: { status: 'UNPAID' }, select: { amount: true } },
  account: { select: { code: true } },
} satisfies Prisma.EmployeeInclude

export type EmployeeWithAggregates = Prisma.EmployeeGetPayload<{ include: typeof EMPLOYEE_INCLUDE }>

/** توحيد شكل صف الموظف المعاد للواجهات */
export function toEmployeeRow(e: EmployeeWithAggregates): EmployeeRow {
  return {
    id: e.id,
    code: e.code,
    name: e.name,
    position: e.position,
    department: e.department,
    phone: e.phone,
    hireDate: e.hireDate.toISOString(),
    baseSalary: e.baseSalary,
    isActive: e.isActive,
    salariesCount: e._count.salaries,
    unpaidAdvancesTotal: round2(e.advances.reduce((s, a) => s + a.amount, 0)),
    accountCode: e.account?.code ?? null,
    createdAt: e.createdAt.toISOString(),
    whatsappUrl: toWhatsappUrl(e.phone),
  }
}

/** جلب موظف بصيغة الصف الموحدة — null إن غير موجود */
export async function getEmployeeRow(id: string): Promise<EmployeeRow | null> {
  const e = await db.employee.findUnique({ where: { id }, include: EMPLOYEE_INCLUDE })
  return e ? toEmployeeRow(e) : null
}

/** موجز موظف للتحقق من وجوده قبل إنشاء حركاته — null إن غير موجود */
export async function employeeBrief(id: string) {
  return db.employee.findUnique({ where: { id }, select: { id: true, code: true, name: true } })
}
