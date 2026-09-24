import { db } from './db'
import { hashPassword } from './password'
import { type Prisma, type PrismaClient } from '@prisma/client'

// ============ تهيئة النظام — بلا أي بيانات تشغيلية ============
// المصدر الوحيد للهيكل الأساسي (الإعدادات + المستخدمون + دليل الحسابات):
// • ensureBootstrap — يُنشئ الهيكل عند أول تشغيل فقط إذا غاب
// • resetEnteredData — تفريغ كل البيانات المدخلة نهائياً مع إعادة بناء الهيكل (فترة جديدة)
// البيانات التشغيلية (فواتير/سندات/قيود/أصناف/أطراف/موظفون...) يُدخلها المستخدم من الشاشات

/** نوع العميل المقبول — PrismaClient أو عميل معاملة تفاعلية */
type DbClient = Prisma.TransactionClient | PrismaClient

interface BaseAccountSpec {
  code: string
  name: string
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
  nature: 'DEBIT' | 'CREDIT'
  parent: string | null
  system?: boolean
}

// ============ دليل الحسابات الأساسي (25 حساباً) ============
// الأرصدة الافتتاحية صفر — تُثبت المستخدم عبر قيد افتتاحي عند بدء الاستخدام الفعلي
const BASE_ACCOUNTS: BaseAccountSpec[] = [
  // الأصول
  { code: '1000', name: 'الأصول', type: 'ASSET', nature: 'DEBIT', parent: null, system: true },
  { code: '1100', name: 'الأصول المتداولة', type: 'ASSET', nature: 'DEBIT', parent: '1000', system: true },
  { code: '1110', name: 'الصندوق', type: 'ASSET', nature: 'DEBIT', parent: '1100' },
  { code: '1120', name: 'البنك - مصرف الشام', type: 'ASSET', nature: 'DEBIT', parent: '1100' },
  { code: '1130', name: 'العملاء (ذمم مدينة)', type: 'ASSET', nature: 'DEBIT', parent: '1100' },
  { code: '1140', name: 'المخزون', type: 'ASSET', nature: 'DEBIT', parent: '1100' },
  { code: '1200', name: 'الأصول الثابتة', type: 'ASSET', nature: 'DEBIT', parent: '1000', system: true },
  { code: '1210', name: 'أثاث ومفروشات', type: 'ASSET', nature: 'DEBIT', parent: '1200' },
  { code: '1220', name: 'سيارات ونقل', type: 'ASSET', nature: 'DEBIT', parent: '1200' },
  // الالتزامات
  { code: '2000', name: 'الالتزامات', type: 'LIABILITY', nature: 'CREDIT', parent: null, system: true },
  { code: '2100', name: 'الالتزامات المتداولة', type: 'LIABILITY', nature: 'CREDIT', parent: '2000', system: true },
  { code: '2110', name: 'الموردون (ذمم دائنة)', type: 'LIABILITY', nature: 'CREDIT', parent: '2100' },
  { code: '2120', name: 'ضريبة القيمة المضافة', type: 'LIABILITY', nature: 'CREDIT', parent: '2100' },
  // حقوق الملكية
  { code: '3000', name: 'حقوق الملكية', type: 'EQUITY', nature: 'CREDIT', parent: null, system: true },
  { code: '3100', name: 'رأس المال', type: 'EQUITY', nature: 'CREDIT', parent: '3000' },
  { code: '3200', name: 'الأرباح المحتجزة', type: 'EQUITY', nature: 'CREDIT', parent: '3000' },
  // الإيرادات
  { code: '4000', name: 'الإيرادات', type: 'REVENUE', nature: 'CREDIT', parent: null, system: true },
  { code: '4100', name: 'إيرادات المبيعات', type: 'REVENUE', nature: 'CREDIT', parent: '4000' },
  // المصروفات
  { code: '5000', name: 'المصروفات', type: 'EXPENSE', nature: 'DEBIT', parent: null, system: true },
  { code: '5100', name: 'تكلفة المبيعات', type: 'EXPENSE', nature: 'DEBIT', parent: '5000' },
  { code: '5200', name: 'رواتب وأجور', type: 'EXPENSE', nature: 'DEBIT', parent: '5000' },
  { code: '5300', name: 'إيجارات', type: 'EXPENSE', nature: 'DEBIT', parent: '5000' },
  { code: '5400', name: 'كهرباء وماء ووقود', type: 'EXPENSE', nature: 'DEBIT', parent: '5000' },
  { code: '5500', name: 'اتصالات وإنترنت', type: 'EXPENSE', nature: 'DEBIT', parent: '5000' },
  { code: '5600', name: 'مصاريف نقل وتوصيل', type: 'EXPENSE', nature: 'DEBIT', parent: '5000' },
]

/** إنشاء دليل الحسابات الأساسي — الأب قبل الابن حسب ترتيب القائمة (يعمل داخل أي معاملة) */
async function createBaseAccounts(tx: DbClient): Promise<void> {
  const idByCode = new Map<string, string>()
  for (const a of BASE_ACCOUNTS) {
    const created = await tx.account.create({
      data: {
        code: a.code,
        name: a.name,
        type: a.type,
        nature: a.nature,
        isSystem: a.system ?? false,
        openingBalance: 0,
        parentId: a.parent ? (idByCode.get(a.parent) ?? null) : null,
      },
    })
    idByCode.set(a.code, created.id)
  }
}

const DEFAULT_SETTINGS: { key: string; value: string }[] = [
  { key: 'companyName', value: 'شركة الأمل التجارية 2026' },
  { key: 'exchangeRate', value: '130' },
  { key: 'currency', value: 'SYP' },
]

// المستخدمون الافتراضيون — بكلمات مرور أولية يجب تغييرها من شاشة المستخدمين بعد أول دخول
// mustChangePassword: true (P1-3) — يُجبر حاملها على تغييرها قبل استخدام النظام
const DEFAULT_USERS = [
  {
    username: 'admin',
    name: 'مدير النظام',
    role: 'ADMIN',
    passwordHash: hashPassword('admin123'),
    mustChangePassword: true,
  },
  {
    username: 'accountant',
    name: 'سارة محمود',
    role: 'ACCOUNTANT',
    passwordHash: hashPassword('acc123'),
    mustChangePassword: true,
  },
  {
    username: 'viewer',
    name: 'مشاهد التقارير',
    role: 'VIEWER',
    passwordHash: hashPassword('view123'),
    mustChangePassword: true,
  },
]

/**
 * تهيئة أول تشغيل — تُنشئ الهيكل الأساسي إذا غاب فقط ولا تلمس أي بيانات قائمة
 * تُستدعى من واجهات القراءة (مثل treasury) كضمان ألا يظهر النظام فارغ الهيكل إطلاقاً
 */
export async function ensureBootstrap(): Promise<void> {
  const accounts = await db.account.count().catch(() => 0)
  if (accounts > 0) return

  // الإعدادات — تُنشأ المفاتيح الغائبة فقط (الشعار والإعدادات المدخلة لا تُمس)
  const existing = await db.setting.findMany({ select: { key: true } })
  const have = new Set(existing.map((s) => s.key))
  const missing = DEFAULT_SETTINGS.filter((s) => !have.has(s.key))
  if (missing.length > 0) await db.setting.createMany({ data: missing })

  // المستخدمون — فقط في وضع ما قبل أول دخول (قاعدة بلا حسابات)
  if ((await db.user.count()) === 0) {
    await db.user.createMany({ data: DEFAULT_USERS })
  }

  // دليل الحسابات الأساسي
  await createBaseAccounts(db)
}

/**
 * تفريغ كل البيانات المدخلة نهائياً — بداية نظيفة لفترة جديدة
 * يبقي: المستخدمين + الإعدادات (بما فيها الشعار وبيانات الشركة)
 * ويعيد بناء دليل الحسابات الأساسي (25 حساباً) بصلاحية الافتتاح صفر
 * لا يُستدعى إلا من /api/reset — إداري فقط مع تأكيد صريح، وتُمسح سجلات التدقيق القديمة أخيراً
 *
 * P1-4 (ذرّية التفريغ): كل المسح وإعادة البناء داخل معاملة واحدة —
 * قطع الخادم أو فشل أي خطوة يعيد القاعدة كما كانت (لا نصف حالة أبداً)
 */
export async function resetEnteredData(): Promise<Record<string, number>> {
  return db.$transaction(async (tx) => {
    const counts: Record<string, number> = {}
    const wipe = async (key: string, op: () => Promise<{ count: number }>) => {
      counts[key] = (await op()).count
    }

    // ترتيب يرضي مفاتيح العلاقات: التفاصيل قبل رؤوسها، والأطراف قبل حساباتها الفرعية
    await wipe('invoiceLines', () => tx.invoiceLine.deleteMany())
    await wipe('invoices', () => tx.invoice.deleteMany())
    await wipe('payments', () => tx.payment.deleteMany())
    await wipe('stocktakingLines', () => tx.stocktakingLine.deleteMany())
    await wipe('stocktakings', () => tx.stocktaking.deleteMany())
    await wipe('stockMovements', () => tx.stockMovement.deleteMany())
    await wipe('itemBalances', () => tx.itemBalance.deleteMany())
    await wipe('itemImages', () => tx.itemImage.deleteMany())
    await wipe('itemUnits', () => tx.itemUnit.deleteMany())
    // سلال العروض الترويجية — قوالب وهياكل كباقي المواد/المستودعات، تُمسح بالكامل هنا
    // (لا تُصفَّر إحصاءاتها فقط كما في التصفير المالي الذي يحتفظ بالهياكل)؛ كانت تُفقَد
    // من هذا التفريغ الشامل فتبقى totalSales/saleCount/totalDiscount من بيانات محذوفة
    await wipe('bundleItems', () => tx.bundleItem.deleteMany())
    await wipe('bundles', () => tx.bundle.deleteMany())
    await wipe('items', () => tx.item.deleteMany())
    await wipe('itemGroups', () => tx.itemGroup.deleteMany())
    await wipe('warehouses', () => tx.warehouse.deleteMany())
    await wipe('salaries', () => tx.salary.deleteMany())
    await wipe('advances', () => tx.advance.deleteMany())
    await wipe('leaves', () => tx.leave.deleteMany())
    await wipe('attendance', () => tx.attendance.deleteMany())
    await wipe('bonuses', () => tx.bonusDeduction.deleteMany())
    await wipe('employees', () => tx.employee.deleteMany())
    await wipe('partners', () => tx.partner.deleteMany())
    await wipe('journalLines', () => tx.journalEntryLine.deleteMany())
    await wipe('journalEntries', () => tx.journalEntry.deleteMany())
    await wipe('periodCloses', () => tx.periodClose.deleteMany())
    await wipe('costCenters', () => tx.costCenter.deleteMany())
    await wipe('accounts', () => tx.account.deleteMany())

    // إعادة بناء الهيكل المحاسبي الأساسي — داخل المعاملة نفسها
    await createBaseAccounts(tx)
    counts.accountsAfter = await tx.account.count()

    // سجلات التدقيق القديمة أخيراً — الحركة الجديدة للتفريغ نفسه تُكتب بعده في المسار
    await wipe('auditLogs', () => tx.auditLog.deleteMany())

    return counts
  })
}

/**
 * التصفير المالي مع الاحتفاظ بالهياكل — بداية عمل مالي جديد فوق البيانات الرئيسية نفسها
 * يمسح فقط الحركات المالية والمخزنية: الفواتير وسطورها، السندات (القبض/الصرف)، القيود وسطورها،
 * حركات المخزون، عمليات الجرد، أرصدة المواد، إقفالات الفترات، والحركات المالية للموظفين (رواتب/سلف/مكافآت)
 * ويحافظ حرفياً دون أي تعديل على: أسماء العملاء والموردين والشركاء، بطاقات المواد (وصورها ووحداتها ومجموعاتها)،
 * شجرة الحسابات الهرمية كاملة، هيكل المستودعات الهرمي، الموظفون، مراكز التكلفة، المستخدمون والإعدادات وسجل التدقيق
 * مع «مفرغة الأرصدة»: أرصدة الحسابات الافتتاحية تُصفَّر صفراً وأرصدة المواد تُمسح (تُبنى صفرية مع أول حركة)
 * لا يُستدعى إلا من /api/reset (وضع FINANCIAL) — إداري فقط بعد تحقق كلمة مرور المدير
 * ذرّية كاملة: كل المسح داخل معاملة واحدة — أي فشل يعيد القاعدة كما كانت
 */
export async function financialResetKeepStructures(): Promise<Record<string, number>> {
  return db.$transaction(async (tx) => {
    const counts: Record<string, number> = {}
    const wipe = async (key: string, op: () => Promise<{ count: number }>) => {
      counts[key] = (await op()).count
    }

    // ترتيب يرضي مفاتيح العلاقات: التفاصيل قبل رؤوسها
    await wipe('invoiceLines', () => tx.invoiceLine.deleteMany())
    await wipe('invoices', () => tx.invoice.deleteMany())
    await wipe('payments', () => tx.payment.deleteMany())
    await wipe('journalLines', () => tx.journalEntryLine.deleteMany())
    await wipe('journalEntries', () => tx.journalEntry.deleteMany())
    await wipe('periodCloses', () => tx.periodClose.deleteMany())
    await wipe('stocktakingLines', () => tx.stocktakingLine.deleteMany())
    await wipe('stocktakings', () => tx.stocktaking.deleteMany())
    await wipe('stockMovements', () => tx.stockMovement.deleteMany())
    await wipe('itemBalances', () => tx.itemBalance.deleteMany())
    await wipe('salaries', () => tx.salary.deleteMany())
    await wipe('advances', () => tx.advance.deleteMany())
    await wipe('bonuses', () => tx.bonusDeduction.deleteMany())
    // حركات نقاط الولاء التجريبية — كشوف النقاط تبدأ بيضاء مع أول فاتورة حقيقية
    await wipe('loyaltyTransactions', () => tx.loyaltyTransaction.deleteMany())
    // سجلات الموارد البشرية غير المالية (الإجازات والحضور) — حركة تشغيلية تُصفَّر مع باقي الحركة
    await wipe('leaves', () => tx.leave.deleteMany())
    await wipe('attendance', () => tx.attendance.deleteMany())

    // «مفرغة الأرصدة» — الهيكل يبقى كما هو والأرصدة صفر جاهزة للعمل الفعلي
    counts.accountsZeroed = (await tx.account.updateMany({ data: { openingBalance: 0 } })).count
    // إحصاءات السلال التاريخية تُصفَّر (النماذج تظل كما هي مع بياناتها ووحداتها)
    counts.bundlesZeroed = (
      await tx.bundle.updateMany({ data: { totalSales: 0, saleCount: 0, totalDiscount: 0 } })
    ).count
    // سعر الشراء التلقائي مستمد من آخر فاتورة مشتريات — يُصفَّر كي لا يتسرب رقم من الحركة المقفّرة
    // (يُعاد احتسابه آلياً مع أول فاتورة شراء حقيقية)
    counts.itemsPurchasePriceZeroed = (await tx.item.updateMany({ data: { purchasePrice: 0 } })).count

    // إثبات الحماية — ما بقي دون لمس يُوثق في الاستجابة وسجل التدقيق
    counts.partnersKept = await tx.partner.count()
    counts.itemsKept = await tx.item.count()
    counts.warehousesKept = await tx.warehouse.count()
    counts.accountsKept = await tx.account.count()
    counts.employeesKept = await tx.employee.count()

    return counts
  })
}
