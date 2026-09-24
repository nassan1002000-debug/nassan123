import { NextRequest, NextResponse } from 'next/server'
import { stat } from 'fs/promises'
import path from 'path'
import { UPLOADS_DIR } from '@/lib/uploads'

export const dynamic = 'force-dynamic'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

// ==================== GET: خدمة صورة مخزنة ====================
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  try {
    const { path: segments } = await ctx.params
    if (!segments || segments.length !== 1) {
      return NextResponse.json({ error: 'مسار غير صالح' }, { status: 400 })
    }

    // منع اجتياز المسارات
    const name = path.basename(decodeURIComponent(segments[0]))
    if (!name || name.startsWith('.')) {
      return NextResponse.json({ error: 'ملف غير موجود' }, { status: 404 })
    }

    const filePath = path.join(UPLOADS_DIR, name)
    const info = await stat(filePath).catch(() => null)
    if (!info || !info.isFile()) {
      return NextResponse.json({ error: 'ملف غير موجود' }, { status: 404 })
    }

    const ext = path.extname(name).toLowerCase()
    const contentType = MIME[ext] ?? 'application/octet-stream'
    const data = await import('fs/promises').then((m) => m.readFile(filePath))

    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(info.size),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    console.error('Files GET error:', error)
    return NextResponse.json({ error: 'فشل جلب الملف' }, { status: 500 })
  }
}

