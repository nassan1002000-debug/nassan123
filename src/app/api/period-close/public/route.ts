// GET /api/period-close/public — قائمة مبسطة للفترات المقفلة لشاشة تسجيل الدخول
// بلا جلسة عمداً (القائمة تحت زر الدخول قبل المصادقة) — تعيد الاسم والتاريخ فقط بلا أي بيانات
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // تصاعدياً حسب تاريخ الإقفال — الأقدم أولاً، كي تُقرأ نقاط الإقفال بترتيب حدوثها الزمني
    const periods = await db.periodClose.findMany({
      orderBy: { closingDate: 'asc' },
      select: { id: true, label: true, closingDate: true, closedBy: true },
    })
    return NextResponse.json({
      periods: periods.map((p) => ({
        id: p.id,
        label: p.label,
        closingDate: p.closingDate.toISOString().slice(0, 10),
        closedBy: p.closedBy,
      })),
    })
  } catch {
    // قاعدة غير مهيأة أو أي عطل — قائمة فارغة تكفي (شاشة الدخول تعمل دائماً)
    return NextResponse.json({ periods: [] })
  }
}
