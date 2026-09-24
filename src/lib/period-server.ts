// إقفال الفترة المحاسبية والتدوير — المنطق المشترك (المحرك + الإنفيذ)
// المنهج المحاسبي الكامل عند الإقفال بتاريخ D:
//  1) نسخة أرشيفية متسقة VACUUM INTO → db/periods/period-*.db (تُعرض للقراءة فقط من شاشة الدخول)
//  2) «سند قيد افتتاحي» بتاريخ D+1 يرحّل أرصدة كل حسابات الميزانية (أصول/التزامات/حقوق ملكية)
//     مع استيعاب نتيجة الفترة (أرباح/خسائر) في حساب «الأرباح المحتجزة» 3200
//  3) تدوير القيود والمستندات التفصيلية: كل ما هو مؤرّخ <= D يُحذف من القاعدة الحية
//     (تعيش كاملة في النسخة الأرشيفية) — الفترة الجديدة تبدأ نظيفة تعتمد حصراً على
//     الأرصدة المدوّرة، مع أرضيات ترقيم تمنع إعادة استخدام أرقام المدوّر (period-doc-rotation)
//  4) بعد الإقفال: يُمنع إنشاء أو تعديل أي مستند مؤرّخ <= آخر تاريخ إقفال عبر assertPeriodOpen
//    (نفس اسم وتوقيع الدالة السابقة — تعمل داخل معاملات الإنشاء فيرمي ويُرجع المعاملة كاملة)
//  5) التراجع عن الإقفال: استعادة النسخة الأرشيفية عبر آلية restore-pending — يخسّر كل ما بعد الإقفال
//  6) حارس النسخ الاحتياطية: يُمنع استرجاع أو تحميل أي نسخة مؤرّخة قبل سند القيد الافتتاحي للفترة الحالية
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import type { Prisma } from '@prisma/client'
import { nextEntryNumber } from '@/lib/journal-server'
import { rotateClosedPeriodDocs, type RotationResult } from '@/lib/period-doc-rotation'
import { verifyPassword } from '@/lib/password'
import { createDbBackup } from '@/lib/backup-server'

const round2 = (n: number): number => Math.round(n * 100) / 100

/** عميل قادر على قراءة الإقفالات والقيود — يعمل مع المعاملة tx أو العميل المباشر db */
export type PeriodClient = Pick<Prisma.TransactionClient, 'periodClose' | 'journalEntry'>

/**
 * خطأ قاعدة عمل: محاولة حفظ/تعديل مستند بتاريخ داخل فترة مقفلة
 * تُصطاد في المسارات لتُعاد 409 برسالتها العربية الكاملة بدل «حدث خطأ» العام
 */
export class PeriodClosedError extends Error {}

/** خطأ تحقق من مدخلات الإقفال — تُعاد للمسار بالحالة المخزنة (400/409) */
export class CloseError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * حرس كلمة سر المدير (شرطا الإقفال والتراجع):
 * الإقفال والتراجع عنه عمليتان جوهريتان لا تكفي فيهما الجلسة — يجب إدخال كلمة سر
 * صحيحة لأحد المستخدمين ذوي دور ADMIN النشطين (المدير) مع كل طلب.
 * رمي CloseError(403) عند الفشل — لا يُلمس أي بيانات.
 */
export async function assertManagerPassword(password: unknown): Promise<void> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new CloseError(400, 'كلمة سر المدير مطلوبة لإتمام هذه العملية')
  }
  const { db } = await import('@/lib/db')
  const admins = await db.user.findMany({
    where: { role: 'ADMIN', isActive: true, passwordHash: { not: null } },
    select: { passwordHash: true },
  })
  if (admins.length === 0) {
    throw new CloseError(409, 'لا يوجد مدير نشط بكلمة مرور محددة — عيّن كلمة سر المدير أولاً من إدارة المستخدمين')
  }
  const ok = admins.some((a) => verifyPassword(password, a.passwordHash as string))
  if (!ok) {
    throw new CloseError(403, 'كلمة سر المدير غير صحيحة — لم يُنفَّذ أي شيء ولم تُمس أي بيانات')
  }
}

/** تحقق من صيغة التاريخ وأنه يوم حقيقي (YYYY-MM-DD) */
export function isValidDayString(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** نهاية يوم التاريخ (23:59:59.999Z) — ليشمل كامل يوم الإقفال */
function dayEnd(day: string): Date {
  return new Date(`${day}T23:59:59.999Z`)
}

/** أول يوم من الفترة الجديدة = الإقفال + 1 (00:00:00.000Z) */
export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** آخر إقفال منفّذ (الأحدث بتاريخ الإقفال) أو null إن لم يوجد */
export async function latestPeriodClose(client: PeriodClient) {
  return client.periodClose.findFirst({ orderBy: { closingDate: 'desc' } })
}

/**
 * التحقق الجوهري: التاريخ الواقع في فترة مقفلة (<= آخر تاريخ إقفال) ⇒ خطأ برسالة عربية واضحة
 * يُستدعى داخل معاملة الإنشاء فيرمي ويُرجع كل شيء — لا أثر جزئي أبداً
 * errorFactory: لرمي نوع الخطأ الخاص بالمسار (مثل InvoiceError) ليُعالج بالرد المناسب
 */
export async function assertPeriodOpen(
  client: PeriodClient,
  date: Date,
  docLabel: string,
  errorFactory?: (message: string) => Error,
): Promise<void> {
  const latest = await latestPeriodClose(client)
  if (!latest) return
  if (date.getTime() > latest.closingDate.getTime()) return
  const message =
    `تعذّر حفظ «${docLabel}» — تاريخه داخل الفترة المقفلة «${latest.label}» ` +
    `(أُقفلت بتاريخ ${latest.closingDate.toISOString().slice(0, 10)}) ولا يجوز إنشاء أو تعديل مستنداتها — ` +
    'يمكن للمدير التراجع عن الإقفال من بطاقة «إقفال الفترة المحاسبية» في الإعدادات'
  throw errorFactory ? errorFactory(message) : new PeriodClosedError(message)
}

/** قيود مسودات مؤرّخة قبل تاريخ الإقفال أو في يومه — شرط الإقفال ألا توجد */
export async function countDraftEntriesBefore(client: PeriodClient, closingDate: string): Promise<number> {
  return client.journalEntry.count({
    where: { status: 'DRAFT', date: { lte: dayEnd(closingDate) } },
  })
}

// ==================== النسخة الأرشيفية ====================

const PERIODS_DIR = path.join(process.cwd(), 'db', 'periods')

/** اسم ملف أرشيفي صالح (basename فقط — حرس ضد أي اجتياز مسار) */
export function isSafeSnapshotName(name: string): boolean {
  return /^[A-Za-z0-9._-]+\.db$/.test(name) && !name.includes('..')
}

/** مسار ملف النسخة الأرشيفية بعد التحقق من سلامة الاسم ووجوده */
export function snapshotPath(name: string): string | null {
  if (!isSafeSnapshotName(name)) return null
  const full = path.join(PERIODS_DIR, name)
  try {
    if (statSync(full).isFile()) return full
  } catch {
    /* غير موجود */
  }
  return null
}

/**
 * التقاط النسخة الأرشيفية المتسقة عبر VACUUM INTO (سكربت backup-db.ts بنمط period)
 * — تعمل خارج أي معاملة قبل بدء عمليات الإقفال، وتُطبع مساراتها من السكربت
 */
export async function takePeriodSnapshot(): Promise<{ file: string; bytes: number }> {
  // داخل العملية عبر node:sqlite — لا تعتمد على وجود bun على PATH
  const file = path.basename(createDbBackup('period'))
  const full = snapshotPath(file)
  if (!full) throw new CloseError(500, `تعذر التحقق من النسخة الأرشيفية المُنتجة (${file})`)
  return { file, bytes: statSync(full).size }
}

// ==================== محرك الإقفال والتدوير ====================

interface OpenLineSpec {
  accountId: string
  debit: number
  credit: number
  description: string
}

export interface CloseOutcome {
  id: string
  label: string
  closingDate: string
  openingDate: string
  openingEntryNumber: string
  rotatedEntries: number
  /** عدّادات تدوير المستندات التفصيلية (فواتير/سندات/حركة مخزون/جرد/HR/نقاط ولاء) */
  rotatedDocs: RotationResult
  snapshotFile: string
  snapshotBytes: number
  netProfit: number
  archiveCopyPath?: string // المسار الإضافي الذي اختاره المدير لحفظ نسخة من الأرشيف (اختياري)
}

/**
 * التحقق المبكر من مسار الحفظ الإضافي المختار (شرط تحديد مسار النسخة المغلقة):
 * يُقبل مسار مطلق أو نسبي، ويُعاد مطلقاً جاهزاً — ويُرمى CloseError(400) عند أي إساءة
 * (طول مبالغ، محرف صفري، ملف موجود مكان المسار، جذر القرص)
 */
export function resolveArchiveCopyDir(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') {
    throw new CloseError(400, 'مسار حفظ النسخة الأرشيفية غير صالح')
  }
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.length > 500 || trimmed.includes('\0')) {
    throw new CloseError(400, 'مسار حفظ النسخة الأرشيفية غير صالح — مسار طويل جداً أو يحوي محارف مرفوضة')
  }
  const abs = path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.join(process.cwd(), trimmed)
  if (abs === path.parse(abs).root) {
    throw new CloseError(400, 'لا يمكن اختيار جذر القرص مساراً لحفظ النسخة الأرشيفية')
  }
  try {
    if (statSync(abs).isFile()) {
      throw new CloseError(400, `المسار «${trimmed}» ملف موجود — اختر مسار مجلد لحفظ النسخة الأرشيفية`)
    }
  } catch (error) {
    if (error instanceof CloseError) throw error
    // غير موجود — سيُنشأ كجديد بعد نجاح الإقفال
  }
  return abs
}

/** نسخة إضافية من النسخة الأرشيفية إلى المسار الذي اختاره المدير — بعد نجاح الإقفال فقط */
export async function copySnapshotToArchiveDir(snapshotFile: string, dirAbs: string): Promise<string> {
  const src = snapshotPath(snapshotFile)
  if (!src) throw new CloseError(500, `تعذر العثور على النسخة الأرشيفية (${snapshotFile}) للنسخ إلى المسار المختار`)
  mkdirSync(dirAbs, { recursive: true })
  let dest = path.join(dirAbs, snapshotFile)
  try {
    if (statSync(dest).isFile()) {
      dest = path.join(dirAbs, snapshotFile.replace(/\.db$/, `-${Date.now()}.db`))
    }
  } catch {
    /* لا ملف بهذا الاسم — الاسم الأصلي يكفي */
  }
  copyFileSync(src, dest)
  try {
    const { chmodSync } = await import('node:fs')
    chmodSync(dest, 0o444)
  } catch {
    /* غير قاتل */
  }
  return dest
}

/**
 * تنفيذ الإقفال والتدوير كاملاً — نسخة أرشيفية ثم معاملة ذرّية واحدة:
 * سند افتتاحي متوازن + حذف القيود المؤرّخة <= تاريخ الإقفال + تسجيل الإقفال + توثيق التدقيق
 * أي فشل داخل المعاملة يرجع كل شيء كما كان (النسخة الأرشيفية تبقى بلا سجل ولا ضرر)
 */
export async function executePeriodClose(input: {
  closingDate: string
  label: string
  username: string
  archivePath?: unknown // مسار اختياري لحفظ نسخة إضافية من الأرشيف خارج النظام
}): Promise<CloseOutcome> {
  const { db } = await import('@/lib/db')
  const { logAudit } = await import('@/lib/audit-server')
  const closingDate = input.closingDate
  const label = input.label.trim()
  const username = input.username
  const archiveCopyDir = resolveArchiveCopyDir(input.archivePath)

  if (!isValidDayString(closingDate)) {
    throw new CloseError(400, 'تاريخ الإقفال غير صالح — أدخل تاريخاً بصيغة YYYY-MM-DD')
  }
  if (label.length < 2 || label.length > 80) {
    throw new CloseError(400, 'اسم الفترة غير صالح — أدخل اسماً بين 2 و 80 محرفاً')
  }
  // لا إقفال بمستقبل — وترتيب زمني صاعد إلزامي بعد آخر إقفال
  const today = new Date().toISOString().slice(0, 10)
  if (closingDate > today) {
    throw new CloseError(400, 'لا يمكن إقفال فترة بتاريخ مستقبلي')
  }
  const latest = await latestPeriodClose(db)
  if (latest && closingDate <= latest.closingDate.toISOString().slice(0, 10)) {
    throw new CloseError(
      409,
      `تاريخ الإقفال يجب أن يكون بعد آخر إقفال (${latest.closingDate.toISOString().slice(0, 10)} — فترة «${latest.label}»)`,
    )
  }
  if (await db.periodClose.findUnique({ where: { label }, select: { id: true } })) {
    throw new CloseError(409, `اسم الفترة «${label}» مستخدم من قبل — اختر اسماً آخر`)
  }
  const drafts = await countDraftEntriesBefore(db, closingDate)
  if (drafts > 0) {
    throw new CloseError(
      409,
      `توجد ${drafts} قيد مسودة مؤرّخة قبل تاريخ الإقفال أو في يومه — رحّلها أو ألغِها من شاشة القيود اليومية ثم أعد الإقفال`,
    )
  }

  // 1) النسخة الأرشيفية — قبل أي تعديل (تعكس الحالة لحظة الإقفال بالضبط)
  const snapshot = await takePeriodSnapshot()

  // 2) المعاملة الذرّية: سند افتتاحي + تدوير القيود والمستندات + تسجيل الإقفال + التدقيق
  const outcome: CloseOutcome = await db.$transaction(async (tx): Promise<CloseOutcome> => {
    const closeEnd = dayEnd(closingDate)
    const openingDay = nextDay(closingDate)
    const openingDate = new Date(`${openingDay}T00:00:00.000Z`)

    // أرصدة الحسابات المرحّلة (قيود مرحّلة فقط — حتى نهاية يوم الإقفال)
    const accounts = await tx.account.findMany({
      select: { id: true, code: true, name: true, type: true },
    })
    const grouped = await tx.journalEntryLine.groupBy({
      by: ['accountId'],
      where: { entry: { status: 'POSTED', date: { lte: closeEnd } } },
      _sum: { debit: true, credit: true },
    })
    const netById = new Map<string, number>()
    for (const g of grouped) {
      netById.set(g.accountId, round2((g._sum.debit ?? 0) - (g._sum.credit ?? 0)))
    }

    // حساب الأرباح المحتجزة — 3200 افتراضياً مع إنشاء نظامي دفاعي إن غاب
    let re = await tx.account.findFirst({
      where: { code: '3200' },
      select: { id: true, code: true, name: true },
    })
    if (!re) {
      const equityRoot = await tx.account.findFirst({
        where: { type: 'EQUITY', parentId: null },
        select: { id: true },
      })
      re = await tx.account.create({
        data: {
          code: '3200',
          name: 'الأرباح المحتجزة',
          type: 'EQUITY',
          nature: 'CREDIT',
          isSystem: true,
          openingBalance: 0,
          parentId: equityRoot?.id ?? null,
        },
        select: { id: true, code: true, name: true },
      })
    }

    // بنود الترحيل: حسابات الميزانية ذات الرصيد غير الصفري (الإيرادات والمصروفات تُستوعب في الأرباح المحتجزة)
    const lines: OpenLineSpec[] = []
    let pnlSum = 0 // مجموع الأرصدة المدينة-الموجبة للإيرادات والمصروفات (سالب = ربح)
    let bsSum = 0
    for (const a of accounts) {
      const net = netById.get(a.id) ?? 0
      if (net === 0) continue
      if (a.type === 'REVENUE' || a.type === 'EXPENSE') {
        pnlSum = round2(pnlSum + net)
        continue
      }
      if (a.id === re.id) continue // الأرباح المحتجزة تُحسم آخراً ببند واحد شامل
      lines.push({
        accountId: a.id,
        debit: net > 0 ? net : 0,
        credit: net < 0 ? round2(-net) : 0,
        description: `رصيد مرحَّل من فترة «${label}» — ${a.name} (${a.code})`,
      })
      bsSum = round2(bsSum + net)
    }
    const profit = round2(-pnlSum) // موجب = صافي ربح (طبيعته دائنة)

    // بند الأرباح المحتجزة: رصيده السابق + نتيجة الفترة = بالنقص تماماً عن مجموع بقية البنود (توازن مزدوج)
    let reValue = round2(-bsSum) // مدين-موجب: موجب = خسارة متراكمة، سالب = أرباح محتجزة
    if (reValue > 0) {
      lines.push({
        accountId: re.id,
        debit: reValue,
        credit: 0,
        description: `الأرباح المحتجزة — ترحيل رصيد فترة «${label}» شامل نتيجتها (صافي خسارة ${reValue.toFixed(2)})`,
      })
    } else if (reValue < 0) {
      lines.push({
        accountId: re.id,
        debit: 0,
        credit: round2(-reValue),
        description: `الأرباح المحتجزة — ترحيل رصيد فترة «${label}» شامل نتيجتها (صافي ربح ${round2(-reValue).toFixed(2)})`,
      })
    }

    // شرط الترحيل الشامل: بند المخزون (1140) يُفصّل مستودعاً مستودعاً — بالكميات والتكاليف
    // القيمة الدفترية للحساب هي المرجع الحاكم للتوازن، والقيم التقديرية من أرصدة الجرد
    // (الكمية × سعر الشراء) تُفصّل بين المستودعات ويمتص بند تسوية أي فرق تقييم
    const inventory = accounts.find((a) => a.code === '1140')
    if (inventory) {
      const invIdx = lines.findIndex((l) => l.accountId === inventory.id)
      if (invIdx >= 0) {
        const invLine = lines[invIdx]
        const invNet = round2(invLine.debit - invLine.credit)
        const balances = await tx.itemBalance.findMany({
          where: { quantity: { not: 0 } },
          select: {
            quantity: true,
            warehouse: { select: { code: true, name: true } },
            item: { select: { code: true, name: true, avgCost: true, purchasePrice: true } },
          },
        })

        // حرس صريح: مادة برصيد بلا تكلفة معروفة تُسقط التفصيل المستودعي كله بصمت
        // (كان الشرط أدناه يتخطاه بلا تحذير فخرج الافتتاحي ببند مخزون واحد مجمّع
        // بدل التفصيل الإلزامي — القسم 8.1 الخطوة 2). الإقفال يتوقف الآن برسالة
        // تسمي المواد بدل أن يمر بقيد ناقص لا يطابق المنهج.
        const uncosted = balances.filter((b) => !(b.item.avgCost > 0 || b.item.purchasePrice > 0))
        if (uncosted.length > 0) {
          const names = [...new Set(uncosted.map((b) => `${b.item.code} ${b.item.name}`))].slice(0, 10)
          throw new CloseError(
            409,
            `تعذّر تفصيل المخزون مستودعاً مستودعاً — ${uncosted.length} رصيداً بلا تكلفة معروفة ` +
              `(${names.join('، ')}${uncosted.length > 10 ? '…' : ''}). ` +
              `صحّح تكلفة هذه المواد قبل الإقفال — لم يُنفَّذ الإقفال ولم تُمس أي بيانات.`,
          )
        }

        const byWarehouse = new Map<string, { name: string; code: string; value: number; items: number }>()
        for (const b of balances) {
          const unit = b.item.avgCost > 0 ? b.item.avgCost : b.item.purchasePrice
          const value = round2(b.quantity * unit)
          if (value === 0) continue
          const key = b.warehouse.code
          const acc = byWarehouse.get(key) ?? { name: b.warehouse.name, code: b.warehouse.code, value: 0, items: 0 }
          acc.value = round2(acc.value + value)
          acc.items += 1
          byWarehouse.set(key, acc)
        }
        const whTotal = round2([...byWarehouse.values()].reduce((s, w) => s + w.value, 0))
        // بعد حرس التكلفة أعلاه لا يبقى سبب مشروع لخلو التفصيل — وخلوّه يعني خللاً
        // في الأرصدة يستوجب الوقوف لا التخطي الصامت
        if (byWarehouse.size === 0 || whTotal === 0) {
          throw new CloseError(
            409,
            `تعذّر تفصيل المخزون مستودعاً مستودعاً — قيمة الأرصدة المقاسة صفر بينما القيمة ` +
              `الدفترية لحساب المخزون ${invNet.toFixed(2)} ل.س. راجع أرصدة الجرد وتكاليف المواد ` +
              `قبل الإقفال — لم يُنفَّذ الإقفال ولم تُمس أي بيانات.`,
          )
        }
        {
          const breakdown: OpenLineSpec[] = [...byWarehouse.values()]
            .sort((a, b) => b.value - a.value)
            .map((w) => ({
              accountId: inventory.id,
              debit: w.value > 0 ? w.value : 0,
              credit: w.value < 0 ? round2(-w.value) : 0,
              description: `رصيد مرحَّل — مخزون مستودع «${w.name}» (${w.code}): ${w.items} صنفاً بقيمة تقديرية ${w.value.toFixed(2)} ل.س حسب أرصدة الجرد`,
            }))
          const diff = round2(invNet - whTotal)
          if (Math.abs(diff) > 0.005) {
            breakdown.push({
              accountId: inventory.id,
              debit: diff > 0 ? diff : 0,
              credit: diff < 0 ? round2(-diff) : 0,
              description: `تسوية فروق تقييم المخزون بين الدفاتر وأرصدة الجرد (${diff.toFixed(2)} ل.س)`,
            })
          }
          lines.splice(invIdx, 1, ...breakdown)
        }
      }
    }

    const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0))
    const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0))
    if (lines.length === 0 || Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new CloseError(500, 'فشل حرس توازن سند الافتتاح — أُلغي الإقفال ولم يُمس أي بيانات')
    }

    // إنشاء السند الافتتاحي — إعادة محاولة عند اصطدام الترقيم التلقائي (نمط شاشة القيود)
    let created: { id: string; number: string } | null = null
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        const number = await nextEntryNumber(tx)
        const entry = await tx.journalEntry.create({
          data: {
            number,
            date: openingDate,
            description: `سند قيد افتتاحي — ترحيل أرصدة فترة «${label}» المنتهية بتاريخ ${closingDate} مع إقفال نتيجتها إلى الأرباح المحتجزة`,
            source: 'OPENING',
            status: 'POSTED',
            refType: 'PERIOD_OPEN',
            totalDebit,
            totalCredit,
            lines: {
              create: lines.map((l, i) => ({
                accountId: l.accountId,
                debit: l.debit,
                credit: l.credit,
                description: l.description,
                order: i,
              })),
            },
          },
          select: { id: true, number: true },
        })
        created = entry
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code !== 'P2002' || attempt === 2) throw error
      }
    }
    if (!created) throw new CloseError(500, 'تعذر توليد رقم سند الافتتاحي — أُلغي الإقفال')

    // تدوير المستندات التفصيلية: كل ما هو مؤرَّخ <= تاريخ الإقفال يُحذف من الحية
    // (فواتير/سندات/حركة مخزون/جرد/تلف/رواتب/سلف/إجازات/دوام/مكافآت/نقاط ولاء)
    // ويعيش كاملاً في النسخة الأرشيفية — فتبدأ الفترة الجديدة نظيفة تماماً
    // تعتمد حصراً على الأرصدة المدوّرة، مع تثبيت أرضيات الترقيم (رقم دُوّر لا يُعاد)
    const rotatedDocs = await rotateClosedPeriodDocs(tx, {
      closeEnd,
      closingMonth: closingDate.slice(0, 7),
      label,
      openingEntryId: created.id,
      openingEntryNumber: created.number,
      openingDay: openingDate,
    })

    // تدوير القيود: القيود المؤرّخة <= تاريخ الإقفال تُحذف من الحية (أسطرها تتساقط Cascade)
    const rotated = await tx.journalEntry.deleteMany({ where: { date: { lte: closeEnd } } })

    // تسجيل الإقفال + توثيق التدقيق داخل المعاملة نفسها
    const record = await tx.periodClose.create({
      data: {
        label,
        closingDate: new Date(`${closingDate}T00:00:00.000Z`),
        openingDate,
        openingEntryId: created.id,
        openingEntryNumber: created.number,
        retainedEarningsCode: re.code,
        snapshotFile: snapshot.file,
        snapshotBytes: snapshot.bytes,
        rotatedEntries: rotated.count,
        closedBy: username,
      },
    })
    await logAudit(tx, {
      action: 'CREATE',
      entity: 'PERIOD_CLOSE',
      entityId: record.id,
      entityNumber: label,
      title: 'إقفال فترة محاسبية وتدوير القيود والمستندات',
      summary:
        `أُقفلت الفترة «${label}» حتى ${closingDate} وأنشئ سند القيد الافتتاحي ${created.number} بتاريخ ${openingDay} ` +
        `ودُوّر ${rotated.count} قيداً و${rotatedDocs.invoices} فاتورة و${rotatedDocs.payments} سنداً ` +
        `و${rotatedDocs.stockMovements} حركة مخزون — النسخة الأرشيفية: ${snapshot.file}`,
      details: {
        'الفترة': label,
        'تاريخ الإقفال': closingDate,
        'سند الافتتاحي': created.number,
        'قيود دُوّرت': rotated.count,
        'فواتير دُوّرت': rotatedDocs.invoices,
        'سندات دُوّرت': rotatedDocs.payments,
        'حركات مخزون دُوّرت': rotatedDocs.stockMovements,
        'أوامر جرد دُوّرت': rotatedDocs.stocktakings,
        'سجلات HR دُوّرت': rotatedDocs.salaries + rotatedDocs.advances + rotatedDocs.leaves + rotatedDocs.attendance + rotatedDocs.bonuses,
        'حركات نقاط ولاء دُوّرت': rotatedDocs.loyaltyDeleted,
        'أرصدة ولاء افتتاحية أُنشئت': rotatedDocs.loyaltyOpeningRows,
        'سلال صُفّرت إحصاؤها': rotatedDocs.bundlesReset,
        'النسخة الأرشيفية': snapshot.file,
        'صافي النتيجة': `${profit.toFixed(2)} (${profit >= 0 ? 'ربح' : 'خسارة'})`,
        'بواسطة': username,
      },
    })

    return {
      id: record.id,
      label,
      closingDate,
      openingDate: openingDay,
      openingEntryNumber: created.number,
      rotatedEntries: rotated.count,
      rotatedDocs,
      snapshotFile: snapshot.file,
      snapshotBytes: snapshot.bytes,
      netProfit: profit,
    }
  })

  // نسخة إضافية إلى المسار الذي اختاره المدير — بعد نجاح المعاملة فقط
  // (فشل النسخ لا يُبطل إقفالاً مكتملاً — يُبلَّغ عنه في الرد ويبقى الأرشيف النظامي سليماً)
  if (archiveCopyDir) {
    try {
      outcome.archiveCopyPath = await copySnapshotToArchiveDir(outcome.snapshotFile, archiveCopyDir)
    } catch (copyError) {
      console.error('period-close: فشل نسخ الأرشيف للمسار المختار:', copyError)
    }
  }
  return outcome
}

// ==================== حارس النسخ الاحتياطية (Backup Guard) ====================

/**
 * طابع زمني النسخة من اسمها (manual-YYYY-MM-DD_HH-MM-SS.db — توقيت الجهاز المحلي)
 * — وإن تعذر التحليل فآخر تعديل للملف — لإحكام حرس «لا استعادة أو تحميل قبل سند الافتتاحي»
 */
export function backupStampMs(name: string, fallbackPath: string): number {
  const m = /^\w+-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.db$/.exec(name)
  if (m) {
    const [, y, mo, d, h, mi, s] = m
    const t = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime()
    if (Number.isFinite(t)) return t
  }
  try {
    return statSync(fallbackPath).mtimeMs
  } catch {
    return 0
  }
}

export interface BackupGuardInfo {
  thresholdMs: number
  label: string
  openingDateISO: string
  openingEntryNumber: string
}

/**
 * حدود حارس النسخ الاحتياطية للفترة الحالية — يُمنع منعاً باتاً استرجاع أو تحميل أي
 * نسخة احتياطية يرجع تاريخها لما قبل تاريخ سند القيد الافتتاحي للفترة الحالية،
 * لمنع إفساد التوازن المالي أو خلط بيانات الفترات. الحد = الأعلى بين تاريخ سند
 * الافتتاحي (D+1) ولحظة تنفيذ الإقفال — يغلق ثغرة إقفالٍ نُفِّذ بعد منتصف الليل
 * (نسخة التُقطت قبله بنفس يوم الافتتاح تحمل بيانات ما قبل الإقفال).
 * null = لا توجد فترة مقفلة بعد — الحارس غير مفعّل.
 */
export async function getBackupGuard(): Promise<BackupGuardInfo | null> {
  const { db } = await import('@/lib/db')
  const latest = await db.periodClose.findFirst({ orderBy: { closingDate: 'desc' } })
  if (!latest) return null
  return {
    thresholdMs: Math.max(latest.openingDate.getTime(), latest.createdAt.getTime()),
    label: latest.label,
    openingDateISO: latest.openingDate.toISOString().slice(0, 10),
    openingEntryNumber: latest.openingEntryNumber,
  }
}

/** رسالة الحجب الموحدة للاسترجاع والتحميل — تُعرض للمدير كما هي */
export function backupGuardMessage(guard: BackupGuardInfo, verb: 'استرجاع' | 'تحميل'): string {
  return (
    `حارس النسخ الاحتياطية: يُمنع منعاً باتاً ${verb} أي نسخة مؤرَّخة قبل تاريخ سند القيد الافتتاحي ` +
    `للفترة الحالية «${guard.label}» (سند ${guard.openingEntryNumber} بتاريخ ${guard.openingDateISO}) ` +
    'لمنع إفساد التوازن المالي أو خلط بيانات الفترات — البيانات التاريخية تُستعرض من أرشيف الفترة المقفلة، ' +
    'وللرجوع إلى ما قبل الإقفال استخدم «التراجع عن الإقفال» من بطاقة إقفال الفترة المحاسبية'
  )
}

// ==================== أسطر سند القيد الافتتاحي (ترحيل الأرصدة) ====================

export interface OpeningLineInfo {
  accountId: string
  debit: number
  credit: number
  description: string | null
  entryNumber: string
  entryDate: Date
}

/**
 * أسطر سند القيد الافتتاحي لآخر فترة مقفلة مفهرسة بالحساب — المصدر الواحد لترحيل
 * أرصدة الأطراف والموظفين بعد تدوير مستنداتهم التفصيلية: رصيد كل طرف في الفترة
 * الجديدة يأتي من سطره في سند الافتتاحي حصراً (بدون فواتيره القديمة).
 * الحسابات غير الموجودة في السند (بلا رصيد مرحّل) لا تدخل الخريطة إطلاقاً.
 * تعمل مع المعاملة tx أو العميل المباشر db.
 */
export async function getOpeningLinesByAccount(
  client: Pick<Prisma.TransactionClient, 'periodClose' | 'journalEntryLine'>,
): Promise<Map<string, OpeningLineInfo>> {
  const latest = await client.periodClose.findFirst({ orderBy: { closingDate: 'desc' } })
  if (!latest) return new Map()
  const lines = await client.journalEntryLine.findMany({
    where: { entryId: latest.openingEntryId },
    select: {
      accountId: true,
      debit: true,
      credit: true,
      description: true,
      entry: { select: { number: true, date: true } },
    },
  })
  const map = new Map<string, OpeningLineInfo>()
  for (const l of lines) {
    map.set(l.accountId, {
      accountId: l.accountId,
      debit: round2(l.debit),
      credit: round2(l.credit),
      description: l.description,
      entryNumber: l.entry.number,
      entryDate: l.entry.date,
    })
  }
  return map
}
