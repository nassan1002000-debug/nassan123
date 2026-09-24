// عميل قراءة النسخة الأرشيفية للفترة المقفلة — PrismaClient منفصل بملف الأرشيف نفسه
// عميل الأرشيف نفسه نُقل إلى db.ts (المصدر الموحّد للوكيل الحي/الأرشيفي) — وهنا إعادة تصدير للتوافق
// الحمايات: معرف الفترة يُتحقق من القاعدة الحية + اسم الملف حرس basename صارم + GET فقط من البوابة
import { db } from '@/lib/db'
import { snapshotPath } from '@/lib/period-server'

export { getSnapshotClient } from '@/lib/db'

export interface ViewPeriod {
  id: string
  label: string
  closingDate: Date
  openingDate: Date
  openingEntryNumber: string
  snapshotFile: string
  snapshotBytes: number
  rotatedEntries: number
  closedBy: string
  createdAt: Date
}

/** التحقق من الفترة من القاعدة الحية + وجود ملف الأرشيف — null إن فشل أي شرط */
export async function resolveViewPeriod(id: string): Promise<ViewPeriod | null> {
  if (!id || id.length > 64) return null
  const period = await db.periodClose.findUnique({ where: { id } })
  if (!period) return null
  if (!snapshotPath(period.snapshotFile)) return null
  return period
}
