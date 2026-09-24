'use client'

// شاشة العملاء والموردين — ملفات الأطراف مع الأرصدة والمستندات
// الأرصدة: العميل = فواتير البيع − المسدد ضمنها − سندات القبض المستقلة · المورد بالعكس

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Eye,
  GitMerge,
  Inbox,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Users,
  UsersRound,
  Wallet,
  X,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { KpiCard } from '@/components/common/kpi-card'
import { SectionCard } from '@/components/common/section-card'
import { TableActions } from '@/components/screens/common/table-actions'
import { useToast } from '@/hooks/use-toast'
import { useActionBus } from '@/lib/action-bus'
import { useIsArchive } from '@/lib/store'
import { AR_PARTNER_TYPE, fmtMoney, fmtNumber, fmtUSD } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PartnerFormDialog } from './partner-form-dialog'
import { PartnerViewDialog } from './partner-view-dialog'
import {
  UnifiedPartyDialog,
  type UnifiedPartyTarget,
} from '@/components/screens/common/unified-party-dialog'
import type { PartnerListStats, PartnerRow } from './types'

const PAGE_SIZE = 15

interface Filters {
  type: string
  status: string
  q: string
}

const EMPTY_FILTERS: Filters = { type: 'ALL', status: 'ALL', q: '' }

const EMPTY_STATS: PartnerListStats = {
  customersCount: 0,
  suppliersCount: 0,
  customersDebt: 0,
  suppliersDue: 0,
}

/** وصف حالة الرصيد حسب النوع وإشارته */
function balanceMeta(type: string, balance: number): { label: string; className: string } {
  if (balance === 0) return { label: 'مسدد', className: 'text-muted-foreground' }
  if (type === 'CUSTOMER') {
    return balance > 0
      ? { label: 'مدين لنا', className: 'text-emerald-600 dark:text-emerald-400' }
      : { label: 'دفع مقدم', className: 'text-amber-600 dark:text-amber-400' }
  }
  return balance > 0
    ? { label: 'علينا له', className: 'text-rose-600 dark:text-rose-400' }
    : { label: 'دفعنا مقدم', className: 'text-amber-600 dark:text-amber-400' }
}

export function PartnersScreen() {
  const { toast } = useToast()

  // وضع استعراض أرشيف فترة مقفلة — يخفي أزرار الكتابة (الشرط 4)
  const isArchive = useIsArchive()

  // قيم الفلاتر (لم تُطبَّق بعد)
  const [fType, setFType] = useState('ALL')
  const [fStatus, setFStatus] = useState('ALL')
  const [fQ, setFQ] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  /** كل الصفوف عند الطباعة — يُفعَّل قبل الطباعة ويُستعاد بعدها */
  const [printAll, setPrintAll] = useState(false)

  const [partners, setPartners] = useState<PartnerRow[]>([])
  const [stats, setStats] = useState<PartnerListStats>(EMPTY_STATS)
  const [nextCustomerCode, setNextCustomerCode] = useState('C-001')
  const [nextSupplierCode, setNextSupplierCode] = useState('S-001')
  const [loading, setLoading] = useState(true)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<PartnerRow | null>(null)
  const [viewId, setViewId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<PartnerRow | null>(null)
  const [acting, setActing] = useState(false)
  // كشف مستندات الطرف الموحد — الشخص نفسه بأدواره وحساباته المتفرقة في الشجرة
  const [unifiedTarget, setUnifiedTarget] = useState<UnifiedPartyTarget | null>(null)

  // Task 40 — رابط عميق من البحث المركزي: فتح بطاقة الطرف مباشرة (إشارة تُستهلك مرة واحدة)
  const pendingPartnerId = useActionBus((s) => s.pendingPartnerId)
  const consumePartnerSignal = useActionBus((s) => s.consumePartnerProfileSignal)
  useEffect(() => {
    if (!pendingPartnerId) return
    setViewId(pendingPartnerId)
    consumePartnerSignal()
  }, [pendingPartnerId, consumePartnerSignal])

  // ===== جلب الملفات — عدّاد تسلسلي يمنع استجابة أقدم من طغيان الأحدث =====
  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.type !== 'ALL') params.set('type', filters.type)
      if (filters.status !== 'ALL') params.set('status', filters.status)
      if (filters.q) params.set('q', filters.q)

      const res = await fetch(`/api/partners?${params.toString()}`)
      const data = await res.json().catch(() => null)
      if (seq !== loadSeq.current) return
      if (!res.ok || !data) {
        toast({
          title: 'تعذر جلب ملفات الأطراف',
          description: data?.error ?? 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        setPartners([])
        return
      }
      setPartners(data.partners ?? [])
      setStats(data.stats ?? EMPTY_STATS)
      setNextCustomerCode(data.nextCustomerCode ?? 'C-001')
      setNextSupplierCode(data.nextSupplierCode ?? 'S-001')
    } catch {
      if (seq === loadSeq.current) {
        toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
        setPartners([])
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [filters, toast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [filters])

  const applyFilters = useCallback(() => {
    setFilters({ type: fType, status: fStatus, q: fQ.trim() })
  }, [fType, fStatus, fQ])

  const clearFilters = useCallback(() => {
    setFType('ALL')
    setFStatus('ALL')
    setFQ('')
    setFilters(EMPTY_FILTERS)
  }, [])

  const performDelete = useCallback(async () => {
    if (!confirmDelete || acting) return
    setActing(true)
    try {
      const res = await fetch(`/api/partners/${confirmDelete.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({
          title: 'تعذر حذف الملف',
          description: data?.error ?? 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        return
      }
      toast({ title: 'تم حذف الملف', description: `الكود: ${confirmDelete.code}` })
      void load()
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setActing(false)
      setConfirmDelete(null)
    }
  }, [acting, confirmDelete, load, toast])

  const totalPages = Math.max(1, Math.ceil(partners.length / PAGE_SIZE))
  // حماية: بعد حذف آخر عنصر بالصفحة الأخيرة نُنزل تلقائياً لآخر صفحة صالحة
  const safePage = Math.min(page, totalPages)
  const pageRows = partners.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <div className="space-y-4">
      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          title="عدد العملاء"
          value={fmtNumber(stats.customersCount)}
          hint="ملفات العملاء المسجلة"
          icon={Users}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="عدد الموردين"
          value={fmtNumber(stats.suppliersCount)}
          hint="ملفات الموردين المسجلة"
          icon={UsersRound}
          tone="amber"
          loading={loading}
        />
        <KpiCard
          title="ذمم العملاء — لنا"
          value={fmtMoney(stats.customersDebt)}
          hint={`≈ ${fmtUSD(stats.customersDebt)}`}
          icon={Wallet}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="مستحقات الموردين — علينا"
          value={fmtMoney(stats.suppliersDue)}
          hint={`≈ ${fmtUSD(stats.suppliersDue)}`}
          icon={Building2}
          tone="rose"
          loading={loading}
        />
      </div>

      {/* شريط الفلاتر */}
      <SectionCard
        title="الفلاتر"
        description="تصفية ملفات الأطراف حسب النوع والحالة والبحث النصي"
        icon={SlidersHorizontal}
        action={
          !isArchive && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              <Plus className="h-4 w-4" />
              ملف جديد
            </Button>
          )
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">النوع</Label>
            <Select value={fType} onValueChange={setFType}>
              <SelectTrigger className="h-9 w-full" aria-label="النوع">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">الكل</SelectItem>
                <SelectItem value="CUSTOMER">عملاء</SelectItem>
                <SelectItem value="SUPPLIER">موردون</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">الحالة</Label>
            <Select value={fStatus} onValueChange={setFStatus}>
              <SelectTrigger className="h-9 w-full" aria-label="الحالة">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">الكل</SelectItem>
                <SelectItem value="ACTIVE">نشط</SelectItem>
                <SelectItem value="INACTIVE">موقوف</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">بحث</Label>
            <Input
              value={fQ}
              onChange={(e) => setFQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFilters()
              }}
              placeholder="الكود أو الاسم أو الهاتف أو العنوان…"
              className="h-9"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" onClick={applyFilters}>
            <Search className="h-4 w-4" />
            تصفية
          </Button>
          <Button size="sm" variant="outline" onClick={clearFilters}>
            <X className="h-4 w-4" />
            مسح الفلاتر
          </Button>
        </div>
      </SectionCard>

      {/* جدول الملفات */}
      <SectionCard
        title="ملفات العملاء والموردين"
        description="مرتبة حسب النوع ثم الكود — انقر الصف لعرض البطاقة الكاملة"
        icon={Users}
        action={
          <Badge variant="outline" className="num gap-1">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {fmtNumber(partners.length)} نتيجة
          </Badge>
        }
      >
        <div className="print-area">
          <TableActions
            title="ملفات العملاء والموردين"
            filename="partners"
            headers={['الكود', 'الاسم', 'الهاتف', 'النوع', 'العنوان', 'الرصيد', 'اتجاه الرصيد', 'الحالة']}
            onBeforePrint={() => setPrintAll(true)}
            onAfterPrint={() => setPrintAll(false)}
            rowsLoader={() =>
              partners.map((p) => [
                p.code,
                p.name,
                p.phone ?? '',
                AR_PARTNER_TYPE[p.type] ?? p.type,
                p.address ?? '',
                p.stats.balance,
                balanceMeta(p.type, p.stats.balance).label,
                p.isActive ? 'نشط' : 'موقوف',
              ])
            }
          />
          <div className="overflow-hidden rounded-lg border">
          {loading && partners.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جارٍ التحميل…
            </div>
          ) : partners.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <Inbox className="h-10 w-10 text-muted-foreground/50" />
              <p className="font-medium">لا توجد ملفات مطابقة</p>
              <p className="text-xs text-muted-foreground">
                جرّب تعديل الفلاتر أو أنشئ ملفاً جديداً
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[880px]">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-24">الكود</TableHead>
                    <TableHead>الاسم</TableHead>
                    <TableHead className="w-24">النوع</TableHead>
                    <TableHead>العنوان</TableHead>
                    <TableHead className="w-48">الرصيد</TableHead>
                    <TableHead className="w-20">الحالة</TableHead>
                    <TableHead className="no-print w-28">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(printAll ? partners : pageRows).map((p) => {
                    const meta = balanceMeta(p.type, p.stats.balance)
                    return (
                      <TableRow
                        key={p.id}
                        className="cursor-pointer"
                        onClick={() => setViewId(p.id)}
                      >
                        <TableCell>
                          <span className="num font-semibold text-primary">{p.code}</span>
                        </TableCell>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-medium" title={p.name}>
                              {p.name}
                            </p>
                            <p className="flex items-center gap-2 text-xs text-muted-foreground">
                              {p.phone ? (
                                <span className="num" dir="ltr">
                                  {p.phone}
                                </span>
                              ) : null}
                              {p.accountCode ? (
                                <span className="num" title="الحساب المرتبط في شجرة الحسابات">
                                  حساب {p.accountCode}
                                </span>
                              ) : null}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              p.type === 'CUSTOMER'
                                ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                                : 'border-amber-500/40 text-amber-600 dark:text-amber-400'
                            }
                          >
                            {AR_PARTNER_TYPE[p.type] ?? p.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          <span className="block truncate text-muted-foreground" title={p.address ?? ''}>
                            {p.address ?? '—'}
                          </span>
                        </TableCell>
                        <TableCell className="text-end">
                          <p className={cn('num font-bold', meta.className)}>
                            {fmtMoney(p.stats.balance)}
                          </p>
                          <p className={cn('text-[11px]', meta.className)}>{meta.label}</p>
                        </TableCell>
                        <TableCell>
                          {p.isActive ? (
                            <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                              نشط
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              موقوف
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="no-print" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {p.accountId && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-primary hover:text-primary"
                                aria-label={`كشف مستندات الطرف الموحد ${p.name}`}
                                title="كشف مستندات الطرف الموحد — كل حركات الشخص مجتمعة بغض النظر عن مكان حساباته في الشجرة"
                                onClick={() => setUnifiedTarget({ accountId: p.accountId, name: p.name })}
                              >
                                <GitMerge className="h-4 w-4" />
                              </Button>
                            )}
                            {p.whatsappUrl && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400"
                                aria-label={`فتح محادثة واتساب مع ${p.name}`}
                                title="واتساب"
                                asChild
                              >
                                <a href={p.whatsappUrl} target="_blank" rel="noopener noreferrer">
                                  <MessageCircle className="h-4 w-4" />
                                </a>
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={`عرض الملف ${p.code}`}
                              title="عرض"
                              onClick={() => setViewId(p.id)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {!isArchive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={`تعديل الملف ${p.code}`}
                                title="تعديل"
                                onClick={() => {
                                  setEditing(p)
                                  setFormOpen(true)
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {!isArchive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700"
                                aria-label={`حذف الملف ${p.code}`}
                                title="حذف"
                                onClick={() => setConfirmDelete(p)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          </div>
        </div>

        {/* التقسيم */}
        {partners.length > PAGE_SIZE && (
          <div className="no-print flex flex-wrap items-center justify-between gap-2 pt-3">
            <p className="text-xs text-muted-foreground">
              صفحة <span className="num font-semibold">{safePage}</span> من{' '}
              <span className="num font-semibold">{totalPages}</span> — عدد النتائج:{' '}
              <span className="num font-semibold">{fmtNumber(partners.length)}</span>
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage <= 1 || loading}
                onClick={() => setPage((pg) => Math.max(1, Math.min(pg, totalPages) - 1))}
              >
                <ChevronRight className="h-4 w-4" />
                السابق
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= totalPages || loading}
                onClick={() => setPage((pg) => Math.min(totalPages, pg + 1))}
              >
                التالي
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </SectionCard>

      {/* نموذج الإنشاء/التعديل */}
      <PartnerFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
        nextCustomerCode={nextCustomerCode}
        nextSupplierCode={nextSupplierCode}
        onSaved={() => void load()}
      />

      {/* بطاقة العرض */}
      <PartnerViewDialog partnerId={viewId} onClose={() => setViewId(null)} />
      <UnifiedPartyDialog target={unifiedTarget} onClose={() => setUnifiedTarget(null)} />

      {/* تأكيد الحذف */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الملف {confirmDelete?.code}</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف ملف «{confirmDelete?.name}» نهائياً إن لم تكن عليه مستندات. إذا كان عليه
              فواتير أو سندات فسيُرفض الحذف ويمكن إيقاف الملف بدلاً منه. هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>تراجع</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={(e) => {
                e.preventDefault()
                void performDelete()
              }}
            >
              {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'حذف نهائياً'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
