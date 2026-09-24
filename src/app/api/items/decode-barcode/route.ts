// POST /api/items/decode-barcode — فك باركود من صورة على الخادم (نظير القراءة العميلية)
// حمولة: multipart/form-data بحقل واحد file — يعيد {text} أو {text: null} إن لم يُعثر على رمز
// لا يُنشئ أو يعدّل أي بيانات — قراءة معالجة صورة بحتة، لذا القراءة العادية تكفي (VIEWER مسموح)
import { NextRequest, NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/api-guard'
import { decodeBarcodeFromImage } from '@/lib/barcode-decode'

export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 8 * 1024 * 1024

export async function POST(req: NextRequest) {
  const denied = await requireApiSession(req)
  if (denied) return denied

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'صيغة الطلب غير صالحة — يُتوقع multipart/form-data' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size <= 0) {
    return NextResponse.json({ error: 'أرسل صورة واحدة في الحقل file' }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'حجم الملف يتجاوز 8MB' }, { status: 400 })
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const text = await decodeBarcodeFromImage(buffer)
    return NextResponse.json({ text })
  } catch (error) {
    console.error('POST /api/items/decode-barcode error:', error)
    return NextResponse.json({ error: 'فشلت معالجة الصورة' }, { status: 500 })
  }
}
