// POST /api/upload — رفع صور المواد (مرحلة صفر P0-2: إعادة بناء المسار المفقود)
// الحرس: جلسة إلزامية (دفاع في العمق — البوابة تحجب المجهول أصلاً)
// كل ملف: سقف 8MB → تحويل تلقائي إلى WebP عبر sharp (حد أقصى 1600px للبعد)
// الصيغ غير المدعومة (مثل HEIC إن لم يقرأها المحوّل) تُرد في rejected برسالة عربية
// الاستجابة: { files: [{url, fileName, originalName}], rejected: [{name, reason}] }
//
// Task 28 — التخزين داخل القاعدة (data URL) لا على القرص:
// كارثتا 2026-09-06 أثبتتا أن ملفات القرص تضيع مع استعادة بيئة الاستضافة المتجمدة
// (مسار الرفع نفسه ومجلد uploads/ اختفيا مرتين) بينما القاعدة تنجو عبر حرس الاستعادة
// — فصارت الصورة data:image/webp;base64 يخزنها عمود ItemImage.url مع بقية البيانات
// وتنجو وتُستعاد وتُنسخ احتياطياً معها بلا أي مجلد يتيم. نفس شكل الاستجابة السابق
// فالواجهة لا تتغير، وfileName يبقى معرفاً للعرض وحذف الصفوف.
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { requireApiSession } from '@/lib/api-guard'

export const dynamic = 'force-dynamic'

/** السقف الأقصى لحجم الملف الواحد قبل المعالجة */
const MAX_FILE_SIZE = 8 * 1024 * 1024

/** الحد الأقصى لعدد الملفات في الطلب الواحد (الواجهة تحصر بـ10 على البطاقة) */
const MAX_FILES_PER_REQUEST = 12

/** أقصى بُعد للصورة بعد المعالجة — تكفي للعرض والتكبير دون انتفاخ التخزين */
const MAX_DIMENSION = 1600

/** سقف حجم data URL المخزن في القاعدة بعد التحويل (محارف base64) */
const MAX_DATA_URL_LENGTH = 2_500_000

export async function POST(req: NextRequest) {
  const denied = await requireApiSession(req)
  if (denied) return denied

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'صيغة الطلب غير صالحة — يُتوقع multipart/form-data' }, { status: 400 })
  }

  const entries = form.getAll('files').filter((f): f is File => f instanceof File)
  if (entries.length === 0) {
    return NextResponse.json({ error: 'لم تُرسل أي ملفات — الحقل المطلوب: files' }, { status: 400 })
  }

  const overflowCount = Math.max(0, entries.length - MAX_FILES_PER_REQUEST)
  const batch = entries.slice(0, MAX_FILES_PER_REQUEST)

  const files: { url: string; fileName: string; originalName: string }[] = []
  const rejected: { name: string; reason: string }[] = []

  for (const file of batch) {
    const originalName = file.name || 'صورة'
    if (file.size <= 0) {
      rejected.push({ name: originalName, reason: 'ملف فارغ' })
      continue
    }
    if (file.size > MAX_FILE_SIZE) {
      rejected.push({ name: originalName, reason: 'حجم الملف يتجاوز 8MB' })
      continue
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      const webp = await sharp(buffer, { failOn: 'none' })
        .rotate() // يطبّق اتجاه EXIF تلقائياً (صور الجوال لا تنقلب)
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer()

      const dataUrl = `data:image/webp;base64,${webp.toString('base64')}`
      if (dataUrl.length > MAX_DATA_URL_LENGTH) {
        rejected.push({ name: originalName, reason: 'الصورة أكبر من الحد المسموح بعد الضغط — جرّب صورة أصغر' })
        continue
      }

      // اسم عرضي عشوائي آمن للتعريف — الصورة نفسها داخل القاعدة فلا مسارات على القرص
      const fileName = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}.webp`

      files.push({
        url: dataUrl,
        fileName,
        originalName,
      })
    } catch {
      rejected.push({
        name: originalName,
        reason: 'صيغة غير مدعومة أو ملف تالف — المسموح: JPG / PNG / WebP / GIF',
      })
    }
  }

  if (overflowCount > 0) {
    rejected.push({
      name: `${overflowCount} ملف إضافي`,
      reason: `الحد الأقصى ${MAX_FILES_PER_REQUEST} ملفات في الطلب الواحد`,
    })
  }

  return NextResponse.json({ files, rejected })
}
