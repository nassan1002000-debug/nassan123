import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parsePayload, removeFiles } from '@/lib/items-server'
import { isUniqueViolation, uniqueTarget } from '@/lib/prisma-errors'
import { logAudit, auditMoney } from '@/lib/audit-server'
import { fmtDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

// ==================== PUT: تعديل بطاقة مادة ====================
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const existing = await db.item.findUnique({
      where: { id },
      include: { images: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'بطاقة المادة غير موجودة' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })
    }

    const parsed = await parsePayload(body, id)
    if (!parsed.data) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status ?? 400 })
    }
    const d = parsed.data

    // مزامنة الصور: الاحتفاظ بالموجود، حذف المحذوف (من القاعدة ومن القرص)، إضافة الجديد
    const removed = existing.images.filter((e) => !d.images.some((img) => img.url === e.url))

    await db.$transaction(async (tx) => {
      if (removed.length > 0) {
        await tx.itemImage.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } })
      }
      // الحالة النهائية المطلوبة: كل صورة إما تُحدَّث أو تُنشأ بالترتيب والشارة الصحيحة
      for (const [i, img] of d.images.entries()) {
        const row = await tx.itemImage.findFirst({ where: { itemId: id, url: img.url } })
        if (row) {
          await tx.itemImage.update({
            where: { id: row.id },
            data: { isPrimary: img.isPrimary, sortOrder: i, fileName: img.fileName },
          })
        } else {
          await tx.itemImage.create({
            data: { itemId: id, url: img.url, fileName: img.fileName, isPrimary: img.isPrimary, sortOrder: i },
          })
        }
      }

      await tx.itemUnit.deleteMany({ where: { itemId: id } })
      await tx.itemUnit.createMany({ data: d.units.map((u) => ({ ...u, itemId: id })) })

      await tx.item.update({
        where: { id },
        data: {
          name: d.name,
          barcode: d.barcode,
          description: d.description,
          // سعر الشراء لا يُعدل من البطاقة — يُحتسب تلقائياً من فواتير المشتريات
          salePrice: d.salePrice,
          taxRate: d.taxRate,
          minStock: d.minStock,
          maxStock: d.maxStock,
          location: d.location,
          isActive: d.isActive,
          warehouseId: d.warehouseId,
        },
      })

      // التوثيق في سجل التدقيق — تغييرات «قبل ← بعد» داخل المعاملة نفسها (نمط الفواتير)
      const changes: string[] = []
      if (d.name !== existing.name) changes.push(`الاسم: ${existing.name} ← ${d.name}`)
      if ((d.barcode ?? null) !== existing.barcode)
        changes.push(`الباركود: ${existing.barcode ?? 'بدون'} ← ${d.barcode ?? 'بدون'}`)
      if (d.salePrice !== existing.salePrice)
        changes.push(`سعر البيع: ${auditMoney(existing.salePrice)} ← ${auditMoney(d.salePrice)} ل.س`)
      if (d.taxRate !== existing.taxRate)
        changes.push(`نسبة الضريبة: ${existing.taxRate}% ← ${d.taxRate}%`)
      if (d.minStock !== existing.minStock || d.maxStock !== existing.maxStock)
        changes.push(`حدود المخزون: ${existing.minStock}/${existing.maxStock} ← ${d.minStock}/${d.maxStock}`)
      if ((d.location ?? null) !== existing.location)
        changes.push(`مكان التواجد: ${existing.location ?? 'بدون'} ← ${d.location ?? 'بدون'}`)
      if (d.isActive !== existing.isActive)
        changes.push(`الحالة: ${existing.isActive ? 'نشطة' : 'موقوفة'} ← ${d.isActive ? 'نشطة' : 'موقوفة'}`)
      if (d.warehouseId !== existing.warehouseId) {
        // أسماء المستودعات قبل/بعد — فقط عند تغيّر الإسناد المخزني
        const whIds = [existing.warehouseId, d.warehouseId].filter((v): v is string => !!v)
        const whs =
          whIds.length > 0
            ? await tx.warehouse.findMany({ where: { id: { in: whIds } }, select: { id: true, name: true } })
            : []
        const beforeWh = whs.find((w) => w.id === existing.warehouseId)?.name ?? 'بدون'
        const afterWh = whs.find((w) => w.id === d.warehouseId)?.name ?? 'بدون'
        changes.push(`الإسناد المخزني: ${beforeWh} ← ${afterWh}`)
      }

      await logAudit(tx, {
        action: 'UPDATE',
        entity: 'ITEM',
        entityId: id,
        entityNumber: existing.code,
        title: `بطاقة مادة ${existing.code}`,
        summary: `تعديل بطاقة مادة ${existing.code} — ${d.name} — ${changes.length > 0 ? changes.join('؛ ') : 'تعديل بيانات دون تغيير قيم دالة'}`,
        details: {
          'كود البطاقة': existing.code,
          'التغييرات': changes.length > 0 ? changes.join('؛ ') : 'لا تغييرات دالة',
          'قبل التعديل': {
            'الاسم': existing.name,
            'الباركود': existing.barcode ?? 'بدون',
            'سعر البيع (ل.س)': auditMoney(existing.salePrice),
            'نسبة الضريبة': `${existing.taxRate}%`,
            'الحد الأدنى/الأعلى': `${existing.minStock} / ${existing.maxStock}`,
            'الحالة': existing.isActive ? 'نشطة' : 'موقوفة',
            'عدد الصور': existing.images.length,
          },
          'بعد التعديل': {
            'الاسم': d.name,
            'الباركود': d.barcode ?? 'بدون',
            'سعر البيع (ل.س)': auditMoney(d.salePrice),
            'نسبة الضريبة': `${d.taxRate}%`,
            'الحد الأدنى/الأعلى': `${d.minStock} / ${d.maxStock}`,
            'الحالة': d.isActive ? 'نشطة' : 'موقوفة',
            'عدد الصور': d.images.length,
          },
          'وقت التعديل': fmtDateTime(new Date()),
        },
      })
    })

    // حذف ملفات الصور المزالة من القرص (خارج المعاملة)
    if (removed.length > 0) await removeFiles(removed.map((r) => r.url))

    const updated = await db.item.findUnique({
      where: { id },
      include: {
        images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
        units: true,
        balances: { select: { warehouseId: true, quantity: true } },
      },
    })
    return NextResponse.json(updated)
  } catch (error) {
    if (isUniqueViolation(error)) {
      const target = uniqueTarget(error)
      if (target.includes('barcode')) {
        return NextResponse.json({ error: 'رمز الباركود مستخدم مسبقاً في مادة أخرى' }, { status: 409 })
      }
      return NextResponse.json({ error: 'تعذر الحفظ — إحدى القيم الفريدة (كود البطاقة/الباركود) مستخدمة مسبقاً' }, { status: 409 })
    }
    console.error('Item PUT error:', error)
    return NextResponse.json({ error: 'فشل تعديل بطاقة المادة' }, { status: 500 })
  }
}

// ==================== DELETE: حذف بطاقة مادة ====================
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const item = await db.item.findUnique({
      where: { id },
      include: {
        images: true,
        _count: { select: { movements: true, invoiceLines: true, stocktakingLines: true } },
      },
    })
    if (!item) {
      return NextResponse.json({ error: 'بطاقة المادة غير موجودة' }, { status: 404 })
    }

    if (item._count.movements + item._count.invoiceLines + item._count.stocktakingLines > 0) {
      return NextResponse.json(
        { error: 'لا يمكن حذف المادة — مرتبطة بحركات مخزنية أو فواتير أو جرد. يمكن إيقافها بدلاً من حذفها.' },
        { status: 409 },
      )
    }

    // الحذف + التوثيق في سجل التدقيق داخل المعاملة نفسها (نمط الفواتير)
    await db.$transaction(async (tx) => {
      await tx.itemBalance.deleteMany({ where: { itemId: id } })
      await tx.item.delete({ where: { id } }) // الصور والوحدات تُحذف تتابعياً

      await logAudit(tx, {
        action: 'DELETE',
        entity: 'ITEM',
        entityId: id,
        entityNumber: item.code,
        title: `بطاقة مادة ${item.code}`,
        summary: `حذف بطاقة مادة ${item.code} — ${item.name} — سعر بيع ${auditMoney(item.salePrice)} ل.س — حُذفت أرصدتها وصورها ووحداتها معها`,
        details: {
          'كود البطاقة': item.code,
          'اسم المادة': item.name,
          'الباركود': item.barcode ?? 'بدون',
          'سعر البيع (ل.س)': auditMoney(item.salePrice),
          'عدد الصور المحذوفة': item.images.length,
          'أثر الحذف': 'حذف البطاقة والأرصدة والصور والوحدات',
          'وقت الحذف': fmtDateTime(new Date()),
        },
      })
    })

    // تنظيف ملفات الصور من القرص
    if (item.images.length > 0) await removeFiles(item.images.map((i) => i.url))

    return NextResponse.json({ deleted: true, code: item.code })
  } catch (error) {
    console.error('Item DELETE error:', error)
    return NextResponse.json({ error: 'فشل حذف بطاقة المادة' }, { status: 500 })
  }
}
