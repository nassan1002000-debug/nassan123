'use client'

// استقصاء عودة الخادم بعد عملية تُنهي العملية الحالية عمداً (تراجع عن إقفال فترة /
// استعادة نسخة احتياطية — كلتاهما تكتب علامة معلّقة ثم تستدعي process.exit): المتصفح
// يبقى متصلاً بعملية ستموت خلال لحظات، فيجب التأكد أنها ماتت فعلاً (فشل اتصال واحد
// على الأقل) قبل اعتبار أي استجابة ناجحة لاحقة دليلاً على أن الخادم الجديد أقلع —
// وإلا يُعاد التحميل فوراً على العملية القديمة نفسها في نافذة الـ1.2 ثانية قبل موتها
export interface WaitForRestartOptions {
  /** يُستدعى أول مرة يتأكد أن الخادم القديم توقف فعلاً — لتحديث رسالة الانتظار */
  onServerDown?: () => void
  /** يُستدعى عند تجاوز الحد الأقصى للانتظار بلا عودة — الخادم لم يُعَد تشغيله يدوياً بعد */
  onTimeout?: () => void
  /** الحد الأقصى للانتظار (مل.ث) قبل التوقف عن الاستقصاء والتنبيه — افتراضياً 3 دقائق */
  maxWaitMs?: number
  /** الفترة بين كل استقصاء ولاحقه (مل.ث) — افتراضياً 2 ثانية */
  pollMs?: number
}

/** يبدأ استقصاء دوري لعودة الخادم، ويُعيد تحميل الصفحة كاملة تلقائياً فور تأكد عودته */
export function waitForServerRestart(options: WaitForRestartOptions = {}): void {
  const { onServerDown, onTimeout, maxWaitMs = 3 * 60 * 1000, pollMs = 2000 } = options
  const startedAt = Date.now()
  let sawServerDown = false

  const tick = async (): Promise<void> => {
    if (Date.now() - startedAt > maxWaitMs) {
      onTimeout?.()
      return
    }
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' })
      // أي استجابة فعلية (200 أو 401) تعني خادماً يرد — لكنها لا تُعتمد دليل عودة
      // إلا بعد رؤية انقطاع فعلي أولاً (العملية القديمة لم تمت بعد قبل ذلك)
      if ((res.status === 200 || res.status === 401) && sawServerDown) {
        window.location.reload()
        return
      }
    } catch {
      if (!sawServerDown) {
        sawServerDown = true
        onServerDown?.()
      }
    }
    setTimeout(tick, pollMs)
  }

  setTimeout(tick, pollMs)
}
