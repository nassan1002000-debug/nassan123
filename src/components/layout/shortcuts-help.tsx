'use client'

// Task 40 — دليل اختصارات لوحة المفاتيح المركزي
// يفتح بـ F1 أو Alt+H أو من زر لوحة المفاتيح في الشريط العلوي

import { useActionBus } from '@/lib/action-bus'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'

interface ShortcutRow {
  keys: string[][]
  action: string
}

const GROUPS: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: 'البحث والتنقل',
    rows: [
      { keys: [['Ctrl', 'K']], action: 'فتح البحث المركزي الذكي (المواد، العملاء، الموردون، الشاشات)' },
      { keys: [['Alt', 'I']], action: 'فاتورة مبيعات جديدة فوراً' },
      { keys: [['Alt', 'V']], action: 'سند قبض جديد فوراً' },
      { keys: [['Alt', 'P']], action: 'سند دفع جديد فوراً' },
      { keys: [['Alt', 'C']], action: 'شاشة حساب الصندوق' },
      { keys: [['Alt', 'M']], action: 'شاشة بطاقات المواد' },
      { keys: [['Alt', 'A']], action: 'شاشة العملاء والموردين' },
      { keys: [['Alt', 'G']], action: 'شاشة دليل الحسابات' },
      { keys: [['Alt', 'J']], action: 'شاشة القيود اليومية' },
      { keys: [['Alt', 'B']], action: 'شاشة سلال العروض' },
      { keys: [['Alt', 'L']], action: 'شاشة نقاط الولاء' },
      { keys: [['Alt', 'R']], action: 'شاشة التقارير' },
    ],
  },
  {
    title: 'عمليات الفواتير والسندات المفتوحة',
    rows: [
      { keys: [['Ctrl', 'S'], ['F8']], action: 'حفظ وترحيل الفاتورة/السند الحالي بمعاملة ذرية' },
      { keys: [['Ctrl', 'P'], ['F9']], action: 'حفظ وطباعة الفاتورة/السند الحالي بالقالب المطور' },
      { keys: [['Ctrl', 'P'], ['F9']], action: 'طباعة الفاتورة/السند المعروضة في بطاقة العرض' },
      { keys: [['Esc']], action: 'إلغاء العملية الحالية وتطهير الحقول — مع نافذة تأكيد للحماية من الخطأ' },
    ],
  },
  {
    title: 'المساعدة',
    rows: [{ keys: [['F1'], ['Alt', 'H']], action: 'فتح دليل الاختصارات هذا' }],
  },
]

export function ShortcutsHelpDialog() {
  const helpOpen = useActionBus((s) => s.helpOpen)
  const setHelpOpen = useActionBus((s) => s.setHelpOpen)

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent variant="preview" className="max-h-[90vh] overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>دليل اختصارات لوحة المفاتيح</DialogTitle>
          <DialogDescription>
            اختصارات مركزية تعمل من أي مكان في النظام — لتسريع عمل المحاسب ومنع الأخطاء
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 max-h-[55vh] space-y-4 overflow-y-auto px-1">
          {GROUPS.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3 className="mb-2 text-xs font-bold text-primary">{group.title}</h3>
              <ul className="space-y-1.5">
                {group.rows.map((row, i) => (
                  <li
                    key={`${row.action}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 text-sm">{row.action}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map((combo, j) => (
                        <span key={j} className="flex items-center gap-1">
                          {j > 0 && <span className="text-[10px] text-muted-foreground">أو</span>}
                          {combo.map((k) => (
                            <Kbd key={k} className="h-6 min-w-6 text-[11px]">
                              {k}
                            </Kbd>
                          ))}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
            ملاحظة أمان: جميع النوافذ المنبثقة محمية — لا تُغلق بالنقر خارجها أو بضغطة Escape،
            ويجب استخدام أزرار «حفظ» أو «إلغاء/إغلاق» الصريحة داخلها.
          </p>
        </div>

        <DialogFooter>
          <Button onClick={() => setHelpOpen(false)}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
