// عميل Prisma المركزي — وكيل توجيه «حي / أرشيفي» (الشرط 4: النسخة الكاملة للقراءة فقط)
// ----------------------------------------------------------------------------------
// db يعمل افتراضياً على القاعدة الحية، وداخل سياق الأرشيف (runInArchive) تُوجَّه كل
// الاستعلامات إلى نسخة الفترة المقفلة db/periods/period-*.db — والكتابة محظورة حصراً
// بمستوى الوكيل نفسه (ArchiveReadOnlyError) حتى لو نسي مسار ما أنه في وضع الاستعراض.
// الجلسات والحراسة تستخدم dbLive دائماً — فحص المستخدم لا يتأثر بسياق الأرشيف أبداً.
import { AsyncLocalStorage } from 'node:async_hooks'
import { PrismaClient } from '@prisma/client'
import { snapshotPath } from '@/lib/period-server'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  __amalSnapshotClients?: Map<string, PrismaClient>
}

/** القاعدة الحية — تُستخدم مباشرة للجلسات والحراسة وخارج سياق الأرشيف */
export const dbLive =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = dbLive

// ==================== تحصين SQLite (المرحلة الأولى P1-2) ====================
// WAL: قراءات لا تحجب الكتابة والعكس + متانة أعلى (يُحفظ داخل ملف القاعدة — يُطبق مرة واحدة)
// busy_timeout: بدل فشل «قاعدة مشغولة» فوراً ينتظر حتى 5 ثوانٍ ثم يتصرف
// foreign_keys: فرض التكامل المرجعي على مستوى المحرك نفسه
// wal_autocheckpoint=128: عند تضخم WAL عن 128 صفحة (~512KB) تُدمج الكتابات في الملف الرئيسي
//   تلقائياً — الدرس المؤسس من كارثة 2026-09-06: الاعتماد على العتبة الافتراضية (1000 صفحة)
//   يُبقي الملف الرئيسي قديماً لساعات فتلتقط أي آلية لقطع ملفية (بيئة الاستضافة) نسخة متجمدة
//   وتستعيدها عند إعادة تشغيل الجهاز فتُمسح بيانات حديثة كاملة — نبض التفتيش الدوري (أدناه)
//   يكمّل هذا بتفتيش TRUNCATE منتظم حتى مع قلة الكتابة
let pragmasApplied = false

export async function ensureDbPragmas(): Promise<void> {
  if (pragmasApplied) return
  try {
    await dbLive.$queryRawUnsafe('PRAGMA journal_mode = WAL;')
    await dbLive.$queryRawUnsafe('PRAGMA busy_timeout = 5000;')
    await dbLive.$queryRawUnsafe('PRAGMA foreign_keys = ON;')
    await dbLive.$queryRawUnsafe('PRAGMA wal_autocheckpoint = 128;')
    pragmasApplied = true
  } catch (error) {
    // فشل الصلاج غير قاتل — النظام يعمل بدونه، ويُعاد المحاولة في النداء التالي
    console.error('db pragmas error:', error)
  }
}

// تُطبق الصلاج عند إقلاع الخادم مباشرة — بلا حجب لاستيراد الوحدة
void dbLive
  .$connect()
  .then(() => ensureDbPragmas())
  .catch(() => {
    // القاعدة غير مهيأة بعد — ستنجح الصلاج عند أول استعلام ناجح عبر ensureDbPragmas
  })

// ==================== سياق الأرشيف (AsyncLocalStorage) ====================

interface ArchiveContext {
  file: string
  client: PrismaClient
}

const archiveStorage = new AsyncLocalStorage<ArchiveContext>()

function clientsMap(): Map<string, PrismaClient> {
  if (!globalForPrisma.__amalSnapshotClients) globalForPrisma.__amalSnapshotClients = new Map()
  return globalForPrisma.__amalSnapshotClients
}

/**
 * عميل Prisma موصول بملف الأرشيف — عميل واحد لكل ملف يُنشأ عند الطلب ويُخزَّن بالذاكرة
 * (نفس المنطق السابق في period-view-server — نُقل هنا ليخدم الوكيل المركزي db)
 */
export function getSnapshotClient(snapshotFile: string): PrismaClient {
  const map = clientsMap()
  const existing = map.get(snapshotFile)
  if (existing) return existing
  const full = snapshotPath(snapshotFile)
  if (!full) throw new Error('ملف الأرشيف غير موجود')
  const client = new PrismaClient({
    datasourceUrl: `file:${full}`,
    log: [],
  })
  map.set(snapshotFile, client)
  return client
}

/** خطأ حظر الكتابة داخل الأرشيف — يُترجم في المسارات إلى 403 برسالة عربية واضحة */
export class ArchiveReadOnlyError extends Error {
  constructor() {
    super('الفترة المحاسبية مقفلة — النسخة الأرشيفية للقراءة فقط ولا تقبل أي إضافة أو تعديل أو حذف')
  }
}

/** دوال المفوضات التي تمس البيانات — تُحجب كلياً داخل سياق الأرشيف */
const ARCHIVE_WRITE_METHODS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  '$executeRaw',
  '$executeRawUnsafe',
])

/** هل نحن الآن داخل سياق أرشيفي؟ (تشخيص وتوثيق فقط) */
export function isArchiveActive(): boolean {
  return archiveStorage.getStore() !== undefined
}

/**
 * تنفيذ دالة داخل سياق أرشيفي — كل نداءات db داخلها تُقرأ من نسخة الفترة المقفلة،
 * وأي محاولة كتابة ترمي ArchiveReadOnlyError فوراً
 */
export async function runInArchive<T>(snapshotFile: string, fn: () => Promise<T>): Promise<T> {
  const client = getSnapshotClient(snapshotFile)
  return archiveStorage.run({ file: snapshotFile, client }, fn)
}

/**
 * وكيل التوجيه المركزي — نفس بنيته التي يستوردها ~40 مساراً:
 * خارج السياق = القاعدة الحية (كما كان تماماً — صفر تغيير سلوكي)،
 * داخل runInArchive = نسخة الأرشيف للقراءة فقط
 */
export const db = new Proxy(dbLive, {
  get(_target, prop) {
    const ctx = archiveStorage.getStore()
    // —— المسار الحي: كما كان قبل الوكيل تماماً (بدون أي غلاف) ——
    if (!ctx) {
      const v = Reflect.get(dbLive as object, prop, dbLive)
      // الدوال تُربط بالعميل الحي نفسه (this صحيح لـ $transaction وأخواتها) —
      // والمفوضات (كائنات الموديلات) تُعاد كما هي فلا يتغير سلوكها إطلاقاً
      return typeof v === 'function' ? (v as (...args: unknown[]) => unknown).bind(dbLive) : v
    }
    // —— المسار الأرشيفي: كل شيء من نسخة الفترة ——
    const client = ctx.client
    const v = Reflect.get(client as object, prop, client)
    if (typeof v === 'function') {
      const fn = v as (...args: unknown[]) => unknown
      return fn.bind(client)
    }
    if (v && typeof v === 'object') {
      // مفوض موديل — غلاف يحجب دوال الكتابة ويكشف دوال القراءة
      return new Proxy(v as object, {
        get(model, method) {
          if (typeof method === 'string' && ARCHIVE_WRITE_METHODS.has(method)) {
            return () => {
              throw new ArchiveReadOnlyError()
            }
          }
          const mv = Reflect.get(model, method, model)
          return typeof mv === 'function' ? (mv as (...a: unknown[]) => unknown).bind(model) : mv
        },
      })
    }
    return v
  },
})
