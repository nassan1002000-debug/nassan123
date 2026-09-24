'use client'

// شاشة تسجيل الدخول — بوابة النظام: تحقق فعلي من جدول المستخدمين (scrypt + جلسة موقعة)
// تُعرض بدل التطبيق كاملاً عند غياب الجلسة — بالشعار واسم الشركة من إعدادات النظام
// + اختيار الفترات المحاسبية المقفلة السابقة للاستعراض (قراءة فقط) — تحت زر تسجيل الدخول
import { useEffect, useState, type FormEvent } from 'react'
import {
  AlertCircle,
  Archive,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  ShieldCheck,
  User,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ForcedChangePassword } from '@/components/screens/auth/forced-change-password'
import { getCachedCompanyInfo } from '@/lib/company'
import { fmtDate } from '@/lib/format'
import type { SessionUser, ViewPeriodInfo } from '@/lib/store'

interface LoginScreenProps {
  onSuccess: (user: SessionUser, viewPeriod?: ViewPeriodInfo | null) => void
}

interface PublicPeriod {
  id: string
  label: string
  closingDate: string
  closedBy: string
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  /** P1-3: جلسة نجحت لكن كلمة المرور افتراضية — يُجبر على تغييرها قبل الدخول */
  const [forcedUser, setForcedUser] = useState<SessionUser | null>(null)

  // استعراض الفترات السابقة (قراءة فقط)
  const [periods, setPeriods] = useState<PublicPeriod[] | null>(null)
  const [showPeriods, setShowPeriods] = useState(false)
  const [viewId, setViewId] = useState('')
  const [viewLoading, setViewLoading] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/period-close/public')
        const data = (await res.json().catch(() => null)) as { periods?: PublicPeriod[] } | null
        if (alive && res.ok && data?.periods) setPeriods(data.periods)
      } catch {
        if (alive) setPeriods([]) // بلا قائمة — لا يُعرض القسم أصلاً
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // الشعار والاسم من الكاش المحلي — إعدادات الخادم محمية بالبوابة ولا تُجلب قبل الدخول
  const info = getCachedCompanyInfo()
  const companyName = info.companyName.trim() || 'شركة الأمل التجارية 2026'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError(null)
    if (!username.trim() || !password) {
      setError('أدخل اسم المستخدم وكلمة المرور')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = (await res.json().catch(() => null)) as { user?: SessionUser; error?: string } | null
      if (!res.ok || !data?.user) {
        setError(data?.error ?? 'تعذر تسجيل الدخول — حاول مجدداً')
        return
      }
      if (data.user.mustChangePassword) {
        setForcedUser(data.user) // الشاشة الإلزامية — بكلمة الدخول المكتوبة كحالية مخفية
        return
      }
      onSuccess(data.user)
    } catch {
      setError('تعذر الاتصال بالخادم — تحقق من الاتصال وحاول مجدداً')
    } finally {
      setLoading(false)
    }
  }

  const submitView = async () => {
    if (viewLoading) return
    if (!viewId) {
      setError('اختر الفترة المطلوب استعراضها أولاً')
      return
    }
    if (!username.trim() || !password) {
      setError('أدخل اسم المستخدم وكلمة المرور لاستعراض الفترة')
      return
    }
    setError(null)
    setViewLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, viewPeriod: viewId }),
      })
      const data = (await res.json().catch(() => null)) as
        | { user?: SessionUser; viewPeriod?: ViewPeriodInfo | null; error?: string }
        | null
      if (!res.ok || !data?.user) {
        setError(data?.error ?? 'تعذر الدخول للاستعراض — حاول مجدداً')
        return
      }
      if (data.user.mustChangePassword) {
        setForcedUser(data.user)
        return
      }
      onSuccess(data.user, data.viewPeriod ?? null)
    } catch {
      setError('تعذر الاتصال بالخادم — تحقق من الاتصال وحاول مجدداً')
    } finally {
      setViewLoading(false)
    }
  }

  if (forcedUser) {
    return (
      <ForcedChangePassword
        user={forcedUser}
        initialCurrent={password}
        onDone={(u) => {
          setForcedUser(null)
          onSuccess(u)
        }}
      />
    )
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      {/* هالات ذهبية خلفية — بهوية الثيم الليلي الأسود/الذهبي */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-24 right-0 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center p-4">
        <main className="w-full max-w-md">
          {/* الشعار + اسم الشركة */}
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            {info.companyLogo ? (
              <img
                src={info.companyLogo}
                alt={`شعار ${companyName}`}
                className="h-40 w-auto max-w-[360px] object-contain"
              />
            ) : (
              <span className="flex h-40 w-40 items-center justify-center rounded-3xl bg-primary/15 text-primary ring-1 ring-primary/30">
                <ShieldCheck className="h-20 w-20" aria-hidden />
              </span>
            )}
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">{companyName}</h1>
              <p className="mt-1 text-sm text-muted-foreground">نظام المحاسبة والمخزون — يتطلب تسجيل الدخول</p>
            </div>
          </div>

          {/* نموذج الدخول */}
          <form
            onSubmit={submit}
            noValidate
            className="rounded-2xl border bg-card p-6 shadow-xl shadow-black/5 sm:p-8"
            aria-label="نموذج تسجيل الدخول"
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
              <div className="space-y-1.5">
                <Label htmlFor="login-username">اسم المستخدم</Label>
                <div className="relative">
                  <User className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="login-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="h-11 ps-9 text-start"
                    dir="ltr"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="admin"
                    disabled={loading}
                    autoFocus
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="login-password">كلمة المرور</Label>
                <div className="relative">
                  <KeyRound className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 ps-9 pe-10 text-start"
                    dir="ltr"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    disabled={loading}
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

              <Button type="submit" className="h-11 w-full text-base font-bold" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                    جارٍ التحقق…
                  </>
                ) : (
                  <>
                    <LogIn className="h-5 w-5" aria-hidden />
                    تسجيل الدخول
                  </>
                )}
              </Button>

              {/* ===== استعراض الفترات السابقة (قراءة فقط) — تحت زر تسجيل الدخول ===== */}
              {periods && periods.length > 0 && (
                <div className="rounded-lg border border-dashed p-3">
                  <button
                    type="button"
                    onClick={() => setShowPeriods((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                    aria-expanded={showPeriods}
                  >
                    <span className="flex items-center gap-2">
                      <Archive className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
                      استعراض فترات محاسبية سابقة (للقراءة فقط)
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${showPeriods ? 'rotate-180' : ''}`}
                      aria-hidden
                    />
                  </button>

                  {showPeriods && (
                    <div className="mt-3 space-y-2.5">
                      <div className="space-y-1.5">
                        <Label htmlFor="view-period">اختر الفترة</Label>
                        <Select value={viewId} onValueChange={setViewId}>
                          <SelectTrigger id="view-period" aria-label="اختيار الفترة السابقة" className="h-10">
                            <SelectValue placeholder="الفترات المقفلة…" />
                          </SelectTrigger>
                          <SelectContent>
                            {periods.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.label} — حتى {fmtDate(p.closingDate)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        اكتب اسم المستخدم وكلمة المرور أعلاه ثم اضغط «دخول للاستعراض» — ستُعرض بيانات الفترة
                        المحفوظة لحظة إقفالها دون أي إمكانية تعديل أو حذف، مع زر العودة إلى الفترة الحالية.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 w-full gap-1.5 border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                        onClick={submitView}
                        disabled={viewLoading || loading}
                      >
                        {viewLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Archive className="h-4 w-4" aria-hidden />
                        )}
                        دخول للاستعراض
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </form>

          <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
            الوصول محمي — بيانات الدخول تُدار من مدير النظام عبر شاشة «المستخدمون والصلاحيات»
          </p>
        </main>
      </div>

      <footer className="relative z-10 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-xs text-muted-foreground">
        نظام المحاسبة والمخزون — شركة الأمل التجارية 2026 ©
      </footer>
    </div>
  )
}
