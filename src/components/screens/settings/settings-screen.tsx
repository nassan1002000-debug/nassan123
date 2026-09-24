'use client'

// شاشة الإعدادات العامة — بيانات الشركة (رأس الطباعات) + سعر الصرف + نمط الأرقام + معلومات النظام
// كل قسم يحفظ مستقلاً — سعر الصرف يُطبَّق حياً عبر setExchangeRate (نفس آلية نافذة الإعدادات السريعة)
// ونمط الأرقام يُطبَّق بإعادة تحميل الصفحة بنفس مفتاح numeralMode بالحرف

import { useEffect, useRef, useState } from 'react'
import {
  ArchiveRestore,
  BookOpen,
  Building2,
  Coins,
  DatabaseBackup,
  Download,
  Eraser,
  FileText,
  Hash,
  ImagePlus,
  Info,
  Loader2,
  Lock,
  LockKeyhole,
  Package,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { KpiCard } from '@/components/common/kpi-card'
import { SectionCard } from '@/components/common/section-card'
import { PeriodCloseCard } from '@/components/screens/settings/period-close-card'
import { useToast } from '@/hooks/use-toast'
import { waitForServerRestart } from '@/lib/wait-for-restart'
import {
  fmtDate,
  fmtNumber,
  getDecimalPlaces,
  getNumeralMode,
  setDecimalPlaces,
  setExchangeRate,
  setNumeralMode,
  type DecimalPlaces,
  type NumeralMode,
} from '@/lib/format'
import { loadCompanyInfo, MAX_LOGO_LENGTH, type CompanyInfo } from '@/lib/company'
import { getCachedPrintTemplate, loadPrintTemplate, type PrintTemplate } from '@/lib/print-template'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PrintTemplateCard } from '@/components/screens/settings/print-template-card'
import { SignatureSettingsCard } from '@/components/screens/settings/signature-settings-card'
import { useApp, useIsArchive } from '@/lib/store'

interface SystemStats {
  invoices: number
  journalEntries: number
  items: number
  partners: number
  employees: number
  users: number
}

/** وضعا حذف البيانات — FULL تفريغ شامل كامل، FINANCIAL تصفير مالي مع الاحتفاظ بالهياكل */
type ResetMode = 'FULL' | 'FINANCIAL'

/** تطبيع كائن stats القادم من الخادم — أعداد سليمة أو أصفار */
function toStats(v: unknown): SystemStats | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const num = (k: string): number => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? o[k] : 0)
  return {
    invoices: num('invoices'),
    journalEntries: num('journalEntries'),
    items: num('items'),
    partners: num('partners'),
    employees: num('employees'),
    users: num('users'),
  }
}

const EMPTY_COMPANY: CompanyInfo = {
  companyName: '',
  companyPhone: '',
  companyAddress: '',
  companyEmail: '',
  companyLogo: '',
}

export function SettingsScreen() {
  const { toast } = useToast()
  // وضع استعراض أرشيف فترة مقفلة — يخفي أزرار الحفظ والكتابة الخطرة
  // (بطاقة الفترات المحاسبية period-close-card مستثناة عمداً — أزرارها تبقى عاملة)
  const isArchive = useIsArchive()

  // ===== بيانات الشركة =====
  const [company, setCompany] = useState<CompanyInfo>(EMPTY_COMPANY)
  const [savingCompany, setSavingCompany] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  // ===== قالب الطباعة — حالة مرفوعة يشترك فيها تبويبا «بيانات الهوية والتوقيعات»
  // (بطاقة التوقيعات) و«تصميم الترويسة والمعاينة» (PrintTemplateCard) معاً، فتبقى
  // المعاينة الحية في التبويب الثاني متزامنة فوراً مع أي تعديل توقيع في الأول
  const [tpl, setTpl] = useState<PrintTemplate>(() => getCachedPrintTemplate())

  // ===== الإعدادات المالية =====
  const [rate, setRate] = useState('')
  const [savingRate, setSavingRate] = useState(false)

  // ===== عرض الأرقام =====
  const [mode, setMode] = useState<NumeralMode>('latin')
  const [decimals, setDecimals] = useState<DecimalPlaces>(() => getDecimalPlaces())
  const [savingDecimals, setSavingDecimals] = useState(false)

  // ===== معلومات النظام =====
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [loading, setLoading] = useState(true)

  // ===== منطقة الخطر — حذف البيانات بوضعين (للمدير فقط + كلمة مرور المدير إلزامية) =====
  const user = useApp((s) => s.user)
  const isAdmin = user?.role === 'ADMIN'
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetMode, setResetMode] = useState<ResetMode | null>(null)
  const [adminPassword, setAdminPassword] = useState('')

  // ===== النسخ الاحتياطي (P1-7 — للمدير فقط) =====
  interface BackupRow {
    name: string
    sizeBytes: number
    createdAt: string
    kind: 'auto' | 'manual' | 'pre-restore' | 'other'
    /** محجوبة بحارس النسخ الاحتياطية — أقدم من سند القيد الافتتاحي للفترة الحالية */
    blocked?: boolean
  }
  const [backups, setBackups] = useState<BackupRow[]>([])
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [creatingBackup, setCreatingBackup] = useState(false)
  const [restoringFile, setRestoringFile] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [backupCustomDir, setBackupCustomDir] = useState('')
  const [savingBackupDir, setSavingBackupDir] = useState(false)

  // الجلب الأول: بيانات الشركة وقالب الطباعة (تُخزّن الكاش للطباعة أيضاً) + سعر الصرف + الإحصاءات
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [info, printTpl, settingsRes] = await Promise.all([
          loadCompanyInfo(),
          loadPrintTemplate(),
          fetch('/api/settings?stats=1'),
        ])
        const data = (await settingsRes.json().catch(() => null)) as Record<string, unknown> | null
        if (!alive) return
        setCompany({
          companyName: info.companyName,
          companyPhone: info.companyPhone,
          companyAddress: info.companyAddress,
          companyEmail: info.companyEmail,
          companyLogo: info.companyLogo,
        })
        setTpl(printTpl)
        if (settingsRes.ok && data) {
          const parsed = Number.parseFloat(String(data.exchangeRate ?? ''))
          if (Number.isFinite(parsed)) setRate(String(parsed))
          setBackupCustomDir(typeof data.backupCustomDir === 'string' ? data.backupCustomDir : '')
          setStats(toStats(data.stats))
        }
      } catch {
        if (alive) {
          toast({ title: 'تعذر تحميل الإعدادات', description: 'تحقق من الاتصال ثم أعد المحاولة', variant: 'destructive' })
        }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [toast])

  // ===== حذف البيانات بوضعيه — نهائي غير قابل للتراجع + كلمة مرور المدير إلزامية =====
  // FINANCIAL: تصفير مالي مع الاحتفاظ بالهياكل — FULL: تفريغ شامل كامل
  async function runReset() {
    if (!resetMode || !adminPassword) return
    const mode = resetMode
    setResetting(true)
    try {
      const res = await fetch('/api/reset?confirm=yes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, adminPassword }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (res.ok && data?.ok) {
        if (mode === 'FINANCIAL') {
          toast({
            title: 'تم التصفير المالي بنجاح',
            description:
              'مُسحت الفواتير والسندات والقيود وحركات المخزون وصُفّرت الأرصدة — تبقى الأطراف وبطاقات المواد وشجرة الحسابات وهيكل المستودعات مفرغة الأرصدة جاهزة للعمل الفعلي',
          })
          setStats({
            invoices: 0,
            journalEntries: 0,
            items: stats?.items ?? 0,
            partners: stats?.partners ?? 0,
            employees: stats?.employees ?? 0,
            users: stats?.users ?? 0,
          })
        } else {
          toast({
            title: 'تم التفريغ الشامل بنجاح',
            description:
              'النظام جاهز ببيانات جديدة — أُعيد بناء دليل الحسابات الأساسي وبقيت حسابات الدخول والإعدادات',
          })
          setStats({
            invoices: 0,
            journalEntries: 0,
            items: 0,
            partners: 0,
            employees: 0,
            users: stats?.users ?? 0,
          })
        }
        // نجاح فقط يغلق النافذة ويمسح كلمة المرور — الفشل يبقيها مفتوحة لتصحيح الإدخال
        setAdminPassword('')
        setResetMode(null)
        setResetOpen(false)
      } else {
        toast({ title: 'تعذر حذف البيانات', description: data?.error ?? 'خطأ غير متوقع', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', description: 'تحقق من الاتصال ثم أعد المحاولة', variant: 'destructive' })
    } finally {
      setResetting(false)
    }
  }

  // ===== النسخ الاحتياطي — جلب القائمة وإنشاء نسخة واستعادة (P1-7) =====
  const loadBackups = async () => {
    setLoadingBackups(true)
    try {
      const res = await fetch('/api/backup')
      const data = (await res.json().catch(() => null)) as { backups?: BackupRow[] } | null
      if (res.ok && data?.backups) setBackups(data.backups)
    } catch {
      // قائمة قديمة تكفي — لا إزعاج
    } finally {
      setLoadingBackups(false)
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    void loadBackups()
  }, [isAdmin])

  async function runCreateBackup() {
    setCreatingBackup(true)
    try {
      const res = await fetch('/api/backup', { method: 'POST' })
      const data = (await res.json().catch(() => null)) as {
        backups?: BackupRow[]
        error?: string
        customDir?: { path: string; ok: boolean; error?: string } | null
      } | null
      if (res.ok && data?.backups) {
        setBackups(data.backups)
        if (data.customDir && !data.customDir.ok) {
          toast({
            title: 'أُنشئت النسخة — لكن تعذّر نسخها إلى المسار المخصص',
            description: data.customDir.error ?? 'راجع مسار الحفظ الإضافي في الأسفل',
            variant: 'destructive',
          })
        } else {
          toast({
            title: 'تم إنشاء النسخة الاحتياطية',
            description:
              data.customDir?.ok
                ? `نُسخت إلى db/backups، ونسخة إضافية إلى: ${data.customDir.path}`
                : 'نُسخت القاعدة كاملةً بنسخة متسقة إلى db/backups',
          })
        }
      } else {
        toast({ title: 'تعذر إنشاء النسخة', description: data?.error ?? 'خطأ غير متوقع', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', description: 'تحقق من الاتصال ثم أعد المحاولة', variant: 'destructive' })
    } finally {
      setCreatingBackup(false)
    }
  }

  async function runRestoreBackup() {
    if (!restoringFile) return
    setRestoring(true)
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: restoringFile, confirm: 'yes' }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null
      if (res.ok && data?.ok) {
        toast({
          title: 'جارٍ تنفيذ الاستعادة',
          description: data.message ?? 'يتوقف الخادم الآن — شغّله يدوياً (start-app.bat) لإتمام الاستعادة',
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
        toast({ title: 'تعذر بدء الاستعادة', description: data?.error ?? 'خطأ غير متوقع', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', description: 'تحقق من الاتصال ثم أعد المحاولة', variant: 'destructive' })
    } finally {
      setRestoring(false)
      setRestoringFile(null)
    }
  }

  // ===== حفظ مسار النسخ الاحتياطية المخصص — نسخة إضافية بعد db/backups لكل نسخة يدوية =====
  const saveBackupCustomDir = async () => {
    setSavingBackupDir(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupCustomDir: backupCustomDir.trim() }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok || !data) {
        toast({ title: 'تعذر حفظ مسار النسخ الاحتياطية', description: data?.error ?? 'خطأ غير متوقع', variant: 'destructive' })
        return
      }
      toast({
        title: 'تم حفظ مسار النسخ الاحتياطية',
        description: backupCustomDir.trim()
          ? 'كل نسخة يدوية جديدة ستُنسخ إضافياً إلى هذا المسار بعد حفظها في db/backups'
          : 'أُزيل المسار المخصص — النسخ ستُحفظ في db/backups فقط',
      })
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSavingBackupDir(false)
    }
  }

  const fmtSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  const AR_KIND: Record<BackupRow['kind'], string> = {
    auto: 'تلقائية',
    manual: 'يدوية',
    'pre-restore': 'أمان استعادة',
    other: '—',
  }

  // ===== حفظ بيانات الشركة — القسم مستقل ويتحقق محلياً قبل الإرسال =====
  const saveCompany = async () => {
    const name = company.companyName.trim()
    const phone = company.companyPhone.trim()
    const address = company.companyAddress.trim()
    const email = company.companyEmail.trim()
    if (name.length < 2 || name.length > 80) {
      toast({ title: 'اسم الشركة غير صالح', description: 'أدخل اسماً بين 2 و 80 حرفاً', variant: 'destructive' })
      return
    }
    if (phone.length > 30) {
      toast({ title: 'الهاتف غير صالح', description: 'يجب ألا يتجاوز 30 محرفاً', variant: 'destructive' })
      return
    }
    if (address.length > 120) {
      toast({ title: 'العنوان غير صالح', description: 'يجب ألا يتجاوز 120 محرفاً', variant: 'destructive' })
      return
    }
    if (email.length > 80 || (email && !email.includes('@'))) {
      toast({ title: 'البريد الإلكتروني غير صالح', description: 'يجب أن يحتوي على @ وبحد أقصى 80 محرفاً', variant: 'destructive' })
      return
    }
    setSavingCompany(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: name,
          companyPhone: phone,
          companyAddress: address,
          companyEmail: email,
          companyLogo: company.companyLogo,
        }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok || !data) {
        toast({ title: 'تعذر حفظ بيانات الشركة', description: data?.error ?? 'حدث خطأ غير متوقع', variant: 'destructive' })
        return
      }
      // مزامنة كاش الطباعة فوراً + تطبيع الحقول من استجابة الخادم
      const info = await loadCompanyInfo()
      setCompany({
        companyName: info.companyName,
        companyPhone: info.companyPhone,
        companyAddress: info.companyAddress,
        companyEmail: info.companyEmail,
        companyLogo: info.companyLogo,
      })
      toast({
        title: 'تم حفظ بيانات الشركة',
        description: company.companyLogo
          ? 'ستظهر بيانات الشركة وشعارها في رأس كل التقارير المطبوعة'
          : 'ستظهر هذه البيانات في رأس كل التقارير المطبوعة',
      })
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSavingCompany(false)
    }
  }

  // ===== حفظ سعر الصرف — تطبيق فوري عبر setExchangeRate (نفس آلية نافذة الإعدادات بالحرف) =====
  const saveRate = async () => {
    const v = Number.parseFloat(rate)
    if (!Number.isFinite(v) || v < 1 || v > 1_000_000) {
      toast({ title: 'سعر الصرف غير صالح', description: 'أدخل رقماً بين 1 و 1,000,000', variant: 'destructive' })
      return
    }
    setSavingRate(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchangeRate: v }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string; exchangeRate?: string } | null
      if (!res.ok || !data) {
        toast({ title: 'تعذر حفظ سعر الصرف', description: data?.error ?? 'حدث خطأ غير متوقع', variant: 'destructive' })
        return
      }
      const savedRate = Number.parseFloat(String(data.exchangeRate ?? v))
      if (Number.isFinite(savedRate)) setExchangeRate(savedRate)
      toast({ title: 'تم حفظ سعر الصرف', description: `سعر الصرف الآن: 1$ = ${savedRate} ل.س` })
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSavingRate(false)
    }
  }

  // ===== تبديل نمط الأرقام — يُخزن فوراً ثم إعادة تحميل (نفس سلوك نافذة الإعدادات الحرفي) =====
  const changeMode = (m: NumeralMode) => {
    if (m === getNumeralMode()) return
    setNumeralMode(m)
    window.location.reload()
  }

  // ===== تبديل الخانات العشرية — يُحفظ بالقاعدة ثم يُخزن محلياً وإعادة تحميل لكل الشاشات =====
  const changeDecimals = async (v: string) => {
    const n = Number(v) as DecimalPlaces
    if (n === getDecimalPlaces()) return
    setSavingDecimals(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decimalPlaces: n }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok || !data) {
        toast({ title: 'تعذر حفظ الخانات العشرية', description: data?.error ?? 'حدث خطأ غير متوقع', variant: 'destructive' })
        return
      }
      setDecimalPlaces(n)
      window.location.reload()
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSavingDecimals(false)
    }
  }

  // ===== رفع الشعار — قراءة الملف وتصغيره على canvas إلى 240px داخل حد 200KB =====
  const handleLogoFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({ title: 'ملف غير مدعوم', description: 'اختر صورة بصيغة PNG أو JPG أو WEBP', variant: 'destructive' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new window.Image()
      img.onload = () => {
        const MAX = 240
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0, w, h)
        // PNG أولاً (يحفظ الشفافية) وJPEG احتياطاً إن تجاوز الحد
        let dataUrl = canvas.toDataURL('image/png')
        if (dataUrl.length > MAX_LOGO_LENGTH) dataUrl = canvas.toDataURL('image/jpeg', 0.85)
        if (dataUrl.length > MAX_LOGO_LENGTH) {
          toast({ title: 'الشعار كبير جداً', description: 'جرّب صورة أصغر أبعاداً أو حجماً', variant: 'destructive' })
          return
        }
        setCompany((c) => ({ ...c, companyLogo: dataUrl }))
        toast({ title: 'تم اختيار الشعار', description: 'اضغط «حفظ بيانات الشركة» لتثبيته على قسائم الطباعة' })
      }
      img.onerror = () => toast({ title: 'تعذر قراءة الصورة', description: 'قد يكون الملف تالفاً', variant: 'destructive' })
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const busy = savingCompany || savingRate

  return (
    <Tabs defaultValue="company">
      {/* تبويبات الإعدادات (Task 26): هوية الشركة / قوالب الطباعة / عام / النظام والأمان */}
      <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
        <TabsTrigger value="company">بيانات الهوية والتوقيعات</TabsTrigger>
        <TabsTrigger value="print">تصميم الترويسة والمعاينة</TabsTrigger>
        <TabsTrigger value="general">عام</TabsTrigger>
        <TabsTrigger value="system">النظام والأمان</TabsTrigger>
      </TabsList>

      <TabsContent value="company" className="mt-4 space-y-4">
      {/* ===== بيانات الشركة ===== */}
      <SectionCard
        title="بيانات الشركة"
        description="الاسم والهاتف والعنوان والبريد — تظهر في رأس كل التقارير المطبوعة"
        icon={Building2}
      >
        <div className="max-w-2xl space-y-3">
            {/* رفع شعار الشركة — يُصغَّر تلقائياً ويظهر في رأس الطباعة */}
            <div className="space-y-1.5">
              <Label>شعار الشركة (يظهر في رأس كل قسائم الطباعة)</Label>
              <div className="flex items-center gap-3">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white">
                  {company.companyLogo ? (
                    <img src={company.companyLogo} alt="شعار الشركة" className="h-full w-full object-contain" />
                  ) : (
                    <ImagePlus className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    aria-label="اختيار صورة الشعار"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handleLogoFile(f)
                      e.target.value = ''
                    }}
                  />
                  {!isArchive && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={loading || savingCompany}
                    >
                      <ImagePlus className="h-4 w-4" aria-hidden="true" />
                      {company.companyLogo ? 'تغيير الشعار' : 'تحميل صورة'}
                    </Button>
                  )}
                  {company.companyLogo && !isArchive && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setCompany((c) => ({ ...c, companyLogo: '' }))}
                      disabled={savingCompany}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      إزالة
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                PNG أو JPG أو WEBP — يُصغَّر تلقائياً إلى 240px (حتى 200KB) — يُثبَّت مع حفظ بيانات الشركة
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="company-name">اسم الشركة</Label>
                <Input
                  id="company-name"
                  value={company.companyName}
                  onChange={(e) => setCompany((c) => ({ ...c, companyName: e.target.value }))}
                  placeholder="شركة الأمل التجارية 2026"
                  maxLength={80}
                  disabled={loading || savingCompany}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company-phone">الهاتف</Label>
                <Input
                  id="company-phone"
                  dir="ltr"
                  className="num"
                  inputMode="tel"
                  value={company.companyPhone}
                  onChange={(e) => setCompany((c) => ({ ...c, companyPhone: e.target.value }))}
                  placeholder="011 123 4567"
                  maxLength={30}
                  disabled={loading || savingCompany}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company-address">العنوان</Label>
                <Input
                  id="company-address"
                  value={company.companyAddress}
                  onChange={(e) => setCompany((c) => ({ ...c, companyAddress: e.target.value }))}
                  placeholder="دمشق — شارع بغداد"
                  maxLength={120}
                  disabled={loading || savingCompany}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="company-email">البريد الإلكتروني</Label>
                <Input
                  id="company-email"
                  dir="ltr"
                  type="email"
                  value={company.companyEmail}
                  onChange={(e) => setCompany((c) => ({ ...c, companyEmail: e.target.value }))}
                  placeholder="info@amal-trade.com"
                  maxLength={80}
                  disabled={loading || savingCompany}
                />
                <p className="text-xs text-muted-foreground">يمكن تركه فارغاً — إن وُجد يجب أن يحتوي على @</p>
              </div>
            </div>
            <div className="pt-1">
              {!isArchive && (
                <Button onClick={saveCompany} disabled={loading || busy}>
                  {savingCompany ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="h-4 w-4" aria-hidden="true" />
                  )}
                  حفظ بيانات الشركة
                </Button>
              )}
            </div>
        </div>
      </SectionCard>

      {/* ===== التوقيعات — بطاقة مستقلة تجاور بيانات الهوية في نفس التبويب ===== */}
      <SignatureSettingsCard tpl={tpl} setTpl={setTpl} />
      </TabsContent>

      {/* ===== تصميم الترويسة والمعاينة — التخصيص الديناميكي (Task 26) ===== */}
      <TabsContent value="print" className="mt-4 space-y-4">
        <PrintTemplateCard tpl={tpl} setTpl={setTpl} company={company} />
      </TabsContent>

      <TabsContent value="general" className="mt-4 space-y-4">
      {/* ===== الإعدادات المالية ===== */}
      <SectionCard
        title="الإعدادات المالية"
        description="سعر صرف الدولار المستخدم لعرض ما يعادل (≈ $) بجانب كل المبالغ"
        icon={Coins}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5 sm:max-w-xs">
            <Label htmlFor="exchange-rate">سعر صرف الدولار (ل.س)</Label>
            <Input
              id="exchange-rate"
              type="number"
              inputMode="decimal"
              min={1}
              max={1000000}
              step="any"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="num"
              dir="ltr"
              placeholder="130"
              aria-describedby="exchange-rate-hint"
              disabled={loading || savingRate}
            />
            <p id="exchange-rate-hint" className="text-xs text-muted-foreground">
              قيمة بين 1 و 1,000,000 — 1$ = X ل.س، ويُطبَّق فوراً بعد الحفظ
            </p>
          </div>
          {!isArchive && (
            <Button onClick={saveRate} disabled={loading || savingRate}>
              {savingRate && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              حفظ سعر الصرف
            </Button>
          )}
        </div>
      </SectionCard>

      {/* ===== عرض الأرقام ===== */}
      <SectionCard
        title="عرض الأرقام"
        description="نمط الأرقام والخانات العشرية للمبالغ في كل الشاشات والتقارير"
        icon={Hash}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="numeral-mode">نمط الأرقام</Label>
            <Select
              value={mode}
              onValueChange={(v) => changeMode(v as NumeralMode)}
              disabled={loading || isArchive}
            >
              <SelectTrigger id="numeral-mode" aria-label="نمط الأرقام">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latin">أرقام إنجليزية (012)</SelectItem>
                <SelectItem value="arabic">أرقام عربية (٠١٢)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">تُطبَّق بإعادة تحميل الصفحة</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="decimal-places">الخانات العشرية للمبالغ</Label>
            <Select
              value={String(decimals)}
              onValueChange={changeDecimals}
              disabled={loading || savingDecimals || isArchive}
            >
              <SelectTrigger id="decimal-places" aria-label="الخانات العشرية للمبالغ">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">بدون علامة عشرية — 100</SelectItem>
                <SelectItem value="1">منزلة واحدة — 100.1</SelectItem>
                <SelectItem value="2">منزلتان — 100.01</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">تُطبَّق على كل المبالغ (ل.س و ≈$) بإعادة تحميل الصفحة</p>
          </div>
        </div>
      </SectionCard>
      </TabsContent>

      <TabsContent value="system" className="mt-4 space-y-4">
      {/* ===== معلومات النظام (قراءة فقط) ===== */}
      <SectionCard
        title="معلومات النظام"
        description="إحصاءات عامة بعدد السجلات في القاعدة — للقراءة فقط"
        icon={Info}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiCard title="الفواتير" value={fmtNumber(stats?.invoices ?? 0)} icon={FileText} tone="gold" loading={loading} />
          <KpiCard title="القيود اليومية" value={fmtNumber(stats?.journalEntries ?? 0)} icon={BookOpen} tone="emerald" loading={loading} />
          <KpiCard title="المواد" value={fmtNumber(stats?.items ?? 0)} icon={Package} tone="amber" loading={loading} />
          <KpiCard title="العملاء والموردون" value={fmtNumber(stats?.partners ?? 0)} icon={Users} tone="gold" loading={loading} />
          <KpiCard title="الموظفون" value={fmtNumber(stats?.employees ?? 0)} icon={UserRound} tone="slate" loading={loading} />
          <KpiCard title="المستخدمون" value={fmtNumber(stats?.users ?? 0)} icon={ShieldCheck} tone="rose" loading={loading} />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <p>
            النظام: <span className="font-semibold text-foreground">نظام المحاسبة والمخزون</span>
          </p>
          <p className="flex items-center gap-1.5">
            الإصدار: <Badge variant="outline" className="num">1.0</Badge>
          </p>
        </div>
      </SectionCard>

      {/* ===== النسخ الاحتياطي — للمدير فقط (P1-7) ===== */}
      {isAdmin && (
        <SectionCard
          title="النسخ الاحتياطي"
          description="نسخ متسقة من قاعدة البيانات — تلقائية كل ساعة (تُحفظ آخر 24) ويدوية عند الطلب"
          icon={DatabaseBackup}
        >
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                النسخ تُحفظ داخل مجلد <code dir="ltr" className="rounded bg-muted px-1 py-0.5 font-mono">db/backups</code> على الجهاز نفسه —
                أنشئ نسخة يدوية قبل أي عملية كبيرة، وللاحتفاظ الخارجي نزّل النسخة واحفظها على وسيط خارج الجهاز.
                الاستعادة تنشئ نسخة أمان أولاً ثم تعيد تشغيل النظام تلقائياً.
                <span className="mt-1 flex items-start gap-1 text-amber-600 dark:text-amber-400">
                  <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  حارس النسخ الاحتياطية: يُمنع منعاً باتاً استرجاع أو تحميل أي نسخة أقدم من سند القيد
                  الافتتاحي للفترة الحالية — لمنع إفساد التوازن المالي أو خلط بيانات الفترات.
                </span>
              </p>
              {!isArchive && (
                <Button onClick={runCreateBackup} disabled={creatingBackup} className="shrink-0">
                  {creatingBackup ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <DatabaseBackup className="h-4 w-4" aria-hidden="true" />
                  )}
                  إنشاء نسخة الآن
                </Button>
              )}
            </div>

            <div className="max-h-64 overflow-y-auto rounded-lg border" role="list" aria-label="قائمة النسخ الاحتياطية">
              {loadingBackups ? (
                <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  جارٍ جلب النسخ…
                </div>
              ) : backups.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  لا نسخ احتياطية بعد — الأولى التلقائية تُنشأ بعد دقائق من إقلاع النظام، أو أنشئ نسخة الآن
                </p>
              ) : (
                backups.map((b) => (
                  <div
                    key={b.name}
                    role="listitem"
                    className="flex flex-col gap-2 border-b p-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p dir="ltr" className="truncate font-mono text-xs" style={{ textAlign: 'right' }}>
                        {b.name}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                          {AR_KIND[b.kind]}
                        </Badge>
                        {b.blocked && (
                          <Badge
                            variant="outline"
                            className="gap-1 border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-600 dark:text-amber-400"
                            title="أقدم من سند القيد الافتتاحي للفترة الحالية — الاسترجاع والتحميل محجوبان بحارس النسخ الاحتياطية"
                          >
                            <Lock className="h-3 w-3" aria-hidden="true" />
                            محجوبة — قبل الافتتاحي
                          </Badge>
                        )}
                        <span>{fmtSize(b.sizeBytes)}</span>
                        <span dir="ltr" className="font-mono">
                          {fmtDate(b.createdAt)}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {b.blocked ? (
                        <span
                          className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-md border px-3 text-xs font-medium text-muted-foreground opacity-60"
                          title="محجوبة بحارس النسخ الاحتياطية — أقدم من سند القيد الافتتاحي للفترة الحالية"
                          aria-disabled="true"
                        >
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                          تنزيل محجوب
                        </span>
                      ) : (
                        <a
                          href={`/api/backup/download?file=${encodeURIComponent(b.name)}`}
                          className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                          aria-label={`تنزيل النسخة ${b.name}`}
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          تنزيل
                        </a>
                      )}
                      {!isArchive && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 gap-1.5 text-xs"
                          onClick={() => setRestoringFile(b.name)}
                          disabled={b.kind === 'pre-restore' || b.blocked}
                          title={b.blocked ? 'محجوبة بحارس النسخ الاحتياطية — أقدم من سند القيد الافتتاحي للفترة الحالية' : undefined}
                          aria-label={`استعادة النسخة ${b.name}`}
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                          استعادة
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {!isArchive && (
              <div className="space-y-1.5 border-t pt-3">
                <Label htmlFor="backup-custom-dir">مسار حفظ نسخة إضافية من النسخ الاحتياطية (اختياري)</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="backup-custom-dir"
                    value={backupCustomDir}
                    onChange={(e) => setBackupCustomDir(e.target.value)}
                    placeholder="مثال: D:\نسخ-احتياطية — الافتراضي: db/backups داخل النظام فقط"
                    dir="ltr"
                    className="num"
                    disabled={savingBackupDir}
                  />
                  <Button
                    variant="outline"
                    className="shrink-0"
                    onClick={saveBackupCustomDir}
                    disabled={savingBackupDir}
                  >
                    {savingBackupDir ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                    حفظ المسار
                  </Button>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  عند تحديد مسار، تُنسخ كل نسخة يدوية جديدة («إنشاء نسخة الآن») إليه أيضاً بعد حفظها في{' '}
                  <code dir="ltr" className="rounded bg-muted px-1 py-0.5 font-mono">db/backups</code> — النسخ التلقائية
                  والأمان قبل عمليات الاستعادة/التصفير غير متأثرة وتبقى في مكانها الافتراضي دوماً.
                </p>
              </div>
            )}

            <AlertDialog open={restoringFile !== null} onOpenChange={(open) => !open && setRestoringFile(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>استعادة النسخة الاحتياطية؟</AlertDialogTitle>
                  <AlertDialogDescription>
                    كل البيانات الحالية ستُستبدل بمحتوى النسخة «{restoringFile}». تُنشئ النظام تلقائياً نسخة أمان من
                    الوضع الحالي قبل الاستبدال، ثم يُعاد تشغيل الخادم وتعود الشاشة للعمل خلال نصف دقيقة تقريباً. هل
                    أنت متأكد تماماً؟
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={restoring}>إلغاء</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault()
                      runRestoreBackup()
                    }}
                    disabled={restoring}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
                    نعم — استعد هذه النسخة
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </SectionCard>
      )}

      {/* ===== إقفال الفترة المحاسبية والتدوير — للمدير والمحاسب ===== */}
      <PeriodCloseCard />

      {/* ===== منطقة الخطر — حذف البيانات بوضعين (للمدير فقط) ===== */}
      {isAdmin && (
        <SectionCard
          title="منطقة الخطر"
          description="عمليات حذف نهائية غير قابلة للتراجع — للمدير فقط ومحمية بكلمة مرور المدير"
          icon={Trash2}
        >
          <div className="flex flex-col gap-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold">حذف البيانات — وضعان</p>
              <p className="text-xs text-muted-foreground">
                «تصفير مالي مع الاحتفاظ بالهياكل» يمسح الفواتير والقيود والسندات وحركات المخزون والمالية فقط ويحافظ
                على الأطراف وبطاقات المواد وشجرة الحسابات وهيكل المستودعات مفرغة الأرصدة — و«تفريغ شامل كامل» يمسح
                كل شيء في القاعدة. كلتاهما تتطلب كلمة مرور المدير وتُنشئ نسخة أمان تلقائياً قبل التنفيذ.
              </p>
            </div>
            <Dialog
              open={resetOpen}
              onOpenChange={(o) => {
                setResetOpen(o)
                // إغلاق النافذة يمسح الاختيار وكلمة المرور — لا يبقى سر في الحالة
                if (!o && !resetting) {
                  setResetMode(null)
                  setAdminPassword('')
                }
              }}
            >
              <DialogTrigger asChild>
                {!isArchive && (
                  <Button variant="destructive" disabled={loading || resetting} className="shrink-0">
                    {resetting ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    )}
                    حذف البيانات
                  </Button>
                )}
              </DialogTrigger>
              <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle>حذف البيانات — اختر الوضع</DialogTitle>
                  <DialogDescription>
                    عملية نهائية غير قابلة للتراجع — تُنشأ نسخة أمان تلقائياً قبل التنفيذ، ويُطلب تأكيد كلمة مرور
                    المدير إلزامياً.
                  </DialogDescription>
                </DialogHeader>

                {/* خيارا الحذف */}
                <div role="radiogroup" aria-label="وضع حذف البيانات" className="grid gap-3">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={resetMode === 'FINANCIAL'}
                    onClick={() => setResetMode('FINANCIAL')}
                    disabled={resetting}
                    className={cn(
                      'rounded-lg border p-4 text-right transition-colors',
                      resetMode === 'FINANCIAL'
                        ? 'border-destructive bg-destructive/10 ring-1 ring-destructive'
                        : 'hover:border-destructive/50 hover:bg-destructive/5',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Eraser className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
                      <span className="text-sm font-semibold">تصفير مالي مع الاحتفاظ بالهياكل</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      يمسح فقط: الفواتير والقيود والسندات وحركات المخزون والجرد ورواتب وسلف ومكافآت الموظفين —
                      ويصفّر أرصدة الحسابات والمواد.
                    </p>
                    <p className="mt-1 text-xs font-medium leading-relaxed text-emerald-600 dark:text-emerald-400">
                      ويحافظ كاملاً على: أسماء العملاء والموردين والشركاء، بطاقات المواد، شجرة الحسابات، الهيكل
                      الهرمي للمستودعات، الموظفين ومراكز التكلفة — مفرغة الأرصدة وجاهزة للعمل الفعلي دون تعديل أي
                      شيء.
                    </p>
                  </button>

                  <button
                    type="button"
                    role="radio"
                    aria-checked={resetMode === 'FULL'}
                    onClick={() => setResetMode('FULL')}
                    disabled={resetting}
                    className={cn(
                      'rounded-lg border p-4 text-right transition-colors',
                      resetMode === 'FULL'
                        ? 'border-destructive bg-destructive/10 ring-1 ring-destructive'
                        : 'hover:border-destructive/50 hover:bg-destructive/5',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Trash2 className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
                      <span className="text-sm font-semibold">تفريغ شامل كامل</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      يمسح كل شيء في القاعدة: الفواتير والسندات والقيود وبطاقات المواد والأطراف والمستودعات
                      والموظفين ومراكز التكلفة وسجل التدقيق.
                    </p>
                    <p className="mt-1 text-xs font-medium leading-relaxed text-amber-600 dark:text-amber-400">
                      ويبقي فقط حسابات الدخول والإعدادات — ويُعيد بناء دليل الحسابات الأساسي (25 حساباً).
                    </p>
                  </button>
                </div>

                {/* حماية المدير — كلمة المرور إلزامية */}
                <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <Label htmlFor="reset-admin-password" className="flex items-center gap-1.5 text-sm font-semibold">
                    <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                    كلمة مرور المدير (إلزامية)
                  </Label>
                  <Input
                    id="reset-admin-password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="أدخل كلمة مرور المدير لتأكيد الحذف"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && resetMode && adminPassword && !resetting) void runReset()
                    }}
                    disabled={resetting}
                  />
                  <p className="text-xs text-muted-foreground">
                    الحذف لن يبدأ إلا بعد التحقق من كلمة مرور المدير الحقيقية — والفشل المتكرر محدود بخمس محاولات
                    كل 10 دقائق.
                  </p>
                </div>

                <DialogFooter className="gap-2">
                  <Button
                    variant="outline"
                    disabled={resetting}
                    onClick={() => {
                      // الإلغاء الصريح يمسح الاختيار وكلمة المرور فوراً — onOpenChange لا يُطلق
                      // عند ضبط الحالة يدوياً فالمسح هنا إلزامي كي لا يبقى سر في الذاكرة
                      setResetOpen(false)
                      setResetMode(null)
                      setAdminPassword('')
                    }}
                  >
                    إلغاء
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={resetting || !resetMode || !adminPassword}
                    onClick={() => void runReset()}
                  >
                    {resetting ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : resetMode === 'FINANCIAL' ? (
                      'نعم — تصفير مالي'
                    ) : resetMode === 'FULL' ? (
                      'نعم — تفريغ شامل كامل'
                    ) : (
                      'اختر وضع الحذف أولاً'
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </SectionCard>
      )}
      </TabsContent>
    </Tabs>
  )
}

export default SettingsScreen
