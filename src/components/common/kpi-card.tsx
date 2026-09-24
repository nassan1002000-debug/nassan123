'use client'

import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import type { LucideIcon } from 'lucide-react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface KpiCardProps {
  title: string
  value: string
  hint?: string
  icon?: LucideIcon
  tone?: 'gold' | 'emerald' | 'rose' | 'slate' | 'amber'
  trend?: 'up' | 'down' | 'flat'
  trendText?: string
  loading?: boolean
  className?: string
}

const toneStyles: Record<string, { icon: string; ring: string }> = {
  gold: {
    icon: 'bg-primary/12 text-primary',
    ring: 'hover:border-primary/40',
  },
  emerald: {
    icon: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    ring: 'hover:border-emerald-500/40',
  },
  rose: {
    icon: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
    ring: 'hover:border-rose-500/40',
  },
  amber: {
    icon: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
    ring: 'hover:border-amber-500/40',
  },
  slate: {
    icon: 'bg-muted text-muted-foreground',
    ring: 'hover:border-muted-foreground/30',
  },
}

export function KpiCard({
  title,
  value,
  hint,
  icon: Icon,
  tone = 'slate',
  trend,
  trendText,
  loading,
  className,
}: KpiCardProps) {
  if (loading) {
    return (
      <div className={cn('rounded-xl border bg-card p-4 space-y-3', className)}>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-3 w-28" />
      </div>
    )
  }

  const t = toneStyles[tone] ?? toneStyles.slate
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const trendColor =
    trend === 'up'
      ? 'text-emerald-600 dark:text-emerald-400'
      : trend === 'down'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-muted-foreground'

  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-4 transition-colors duration-200',
        t.ring,
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{title}</p>
        {Icon && (
          <div className={cn('rounded-lg p-2 shrink-0', t.icon)}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      <p className="mt-2 text-xl font-bold num tracking-tight truncate" title={value}>
        {value}
      </p>
      <div className="mt-1 flex items-center justify-between gap-2 min-h-4">
        {hint ? (
          <p className="text-xs text-muted-foreground num">{hint}</p>
        ) : <span />}
        {trend && trendText && (
          <span className={cn('inline-flex items-center gap-1 text-xs font-medium', trendColor)}>
            <TrendIcon className="h-3 w-3" />
            {trendText}
          </span>
        )}
      </div>
    </div>
  )
}
