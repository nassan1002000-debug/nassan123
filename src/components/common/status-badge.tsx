'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const statusStyles: Record<string, string> = {
  // قيود يومية
  DRAFT: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  POSTED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  CANCELLED: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
  // فواتير
  PAID: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  PARTIAL: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  UNPAID: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
  // موارد بشرية
  PENDING: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  APPROVED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  REJECTED: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
  PRESENT: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  ABSENT: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
  LATE: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  LEAVE: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30',
  SETTLED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  // سندات
  RECEIPT: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  PAYMENT: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
}

interface StatusBadgeProps {
  status: string
  label?: string
  className?: string
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <Badge variant="outline" className={cn('font-medium', statusStyles[status] ?? '', className)}>
      {label ?? status}
    </Badge>
  )
}
