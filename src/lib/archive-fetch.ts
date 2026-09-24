'use client'

// إعادة توجيه الجلب أثناء استعراض فترة مقفلة — الشاشات الحية نفسها تقرأ من الأرشيف
// --------------------------------------------------------------------------------
// عند تفعيل الوضع: كل GET إلى /api/<مسار> يُعاد توجيهه شفافاً إلى /api/archive/<مسار>
// (المرآة الأرشيفية)، مع قائمة استثناءات تعمل على القاعدة الحية عمداً:
//   auth (الجلسة والدخول/الخروج) · settings (إعدادات عامة حية) · notifications ·
//   files (صور من القرص) · period-close/period-view (بيانات تعريفية) · backup (القرص)
// وأي طلب كتابة (POST/PUT/PATCH/DELETE) يُحجب عميل فوراً — والبوابة تحجبه أصلاً —
// فلا يخطر ببال أثناء الاستعراض أن أي زر حفظ يمكن أن يمس القاعدة الحية.

/** مسارات تبقى حية أثناء استعراض الأرشيف — لا تُعاد كتابتها */
const LIVE_PREFIXES = [
  '/api/auth/',
  '/api/settings',
  '/api/notifications',
  '/api/files',
  '/api/period-close',
  '/api/period-view',
  '/api/backup',
]

let originalFetch: typeof window.fetch | null = null

// حالة التثبيت كمخزن خارجي — تُقرأ بـ useSyncExternalStore بلا أي setState داخل effects
let installed = false
const installListeners = new Set<() => void>()

function emitInstallChange(): void {
  for (const l of installListeners) l()
}

/** اشتراك بحالة تثبيت غلاف الأرشيف (useSyncExternalStore) */
export function subscribeArchiveFetch(cb: () => void): () => void {
  installListeners.add(cb)
  return () => {
    installListeners.delete(cb)
  }
}

/** هل الغلاف مثبّت الآن؟ (قيمة المخزن الخارجي) */
export function isArchiveFetchInstalled(): boolean {
  return installed
}

function isLivePath(pathWithQuery: string): boolean {
  return LIVE_PREFIXES.some((p) => pathWithQuery === p || pathWithQuery.startsWith(p))
}

/**
 * نزع غلاف الجلب الأرشيفي وإعادة fetch الأصلي — آمن للاستدعاء المتكرر
 */
export function uninstallArchiveFetch(): void {
  if (typeof window === 'undefined' || !originalFetch) return
  window.fetch = originalFetch
  originalFetch = null
  if (installed) {
    installed = false
    emitInstallChange()
  }
}

/**
 * تثبيت غلاف الجلب الأرشيفي — يُستدعى عند دخول وضع الاستعراض (متكرر بلا ضرر)
 */
export function installArchiveFetch(): void {
  if (typeof window === 'undefined') return
  if (originalFetch) return // مثبّت أصلاً
  originalFetch = window.fetch.bind(window)

  // توقيع النداء وحده — `typeof window.fetch` يحمل خاصيات ساكنة (preconnect) لا
  // تملكها دالة سهمية، فتُنقل عند الإسناد أدناه بـ Object.assign بدل إسقاط النوع
  const wrapped = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const original = originalFetch as typeof window.fetch
    try {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url
      const resolved = new URL(url, window.location.href)
      if (!resolved.pathname.startsWith('/api')) return original(input, init)

      const method = String(
        init?.method ?? (input instanceof Request ? input.method : 'GET') ?? 'GET',
      ).toUpperCase()

      const pathWithQuery = resolved.pathname + resolved.search

      if (method === 'GET' || method === 'HEAD') {
        if (isLivePath(pathWithQuery)) return original(input, init)
        // إعادة الكتابة الشفافة: /api/<x> → /api/archive/<x> — بنفس البارامترات والترويسات
        const archived = pathWithQuery.replace(/^\/api\//, '/api/archive/')
        return original(archived, init)
      }

      // كتابة أثناء استعراض الأرشيف — محجوبة هنا قبل أن تلمس الشبكة أصلاً
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: 'أنت تستعرض فترة محاسبية مقفلة — الاستعراض للقراءة فقط — عُد إلى الفترة الحالية للتعديل',
          }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
      )
    } catch {
      return original(input, init)
    }
  }

  // نقل الخاصيات الساكنة من fetch الأصلي (preconnect وغيرها) فيبقى الغلاف بديلاً كاملاً
  window.fetch = Object.assign(wrapped, originalFetch) as typeof window.fetch
  installed = true
  emitInstallChange()
}
