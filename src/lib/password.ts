// تجزئة كلمات المرور — Node crypto scrypt بلا أي تبعيات خارجية
// الصيغة المخزنة في User.passwordHash: scrypt:<saltHex>:<keyHex>
// الملح 16 بايت عشوائي لكل مستخدم والمفتاح 64 بايت — لا تُخزَّن كلمة المرور النصية إطلاقاً

import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const SALT_BYTES = 16
const KEY_BYTES = 64
const PREFIX = 'scrypt'

/** هل النص سدس عشري صالح بطول محدد؟ (حرس صيغة قبل أي فك تشفير) */
function isHexOfLength(value: string, byteLength: number): boolean {
  return value.length === byteLength * 2 && /^[0-9a-f]+$/i.test(value)
}

/**
 * تجزئة كلمة مرور نصية إلى صيغة `scrypt:salt:key` سداسية عشرية
 * — ملح عشوائي جديد (16 بايت) في كل استدعاء فلا يتكرر الهاش نفسه لمستخدمين مختلفين
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES)
  const key = scryptSync(password, salt, KEY_BYTES)
  return `${PREFIX}:${salt.toString('hex')}:${key.toString('hex')}`
}

/**
 * التحقق من كلمة مرور مقابل الصيغة المخزنة
 * — حراسة صارمة للصيغة (البادئة وأطوال salt/key السداسية) ثم مقارنة ثابتة الزمن
 *   بـ timingSafeEqual فلا يتسرب طول/محتوى الهاش عبر قياس زمن المقارنة
 */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split(':')
    if (parts.length !== 3 || parts[0] !== PREFIX) return false
    if (!isHexOfLength(parts[1], SALT_BYTES) || !isHexOfLength(parts[2], KEY_BYTES)) return false

    const salt = Buffer.from(parts[1], 'hex')
    const key = Buffer.from(parts[2], 'hex')
    const candidate = scryptSync(password, salt, KEY_BYTES)
    return timingSafeEqual(candidate, key)
  } catch {
    // صيغة فاسدة أو مدخلات غير صالحة — الرفض دائماً وليس انهياراً
    return false
  }
}
