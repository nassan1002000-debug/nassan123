'use client'

// جرس التنبيهات — يراقب أرصدة المخزون مقابل الحدين الأدنى/الأعلى في بطاقة كل مادة:
// • فحص دوري كل 60 ثانية + عند العودة إلى النافذة + عند فتح النافذة المنسدلة
// • نافذة منسدلة بالتنبيهات (نقص تحت الحد الأدنى / تكدس فوق الأعلى) مع صور المادة والقسم
// • جرس مسموع (WebAudio — بلا ملفات صوتية) عند ورود تنبيه، قابل للكتم ويُحفظ الكتم محلياً
// • زر الانتقال إلى بطاقات المواد لمعالجة السبب

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, CheckCircle2, PackageSearch, RefreshCw, TrendingDown, TrendingUp, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { useNav } from '@/lib/store'
import { cn } from '@/lib/utils'
import { fmtQty } from '@/lib/format'

interface StockAlert {
  id: string
  type: 'LOW' | 'HIGH'
  severity: 'high' | 'medium'
  itemId: string
  code: string
  name: string
  unitName: string | null
  warehouseName: string | null
  imageUrl: string | null
  balance: number
  min: number
  max: number
  shortfall: number
}

const POLL_MS = 60_000
const MUTE_KEY = 'stock-notif-muted'

// نغمة جرس «دَينغ-دونغ» عبر WebAudio — لا تحتاج ملفات صوتية
let audioCtx: AudioContext | null = null
function playBellSound() {
  try {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    audioCtx = audioCtx ?? new Ctor()
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => undefined)
    const ctx = audioCtx
    if (ctx.state !== 'running') return
    const now = ctx.currentTime
    // نغمتان متتاليتان بتخميد أُسّي — طابع جرس متجر
    const tones: [number, number][] = [
      [1318.5, 0], // E6 — دَينغ
      [987.8, 0.22], // B5 — دونغ
    ]
    for (const [freq, delay] of tones) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, now + delay)
      gain.gain.exponentialRampToValueAtTime(0.2, now + delay + 0.025)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.95)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + delay)
      osc.stop(now + delay + 1.1)
    }
  } catch {
    // الصوت تحسين اختياري — أي فشل يُتجاهل بصمت
  }
}

export function NotificationBell() {
  const { toast } = useToast()
  const navigate = useNav((s) => s.navigate)

  const [alerts, setAlerts] = useState<StockAlert[] | null>(null)
  const [open, setOpen] = useState(false)
  const [muted, setMuted] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // أول تحميل لا يرن إلا عند وجود تنبيهات فعلية — واللاحق يرن على الجديد فقط
  const knownIds = useRef<Set<string> | null>(null)
  const mutedRef = useRef(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' })
      const data = res.ok ? await res.json() : null
      const list: StockAlert[] = Array.isArray(data?.alerts) ? data.alerts : []

      const ids = new Set(list.map((a) => a.id))
      const isFirst = knownIds.current === null
      const fresh = list.filter((a) => !knownIds.current?.has(a.id))
      knownIds.current = ids
      setAlerts(list)

      if (!isFirst && fresh.length > 0) {
        toast({
          title: fresh.length === 1 ? 'تنبيه مخزون جديد' : `${fresh.length} تنبيهات مخزون جديدة`,
          description: fresh[0].type === 'LOW'
            ? `${fresh[0].name} — الرصيد تحت الحد الأدنى`
            : `${fresh[0].name} — الرصيد فوق الحد الأعلى`,
        })
      }

      // الجرس يرن عند وجود تنبيهات (أول مرة) أو ورود جديد — ما لم يكن مكتوماً
      const hasNew = isFirst ? list.length > 0 : fresh.length > 0
      if (hasNew && !mutedRef.current && typeof document !== 'undefined' && document.visibilityState === 'visible') {
        playBellSound()
      }
    } catch {
      // فشل الفحص الدوري صامت — الجرس يحتفظ بآخر بيانات
    } finally {
      setRefreshing(false)
    }
  }, [toast])

  // الكتم من التخزين المحلي + دورية الفحص + الفحص عند العودة للنافذة
  useEffect(() => {
    const saved = window.localStorage.getItem(MUTE_KEY)
    mutedRef.current = saved === '1'
    setMuted(saved === '1')
    load()
    const timer = setInterval(load, POLL_MS)
    const onFocus = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  function toggleMute() {
    setMuted((m) => {
      const next = !m
      mutedRef.current = next
      window.localStorage.setItem(MUTE_KEY, next ? '1' : '0')
      return next
    })
  }

  const count = alerts?.length ?? 0
  const lowCount = alerts?.filter((a) => a.type === 'LOW').length ?? 0
  const highCount = count - lowCount

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) load() // بيانات حية عند كل فتح
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`التنبيهات${count > 0 ? ` — ${count} تنبيه` : ''}`} className="relative">
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span
              className={cn(
                'num absolute -top-0.5 -start-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none text-white',
                lowCount > 0 ? 'bg-rose-500' : 'bg-amber-500',
                !muted && 'animate-pulse',
              )}
            >
              {count > 9 ? '+9' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(92vw,24rem)] p-0" dir="rtl">
        {/* رأس النافذة */}
        <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-primary/12 p-1.5 text-primary">
              <Bell className="h-3.5 w-3.5" />
            </span>
            <div>
              <p className="text-sm font-bold leading-tight">تنبيهات المخزون</p>
              <p className="text-[11px] text-muted-foreground leading-tight">
                {alerts ? (
                  count === 0 ? (
                    'كل الأرصدة ضمن الحدود'
                  ) : (
                    <>
                      <span className="num font-semibold text-rose-600 dark:text-rose-400">{lowCount}</span> نقص •{' '}
                      <span className="num font-semibold text-amber-600 dark:text-amber-400">{highCount}</span> تكدس
                    </>
                  )
                ) : (
                  'جارٍ الفحص…'
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7.5 w-7.5"
              onClick={load}
              disabled={refreshing}
              aria-label="تحديث التنبيهات"
              title="تحديث الآن"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7.5 w-7.5"
              onClick={toggleMute}
              aria-label={muted ? 'تشغيل صوت الجرس' : 'كتم صوت الجرس'}
              title={muted ? 'الجرس مكتوم — اضغط للتشغيل' : 'الجرس يعمل — اضغط للكتم'}
            >
              {muted ? <VolumeX className="h-3.5 w-3.5 text-muted-foreground" /> : <Volume2 className="h-3.5 w-3.5 text-emerald-600" />}
            </Button>
          </div>
        </div>

        {/* القائمة */}
        <div className="max-h-80 overflow-y-auto">
          {!alerts &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3.5 py-3">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}

          {alerts?.length === 0 && (
            <div className="px-4 py-10 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
              <p className="text-sm font-semibold">لا توجد تنبيهات</p>
              <p className="mt-1 text-xs text-muted-foreground">
                كل المواد النشطة ضمن الحد الأدنى/الأعلى المسجل في بطاقاتها
              </p>
            </div>
          )}

          {alerts?.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('items')
              }}
              className="flex w-full items-start gap-3 border-b px-3.5 py-3 text-start transition-colors last:border-b-0 hover:bg-accent/60"
              title="فتح بطاقات المواد"
            >
              {a.imageUrl ? (
                <img
                  src={a.imageUrl}
                  alt={`الصورة الأساسية — ${a.name}`}
                  className="h-9 w-9 shrink-0 rounded-lg border object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed text-muted-foreground/50">
                  <PackageSearch className="h-4 w-4" />
                </span>
              )}

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-bold">{a.name}</span>
                  <span className="num shrink-0 text-[10px] text-muted-foreground">{a.code}</span>
                </span>
                <span
                  className={cn(
                    'num mt-0.5 flex flex-wrap items-center gap-1 text-[11px] font-semibold',
                    a.type === 'LOW' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400',
                  )}
                >
                  {a.type === 'LOW' ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                  الرصيد {fmtQty(a.balance)}
                  {a.unitName ? ` ${a.unitName}` : ''}
                  {a.type === 'LOW'
                    ? ` — تحت الحد الأدنى ${fmtQty(a.min)} (ينقص ${fmtQty(a.shortfall)})`
                    : ` — فوق الحد الأعلى ${fmtQty(a.max)} (زيادة ${fmtQty(a.shortfall)})`}
                </span>
                {a.warehouseName && (
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">القسم: {a.warehouseName}</span>
                )}
              </span>

              <span
                className={cn(
                  'mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-bold',
                  a.type === 'LOW'
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
                )}
              >
                {a.type === 'LOW' ? 'نقص' : 'تكدس'}
              </span>
            </button>
          ))}
        </div>

        {/* تذييل */}
        {count > 0 && (
          <div className="border-t p-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setOpen(false)
                navigate('items')
              }}
            >
              <PackageSearch className="h-4 w-4" />
              فتح بطاقات المواد للمعالجة
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
