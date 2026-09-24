'use client'

// شاشة إجبار تغيير كلمة المرور (المرحلة الأولى P1-3) — تُعرض حاجزاً كاملاً
// عندما تكون كلمة مرور المستخدم افتراضية معروفة (mustChangePassword) —
// لا يمكن إغلاقها ولا الوصول للتطبيق قبل تغيير الكلمة عبر /api/auth/change-password

import { useState, type FormEvent } from 'react'
import { AlertCircle, Eye, EyeOff, KeyRound, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { SessionUser } from '@/lib/store'

interface ForcedChangePasswordProps {
  user: SessionUser
  /** كلمة المرور الحالية إن كانت معروفة (من نموذج الدخول مباشرة) — يُخفى الحقل عندها */
  initialCurrent?: string
  onDone: (user: SessionUser) => void
}

export function ForcedChangePassword({ user, initialCurrent, onDone }: ForcedChangePasswordProps) {
  const [currentPassword, setCurrentPassword] = useState(initialCurrent ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError(null)
    if (!currentPassword) {
      setError('أدخل كلمة المرور الحالية')
      return
    }
    if (newPassword.length < 6) {
      setError('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('كلمة المرور الجديدة وتأكيدها غير متطابقين')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = (await res.json().catch(() => null)) as { user?: SessionUser; error?: string } | null
      if (!res.ok || !data?.user) {
        setError(data?.error ?? 'تعذر تغيير كلمة المرور — حاول مجدداً')
        return
      }
      onDone(data.user)
    } catch {
      setError('تعذر الاتصال بالخادم — تحقق من الاتصال وحاول مجدداً')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute -bottom-24 right-0 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center p-4">
        <main className="w-full max-w-md">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
              <ShieldAlert className="h-10 w-10" aria-hidden />
            </span>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">تغيير كلمة المرور إلزامي</h1>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                حسابك «{user.name}» لا يزال بكلمة مرور افتراضية معروفة —
                اختر كلمة مرور خاصة بك قبل المتابعة لحماية بياناتك المالية
              </p>
            </div>
          </div>

          <form
            onSubmit={submit}
            noValidate
            className="rounded-2xl border bg-card p-6 shadow-xl shadow-black/5 sm:p-8"
            aria-label="نموذج تغيير كلمة المرور الإلزامي"
          >
            {error && (
              <div
                role="alert"
                className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-4">
              {!initialCurrent && (
                <div className="space-y-1.5">
                  <Label htmlFor="forced-current">كلمة المرور الحالية</Label>
                  <div className="relative">
                    <KeyRound className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input
                      id="forced-current"
                      type={showPassword ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="h-11 ps-9 pe-10 text-start"
                      dir="ltr"
                      autoComplete="current-password"
                      disabled={loading}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="forced-new">كلمة المرور الجديدة</Label>
                <div className="relative">
                  <KeyRound className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="forced-new"
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="h-11 ps-9 pe-10 text-start"
                    dir="ltr"
                    autoComplete="new-password"
                    placeholder="6 أحرف على الأقل"
                    disabled={loading}
                    autoFocus={Boolean(initialCurrent)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="forced-confirm">تأكيد كلمة المرور الجديدة</Label>
                <Input
                  id="forced-confirm"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-11 text-start"
                  dir="ltr"
                  autoComplete="new-password"
                  disabled={loading}
                />
              </div>

              <Button type="submit" className="h-11 w-full text-base font-bold" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                    جارٍ الحفظ…
                  </>
                ) : (
                  <>
                    <KeyRound className="h-5 w-5" aria-hidden />
                    حفظ كلمة المرور والمتابعة
                  </>
                )}
              </Button>
            </div>
          </form>

          <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
            بعد الحفظ تُسقط كل الجلسات النشطة الأخرى لهذا الحساب تلقائياً — وتبقى أنت مسجلاً هنا
          </p>
        </main>
      </div>

      <footer className="relative z-10 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-xs text-muted-foreground">
        نظام المحاسبة والمخزون — شركة الأمل التجارية 2026 ©
      </footer>
    </div>
  )
}
