'use client'

// نافذة عرض سند مقاصة — قراءة فقط + طباعة (Task 101)

import { Printer, Scale } from 'lucide-react'
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
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AR_ENTRY_STATUS, fmtDate, fmtMoney } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import { printClearing } from './print-clearing'
import type { ClearingVoucherRow } from './types'

interface Props {
  voucher: ClearingVoucherRow | null
  onClose: () => void
}

export function ClearingViewDialog({ voucher, onClose }: Props) {
  const { toast } = useToast()
  if (!voucher) return null

  const isPosted = voucher.status === 'POSTED'

  const handlePrint = () => {
    const ok = printClearing(voucher)
    if (!ok) {
      toast({ title: 'تعذر فتح نافذة الطباعة', description: 'المتصفح حجب النوافذ المنبثقة — اسمح بها وأعد المحاولة', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={!!voucher} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Scale className="h-5 w-5 text-primary" aria-hidden />
            سند مقاصة {voucher.number}
            <Badge variant="outline" className={isPosted ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400'}>
              {AR_ENTRY_STATUS[voucher.status] ?? voucher.status}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            بتاريخ {fmtDate(voucher.date)} — إجمالي المبلغ المقاص {fmtMoney(voucher.total)} ل.س
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="rounded-lg border bg-card/50 p-3 text-sm leading-relaxed">
            <div className="mb-1 text-xs font-semibold text-muted-foreground">البيان العام</div>
            {voucher.description || '—'}
          </div>

          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary/8">
                  <TableHead className="text-center w-10">ت</TableHead>
                  <TableHead>الحساب</TableHead>
                  <TableHead className="text-start">مدين (ل.س)</TableHead>
                  <TableHead className="text-start">دائن (ل.س)</TableHead>
                  <TableHead className="hidden md:table-cell">البيان</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {voucher.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-center text-muted-foreground">{i + 1}</TableCell>
                    <TableCell>
                      <div className="font-semibold leading-tight">{l.accountName}</div>
                      <div className="num text-[11px] text-muted-foreground" dir="ltr">{l.accountCode}</div>
                    </TableCell>
                    <TableCell className="num text-start">{l.debit ? fmtMoney(l.debit) : '—'}</TableCell>
                    <TableCell className="num text-start">{l.credit ? fmtMoney(l.credit) : '—'}</TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{l.description ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="font-bold">
                  <TableCell colSpan={2}>الإجمالي</TableCell>
                  <TableCell className="num text-start">{fmtMoney(voucher.total)}</TableCell>
                  <TableCell className="num text-start">{fmtMoney(voucher.total)}</TableCell>
                  <TableCell className="hidden md:table-cell" />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            إغلاق
          </Button>
          <Button type="button" onClick={handlePrint}>
            <Printer className="h-4 w-4" aria-hidden /> طباعة السند
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
