'use client'

// نافذة عرض قيد يومية — ترويسة كاملة + جدول البنود + الإجماليات + زر الطباعة

import { useEffect, useState } from 'react'
import { Loader2, Printer } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { StatusBadge } from '@/components/common/status-badge'
import { useToast } from '@/hooks/use-toast'
import { AR_ACCOUNT_TYPE, AR_ENTRY_STATUS, AR_SOURCE, fmtDate, fmtMoney, fmtUSD } from '@/lib/format'
import { printJournalEntry } from './print-entry'
import type { JournalEntryDetail } from './types'

interface JournalViewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entryId: string | null
}

export function JournalViewDialog({ open, onOpenChange, entryId }: JournalViewDialogProps) {
  const { toast } = useToast()

  const [entry, setEntry] = useState<JournalEntryDetail | null>(null)
  const [loading, setLoading] = useState(false)

  const handleClose = (v: boolean) => {
    if (!v) setEntry(null)
    onOpenChange(v)
  }

  useEffect(() => {
    if (!open || !entryId) return
    let cancelled = false
    const run = async () => {
      setLoading(true)
      try {
        const r = await fetch(`/api/journal/${entryId}`)
        if (!r.ok) throw new Error('failed')
        const data: JournalEntryDetail = await r.json()
        if (!cancelled) setEntry(data)
      } catch {
        if (!cancelled) {
          toast({ title: 'تعذر تحميل القيد', variant: 'destructive' })
          onOpenChange(false)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [open, entryId, toast, onOpenChange])

  const handlePrint = () => {
    if (!entry) return
    const ok = printJournalEntry({
      number: entry.number,
      date: entry.date,
      description: entry.description,
      source: entry.source,
      status: entry.status,
      totalDebit: entry.totalDebit,
      totalCredit: entry.totalCredit,
      lines: entry.lines.map((l) => ({
        account: { code: l.account.code, name: l.account.name },
        description: l.description,
        costCenterName: l.costCenter?.name ?? null,
        debit: l.debit,
        credit: l.credit,
      })),
    })
    if (!ok) {
      toast({
        title: 'تعذر فتح نافذة الطباعة',
        description: 'يرجى السماح بالنوافذ المنبثقة لهذا الموقع ثم إعادة المحاولة',
        variant: 'destructive',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent variant="preview" className="flex max-h-[92vh] w-[calc(100vw_-_var(--sidebar-w)_-_1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px]">
        <div className="border-b px-5 py-4">
          <DialogHeader className="text-start">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              قيد يومية
              <span className="num text-primary">{entry?.number ?? ''}</span>
              {entry && (
                <StatusBadge status={entry.status} label={AR_ENTRY_STATUS[entry.status] ?? entry.status} />
              )}
            </DialogTitle>
            <DialogDescription>تفاصيل القيد كاملة مع بنوده ومراكز التكلفة</DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading || !entry ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              جاري التحميل…
            </div>
          ) : (
            <div className="space-y-4">
              {/* الترويسة */}
              <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-4">
                <div>
                  <p className="text-[10px] text-muted-foreground">رقم القيد</p>
                  <p className="num text-sm font-bold">{entry.number}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">التاريخ</p>
                  <p className="num text-sm font-bold">{fmtDate(entry.date)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">المصدر</p>
                  <Badge variant="outline" className="mt-0.5">
                    {AR_SOURCE[entry.source] ?? entry.source}
                  </Badge>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">الحالة</p>
                  <div className="mt-0.5">
                    <StatusBadge status={entry.status} label={AR_ENTRY_STATUS[entry.status] ?? entry.status} />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <p className="text-[10px] text-muted-foreground">البيان</p>
                <p className="mt-1 text-sm leading-relaxed">{entry.description}</p>
              </div>

              {/* البنود */}
              <div className="overflow-x-auto rounded-lg border">
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="w-10 text-center">م</TableHead>
                      <TableHead>الحساب</TableHead>
                      <TableHead>البيان</TableHead>
                      <TableHead>مركز التكلفة</TableHead>
                      <TableHead>مدين</TableHead>
                      <TableHead>دائن</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entry.lines.map((l, i) => (
                      <TableRow key={l.id}>
                        <TableCell className="num text-center text-xs text-muted-foreground">
                          {i + 1}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">
                              <span className="num text-xs text-muted-foreground">{l.account.code}</span>
                              {' — '}
                              {l.account.name}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {AR_ACCOUNT_TYPE[l.account.type] ?? l.account.type}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px] text-sm text-muted-foreground">
                          <span className="line-clamp-1" title={l.description ?? ''}>
                            {l.description ?? '—'}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">
                          {l.costCenter ? (
                            <span>
                              <span className="num text-xs text-muted-foreground">{l.costCenter.code}</span>
                              {' — '}
                              {l.costCenter.name}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="num whitespace-nowrap text-end">
                          {l.debit ? fmtMoney(l.debit) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="num whitespace-nowrap text-end">
                          {l.credit ? fmtMoney(l.credit) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={4} className="text-center font-bold">
                        الإجمالي
                      </TableCell>
                      <TableCell className="num whitespace-nowrap text-end">
                        <div className="font-bold">{fmtMoney(entry.totalDebit)}</div>
                        <div className="num text-[10px] font-normal text-muted-foreground">
                          ≈ {fmtUSD(entry.totalDebit)}
                        </div>
                      </TableCell>
                      <TableCell className="num whitespace-nowrap text-end">
                        <div className="font-bold">{fmtMoney(entry.totalCredit)}</div>
                        <div className="num text-[10px] font-normal text-muted-foreground">
                          ≈ {fmtUSD(entry.totalCredit)}
                        </div>
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t bg-muted/30 px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إغلاق
          </Button>
          <Button onClick={handlePrint} disabled={!entry || loading}>
            <Printer className="h-4 w-4" />
            طباعة القيد
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
