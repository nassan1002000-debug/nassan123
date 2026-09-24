'use client'

// بطاقة الموظف — البيانات الكاملة + مؤشرات الرواتب والسلف + أحدث الحركتين
// نفس نمط بطاقة الطرف (partner-view-dialog.tsx): فاتورة/سند هنا راتب/سلفة

import { useCallback, useEffect, useState } from 'react'
import {
  Ban,
  BadgeCheck,
  Briefcase,
  Building2,
  CalendarDays,
  Eye,
  HandCoins,
  Loader2,
  MessageCircle,
  Phone,
  Printer,
  Wallet,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { fmtDate, fmtMoney, fmtNumber, fmtUSD } from '@/lib/format'
import { printEmployee } from './print-employee'
import type { EmployeeDetailResponse } from './hr-shared'

interface Props {
  employeeId: string | null
  onClose: () => void
}

export function EmployeeViewDialog({ employeeId, onClose }: Props) {
  const { toast } = useToast()
  const [detail, setDetail] = useState<EmployeeDetailResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!employeeId) return
    setLoading(true)
    setDetail(null)
    try {
      const res = await fetch(`/api/employees/${employeeId}`)
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) {
        toast({
          title: 'تعذر جلب بطاقة الموظف',
          description: data?.error ?? 'حدث خطأ غير متوقع',
          variant: 'destructive',
        })
        return
      }
      setDetail(data)
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [employeeId, toast])

  useEffect(() => {
    if (employeeId) void load()
  }, [employeeId, load])

  const handlePrint = useCallback(() => {
    if (!detail) return
    const ok = printEmployee(detail)
    if (!ok) {
      toast({
        title: 'تعذر فتح نافذة الطباعة',
        description: 'يرجى السماح بالنوافذ المنبثقة لهذا الموقع ثم إعادة المحاولة',
        variant: 'destructive',
      })
    }
  }, [detail, toast])

  return (
    <Dialog open={!!employeeId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" />
            {loading ? 'جارٍ التحميل…' : detail ? detail.employee.name : 'بطاقة الموظف'}
            {detail && (
              <Button
                variant="outline"
                size="sm"
                className="mr-auto text-primary"
                onClick={handlePrint}
                aria-label={`طباعة بطاقة الموظف ${detail.employee.name}`}
              >
                <Printer className="h-4 w-4" />
                طباعة
              </Button>
            )}
          </DialogTitle>
          <DialogDescription>
            {detail ? `${detail.employee.position} — كود ${detail.employee.code}` : 'البيانات والرواتب والسلف'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            جارٍ التحميل…
          </div>
        ) : detail ? (
          <div className="space-y-4">
            {/* شبكة البيانات */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <InfoRow icon={Building2} label="الكود" value={detail.employee.code} mono />
              <InfoRow icon={Briefcase} label="الوظيفة" value={detail.employee.position} />
              <InfoRow
                icon={Phone}
                label="الهاتف"
                value={detail.employee.phone ?? '—'}
                mono
                ltr={!!detail.employee.phone}
                whatsappUrl={detail.employee.whatsappUrl}
              />
              <InfoRow icon={CalendarDays} label="تاريخ التعيين" value={fmtDate(detail.employee.hireDate)} mono />
              <InfoRow
                icon={detail.employee.isActive ? BadgeCheck : Ban}
                label="الحالة"
                value={detail.employee.isActive ? 'نشط' : 'موقوف'}
              />
              <InfoRow icon={Building2} label="القسم" value={detail.employee.department ?? '—'} />
            </div>

            {/* ملخص الرواتب والسلف */}
            <div className="grid grid-cols-3 gap-2">
              <MiniStat icon={Wallet} label="الراتب الأساسي" value={fmtMoney(detail.employee.baseSalary)} sub={`≈ ${fmtUSD(detail.employee.baseSalary)}`} />
              <MiniStat icon={CalendarDays} label="عدد أقساط الرواتب" value={fmtNumber(detail.employee.salariesCount)} sub="كل الأشهر" />
              <MiniStat icon={HandCoins} label="سلف غير مسددة" value={fmtMoney(detail.employee.unpaidAdvancesTotal)} sub={`≈ ${fmtUSD(detail.employee.unpaidAdvancesTotal)}`} />
            </div>

            {/* أحدث الرواتب */}
            <div>
              <p className="mb-2 text-sm font-semibold">
                أحدث أقساط الرواتب <span className="num text-xs text-muted-foreground">(آخر 12 شهراً)</span>
              </p>
              {detail.salaries.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  لا توجد أقساط رواتب — تُولَّد من شاشة الرواتب
                </p>
              ) : (
                <div className="max-h-56 space-y-1.5 overflow-y-auto pe-1">
                  {detail.salaries.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <span className="num font-semibold text-primary">{s.month}</span>
                        {s.paidAt ? (
                          <span className="num mr-2 text-xs text-muted-foreground">{fmtDate(s.paidAt)}</span>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            s.status === 'PAID'
                              ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                              : 'border-amber-500/40 text-amber-600 dark:text-amber-400'
                          }
                        >
                          {s.status === 'PAID' ? 'مصروف' : 'معلّق'}
                        </Badge>
                        <span className="num font-bold">{fmtMoney(s.net)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* أحدث السلف */}
            <div>
              <p className="mb-2 text-sm font-semibold">
                أحدث السلف <span className="num text-xs text-muted-foreground">(آخر 10)</span>
              </p>
              {detail.advances.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  لا توجد سلف — تُسجَّل من شاشة السلف
                </p>
              ) : (
                <div className="max-h-56 space-y-1.5 overflow-y-auto pe-1">
                  {detail.advances.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <span className="num text-xs text-muted-foreground">{fmtDate(a.date)}</span>
                        {a.reason ? (
                          <span className="ms-2 hidden truncate text-xs text-muted-foreground sm:inline">{a.reason}</span>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            a.status === 'UNPAID'
                              ? 'border-rose-500/40 text-rose-600 dark:text-rose-400'
                              : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                          }
                        >
                          {a.status === 'UNPAID' ? 'غير مسددة' : 'مسددة'}
                        </Badge>
                        <span className="num font-bold">{fmtMoney(a.amount)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
  mono,
  ltr,
  whatsappUrl,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  mono?: boolean
  ltr?: boolean
  whatsappUrl?: string | null
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className={`truncate text-sm font-medium ${mono ? 'num' : ''}`} dir={ltr ? 'ltr' : undefined} title={value}>
          {value}
        </p>
      </div>
      {whatsappUrl ? (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-full p-1.5 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
          title="واتساب"
          aria-label="فتح محادثة واتساب"
        >
          <MessageCircle className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </div>
  )
}

function MiniStat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub: string
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <p className="text-[11px] leading-tight">{label}</p>
      </div>
      <p className="num mt-1.5 text-lg font-bold leading-tight">{value}</p>
      <p className="num mt-0.5 text-[11px] text-muted-foreground" title={sub}>
        {sub}
      </p>
    </div>
  )
}
