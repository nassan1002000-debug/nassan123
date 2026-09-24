'use client'

import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface SectionCardProps {
  title?: string
  description?: string
  icon?: LucideIcon
  action?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

export function SectionCard({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <section className={cn('min-w-0 overflow-hidden rounded-xl border bg-card', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b">
          <div className="flex items-center gap-2.5 min-w-0">
            {Icon && (
              <div className="rounded-lg bg-primary/12 p-1.5 text-primary shrink-0">
                <Icon className="h-4 w-4" />
              </div>
            )}
            <div className="min-w-0">
              <h3 className="text-sm font-semibold leading-tight">{title}</h3>
              {description && (
                <p className="text-xs text-muted-foreground leading-tight mt-0.5">{description}</p>
              )}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn('p-3', contentClassName)}>{children}</div>
    </section>
  )
}
