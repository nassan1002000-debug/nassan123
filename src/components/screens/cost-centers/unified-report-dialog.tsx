'use client'

// نافذة التقرير الموحد لمراكز التكلفة — تجميع حركة القيود المُرحّلة على كل المراكز ضمن فترة
// فلاتر from/to (افتراضي السنة الحالية) + إظهار المراكز النشطة بلا حركة + عرض/تصدير إكسل/طباعة

import { useCallback, useEffect, useRef, useState } from 'react'
import { FileSpreadsheet, Inbox, Loader2, ScrollText, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { exportTableToCsv } from '@/lib/export'
import { fmtMoney, fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { printUnifiedCostCentersReport } from './print-unified-report'

interface UnifiedCenterRow {
  id: string
  code: string
  name: string
  isActive: boolean
  entriesCount: number
  totalDebit: number
  totalCredit: number
  net: number
}

interface UnifiedReport {
  from: string
  to: string
  centers: UnifiedCenterRow[]
  totals: { entriesCount: number; totalDebit: number; totalCredit: number; net: number }
}

interface UnifiedReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** تاريخ اليوم بصيغة YYYY-MM-DD محلياً (نفس منطق todayYMD في format) */
function todayYMDLocal(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

export function UnifiedReportDialog({ open, onOpenChange }: UnifiedReportDialogProps) {
  const { toast } = useToast()

  // الفترة الافتراضية: بداية السنة الحالية ← اليوم
  const [from, setFrom] = useState(() => `${new Date().getFullYear()}-01-01`)
  const [to, setTo] = useState(todayYMDLocal)
  const [includeEmpty, setIncludeEmpty] = useState(false)
  const [report, setReport] = useState<UnifiedReport | null>(null)
  const [loading, setLoading] = useState(false)
  const seqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (includeEmpty) params.set('includeEmpty', '1')
      const res = await fetch(`/api/cost-centers/report?${params.toString()}`)
      const data = await res.json().catch(() => null)
      if (seq !== seqRef.current) return
      if (!res.ok || !data) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? 'تعذر جلب التقرير الموحد لمراكز التكلفة',
        )
      }
      setReport(data as UnifiedReport)
    } catch (err) {
      if (seq !== seqRef.current) return
      setReport(null)
      toast({
        title: 'تعذر جلب التقرير الموحد',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [from, to, includeEmpty, toast])

  // الجلب عند فتح النافذة وعند تغيير الفلاتر — زر «عرض» يعيد الجلب يدوياً وقتما شئت
  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const handleExport = useCallback(() => {
    if (!report) return
    exportTableToCsv({
      filename: 'cost-centers-unified-report',
      headers: ['الكود', 'المركز', 'عدد القيود', 'إجمالي المدين', 'إجمالي الدائن', 'الصافي'],
      rows: report.centers.map((c) => [
        c.code,
        c.name,
        c.entriesCount,
        c.totalDebit,
        c.totalCredit,
        c.net,
      ]),
    })
  }, [report])

  const handlePrint = useCallback(() => {
    if (!report) return
    const ok = printUnifiedCostCentersReport({
      rows: report.centers.map((c) => ({
        code: c.code,
        name: c.name,
        isActive: c.isActive,
        entriesCount: c.entriesCount,
        totalDebit: c.totalDebit,
        totalCredit: c.totalCredit,
        net: c.net,
      })),
      entriesCount: report.totals.entriesCount,
      totalDebit: report.totals.totalDebit,
      totalCredit: report.totals.totalCredit,
      net: report.totals.net,
      from: report.from,
      to: report.to,
    })
    if (!ok) {
      toast({
        title: 'تعذر فتح نافذة الطباعة',
        description: 'المتصفح يحجب النوافذ المنبثقة — اسمح بها لهذا الموقع',
        variant: 'destructive',
      })
    }
  }, [report, toast])

  const totals = report?.totals

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>التقرير الموحد لمراكز التكلفة</DialogTitle>
          <DialogDescription>
            حركة كل المراكز من القيود المُرحّلة (POSTED) ضمن الفترة — حدد الفترة ثم اعرض أو اطبع أو صدّر
          </DialogDescription>
        </DialogHeader>

        {/* الفلاتر والإجراءات */}
        <div className="flex flex-wrap items-end gap-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="cc-u-from">من تاريخ</Label>
            <Input
              id="cc-u-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="num h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-u-to">إلى تاريخ</Label>
            <Input
              id="cc-u-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="num h-9"
            />
          </div>
          <div className="flex h-9 items-center gap-2 rounded-lg border px-3">
            <Switch
              id="cc-u-empty"
              checked={includeEmpty}
              onCheckedChange={setIncludeEmpty}
              aria-label="إظهار المراكز النشطة بلا حركة"
            />
            <Label
              htmlFor="cc-u-empty"
              className="cursor-pointer text-xs font-normal text-muted-foreground"
            >
              إظهار النشطة بلا حركة
            </Label>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            عرض
          </Button>
          <Button size="sm" variant="outline" onClick={handleExport} disabled={loading || !report}>
            <FileSpreadsheet className="h-4 w-4" />
            تصدير إكسل
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handlePrint}
            disabled={loading || !report}
            className="text-primary"
          >
            <ScrollText className="h-4 w-4" />
            طباعة
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : report ? (
          <div className="space-y-3">
            {/* بطاقات الإجماليات */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <div className="rounded-lg border p-2.5">
                <p className="text-xs text-muted-foreground">عدد المراكز</p>
                <p className="num text-base font-bold">{fmtNumber(report.centers.length)}</p>
              </div>
              <div className="rounded-lg border p-2.5">
                <p className="text-xs text-muted-foreground">عدد القيود</p>
                <p className="num text-base font-bold">{fmtNumber(totals?.entriesCount ?? 0)}</p>
              </div>
              <div className="rounded-lg border p-2.5">
                <p className="text-xs text-muted-foreground">إجمالي المدين</p>
                <p className="num text-base font-bold">{fmtMoney(totals?.totalDebit ?? 0)}</p>
              </div>
              <div className="rounded-lg border p-2.5">
                <p className="text-xs text-muted-foreground">إجمالي الدائن</p>
                <p className="num text-base font-bold">{fmtMoney(totals?.totalCredit ?? 0)}</p>
              </div>
              <div className="rounded-lg border p-2.5">
                <p className="text-xs text-muted-foreground">الصافي</p>
                <p
                  className={cn(
                    'num text-base font-bold',
                    (totals?.net ?? 0) < 0 && 'text-rose-600 dark:text-rose-400',
                  )}
                >
                  {fmtMoney(totals?.net ?? 0)}
                </p>
              </div>
            </div>

            {/* جدول المراكز */}
            <div className="max-h-96 overflow-y-auto rounded-lg border">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-20">الكود</TableHead>
                    <TableHead>المركز</TableHead>
                    <TableHead className="w-24 text-center">عدد القيود</TableHead>
                    <TableHead className="w-36">مدين</TableHead>
                    <TableHead className="w-36">دائن</TableHead>
                    <TableHead className="w-36">صافي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.centers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-12 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <div className="rounded-full bg-muted p-4">
                            <Inbox className="h-8 w-8" />
                          </div>
                          <div>
                            <p className="font-medium">لا توجد حركات على المراكز ضمن الفترة</p>
                            <p className="mt-1 text-xs">
                             فعّل «إظهار النشطة بلا حركة» لعرض المراكز النشطة بقيم صفرية
                            </p>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {report.centers.map((c) => (
                        <TableRow key={c.id} className={cn(!c.isActive && 'opacity-60')}>
                          <TableCell className="num font-bold">{c.code}</TableCell>
                          <TableCell className="font-medium">
                            {c.name}
                            {!c.isActive && (
                              <span className="ms-2 text-xs text-muted-foreground">(موقوف)</span>
                            )}
                          </TableCell>
                          <TableCell className="num text-center">
                            {fmtNumber(c.entriesCount)}
                          </TableCell>
                          <TableCell className="num whitespace-nowrap text-end">
                            {c.totalDebit ? fmtMoney(c.totalDebit) : '—'}
                          </TableCell>
                          <TableCell className="num whitespace-nowrap text-end">
                            {c.totalCredit ? fmtMoney(c.totalCredit) : '—'}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'num whitespace-nowrap text-end',
                              c.net < 0 && 'text-rose-600 dark:text-rose-400',
                            )}
                          >
                            {fmtMoney(c.net)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* صف الإجمالي */}
                      <TableRow className="bg-primary/10 font-bold hover:bg-primary/10">
                        <TableCell colSpan={2} className="text-center">
                          الإجمالي
                        </TableCell>
                        <TableCell className="num text-center">
                          {fmtNumber(totals?.entriesCount ?? 0)}
                        </TableCell>
                        <TableCell className="num whitespace-nowrap text-end">
                          {fmtMoney(totals?.totalDebit ?? 0)}
                        </TableCell>
                        <TableCell className="num whitespace-nowrap text-end">
                          {fmtMoney(totals?.totalCredit ?? 0)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'num whitespace-nowrap text-end',
                            (totals?.net ?? 0) < 0 && 'text-rose-600 dark:text-rose-400',
                          )}
                        >
                          {fmtMoney(totals?.net ?? 0)}
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground">
            حدد الفترة واضغط «عرض» لجلب التقرير
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
