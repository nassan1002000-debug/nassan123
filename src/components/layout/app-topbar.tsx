'use client'

import * as React from 'react'
import { useTheme } from 'next-themes'
import { SCREENS, useApp, useNav } from '@/lib/store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { NavItems, BrandHeader } from '@/components/layout/app-sidebar'
import { NotificationBell } from '@/components/layout/notification-bell'
import { GlobalSearchButton } from '@/components/layout/global-search'
import { useActionBus } from '@/lib/action-bus'
import { loadPrintTemplate } from '@/lib/print-template'
import { Keyboard, LogOut, Menu, Moon, Sun, UserRound } from 'lucide-react'

const AR_ROLE: Record<string, string> = { ADMIN: 'مدير', ACCOUNTANT: 'محاسب', VIEWER: 'مشاهد' }

export function AppTopbar() {
  const screen = useNav((s) => s.screen)
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = React.useState(false)
  const user = useApp((s) => s.user)
  const setUser = useApp((s) => s.setUser)
  const meta = SCREENS[screen]

  // الخروج: إبطال الكوكي على الخادم ثم إعادة ضبط كاملة — البوابة تعيد لشاشة الدخول
  const logout = React.useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // الخروج محلياً دائماً — فشل الشبكة لا يمنع إعادة الضبط
    }
    setUser(null)
    window.location.reload()
  }, [setUser])

  // Task 26: تحميل قالب الطباعة مسبقاً عند إقلاع الواجهة — نوافذ الطباعة تقرأ الكاش متزامنةً بلا انتظار شبكة
  React.useEffect(() => {
    void loadPrintTemplate()
  }, [])

  return (
    <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* قائمة الجوال */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="فتح القائمة">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-64 p-0">
          <SheetHeader className="p-0">
            <SheetTitle className="sr-only">القائمة الرئيسية</SheetTitle>
            <BrandHeader />
          </SheetHeader>
          <NavItems onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="min-w-0 flex-1">
        <h2 className="truncate text-base font-bold leading-tight">{meta.title}</h2>
        <p className="truncate text-xs text-muted-foreground leading-tight">{meta.description}</p>
      </div>

      {/* Task 40 — البحث المركزي الذكي في الهيدر (Ctrl+K من أي مكان في النظام) */}
      <GlobalSearchButton />

      {/* Task 40 — زر دليل اختصارات لوحة المفاتيح (F1 / Alt+H) */}
      <Button
        variant="ghost"
        size="icon"
        aria-label="دليل اختصارات لوحة المفاتيح (F1)"
        title="دليل الاختصارات — F1 أو Alt+H"
        onClick={() => useActionBus.getState().setHelpOpen(true)}
      >
        <Keyboard className="h-4 w-4" />
      </Button>

      {/* جرس تنبيهات المخزون — مراقبة الحد الأدنى/الأعلى مع صوت الجرس */}
      <NotificationBell />

      <Button
        variant="ghost"
        size="icon"
        aria-label="تبديل الوضع الليلي/النهاري"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        <Sun className="h-4 w-4 dark:hidden" />
        <Moon className="hidden h-4 w-4 dark:block" />
      </Button>

      {/* شريحة المستخدم الجاري + تسجيل الخروج */}
      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 px-2" aria-label={`قائمة المستخدم ${user.name}`}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary">
                <UserRound className="h-4 w-4" aria-hidden />
              </span>
              <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
                <span className="max-w-[140px] truncate text-xs font-bold">{user.name}</span>
                <span className="text-[10px] text-muted-foreground">{AR_ROLE[user.role] ?? user.role}</span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-sm">{user.name}</span>
              <span className="num text-xs font-normal text-muted-foreground" dir="ltr">
                @{user.username}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={logout}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              تسجيل الخروج
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  )
}
