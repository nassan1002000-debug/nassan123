import { NextRequest, NextResponse } from 'next/server'
import { unlink } from 'fs/promises'
import path from 'path'
import { UPLOADS_DIR } from '@/lib/uploads'

export const dynamic = 'force-dynamic'

// ==================== DELETE: تنظيف صور يتيمة (أُلغيت قبل الحفظ) ====================
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { urls?: string[] } | null
    const urls = Array.isArray(body?.urls) ? body!.urls! : []
    if (urls.length === 0) {
      return NextResponse.json({ deleted: 0 })
    }

    let deleted = 0
    for (const raw of urls) {
      const name = path.basename(decodeURIComponent(String(raw)))
      if (!name || name.startsWith('.')) continue
      const removed = await unlink(path.join(UPLOADS_DIR, name))
        .then(() => true)
        .catch(() => false)
      if (removed) deleted += 1
    }

    return NextResponse.json({ deleted })
  } catch (error) {
    console.error('Files DELETE error:', error)
    return NextResponse.json({ error: 'فشل حذف الملفات' }, { status: 500 })
  }
}
