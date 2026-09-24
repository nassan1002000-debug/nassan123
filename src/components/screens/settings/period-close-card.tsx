'use client'

// بطاقة إقفال الفترة المحاسبية والتدوير — داخل شاشة الإعدادات (نهاية كل دورة محاسبية)
// الخطوات كما يريدها المستخدم:
//  1) إقفال الفترة حتى تاريخ محدد  2) ترحيل كل البيانات للفترة الجديدة بسند قيد افتتاحي
//  3) حفظ نسخة أرشيفية بتاريخ الإقفال  4) الرجوع إليها عند الدخول (استعراض قراءة فقط)
//  5) منع استعادة نسخ احتياطية أقدم من الافتتاحي  6) التراجع عن الإقفال بخسارة كل ما بعده
import { useCallback, useEffect, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  History,
  Loader2,
  Lock,
  LockKeyhole,
  Undo2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { SectionCard } from '@/components/common/section-card'
import { useToast } from '@/hooks/use-toast'
import { useApp } from '@/lib/store'
import { fmtDate, fmtNumber } from '@/lib/format'
import { waitForServerRestart } from '@/lib/wait-for-restart'

interface PeriodRow {
  id: string
  label: string
  closingDate: string
  openingDate: string
  openingEntryNumber: string
  snapshotFile: string
  snapshotBytes: number
  rotatedEntries: number
  closedBy: string
  createdAt: string
}

const fmtSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function PeriodCloseCard() {
  const { toast } = useToast()
  const user = useApp((s) => s.user)
  const isAdmin = user?.role === 'ADMIN'
  const canManage = isAdmin || user?.role === 'ACCOUNTANT'

  const [periods, setPeriods] = useState<PeriodRow[] | null>(null)
  const [draftEntries, setDraftEntries] = useState(0)
  const [loading, setLoading] = useState(true)

  const [closingDate, setClosingDate] = useState('')
  const [label, setLabel] = useState('')
  const [closePassword, setClosePassword] = useState('')
  const [archivePath, setArchivePath] = useState('')
  const [closing, setClosing] = useState(false)

  const [undoing, setUndoing] = useState(false)
  const [undoPassword, setUndoPassword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/period-close')
      const data = (await res.json().catch(() => null)) as
        | { periods?: PeriodRow[]; draftEntries?: number }
        | null
      if (res.ok && data) {
        setPeriods(data.periods ?? [])
        setDraftEntries(data.draftEntries ?? 0)
      }
    } catch {
      // قائمة قديمة تكفي
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canManage) return
    void load()
  }, [canManage, load])

  // الدخول لوضع الاستعراض من الإعدادات مباشرة
  const enterView = async (id: string) => {
    try {
      const res = await fetch('/api/auth/period-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (res.ok && data?.ok) {
        window.location.reload()
      } else {
        toast({ title: 'تعذر الدخول للاستعراض', description: data?.error ?? 'خطأ غير متوقع', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    }
  }

  const runClose = async () => {
    if (!closingDate || !label.trim()) return
    setClosing(true)
    try {
      const res = await fetch('/api/period-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          closingDate,
          label: label.trim(),
          confirm: 'yes',
          password: closePassword,
          archivePath: archivePath.trim() || undefined,
        }),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; period?: { label: string; openingEntryNumber: string; rotatedEntries: number; rotatedDocs?: { invoices: number; payments: number; stockMovements: number; salaries: number; advances: number; leaves: number; attendance: number; bonuses: number; bundlesReset?: number } } }
        | null
      if (res.ok && data?.ok && data.period) {
        const docs = data.period.rotatedDocs
        const docsSummary = docs
          ? `، ودُوّر ${fmtNumber(docs.invoices)} فاتورة و${fmtNumber(docs.payments)} سنداً و${fmtNumber(docs.stockMovements)} حركة مخزون و${fmtNumber(docs.salaries + docs.advances + docs.leaves + docs.attendance + docs.bonuses)} سجل موارد بشرية${typeof docs.bundlesReset === 'number' ? ` وصُفّرت إحصاءات ${fmtNumber(docs.bundlesReset)} سلة` : ''}`
          : ''
        toast({
          title: `أُقفلت الفترة «${data.period.label}» بنجاح`,
          description: `سند القيد الافتتاحي ${data.period.openingEntryNumber} جاهز ودُوّر ${fmtNumber(data.period.rotatedEntries)} قيداً${docsSummary} — النسخة الأرشيفية محفوظة وتظهر في شاشة الدخول للاستعراض، والفترة الجديدة تبدأ بسجلات تفصيلية نظيفة تعتمد على الأرصدة المدوّرة. جارٍ تحديث كل شاشات النظام الآن…`,
        })
        setClosingDate('')
        setLabel('')
        setClosePassword('')
        setArchivePath('')
        // إعادة تحميل شاملة — كل الشاشات المفتوحة قد تحمل بيانات فواتير/قيود دُوّرت للأرشيف
        // للتو، فتُحدَّث كلها دفعة واحدة بدل انتظار تسجيل خروج/دخول يدوي
        setTimeout(() => window.location.reload(), 1600)
      } else {
        toast({ title: 'تعذر تنفيذ الإقفال', description: data?.error ?? 'خطأ غير متوقع', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setClosing(false)
    }
  }

  const runUndo = async (row: PeriodRow) => {
    setUndoing(true)
    try {
      const res = await fetch('/api/period-close/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, confirm: 'yes', password: undoPassword }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null
      if (res.ok && data?.ok) {
        toast({
          title: `جارٍ التراجع عن إقفال «${row.label}»`,
          description: data.message ?? 'يتوقف الخادم الآن — شغّله يدوياً (start-app.bat) لإتمام التراجع',
        })
        // استقصاء تلقائي لعودة الخادم — إعادة تحميل فورية بلا حاجة لتسجيل خروج/دخول يدوي
        waitForServerRestart({
          onServerDown: () =>
            toast({ title: 'توقف الخادم', description: 'شغّل start-app.bat الآن — ستُعاد الصفحة تلقائياً فور عودته' }),
          onTimeout: () =>
            toast({
              title: 'لم يُكتشف عودة الخادم بعد',
              description: 'تحقق من تشغيل start-app.bat يدوياً ثم أعد تحميل الصفحة (F5)',
              variant: 'destructive',
            }),
        })
      } else {
        toast({ title: 'تعذر بدء التراجع', description: data?.error ?? 'خطأ غير متوقع', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setUndoing(false)
      setUndoPassword('')
    }
  }

  if (!canManage) return null

  const latest = periods?.[0] ?? null

  return (
    <SectionCard
      title="إقفال الفترة المحاسبية والتدوير"
      description="إقفال الفترة وترحيل الأرصدة بسند افتتاحي وحفظ نسخة أرشيفية — نهاية كل دورة محاسبية"
      icon={Lock}
    >
      <div className="space-y-5">
        {/* ===== شرح المنظومة ===== */}
        <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2">
          <p className="flex items-start gap-1.5">
            <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            عند الإقفال: تُمنع الإضافة والتعديل على أي مستند مؤرَّخ قبل تاريخ الإقفال، وتُدوَّر القيود
            والمستندات التفصيلية (الفواتير والسندات وحركة المخزون والجرد والرواتب) إلى النسخة الأرشيفية —
            فتبدأ الفترة الجديدة بسجلات تفصيلية نظيفة تماماً.
          </p>
          <p className="flex items-start gap-1.5">
            <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            تُرحَّل أرصدة كل الحسابات والأطراف والموظفين ونقاط الولاء إلى الفترة الجديدة بسند قيد افتتاحي
            (النتيجة إلى الأرباح المحتجزة) مع بقاء أدلة الحسابات والمواد والسلال كاملة.
          </p>
          <p className="flex items-start gap-1.5">
            <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            تُحفظ نسخة أرشيفية كاملة بتاريخ الإقفال — والرجوع إليها من شاشة تسجيل الدخول (تحت زر تسجيل
            الدخول) للمشاهدة فقط دون أي تعديل أو حذف.
          </p>
          <p className="flex items-start gap-1.5">
            <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            يمكن التراجع عن الإقفال (للمدير) مع خسارة كل ما بعده — ولا تُستعاد أي نسخة احتياطية أقدم من سند
            القيد الافتتاحي.
          </p>
        </div>

        {/* ===== الحالة الحالية ===== */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">الفترة الحالية:</span>
          {latest ? (
            <Badge variant="outline" className="gap-1.5 border-amber-500/40 bg-amber-500/10 text-xs">
              <Lock className="h-3 w-3" />
              تبدأ بعد {fmtDate(latest.closingDate)} — آخر إقفال: «{latest.label}»
            </Badge>
          ) : (
            <span className="text-muted-foreground">لم يُنفَّذ أي إقفال بعد — كل التواريخ مفتوحة</span>
          )}
          {draftEntries > 0 && (
            <Badge variant="outline" className="text-xs text-destructive">
              {fmtNumber(draftEntries)} قيد مسودة — رحّلها قبل أي إقفال
            </Badge>
          )}
        </div>

        {/* ===== نموذج الإقفال ===== */}
        <div className="rounded-lg border p-4">
          <p className="mb-3 text-sm font-bold">إقفال فترة جديدة</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="period-close-date">تاريخ الإقفال (آخر يوم في الفترة)</Label>
              <Input
                id="period-close-date"
                type="date"
                value={closingDate}
                onChange={(e) => setClosingDate(e.target.value)}
                className="num h-10"
                dir="ltr"
                disabled={closing}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period-close-label">اسم الفترة المقفلة</Label>
              <Input
                id="period-close-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="مثال: السنة المالية 2025"
                maxLength={80}
                disabled={closing}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period-close-password">كلمة سر المدير (إلزامية للإقفال)</Label>
              <Input
                id="period-close-password"
                type="password"
                value={closePassword}
                onChange={(e) => setClosePassword(e.target.value)}
                autoComplete="off"
                disabled={closing}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period-close-archive-path">مسار حفظ نسخة إضافية من الأرشيف (اختياري)</Label>
              <Input
                id="period-close-archive-path"
                value={archivePath}
                onChange={(e) => setArchivePath(e.target.value)}
                placeholder="مثال: /home/z/archives — الافتراضي: db/periods داخل النظام"
                dir="ltr"
                className="num"
                disabled={closing}
              />
            </div>
          </div>
          <div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-muted-foreground">
              سيُنشأ سند القيد الافتتاحي بتاريخ اليوم التالي للإقفال، وتُحفظ النسخة الأرشيفية (ونسخة إضافية
              بالمسار المختار إن وُجد)، وتُدوَّر القيود حتى تاريخ الإقفال — بشرط كلمة سر المدير الصحيحة.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  className="shrink-0"
                  disabled={closing || !closingDate || !label.trim() || !closePassword}
                >
                  {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                  إقفال الفترة
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>تأكيد إقفال الفترة حتى {closingDate}؟</AlertDialogTitle>
                  <AlertDialogDescription>
                    سيتم: إنشاء سند قيد افتتاحي يرحّل أرصدة كل الحسابات (مع إقفال نتيجة الفترة إلى الأرباح
                    المحتجزة وتفصيل المخزون بالمستودعات) — حفظ نسخة أرشيفية كاملة للفترة — تدوير القيود القديمة إلى الأرشيف — منع أي
                    إنشاء أو تعديل على مستندات مؤرَّخة قبل {closingDate}. يمكن للمدير التراجع عن الإقفال لاحقاً
                    مع خسارة كل ما يتم بعده. هل أنت متأكد؟
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={closing}>إلغاء</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => runClose()}
                    disabled={closing}
                  >
                    نعم — أقفل الفترة بكلمة سر المدير
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* ===== جدول الفترات المقفلة ===== */}
        <div className="rounded-lg border">
          <div className="border-b bg-muted/40 px-3 py-2 text-sm font-bold">
            الفترات المقفلة المحفوظة {periods && periods.length > 0 && `(${periods.length})`}
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جارٍ الجلب…
            </div>
          ) : !periods || periods.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              لا فترات مقفلة بعد — أول إقفال سيحفظ أول نسخة أرشيفية
            </p>
          ) : (
            periods.map((p, idx) => (
              <div
                key={p.id}
                className="flex flex-col gap-2 border-b p-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                    {p.label}
                    {idx === 0 && (
                      <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600 dark:text-amber-400">
                        الأحدث — التراجع متاح عنها فقط
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>الإقفال: {fmtDate(p.closingDate)}</span>
                    <span>
                      سند الافتتاحي: <span className="num font-mono">{p.openingEntryNumber}</span>
                    </span>
                    <span>قيود دُوّرت: {fmtNumber(p.rotatedEntries)}</span>
                    <span>الأرشيف: {fmtSize(p.snapshotBytes)}</span>
                    <span>بواسطة: {p.closedBy}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5 text-xs"
                    onClick={() => enterView(p.id)}
                    aria-label={`استعراض الفترة ${p.label}`}
                  >
                    <Archive className="h-3.5 w-3.5" />
                    استعراض (قراءة فقط)
                  </Button>
                  {isAdmin && idx === 0 && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={undoing}
                          aria-label={`التراجع عن إقفال ${p.label}`}
                        >
                          {undoing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                          التراجع عن الإقفال
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>التراجع عن إقفال «{p.label}»؟</AlertDialogTitle>
                          <AlertDialogDescription>
                            ستُستعاد النسخة الأرشيفية الملتقطة لحظة الإقفال ({fmtDate(p.closingDate)}) و{' '}
                            <span className="font-bold text-destructive">يُخسّر كل ما تم بعدها</span>: سند
                            الافتتاحي {p.openingEntryNumber} وكل قيود وفواتير وسندات أُنشئت بعد الإقفال. تُسجَّل
                            نسخة أمان من الوضع الحالي قبل التراجع. هل أنت متأكد تماماً؟
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="space-y-1.5">
                          <Label htmlFor={`period-undo-password-${p.id}`}>
                            كلمة سر المدير (إلزامية للتراجع)
                          </Label>
                          <Input
                            id={`period-undo-password-${p.id}`}
                            type="password"
                            value={undoPassword}
                            onChange={(e) => setUndoPassword(e.target.value)}
                            autoComplete="off"
                            disabled={undoing}
                          />
                        </div>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={undoing}>إلغاء</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => runUndo(p)}
                            disabled={undoing || !undoPassword}
                            className="bg-destructive text-white hover:bg-destructive/90"
                          >
                            نعم — تراجع واخسر ما بعد الإقفال
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <ArchiveRestore className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          تذكير: استعادة أي نسخة احتياطية تاريخها قبل سند القيد الافتتاحي للفترة المقفلة مرفوضة من النظام —
          استخدم «التراجع عن الإقفال» بدلاً منها.
        </p>
      </div>
    </SectionCard>
  )
}
