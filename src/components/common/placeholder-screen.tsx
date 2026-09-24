'use client'

import { SCREENS, useNav, type ScreenId } from '@/lib/store'
import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard,
  Target,
  User,
  Banknote,
  Coins,
  CalendarDays,
  Clock,
  Gift,
  ShieldCheck,
  BarChart3,
  Settings,
} from 'lucide-react'

// أيقونة كل شاشة قيد الإنشاء — مفاتيحها معرفات الشاشات (ScreenId) نفسها
const screenIcons: Partial<Record<ScreenId, LucideIcon>> = {
  'cost-centers': Target,
  employees: User,
  salaries: Banknote,
  advances: Coins,
  leaves: CalendarDays,
  attendance: Clock,
  bonuses: Gift,
  users: ShieldCheck,
  reports: BarChart3,
  settings: Settings,
}

/**
 * شاشة احتياطية للشاشات غير المبنية بعد — تقرأ الشاشة الحالية من المتجر بنفسها
 * بلا خصائص، لتعمل موحّدة مع نمط سجل الشاشات في page.tsx (لا تُعرض أبداً
 * فوق شاشة حقيقية — السجل يضمن الإقصاء المتبادل).
 */
export function PlaceholderScreen() {
  const screen = useNav((s) => s.screen)
  const meta = SCREENS[screen]
  const Icon = screenIcons[screen] ?? LayoutDashboard

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="rounded-2xl bg-primary/10 p-6 text-primary">
        <Icon className="h-12 w-12" aria-hidden="true" />
      </div>
      <h2 className="mt-5 text-2xl font-bold">{meta.title}</h2>
      <p className="mt-2 text-muted-foreground max-w-md">{meta.description}</p>
      <div className="mt-6 rounded-xl border border-dashed border-primary/30 bg-primary/5 px-6 py-4">
        <p className="text-sm font-medium text-primary">🚧 هذه الشاشة قيد الإنشاء — قريباً</p>
        <p className="mt-1 text-xs text-muted-foreground">
          بنية البيانات جاهزة في قاعدة البيانات وسيتم بناء هذه الشاشة ضمن خطة التطوير
        </p>
      </div>
    </div>
  )
}
