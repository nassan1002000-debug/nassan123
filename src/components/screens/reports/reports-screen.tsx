'use client'

// مركز التقارير — شبكة بطاقات التقارير الـ16 (مثل قوالب لوحة التحكم)
// كل بطاقة: أيقونة داخل مربع ملون + عنوان + وصف كامل بلا بتر (تفاف تلقائي) + زر مجسم لامع «عرض التقرير» (نمط القائمة الجانبية 3D Glossy)
// الضغط يفتح واجهة التقرير داخل نفس الشاشة مع زر «رجوع إلى التقارير»

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { REPORT_CARDS, type ReportKey } from './report-shared'
import { useActionBus } from '@/lib/action-bus'
import { FinancialReportView } from './financial-views'
import {
  InventoryReportView,
  InventoryTurnoverView,
  ItemProfitabilityView,
  MonthlyPnlView,
  ProfitabilityView,
  SalesPurchasesReportView,
} from './operational-views'
import {
  ExpensesReportView,
  PartnerStatementView,
  PeriodComparisonView,
  ReceivablesAgingView,
  TreasuryReportView,
} from './ledger-views'
import { cn } from '@/lib/utils'

// ==================== بطاقة تقرير في المركز ====================

function ReportCard({ index, onOpen }: { index: number; onOpen: (key: ReportKey) => void }) {
  const card = REPORT_CARDS[index]
  const Icon = card.icon
  return (
    <div className="flex w-full flex-col rounded-xl border bg-card p-4 transition-colors duration-200 hover:border-primary/40">
      <div className="flex items-start gap-3 pb-3">
        <div className={cn('shrink-0 rounded-lg p-2.5', card.iconBox)}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-sm font-bold leading-snug">{card.title}</h3>
          <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{card.description}</p>
        </div>
      </div>
      {/* زر مجسم بارز لامع — نفس لغة القائمة الجانبية (3D Glossy Dark Neon) */}
      <button
        type="button"
        onClick={() => onOpen(card.key)}
        className={cn(
          'mt-auto inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-zinc-50',
          'bg-gradient-to-b from-zinc-600/80 via-zinc-800 to-zinc-900 ring-1 ring-white/15',
          'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22),inset_0_-1px_0_0_rgba(0,0,0,0.50),0_6px_18px_-6px_rgba(0,0,0,0.75),0_0_22px_-4px_color-mix(in_oklab,var(--primary)_85%,transparent),0_0_38px_-8px_color-mix(in_oklab,var(--primary)_55%,transparent)]',
          'transition-all duration-200 ease-out hover:translate-y-px hover:brightness-110 active:translate-y-0 active:scale-[0.98]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      >
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
        عرض التقرير
      </button>
    </div>
  )
}

// ==================== الشاشة ====================

export default function ReportsScreen() {
  // null = شبكة بطاقات المركز — قيمة = واجهة التقرير المفتوح
  const [active, setActive] = useState<ReportKey | null>(null)
  const activeCard = active ? REPORT_CARDS.find((c) => c.key === active) ?? null : null

  // Task 46 — رابط عميق من البحث المركزي: فتح التقرير المطلوب مباشرة (إشارة تُستهلك مرة واحدة).
  // نمط «تعديل الحالة أثناء الرندر» الرسمي بحارس آخر-تسلسل-مُستهلَك — أداءً أفضل من التأثير
  // (بلا رندر متتالٍ) ومطابقةً لتوصية react.dev «أنت قد لا تحتاج إلى تأثير».
  const reportSignal = useActionBus((s) => s.pendingReportSignal)
  const consumeReportSignal = useActionBus((s) => s.consumeReportSignal)
  const [consumedSeq, setConsumedSeq] = useState<number | null>(null)
  if (reportSignal && reportSignal.seq !== consumedSeq) {
    setConsumedSeq(reportSignal.seq)
    setActive(reportSignal.key as ReportKey)
    // استهلاك إشارة المتجر يُؤجَّل إلى microtask — لا نُحدِّث مكوناً آخر (GlobalSearchDialog)
    // أثناء رندرنا (تفادياً لتحذير setstate-in-render)
    queueMicrotask(() => consumeReportSignal())
  }

  // ===== واجهة التقرير المفتوح =====
  if (active && activeCard) {
    const ActiveIcon = activeCard.icon
    return (
      <div className="space-y-4">
        {/* رأس التقرير — زر الرجوع + عنوان البطاقة المختارة */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button variant="outline" size="sm" onClick={() => setActive(null)}>
            <ArrowRight className="h-4 w-4" />
            رجوع إلى التقارير
          </Button>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-bold leading-tight">
              <span className={cn('rounded-lg p-1.5', activeCard.iconBox)}>
                <ActiveIcon className="h-4 w-4" />
              </span>
              {activeCard.title}
            </h2>
            <p className="mt-0.5 break-words text-sm text-muted-foreground">{activeCard.description}</p>
          </div>
        </div>

        {/* مفتاح مستخدم لكل عرض — يضمن تصفير الحالة عند التنقل بين تقارير تشارك نفس المكون */}
        {active === 'trial-balance' && <FinancialReportView key={active} type="trial-balance" />}
        {active === 'income-statement' && <FinancialReportView key={active} type="income-statement" />}
        {active === 'balance-sheet' && <FinancialReportView key={active} type="balance-sheet" />}
        {active === 'monthly-pnl' && <MonthlyPnlView key={active} />}
        {active === 'inventory' && <InventoryReportView key={active} />}
        {active === 'sales' && <SalesPurchasesReportView key={active} kind="sales" />}
        {active === 'purchases' && <SalesPurchasesReportView key={active} kind="purchases" />}
        {active === 'customer-statement' && <PartnerStatementView key={active} mode="CUSTOMER" />}
        {active === 'supplier-statement' && <PartnerStatementView key={active} mode="SUPPLIER" />}
        {active === 'treasury' && <TreasuryReportView key={active} />}
        {active === 'expenses' && <ExpensesReportView key={active} />}
        {active === 'item-profitability' && <ItemProfitabilityView key={active} />}
        {active === 'receivables-aging' && <ReceivablesAgingView key={active} />}
        {active === 'profitability' && <ProfitabilityView key={active} />}
        {active === 'period-comparison' && <PeriodComparisonView key={active} />}
        {active === 'inventory-turnover' && <InventoryTurnoverView key={active} />}
      </div>
    )
  }

  // ===== مركز التقارير — شبكة البطاقات =====
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold leading-tight">مركز التقارير</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          اختر تقريراً لعرضه — التقارير المالية والتشغيلية مع طباعة وتصدير موحّدين
        </p>
      </div>

      <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {REPORT_CARDS.map((c, i) => (
          <ReportCard key={c.key} index={i} onOpen={setActive} />
        ))}
      </div>
    </div>
  )
}
