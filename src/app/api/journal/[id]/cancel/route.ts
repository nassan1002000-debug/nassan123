import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit-server'
import { AR_ENTRY_STATUS, AR_SOURCE, fmtDateTime } from '@/lib/format'

type RouteParams = { params: Promise<{ id: string }> }

// حساب مصدره الآلي مذكور بالـrefType — كل واحد يُلغى من مستنده لا من هنا،
// وما لا يملك مسار تراجع في مستنده مقصود «محصّن» بتصميم مسبق (رواتب/سلف/جرد)،
// لا ثغرة يسدّها إلغاء يدوي عام يتجاوز القيد التجاري المرتبط
const REF_TYPE_GUIDANCE: Record<string, string> = {
  INVOICE: 'احذف الفاتورة نفسها من شاشة الفواتير — الحذف يعكس القيد والمخزون والتكلفة معاً في معاملة واحدة',
  PAYMENT: 'احذف السند نفسه من شاشة السندات — حذفه يُلغي قيده المرتبط تلقائياً',
  SALARY: 'قسط الراتب مصروف ومحصّن بتصميم النظام — لا تراجع عنه من هنا ولا من شاشة الرواتب',
  ADVANCE: 'السلفة مصروفة ومحصّنة بتصميم النظام — لا تراجع عنها من هنا ولا من شاشة السلف',
  DAMAGE: 'احذف حالة التلف نفسها من شاشة التلف — الحذف يعكس القيد والمخزون معاً',
  STOCKTAKING: 'أمر الجرد مُرحّل ومحصّن بتصميم النظام — لا تراجع عنه من هنا ولا من شاشة الجرد',
  PERIOD_OPEN: 'هذا سند القيد الافتتاحي لإقفال فترة — لا يُلغى إلا عبر زر التراجع في بطاقة إقفال الفترة (للفترة الأحدث حصراً)',
  CLEARING: 'سند المقاصة نهائي بطبيعته — لا مسار للتراجع عنه',
}

// POST /api/journal/[id]/cancel — إلغاء قيد يدوي (إلا إذا كان ملغى أصلاً أو مرتبطاً بمستند آلي)
export async function POST(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const entry = await db.journalEntry.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        status: true,
        description: true,
        source: true,
        totalDebit: true,
        refType: true,
      },
    })
    if (!entry) return NextResponse.json({ error: 'القيد غير موجود' }, { status: 404 })
    if (entry.status === 'CANCELLED') {
      return NextResponse.json({ error: 'القيد ملغى مسبقاً' }, { status: 400 })
    }
    // قيد مرتبط بمستند آلي (فاتورة/سند/راتب/سلفة/تلف/جرد/إقفال فترة/مقاصة) —
    // هذا المسار شاشة القيود اليدوية حصراً؛ إلغاء قيد له مستند مصدر من هنا يُبطل
    // أثره المحاسبي بينما يبقى المستند نفسه (والمخزون/السداد المرتبط به) بلا تغيير
    if (entry.refType) {
      const guidance = REF_TYPE_GUIDANCE[entry.refType] ?? 'هذا القيد مرتبط بمستند آلي — أنهِ الأمر من مستنده الأصلي'
      return NextResponse.json(
        {
          error: `لا يمكن إلغاء القيد ${entry.number} من شاشة القيود — مرتبط بمستند آلي (${entry.refType}). ${guidance}`,
        },
        { status: 409 },
      )
    }

    // الإلغاء + التوثيق في سجل التدقيق داخل المعاملة نفسها (نمط الفواتير)
    const updated = await db.$transaction(async (tx) => {
      const u = await tx.journalEntry.update({
        where: { id },
        data: { status: 'CANCELLED' },
      })

      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'JOURNAL',
        entityId: id,
        entityNumber: u.number,
        title: `قيد يومية ${u.number}`,
        summary: `إلغاء قيد يومية ${u.number} — بطلان أثره المحاسبي — البيان: ${entry.description} — المدين ${entry.totalDebit.toFixed(2)} ل.س`,
        details: {
          'الرقم': u.number,
          'البيان': entry.description,
          'المصدر': AR_SOURCE[entry.source] ?? entry.source,
          'الحالة': `${AR_ENTRY_STATUS[entry.status] ?? entry.status} ← ${AR_ENTRY_STATUS.CANCELLED}`,
          'أثر الإلغاء': 'القيد بلا أثر محاسبي — لا يدخل في الأرصدة والتقارير',
          'وقت الإلغاء': fmtDateTime(new Date()),
        },
        amount: entry.totalDebit,
      })

      return u
    })

    const full = await db.journalEntry.findUnique({
      where: { id },
      include: {
        lines: {
          orderBy: { order: 'asc' },
          include: {
            account: { select: { code: true, name: true } },
            costCenter: { select: { name: true } },
          },
        },
      },
    })
    return NextResponse.json(full)
  } catch (error) {
    console.error('POST /api/journal/[id]/cancel error:', error)
    return NextResponse.json({ error: 'حدث خطأ أثناء إلغاء القيد' }, { status: 500 })
  }
}
