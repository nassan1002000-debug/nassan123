import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { readFile } from 'fs/promises'
import path from 'path'
import { UPLOADS_DIR } from '@/lib/uploads'

export const dynamic = 'force-dynamic'

// ==================== POST: تنزيل الصور المحددة كملف ZIP ====================
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { urls?: string[]; name?: string } | null
    const urls = Array.isArray(body?.urls) ? body!.urls!.slice(0, 10) : []

    if (urls.length === 0) {
      return NextResponse.json({ error: 'لم تُحدد أي صور للتنزيل' }, { status: 400 })
    }

    const zip = new JSZip()
    let added = 0
    const used = new Set<string>()

    for (const raw of urls) {
      const s = String(raw)
      // صور داخل القاعدة (Task 28): data:image/…;base64 — فك الترميز مباشرة بلا قرص
      if (s.startsWith('data:image/')) {
        const m = /^data:image\/(webp|png|jpeg|gif);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(s)
        if (!m) continue
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
        const data = Buffer.from(m[2].replace(/\s+/g, ''), 'base64')
        if (data.length === 0) continue
        let finalName = `صورة-${added + 1}.${ext}`
        let i = 1
        while (used.has(finalName)) {
          finalName = `صورة-${added + 1}-${i}.${ext}`
          i += 1
        }
        used.add(finalName)
        zip.file(finalName, data)
        added += 1
        continue
      }
      // صور قديمة على القرص (حقبة ما قبل Task 28)
      const name = path.basename(decodeURIComponent(s))
      if (!name || name.startsWith('.')) continue
      const data = await readFile(path.join(UPLOADS_DIR, name)).catch(() => null)
      if (!data) continue
      // ضمان أسماء فريدة داخل الأرشيف
      let finalName = name
      let i = 1
      while (used.has(finalName)) {
        const ext = path.extname(name)
        finalName = `${path.basename(name, ext)}-${i}${ext}`
        i += 1
      }
      used.add(finalName)
      zip.file(finalName, data)
      added += 1
    }

    if (added === 0) {
      return NextResponse.json({ error: 'الملفات المحددة غير موجودة على الخادم' }, { status: 404 })
    }

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    const zipName = `${body?.name?.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40) || 'item-images'}-${Date.now()}.zip`

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="images.zip"; filename*=UTF-8''${encodeURIComponent(zipName)}`,
        'Content-Length': String(buffer.length),
      },
    })
  } catch (error) {
    console.error('Download ZIP error:', error)
    return NextResponse.json({ error: 'فشل تجهيز ملف التنزيل' }, { status: 500 })
  }
}
