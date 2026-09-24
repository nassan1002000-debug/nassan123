// حد المحاولات (المرحلة الأولى P1-5) — الحالة في قاعدة البيانات نفسها
// لماذا القاعدة لا الذاكرة؟ خادم التطوير (Turbopack) يعزل سياقات التنفيذ بين
// الرسوم المترجمة فتضيع عدّادات الذاكرة — والقاعدة تضمن العدّ الصحيح عبر
// السياقات والعمليات وإعادة التشغيل أيضاً، وتكلفتها تافهة عند هذا الحجم
// • حماية تسجيل الدخول من التجربة العنيفة: 5 فشلات لاسم مستخدم → قفل 10 دقائق
// • حد عام لكل مفتاح (IP/مستخدم) بنافذة زمنية ثابتة
import { db } from '@/lib/db'

const LOGIN_MAX_FAILURES = 5
const LOGIN_LOCK_MS = 10 * 60 * 1000 // 10 دقائق

export interface LimitResult {
  /** true = مسموح المتابعة */
  ok: boolean
  /** ثوانٍ حتى رفع الحجب/إتاحة المحاولة — للرسالة العربية */
  retryAfterSec: number
}

function secondsLeft(until: Date): number {
  return Math.ceil((until.getTime() - Date.now()) / 1000)
}

/** هل اسم المستخدم مقفول حالياً بسبب فشل متكرر؟ — fail-open عند أي عطل قاعدي */
export async function loginLocked(username: string): Promise<LimitResult> {
  try {
    const entry = await db.rateLimitEntry.findUnique({ where: { key: `login:${username.toLowerCase()}` } })
    if (entry?.lockedUntil && entry.lockedUntil > new Date()) {
      return { ok: false, retryAfterSec: secondsLeft(entry.lockedUntil) }
    }
    return { ok: true, retryAfterSec: 0 }
  } catch {
    return { ok: true, retryAfterSec: 0 }
  }
}

/** تسجيل فشل دخول — عند بلوغ الحد يُقفل اسم المستخدم 10 دقائق */
export async function recordLoginFailure(username: string): Promise<void> {
  const key = `login:${username.toLowerCase()}`
  const now = new Date()
  try {
    await db.$transaction(async (tx) => {
      const entry = await tx.rateLimitEntry.findUnique({ where: { key } })
      const count = (entry?.count ?? 0) + 1
      if (count >= LOGIN_MAX_FAILURES) {
        // بلغ الحد — قفل يبدأ الآن ويُصفَّر العدّ (بعد انتهاء القفل يبدأ عدّ جديد)
        await tx.rateLimitEntry.upsert({
          where: { key },
          create: { key, count: 0, lockedUntil: new Date(now.getTime() + LOGIN_LOCK_MS) },
          update: { count: 0, lockedUntil: new Date(now.getTime() + LOGIN_LOCK_MS) },
        })
      } else {
        await tx.rateLimitEntry.upsert({
          where: { key },
          create: { key, count },
          update: { count, windowStart: entry?.windowStart ?? now },
        })
      }
    })
  } catch (error) {
    // فشل التسجيل لا يوقف مسار الدخول إطلاقاً
    console.error('recordLoginFailure error:', error)
  }
}

/** نجاح الدخول يصفّر عدّاد الفشل لاسم المستخدم */
export async function clearLoginFailures(username: string): Promise<void> {
  try {
    await db.rateLimitEntry.deleteMany({ where: { key: `login:${username.toLowerCase()}` } })
  } catch {
    // تجاهل — العدّاد يُعاد بناؤه لاحقاً
  }
}

/** حد عام بنافذة زمنية ثابتة — fail-open عند أي عطل قاعدي */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<LimitResult> {
  try {
    return await db.$transaction(async (tx) => {
      const entry = await tx.rateLimitEntry.findUnique({ where: { key } })
      const now = new Date()
      // نافذة منتهية أو غائبة — عدّ جديد
      if (!entry || entry.windowStart.getTime() + windowMs <= now.getTime()) {
        await tx.rateLimitEntry.upsert({
          where: { key },
          create: { key, count: 1, windowStart: now, lockedUntil: null },
          update: { count: 1, windowStart: now, lockedUntil: null },
        })
        return { ok: true, retryAfterSec: 0 }
      }
      const count = entry.count + 1
      await tx.rateLimitEntry.update({ where: { key }, data: { count } })
      if (count > limit) {
        return { ok: false, retryAfterSec: secondsLeft(new Date(entry.windowStart.getTime() + windowMs)) }
      }
      return { ok: true, retryAfterSec: 0 }
    })
  } catch {
    return { ok: true, retryAfterSec: 0 }
  }
}

/** عنوان IP للطلب من ترويسات البوابة العكسية — يُستخدم لمفاتيح الحد */
export function requestIp(req: { headers: { get(name: string): string | null } }): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip')?.trim() || 'local'
}
