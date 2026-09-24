'use client'

// شاشة سندات المقاصة — Task 101
// KPIs + قائمة السندات (قيود بمصدر CLEARING) + إنشاء/عرض/طباعة
// المقاصة: موازنة الذمم المتقابلة لمن يجمع أكثر من صفة — بلا حركة نقدية إطلاقاً

import { useCallback, useEffect, useState } from 'react'
import { Eye, Inbox, Plus, Printer, Scale, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { useToast } from '@/hooks/use-toast'
import { useIsArchive } from '@/lib/store'
import { AR_ENTRY_STATUS, fmtDate, fmtMoney, fmtUSD } from '@/lib/format'
import { ClearingFormDialog } from './clearing-form-dialog'
import { ClearingViewDialog } from './clearing-view-dialog'
import { printClearing } from './print-clearing'
import type { ClearingTotals, ClearingVoucherRow } from './types'

export default function ClearingsScreen() {
  const { toast } = useToast()

  // وضع استعراض أرشيف فترة مقفلة — يخفي أزرار الكتابة (الشرط 4)
  const isArchive = useIsArchive()

  const [vouchers, setVouchers] = useState<ClearingVoucherRow[]>([])
  const [totals, setTotals] = useState<ClearingTotals>({ count: 0, sum: 0, thisMonth: 0 })
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [viewing, setViewing] = useState<ClearingVoucherRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/clearings')
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) {
        toast({ title: 'تعذر جلب سندات المقاصة', description: data?.error, variant: 'destructive' })
        return
      }
      setVouchers(data.vouchers ?? [])
      setTotals(data.totals ?? { count: 0, sum: 0, thisMonth: 0 })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const handlePrint = (v: ClearingVoucherRow) => {
    const ok = printClearing(v)
    if (!ok) {
      toast({ title: 'تعذر فتح نافذة الطباعة', description: 'المتصفح حجب النوافذ المنبثقة — اسمح بها وأعد المحاولة', variant: 'destructive' })
    }
  }

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      {/* الترويسة */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold">
            <Scale className="h-6 w-6 text-primary" aria-hidden />
            سندات المقاصة
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            موازنة الذمم المتقابلة لمن يجمع أكثر من صفة (عميل ↔ مورد ↔ موظف) — قيود متوازنة رسمية MC-xxxx بلا أي حركة نقدية
          </p>
        </div>
        {!isArchive && (
          <Button onClick={() => setFormOpen(true)} className="min-h-11">
            <Plus className="h-4 w-4" aria-hidden />
            سند مقاصة جديد
          </Button>
        )}
      </header>

      {/* بطاقات المؤشرات */}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          title="عدد السندات المرحّلة"
          value={String(totals.count)}
          hint="سند مقاصة POSTED"
          icon={Scale}
          tone="gold"
          loading={loading}
        />
        <KpiCard
          title="إجمالي المبالغ المقاصة"
          value={`${fmtMoney(totals.sum)} ل.س`}
          hint={`≈ ${fmtUSD(totals.sum)}`}
          icon={Wallet}
          tone="emerald"
          loading={loading}
        />
        <KpiCard
          title="مقاصة هذا الشهر"
          value={`${fmtMoney(totals.thisMonth)} ل.س`}
          hint={`≈ ${fmtUSD(totals.thisMonth)}`}
          icon={Printer}
          tone="amber"
          loading={loading}
        />
      </div>

      {/* قائمة السندات */}
      <SectionCard title="قائمة سندات المقاصة" description="كل سند قيد مزدوج مُرحّل يظهر آلياً في دفتر الأستاذ وكشوف الأطراف">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Inbox className="h-5 w-5 animate-pulse" aria-hidden /> جارٍ التحميل…
          </div>
        ) : vouchers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Scale className="h-10 w-10 text-muted-foreground/50" aria-hidden />
            <p className="font-semibold">لا توجد سندات مقاصة بعد</p>
            <p className="max-w-md text-sm text-muted-foreground">
              ابدأ بـ «سند مقاصة جديد» — ستظهر فيه الأشخاص الذين يجمعون أكثر من صفة بأرصدتهم المتقابلة
            </p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="bg-primary/8">
                  <TableHead className="text-start">رقم السند</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">البيان</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  <TableHead className="text-start">الإجمالي (ل.س)</TableHead>
                  <TableHead className="text-center">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vouchers.map((v) => {
                  const isPosted = v.status === 'POSTED'
                  return (
                    <TableRow key={v.id} className="hover:bg-muted/40">
                      <TableCell className="num font-bold text-primary" dir="ltr">
                        {v.number}
                      </TableCell>
                      <TableCell className="num" dir="ltr">
                        {fmtDate(v.date)}
                      </TableCell>
                      <TableCell className="max-w-[340px]">
                        <span className="line-clamp-2 text-sm" title={v.description}>
                          {v.description || '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            isPosted
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                              : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400'
                          }
                        >
                          {AR_ENTRY_STATUS[v.status] ?? v.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="num font-semibold" dir="ltr">
                        {fmtMoney(v.total)}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`عرض سند المقاصة ${v.number}`}
                            title="عرض"
                            onClick={() => setViewing(v)}
                          >
                            <Eye className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`طباعة سند المقاصة ${v.number}`}
                            title="طباعة"
                            disabled={!isPosted}
                            onClick={() => handlePrint(v)}
                          >
                            <Printer className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      {/* النوافذ */}
      <ClearingFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={load}
      />
      <ClearingViewDialog voucher={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}
