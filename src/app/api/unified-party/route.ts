// GET /api/unified-party — فهرس الأطراف الموحدة (الأشخاص ذوو الأدوار المتعددة)
// يُستهلك من شجرة الحسابات: شارة «طرف موحد» على كل حساب من حسابات الشخص
import { NextResponse } from 'next/server'
import { buildUnifiedIndex } from '@/lib/unified-party-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json({ persons: await buildUnifiedIndex() })
  } catch (error) {
    console.error('GET /api/unified-party error:', error)
    return NextResponse.json({ error: 'فشل جلب فهرس الأطراف الموحدة' }, { status: 500 })
  }
}
