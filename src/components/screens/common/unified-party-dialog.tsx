'use client'

// نافذة «كشف مستندات الطرف الموحد» — لمّ شمل حركات الشخص في عرض واحد شامل
// ---------------------------------------------------------------------------------
// الشخص الواحد يجمع أدواراً متعددة (شريك + عميل + مورد + موظف) وحسابات متفرقة في الشجرة —
// هذه النافذة تدمج كل حركاته: فواتيره وسنداته وسلفه ومسحوباته ومقاصاته ونقاط ولائه —
// مع بطاقة رصيد لكل دور، بغض النظر عن مكان حساباته في شجرة الحسابات.
// تُستدعى من شجرة الحسابات ومن شاشة الأطراف — والقراءة من الأرشيف تعمل تلقائياً
// عبر غلاف إعادة التوجيه (archive-fetch) لأن المسار مسجل في المرآة الأرشيفية.

import { useCallback, useEffect, useState } from 'react'
import {
  Coins,
  Gift,
  GitMerge,
  Loader2,
  Printer,
  ShoppingBasket,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, fmtUSD, AR_INVOICE_STATUS } from '@/lib/format'
import { tafqitSYP } from '@/lib/tafqit'
import { cn } from '@/lib/utils'
import type {
  UnifiedRoleBalance,
  UnifiedRoleKind,
  UnifiedStatement,
} from '@/lib/unified-party-types'
import { printUnifiedPartyStatement } from '@/components/screens/accounts/print-unified-party'

/** ألوان شارات الأدوار — شريك بنفسجي وعميل أخضر ومورد كهرماني وموظف سماوي */
export const ROLE_BADGE: Record<UnifiedRoleKind, string> = {
  PARTNER: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400',
  CUSTOMER: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  SUPPLIER: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  EMPLOYEE: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400',
}

const AR_BALANCE_DIR = (signed: number): string =>
  Math.abs(signed) < 0.005 ? 'صفر' : signed > 0 ? 'مدين لنا' : 'دائن له'

const AR_ADVANCE_STATUS: Record<string, string> = {
  PAID: 'مسددة',
  UNPAID: 'غير مسددة',
  SETTLED: 'مسددة بالاستقطاع',
}

const AR_INVOICE_STATUS_BADGE: Record<string, string> = {
  PAID: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
  PARTIAL: 'border-amber-500/40 text-amber-700 dark:text-amber-400',
  UNPAID: 'border-rose-500/40 text-rose-700 dark:text-rose-400',
}

/** بطاقة رصيد دور واحد — الرصيد بمصطلحات مدين (موجب = علينا تحصيله) */
function RoleBalanceCard({ role }: { role: UnifiedRoleBalance }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px]', ROLE_BADGE[role.kind])}>
          {role.label}
        </Badge>
        <span className="num text-xs font-semibold text-muted-foreground">{role.fileCode}</span>
        {role.accountCode && (
          <span className="num text-[10px] text-muted-foreground">
            حساب {role.accountCode}
          </span>
        )}
      </div>
      {role.accountName && (
        <p className="mt-1 truncate text-xs text-muted-foreground" title={role.accountName}>
          {role.accountName}
        </p>
      )}
      <p className="num mt-1.5 text-sm font-bold">
        {fmtMoney(Math.abs(role.balance))}
        <span
          className={cn(
            'ms-1.5 text-[10px] font-normal',
            role.balance > 0.005
              ? 'text-emerald-600 dark:text-emerald-400'
              : role.balance < -0.005
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-muted-foreground',
          )}
        >
          {AR_BALANCE_DIR(role.balance)}
        </span>
      </p>
      <p className="num mt-0.5 text-[10px] text-muted-foreground">≈ {fmtUSD(Math.abs(role.balance))}</p>
    </div>
  )
}

/**
 * بطاقة «محصلة الحساب الموحدة» — الصافي النهائي التراكمي لكل أدوار الشخص معاً
 * (طلب صريح من القائد). تصميم مميز رمادي/ذهبي يفرّقها بصرياً عن بطاقات الأدوار
 * الفردية أعلاه، وتُعرض بجوارها مباشرة في نفس الشريط العلوي — بلا حاجة للتمرير
 */
function CombinedBalanceCard({ balance }: { balance: number }) {
  const abs = Math.abs(balance)
  return (
    <div className="min-w-0 rounded-xl border border-amber-500/40 bg-gradient-to-br from-slate-100 via-slate-50 to-amber-50 p-3 shadow-sm dark:border-amber-400/30 dark:from-slate-800 dark:via-slate-800/80 dark:to-amber-950/40">
      <div className="flex flex-wrap items-center gap-1.5">
        <Coins className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">محصلة الحساب الموحدة</span>
      </div>
      <p className="num mt-1.5 text-base font-extrabold text-slate-900 dark:text-slate-50">
        {fmtMoney(abs)}
        <span
          className={cn(
            'ms-1.5 text-[10px] font-normal',
            balance > 0.005
              ? 'text-emerald-600 dark:text-emerald-400'
              : balance < -0.005
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-muted-foreground',
          )}
        >
          {AR_BALANCE_DIR(balance)}
        </span>
      </p>
      <p className="num mt-0.5 text-[10px] text-muted-foreground">≈ {fmtUSD(abs)}</p>
      <p className="mt-1.5 border-t border-amber-500/25 pt-1.5 text-[10px] leading-snug text-slate-600 dark:text-slate-300">
        {tafqitSYP(abs)}
      </p>
    </div>
  )
}

export interface UnifiedPartyTarget {
  accountId?: string | null
  partnerId?: string | null
  employeeId?: string | null
  /** اسم مقترح للعرض قبل وصول البيانات */
  name?: string
}

interface UnifiedPartyDialogProps {
  target: UnifiedPartyTarget | null
  onClose: () => void
}

export function UnifiedPartyDialog({ target, onClose }: UnifiedPartyDialogProps) {
  const { toast } = useToast()
  const [data, setData] = useState<UnifiedStatement | null>(null)
  const [loading, setLoading] = useState(false)

  const query = target
    ? target.accountId
      ? `accountId=${encodeURIComponent(target.accountId)}`
      : target.partnerId
        ? `partnerId=${encodeURIComponent(target.partnerId)}`
        : target.employeeId
          ? `employeeId=${encodeURIComponent(target.employeeId)}`
          : null
    : null

  const load = useCallback(async () => {
    if (!query) return
    setLoading(true)
    setData(null)
    try {
      const res = await fetch(`/api/unified-party/statement?${query}`)
      const json = (await res.json().catch(() => null)) as UnifiedStatement | { error?: string } | null
      if (!res.ok || !json) {
        toast({
          title: 'تعذر بناء كشف الطرف الموحد',
          description: 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        return
      }
      // كشف خطأ الخادم — بلا «person» فهو ليس كشفاً صالحاً
      if (!('person' in json)) {
        toast({
          title: 'تعذر بناء كشف الطرف الموحد',
          description: ('error' in json && json.error) || 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        return
      }
      setData(json)
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [query, toast])

  useEffect(() => {
    if (target && query) void load()
  }, [target, query, load])

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        variant="preview"
        className="flex max-h-[92vh] w-[calc(100vw_-_var(--sidebar-w)_-_2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1200px]"
      >
        {/* رأس النافذة — اسم الشخص وشارات أدواره */}
        <DialogHeader className="border-b px-5 py-4 text-start pl-14">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-primary">
              <GitMerge className="h-4 w-4" />
              كشف مستندات الطرف الموحد
            </span>
            {data && (
              <>
                <span className="text-base font-extrabold">{data.person.name}</span>
                {data.person.multiRole && (
                  <Badge className="border border-primary/40 bg-primary/10 px-1.5 py-0 text-[10px] text-primary">
                    {fmtNumber(data.person.roles.length)} أدوار موحدة
                  </Badge>
                )}
              </>
            )}
            {!data && target?.name && <span className="text-base font-extrabold">{target.name}</span>}
          </DialogTitle>
          <DialogDescription>
            كل حركات الشخص مجتمعةً: فواتيره وسنداته وسلفه ومسحوباته ومقاصاته — بغض النظر عن مكان
            حساباته في الشجرة
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-64 w-full" />
            </div>
          )}

          {!loading && !data && (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <UserRound className="h-8 w-8 text-amber-500" />
              تعذر تحميل الكشف الموحد — أغلق النافذة وأعد المحاولة
            </div>
          )}

          {data && (
            <>
              {/* بطاقات الأرصدة — رصيد كل دور */}
              <section aria-label="أرصدة الأدوار">
                <h4 className="mb-2 text-xs font-bold text-muted-foreground">أرصدة الأدوار</h4>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                  {data.person.roles.map((r) => (
                    <RoleBalanceCard key={`${r.kind}-${r.fileCode}`} role={r} />
                  ))}
                  <CombinedBalanceCard balance={data.person.combinedBalance} />
                </div>
              </section>

              {/* كشف الحركة الموحد */}
              <section aria-label="كشف الحركة الموحد">
                <h4 className="mb-2 text-xs font-bold text-muted-foreground">
                  كشف الحركة الموحد ({fmtNumber(data.totals.count)} حركة — الأحدث أولاً)
                </h4>
                {data.docs.length === 0 ? (
                  <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                    لا توجد حركات على أي من أدوار هذا الشخص بعد
                  </div>
                ) : (
                  <div className="max-h-96 overflow-auto rounded-xl border">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-muted">
                        <TableRow>
                          <TableHead className="w-24">التاريخ</TableHead>
                          <TableHead className="w-32">المستند</TableHead>
                          <TableHead className="w-28">الرقم</TableHead>
                          <TableHead>البيان</TableHead>
                          <TableHead className="w-36">الدور / الحساب</TableHead>
                          <TableHead className="w-32 text-end">مدين</TableHead>
                          <TableHead className="w-32 text-end">دائن</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.docs.map((d, i) => (
                          <TableRow key={`${d.number}-${i}`}>
                            <TableCell className="num whitespace-nowrap text-xs">{fmtDate(d.date)}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{d.docType}</TableCell>
                            <TableCell className="num whitespace-nowrap text-xs font-semibold text-primary">
                              {d.number}
                            </TableCell>
                            <TableCell className="max-w-64 truncate text-xs" title={d.description}>
                              {d.description}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'px-1.5 py-0 text-[10px]',
                                  ROLE_BADGE[
                                    data.person.roles.find((r) => r.fileCode === d.fileCode)?.kind ?? 'CUSTOMER'
                                  ],
                                )}
                              >
                                {d.roleLabel}
                              </Badge>
                              <span className="num ms-1 text-[10px] text-muted-foreground">{d.accountCode}</span>
                            </TableCell>
                            <TableCell className="num text-end text-xs">
                              {d.debit ? fmtMoney(d.debit) : '—'}
                            </TableCell>
                            <TableCell className="num text-end text-xs">
                              {d.credit ? fmtMoney(d.credit) : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell colSpan={5} className="text-xs font-bold">
                            الإجمالي
                          </TableCell>
                          <TableCell className="num text-end text-xs font-bold">{fmtMoney(data.totals.debit)}</TableCell>
                          <TableCell className="num text-end text-xs font-bold">{fmtMoney(data.totals.credit)}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </section>

              {/* الفواتير — بشارات السلة والولاء */}
              {data.invoices.length > 0 && (
                <section aria-label="فواتير الشخص">
                  <h4 className="mb-2 text-xs font-bold text-muted-foreground">
                    الفواتير ({fmtNumber(data.invoicesTotals.count)} فاتورة — إجمالي{' '}
                    <span className="num">{fmtMoney(data.invoicesTotals.total)}</span> ل.س)
                  </h4>
                  <div className="max-h-80 overflow-auto rounded-xl border">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-muted">
                        <TableRow>
                          <TableHead className="w-28">الرقم</TableHead>
                          <TableHead className="w-24">التاريخ</TableHead>
                          <TableHead className="w-28">النوع</TableHead>
                          <TableHead className="w-32 text-end">الإجمالي</TableHead>
                          <TableHead className="w-32 text-end">المسدد</TableHead>
                          <TableHead className="w-24">الحالة</TableHead>
                          <TableHead>وسوم</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.invoices.map((inv) => (
                          <TableRow key={inv.id}>
                            <TableCell className="num whitespace-nowrap text-xs font-semibold text-primary">
                              {inv.number}
                            </TableCell>
                            <TableCell className="num whitespace-nowrap text-xs">{fmtDate(inv.date)}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{inv.typeLabel}</TableCell>
                            <TableCell className="num text-end text-xs">{fmtMoney(inv.total)}</TableCell>
                            <TableCell className="num text-end text-xs">{fmtMoney(inv.paid)}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn('px-1.5 py-0 text-[10px]', AR_INVOICE_STATUS_BADGE[inv.status] ?? '')}
                              >
                                {AR_INVOICE_STATUS[inv.status] ?? inv.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {inv.hasBundle && (
                                  <Badge
                                    variant="outline"
                                    className="gap-1 border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-400"
                                    title={inv.bundleNames.join('، ')}
                                  >
                                    <ShoppingBasket className="h-3 w-3" />
                                    سلة عروض
                                  </Badge>
                                )}
                                {inv.loyaltyPointsRedeemed > 0 && (
                                  <Badge
                                    variant="outline"
                                    className="gap-1 border-violet-500/40 bg-violet-500/10 px-1.5 py-0 text-[10px] text-violet-700 dark:text-violet-400"
                                  >
                                    <Sparkles className="h-3 w-3" />
                                    استرداد نقاط ولاء
                                  </Badge>
                                )}
                                {!inv.hasBundle && inv.loyaltyPointsRedeemed === 0 && (
                                  <span className="text-[10px] text-muted-foreground">—</span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              )}

              {/* الموارد البشرية — للأدوار الموظفية */}
              {data.hr.isEmployee && (
                <section aria-label="سلف ورواتب الموظف">
                  <h4 className="mb-2 text-xs font-bold text-muted-foreground">
                    السلف والرواتب — رواتب مدفوعة: <span className="num">{fmtNumber(data.hr.salaries.count)}</span> بقيمة{' '}
                    <span className="num">{fmtMoney(data.hr.salaries.totalPaid)}</span> ل.س
                  </h4>
                  {data.hr.advances.length === 0 ? (
                    <div className="rounded-xl border border-dashed py-6 text-center text-xs text-muted-foreground">
                      لا توجد سلف مسجلة على الموظف
                    </div>
                  ) : (
                    <div className="max-h-56 overflow-auto rounded-xl border">
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-muted">
                          <TableRow>
                            <TableHead className="w-24">التاريخ</TableHead>
                            <TableHead className="w-32 text-end">المبلغ</TableHead>
                            <TableHead className="w-36">الحالة</TableHead>
                            <TableHead>السبب</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.hr.advances.map((a, i) => (
                            <TableRow key={i}>
                              <TableCell className="num whitespace-nowrap text-xs">{fmtDate(a.date)}</TableCell>
                              <TableCell className="num text-end text-xs">{fmtMoney(a.amount)}</TableCell>
                              <TableCell className="text-xs">{AR_ADVANCE_STATUS[a.status] ?? a.status}</TableCell>
                              <TableCell className="max-w-64 truncate text-xs" title={a.reason ?? ''}>
                                {a.reason || '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </section>
              )}

              {/* نقاط الولاء — لملفات العملاء */}
              {data.loyalty.length > 0 && (
                <section aria-label="نقاط الولاء">
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                    <Gift className="h-3.5 w-3.5" />
                    نقاط الولاء
                  </h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {data.loyalty.map((l) => (
                      <div key={l.fileCode} className="rounded-xl border bg-card p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold" title={l.customerName}>
                            {l.customerName}
                          </span>
                          <span className="num text-[10px] text-muted-foreground">{l.fileCode}</span>
                        </div>
                        <p className="num mt-1.5 text-sm font-bold text-primary">{fmtNumber(l.balance)} نقطة</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {fmtNumber(l.movements)} حركة
                          {l.lastDate ? ` — آخر حركة ${fmtDateTime(l.lastDate)}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* شريط الإجراءات */}
        <div className="flex items-center justify-between gap-2 border-t px-5 py-3">
          <p className="hidden text-[11px] text-muted-foreground sm:block">
            الكشف يجمع حسابات الشخص كلها من مواضعها المختلفة في الشجرة — من مستنداتها وقيودها المُرحّلة
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!data}
              onClick={() => data && printUnifiedPartyStatement(data)}
              title="طباعة الكشف الموحد"
            >
              <Printer className="h-4 w-4" />
              طباعة
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              إغلاق
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
