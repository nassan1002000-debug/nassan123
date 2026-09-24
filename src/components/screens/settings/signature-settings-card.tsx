'use client'

// بطاقة التوقيعات — تذييل كل مستند مطبوع (خانتا المحاسب والمدير المالي)
// فُصلت عن بطاقة قوالب الطباعة لتجاور بيانات هوية الشركة في تبويب واحد
// («بيانات الهوية والتوقيعات») بعيداً عن تبويب تصميم الترويسة والمعاينة —
// تشارك حالة PrintTemplate كاملة مع PrintTemplateCard عبر props مرفوعة
// من الأب (settings-screen.tsx) فتبقى المعاينة الحية في التبويب الآخر
// متزامنة فوراً مع أي تعديل هنا دون إعادة تحميل

import { useState, type Dispatch, type SetStateAction } from 'react'
import { FileSignature, Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SectionCard } from '@/components/common/section-card'
import { useToast } from '@/hooks/use-toast'
import { useIsArchive } from '@/lib/store'
import { applyPrintTemplate, type PrintTemplate } from '@/lib/print-template'

interface SignatureSettingsCardProps {
  tpl: PrintTemplate
  setTpl: Dispatch<SetStateAction<PrintTemplate>>
}

export function SignatureSettingsCard({ tpl, setTpl }: SignatureSettingsCardProps) {
  const { toast } = useToast()
  const isArchive = useIsArchive()
  const [saving, setSaving] = useState(false)

  const set = (patch: Partial<PrintTemplate>) => setTpl((t) => ({ ...t, ...patch }))

  const save = async () => {
    const signAccountant = tpl.signAccountant.trim()
    const signManager = tpl.signManager.trim()
    const nameAccountant = tpl.signAccountantName.trim()
    const nameManager = tpl.signManagerName.trim()
    if (signAccountant.length < 1 || signAccountant.length > 40) {
      toast({ title: 'مسمى المحاسب غير صالح', description: 'أدخل نصاً بين 1 و 40 محرفاً', variant: 'destructive' })
      return
    }
    if (signManager.length < 1 || signManager.length > 40) {
      toast({ title: 'مسمى المدير المالي غير صالح', description: 'أدخل نصاً بين 1 و 40 محرفاً', variant: 'destructive' })
      return
    }
    if (nameAccountant.length > 60 || nameManager.length > 60) {
      toast({ title: 'اسم التوقيع طويل', description: 'بحد أقصى 60 محرفاً', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printSignAccountant: signAccountant,
          printSignAccountantName: nameAccountant,
          printSignAccountantVisible: String(tpl.signAccountantVisible),
          printSignManager: signManager,
          printSignManagerName: nameManager,
          printSignManagerVisible: String(tpl.signManagerVisible),
        }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok || !data) {
        toast({ title: 'تعذر حفظ التوقيعات', description: data?.error ?? 'حدث خطأ غير متوقع', variant: 'destructive' })
        return
      }
      setTpl((t) => ({
        ...t,
        signAccountant,
        signAccountantName: nameAccountant,
        signManager,
        signManagerName: nameManager,
      }))
      // الكاش المحلي يتحدث فوراً — نفس الكائن الكامل الحالي مع القيم المهذَّبة فقط
      applyPrintTemplate({
        ...tpl,
        signAccountant,
        signAccountantName: nameAccountant,
        signManager,
        signManagerName: nameManager,
      })
      toast({ title: 'تم حفظ التوقيعات', description: 'ستظهر في تذييل كل الفواتير والسندات والكشوفات المطبوعة فوراً' })
    } catch {
      toast({ title: 'تعذر الاتصال بالخادم', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title="التوقيعات"
      description="خانتا تذييل كل مستند مطبوع — خانة «المستلم» في الفواتير و«المحصل / الدفع» في السندات تلقائيتان ولا تتأثران"
      icon={FileSignature}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="sign-accountant" className="text-xs">
              خانة أولى
            </Label>
            <Switch
              aria-label="إظهار خانة التوقيع الأولى"
              checked={tpl.signAccountantVisible}
              onCheckedChange={(v) => set({ signAccountantVisible: v })}
              disabled={saving}
            />
          </div>
          <Input
            id="sign-accountant"
            value={tpl.signAccountant}
            onChange={(e) => set({ signAccountant: e.target.value })}
            placeholder="المحاسب"
            maxLength={40}
            disabled={saving || !tpl.signAccountantVisible}
            aria-label="مسمى التوقيع الأول"
          />
          <Input
            value={tpl.signAccountantName}
            onChange={(e) => set({ signAccountantName: e.target.value })}
            placeholder="اسم اختياري (مثلاً: سارة محمود)"
            maxLength={60}
            disabled={saving || !tpl.signAccountantVisible}
            aria-label="اسم اختياري تحت التوقيع الأول"
          />
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="sign-manager" className="text-xs">
              خانة ثانية
            </Label>
            <Switch
              aria-label="إظهار خانة التوقيع الثانية"
              checked={tpl.signManagerVisible}
              onCheckedChange={(v) => set({ signManagerVisible: v })}
              disabled={saving}
            />
          </div>
          <Input
            id="sign-manager"
            value={tpl.signManager}
            onChange={(e) => set({ signManager: e.target.value })}
            placeholder="المدير المالي"
            maxLength={40}
            disabled={saving || !tpl.signManagerVisible}
            aria-label="مسمى التوقيع الثاني"
          />
          <Input
            value={tpl.signManagerName}
            onChange={(e) => set({ signManagerName: e.target.value })}
            placeholder="اسم اختياري (يظهر تحت المسمى)"
            maxLength={60}
            disabled={saving || !tpl.signManagerVisible}
            aria-label="اسم اختياري تحت التوقيع الثاني"
          />
        </div>
      </div>
      {!isArchive && (
        <div className="pt-4">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            حفظ التوقيعات
          </Button>
        </div>
      )}
    </SectionCard>
  )
}
