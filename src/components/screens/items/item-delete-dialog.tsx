'use client'

// تأكيد حذف بطاقة مادة — يُمنع الحذف عند وجود حركات/فواتير/جرد (الخادم يتحقق أيضاً)

import { useState } from 'react'
import { Loader2, ShieldAlert, Trash2 } from 'lucide-react'
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
import { useToast } from '@/hooks/use-toast'
import type { ItemDTO } from './types'

interface ItemDeleteDialogProps {
  target: ItemDTO | null
  onClose: () => void
  onDeleted: () => void
}

export function ItemDeleteDialog({ target, onClose, onDeleted }: ItemDeleteDialogProps) {
  const { toast } = useToast()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!target) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/items/${target.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'فشل الحذف')
      toast({ title: `حُذفت بطاقة المادة ${target.code} — ${target.name}` })
      onDeleted()
      onClose()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'فشل حذف البطاقة', variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  const linked = target ? target.counts.movements + target.counts.invoiceLines + target.counts.stocktakingLines : 0

  return (
    <AlertDialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4.5 w-4.5 text-rose-500" />
            حذف بطاقة المادة «{target?.name}»؟
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                سيُحذف رقم البطاقة <span className="num font-bold">{target?.code}</span> مع صورها
                ({target?.images.length ?? 0}) ووحداتها الإضافية نهائياً.
              </p>
              {linked > 0 ? (
                <p className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-600 dark:text-rose-300">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  مرتبطة بـ <span className="num">{linked}</span> حركة/فاتورة/جرد — الحذف ممنوع، أوقفها بدلاً من حذفها.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  لا توجد حركات مرتبطة بها — يمكن الحذف بأمان.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>إلغاء</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              handleDelete()
            }}
            disabled={deleting || linked > 0}
            className="bg-rose-600 text-white hover:bg-rose-700"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            حذف نهائي
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
