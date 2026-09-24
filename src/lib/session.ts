// جلسات تسجيل الدخول — توكن موقّع HMAC-SHA256 بلا أي تبعيات خارجية
// التوكن: <payloadBase64url>.<hmacHex> — cookie httpOnly يدوم 7 أيام ولا يحمل سراً
// السر يُولَّد عشوائياً مرة واحدة ويُخزَّن في db/auth-secret.txt — خارج جدول الإعدادات
// (GET /api/settings يُرجع كل صفوف Setting فلن يتسرب السر عبره إطلاقاً)

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

export const SESSION_COOKIE = 'amal2026_session'
/** كوكي وضع استعراض فترة سابقة (قراءة فقط) — قيمته معرف PeriodClose موجود فعلاً بالقاعدة */
export const VIEW_PERIOD_COOKIE = 'amal2026_viewperiod'
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60 // بالثواني — أسبوع كامل

const SECRET_FILE = path.join(process.cwd(), 'db', 'auth-secret.txt')

export interface SessionPayload {
  uid: string
  username: string
  name: string
  role: string
  /** P1-1: إصدار الجلسة — إن خالف قيمة المستخدم بالقاعدة تسقط الجلسة فوراً */
  v?: number
  iat: number
  exp: number
}

let cachedSecret: Buffer | null = null

/** قراءة السر فقط بلا إنشاء — تُستخدم في التحقق (proxy والواجهات) */
export function readSessionSecret(): Buffer | null {
  if (cachedSecret) return cachedSecret
  try {
    if (!existsSync(SECRET_FILE)) return null
    const raw = readFileSync(SECRET_FILE, 'utf8').trim()
    if (raw.length < 64) return null
    cachedSecret = Buffer.from(raw, 'hex')
    return cachedSecret
  } catch {
    return null
  }
}

/** ضمان وجود السر — تُستخدم عند تسجيل الدخول فقط (تُنشئه عند أول استخدام) */
export function ensureSessionSecret(): Buffer {
  const existing = readSessionSecret()
  if (existing) return existing
  const secret = randomBytes(32)
  writeFileSync(SECRET_FILE, secret.toString('hex'), { mode: 0o600 })
  cachedSecret = secret
  return secret
}

/** توقيع جلسة جديدة للمستخدم — توكن جاهز للكوكي (يتضمن إصدار الجلسة P1-1) */
export function signSession(user: {
  id: string
  username: string
  name: string
  role: string
  sessionVersion?: number
}): string {
  const payload: SessionPayload = {
    uid: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    v: user.sessionVersion ?? 1,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', ensureSessionSecret()).update(body).digest('hex')
  return `${body}.${sig}`
}

/**
 * فحص التوكن — يرجع الحمولة أو null (صيغة/توقيع/صلاحية غير صالحة)
 * مقارنة ثابتة الزمن بـ timingSafeEqual فلا يتسرب التوقيع عبر قياس زمن المقارنة
 */
export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const secret = readSessionSecret()
  if (!secret) return null
  try {
    const expected = createHmac('sha256', secret).update(parts[0]).digest()
    const given = Buffer.from(parts[1], 'hex')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as SessionPayload
    if (!payload || typeof payload.uid !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}
