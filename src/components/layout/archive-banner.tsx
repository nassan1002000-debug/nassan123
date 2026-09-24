'use client'

// لافتة وضع استعراض الأرشيف — تُثبت أعلى الشاشة في كل الشاشات (الشرط 4 + 6)
// تخبر المستخدم بوضوح: أنت الآن في فترة مقفلة — مشاهدة وبحث وطباعة فقط —
// وزر العودة إلى الفترة الحالية يعمل دائماً مهما كانت الشاشة المفتوحة
import { Archive, ArrowRightLeft, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/store'

export function ArchiveBanner() {
  const viewPeriod = useApp((s) => s.viewPeriod)
  const setViewPeriod = useApp((s) => s.setViewPeriod)
  if (!viewPeriod) return null

  const exitArchive = async () => {
    try {
      // GET عمداً — يبطل كوكي الاستعراض (آمن حتى داخل وضع القراءة فقط)
      await fetch('/api/auth/period-view', { cache: 'no-store' })
    } catch {
      // الخروج لا يفشل — الكوكي يُمسح من الذاكرة أيضاً ويعاد التحميل
    }
    setViewPeriod(null)
    // إعادة تحميل كاملة: تُنزع غلاف الأرشيف وتُجلب الشاشات بيانات الفترة الحية من جديد
    window.location.reload()
  }

  return (
    <div
      role="status"
      aria-label="وضع استعراض أرشيف فترة محاسبية مقفلة"
      className="no-print sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 border-b border-primary/40 bg-primary/10 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-primary/10"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-primary">
        <Archive className="h-4 w-4 shrink-0" aria-hidden />
        <span className="font-bold">
          استعراض أرشيف الفترة المالية «{viewPeriod.label}»
        </span>
        <span className="text-muted-foreground">
          — أقفلت بتاريخ {viewPeriod.closingDate}
          {viewPeriod.openingEntryNumber ? ` — سند الافتتاحي ${viewPeriod.openingEntryNumber}` : ''}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-background/60 px-2 py-0.5 text-xs font-semibold">
          <Lock className="h-3 w-3" aria-hidden />
          قراءة فقط — مشاهدة وبحث وتقارير وطباعة
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={exitArchive}
        className="gap-1.5 border-primary/50 text-primary hover:bg-primary/15"
        aria-label="العودة إلى الفترة الحالية"
      >
        <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
        العودة إلى الفترة الحالية
      </Button>
    </div>
  )
}
