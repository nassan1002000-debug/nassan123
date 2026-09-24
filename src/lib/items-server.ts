// أدوات خادم مشتركة لواجهات المواد — التحقق، الترقيم التلقائي، إدارة ملفات الصور
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { unlink } from 'fs/promises'
import path from 'path'
import { UPLOADS_DIR } from '@/lib/uploads'
import { nextSequentialNumber } from '@/lib/math'

export { UPLOADS_DIR }
export const MAX_IMAGES = 10
export const MAX_UNITS = 3 // وحدات المادة (أُلغي مفهوم «الوحدة الأساسية» — كل الوحدات متساوية)

/** حذف ملفات صور من القرص (تنظيف) — data URLs (الصور داخل القاعدة منذ Task 28) تُتخطى */
export async function removeFiles(urls: string[]) {
  for (const raw of urls) {
    if (String(raw).startsWith('data:')) continue
    const name = path.basename(decodeURIComponent(String(raw)))
    if (!name || name.startsWith('.')) continue
    await unlink(path.join(UPLOADS_DIR, name)).catch(() => undefined)
  }
}

/** سقف حجم data URL الصورة المخزنة في القاعدة (محارف) — متزامن مع سقف /api/upload */
const MAX_IMAGE_DATA_URL = 2_500_000

/**
 * تحقق صارم من data URL الصورة قبل قبولها في القاعدة:
 * صيغة صورة معروفة (webp/png/jpeg/gif) + ترميز base64 خالص + سقف حجم
 * — يمنع زرع أي محتوى غير صور تحت غطاء data:
 */
export function isValidImageDataUrl(url: string): boolean {
  if (url.length > MAX_IMAGE_DATA_URL) return false
  const m = /^data:image\/(webp|png|jpeg|gif);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(url)
  return m !== null
}

/** رقم البطاقة التالي = الأكبر الحالي + 1 (I-001، I-002، …) */
export function nextCodeFrom(codes: string[]): string {
  return nextSequentialNumber('I-', codes, 3)
}

interface IncomingImage {
  id?: string
  url?: string
  fileName?: string
  isPrimary?: boolean
}

interface IncomingUnit {
  id?: string
  name?: string
  factor?: number | string
  barcode?: string
  isActive?: boolean
}

export interface ParsedPayload {
  name: string
  barcode: string | null
  description: string | null
  salePrice: number
  taxRate: number
  minStock: number
  maxStock: number
  location: string | null
  isActive: boolean
  warehouseId: string | null
  images: { url: string; fileName: string; isPrimary: boolean }[]
  units: { name: string; factor: number; barcode: string | null; isActive: boolean }[]
}

/** تحقق موحّد وتجهيز الحمولة للإنشاء/التعديل */
export async function parsePayload(
  body: Record<string, unknown>,
  currentItemId?: string,
): Promise<{ data?: ParsedPayload; error?: string; status?: number }> {
  const name = typeof body.name === 'string' ? body.name.trim() : ''

  if (!name) return { error: 'اسم المادة مطلوب', status: 400 }

  // منع تكرار الاسم (مع السماح للمادة نفسها عند التعديل)
  const duplicate = await db.item.findFirst({
    where: { name, ...(currentItemId ? { id: { not: currentItemId } } : {}) },
    select: { id: true, code: true },
  })
  if (duplicate) {
    return { error: `اسم المادة "${name}" مستخدم مسبقاً في البطاقة ${duplicate.code}`, status: 409 }
  }

  const num = (v: unknown, fallback = 0): number => {
    const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }

  // رمز الباركود — اختياري لكن لا يجوز تكراره بين المواد
  let barcode: string | null = null
  const rawBarcode = typeof body.barcode === 'string' ? body.barcode.trim() : ''
  if (rawBarcode) {
    const taken = await db.item.findFirst({
      where: { barcode: rawBarcode, ...(currentItemId ? { id: { not: currentItemId } } : {}) },
      select: { id: true, code: true },
    })
    if (taken) {
      return { error: `رمز الباركود «${rawBarcode}» مستخدم مسبقاً في البطاقة ${taken.code}`, status: 409 }
    }
    barcode = rawBarcode
  }

  const salePrice = num(body.salePrice)
  const taxRate = Math.min(num(body.taxRate), 100)
  const minStock = num(body.minStock)
  const maxStock = num(body.maxStock)
  // الحدّان إلزاميان للحفظ — مرتبطان بجرس تنبيهات المخزون
  if (minStock <= 0) {
    return { error: 'الحد الأدنى للمخزون إلزامي — أدخل قيمة أكبر من صفر', status: 400 }
  }
  if (maxStock <= 0) {
    return { error: 'الحد الأعلى للمخزون إلزامي — أدخل قيمة أكبر من صفر', status: 400 }
  }
  if (maxStock < minStock) {
    return { error: 'الحد الأعلى يجب أن يكون أكبر من أو يساوي الحد الأدنى', status: 400 }
  }
  const location =
    typeof body.location === 'string' && body.location.trim() ? body.location.trim().slice(0, 120) : null

  // المستودع: القسم النهائي فقط — آخر ابن في السلسلة (لا يوجد بداخله مستودعات أخرى)
  let warehouseId: string | null = null
  if (body.warehouseId !== undefined && body.warehouseId !== null && body.warehouseId !== '') {
    const wh = await db.warehouse.findUnique({
      where: { id: String(body.warehouseId) },
      select: { id: true, name: true, isActive: true, _count: { select: { children: true } } },
    })
    if (!wh) return { error: 'المستودع المختار غير موجود', status: 400 }
    if (wh._count.children > 0) {
      return {
        error: `«${wh.name}» يحتوي مستودعات فرعية — المادة تُسند للقسم النهائي (آخر ابن في السلسلة) فقط`,
        status: 400,
      }
    }
    if (!wh.isActive) return { error: `المستودع «${wh.name}» موقوف — اختر قسماً نشطاً`, status: 400 }
    warehouseId = wh.id
  } else {
    return { error: 'يجب إسناد المادة إلى قسم (آخر مستوى في شجرة المستودعات)', status: 400 }
  }

  // ==================== الصور ====================
  const rawImages = Array.isArray(body.images) ? (body.images as IncomingImage[]) : []
  if (rawImages.length > MAX_IMAGES) {
    return { error: `الحد الأقصى ${MAX_IMAGES} صور للمادة`, status: 400 }
  }

  const images: ParsedPayload['images'] = []
  const seenUrls = new Set<string>()
  for (const img of rawImages) {
    const url = typeof img?.url === 'string' ? img.url.trim() : ''
    if (!url || seenUrls.has(url)) continue
    // شكلا الروابط المقبولة — أي رابط آخر يُسقط بصمت (حماية من المحتوى المزروع):
    // 1) data:image/…;base64 — الصورة مخزنة داخل القاعدة نفسها منذ Task 28 (تنجو مع النسخ الاحتياطي)
    //    بشرط صيغة صورة معروفة + base64 سليم + سقف حجم (وإلا رُفضت بصمت)
    // 2) /api/files/… — صور قديمة على القرص من حقبة ما قبل Task 28 (تُخدم ولا تُستحدث)
    if (url.startsWith('data:image/')) {
      if (!isValidImageDataUrl(url)) continue
    } else if (!url.startsWith('/api/files/')) {
      continue
    }
    seenUrls.add(url)
    images.push({
      url,
      fileName: typeof img?.fileName === 'string' && img.fileName.trim() ? img.fileName.trim() : url.startsWith('data:') ? 'صورة.webp' : path.basename(decodeURIComponent(url)),
      isPrimary: Boolean(img?.isPrimary),
    })
  }
  // صورة أساسية واحدة بالضبط — إن لم يُحدد شيء تكون الأولى
  if (!images.some((i) => i.isPrimary) && images.length > 0) images[0].isPrimary = true

  // ==================== وحدات المادة (إلزامية — وحدة واحدة على الأقل) ====================
  const rawUnits = Array.isArray(body.units) ? (body.units as IncomingUnit[]) : []
  if (rawUnits.length === 0) {
    return { error: 'يجب إضافة وحدة واحدة على الأقل للمادة قبل الحفظ', status: 400 }
  }
  if (rawUnits.length > MAX_UNITS) {
    return { error: `الحد الأقصى ${MAX_UNITS} وحدات للمادة`, status: 400 }
  }

  const units: ParsedPayload['units'] = []
  const seenUnits = new Set<string>()
  for (const u of rawUnits) {
    const uName = typeof u?.name === 'string' ? u.name.trim() : ''
    if (!uName) return { error: 'اسم الوحدة مطلوب — أكمل الصفوف أو احذفها', status: 400 }
    if (seenUnits.has(uName)) {
      return { error: `الوحدة «${uName}» مكررة — يجب أن تختلف أسماء الوحدات بينها`, status: 400 }
    }
    seenUnits.add(uName)
    // معامل التحويل اختياري — الافتراضي 1
    const parsed = num(u?.factor, NaN)
    const factor = Number.isFinite(parsed) && parsed > 0 ? parsed : 1
    const uBarcode = typeof u?.barcode === 'string' && u.barcode.trim() ? u.barcode.trim() : null
    units.push({ name: uName, factor, barcode: uBarcode, isActive: u?.isActive === undefined ? true : Boolean(u.isActive) })
  }

  return {
    data: {
      name,
      barcode,
      description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null,
      salePrice,
      taxRate,
      minStock,
      maxStock,
      location,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      warehouseId,
      images,
      units,
    },
  }
}

// ==================== سعر الشراء التلقائي ====================

export interface PurchaseInfo {
  /** آخر سعر شراء (من آخر فاتورة مشتريات) */
  last: number
  /** السعر الوسطي المرجح بالكميات */
  avg: number
  lastInvoiceNumber: string | null
  lastInvoiceDate: string | null
  invoicesCount: number
}

/**
 * التكلفة المعتمدة للقيم التقديرية (تلف/جرد فروق).
 *
 * الأولوية للمتوسط المرجح المحفوظ على البطاقة (`Item.avgCost`) لأنه المصدر الوحيد
 * الذي يعبر حدود الفترات: ما يُحتسب من بنود فواتير الشراء ينهار إلى صفر بعد الإقفال
 * لأن التدوير ينقل الفواتير كلها إلى الأرشيف. وما بعده شبكة أمان لمادة لم تمر بحركة
 * دخول بعد الإصلاح — والوسطي قبل الأخير عمداً وفق القسم 4.2 لا «آخر سعر شراء».
 */
export function purchaseCostOf(info: PurchaseInfo | null | undefined, storedAvgCost = 0): number {
  if (storedAvgCost > 0) return storedAvgCost
  if (info?.avg) return info.avg
  if (info?.last) return info.last
  return 0
}

// ==================== P2-2: كاش أسعار الشراء — ختم إصدار قاعدي ====================
// درس موثق (P1): وضع التطوير يعزل السياقات بين المسارات فلا تُوثق ذاكرة واحدة ولا حتى globalThis —
// لذا ختم الإصدار يُخزن في قاعدة البيانات نفسها: أي كتابة على فاتورة شراء ترفع الختم داخل معاملتها،
// وأي سياق يستدعي الحساب يكتشف اختلاف الختم فيعيد الحساب مرة واحدة ثم يخدم نداءاته من الذاكرة.
const PURCHASE_INFO_VERSION_KEY = 'purchaseInfoVersion'

type SettingClient = Prisma.TransactionClient | Pick<typeof db, 'setting'>

/** رفع ختم إصدار أسعار الشراء — تُستدعى داخل معاملة كتابة فاتورة شراء (ذرّية مع العملية) */
export async function bumpPurchaseInfoVersion(client: SettingClient = db): Promise<void> {
  await client.setting.upsert({
    where: { key: PURCHASE_INFO_VERSION_KEY },
    update: { value: `v${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    create: { key: PURCHASE_INFO_VERSION_KEY, value: 'v1' },
  })
}

/** الكاش داخل السياق — صحته مضمونة بمطابقة الختم القاعدي قبل كل استدعاء */
let purchaseInfoCache: { version: string; map: Map<string, PurchaseInfo> } | null = null

/** احتساب سعر الشراء لكل مادة من فواتير المشتريات — آخر سعر أو الوسطي (مع كاش الختم القاعدي) */
export async function computePurchaseInfo(): Promise<Map<string, PurchaseInfo>> {
  const versionRow = await db.setting.findUnique({ where: { key: PURCHASE_INFO_VERSION_KEY } })
  const version = versionRow?.value ?? 'v0'
  if (purchaseInfoCache && purchaseInfoCache.version === version) return purchaseInfoCache.map

  const lines = await db.invoiceLine.findMany({
    where: { invoice: { type: 'PURCHASE' } },
    select: {
      itemId: true,
      unitPrice: true,
      quantity: true,
      invoice: { select: { number: true, date: true } },
    },
    orderBy: [{ invoice: { date: 'desc' } }, { id: 'desc' }],
  })

  const map = new Map<string, PurchaseInfo>()
  const acc = new Map<string, { qty: number; val: number }>()
  for (const ln of lines) {
    const info = map.get(ln.itemId) ?? {
      last: 0,
      avg: 0,
      lastInvoiceNumber: null as string | null,
      lastInvoiceDate: null as string | null,
      invoicesCount: 0,
    }
    if (info.invoicesCount === 0) {
      // الأسطر مرتبة بالأحدث أولاً — أول ظهور = آخر فاتورة
      info.last = ln.unitPrice
      info.lastInvoiceNumber = ln.invoice.number
      info.lastInvoiceDate = ln.invoice.date.toISOString()
    }
    info.invoicesCount += 1
    map.set(ln.itemId, info)
    const a = acc.get(ln.itemId) ?? { qty: 0, val: 0 }
    a.qty += ln.quantity
    a.val += ln.quantity * ln.unitPrice
    acc.set(ln.itemId, a)
  }
  // السعر الوسطي المرجح: Σ(كمية × سعر) ÷ Σ(كمية)
  for (const [itemId, info] of map) {
    const a = acc.get(itemId)!
    info.avg = a.qty > 0 ? a.val / a.qty : info.last
  }
  purchaseInfoCache = { version, map }
  return map
}
