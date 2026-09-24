// GET /api/unified-party/statement — كشف مستندات الطرف الموحد
// يدمج كل حركات الشخص (فواتيره وسنداته وسلفه ومسحوباته ومقاصاته) بغض النظر
// عن مكان حساباته في شجرة الحسابات — ?accountId= أو ?partnerId= أو ?employeeId=
import { NextResponse, type NextRequest } from 'next/server'
import { buildUnifiedStatement } from '@/lib/unified-party-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const accountId = sp.get('accountId')
    const partnerId = sp.get('partnerId')
    const employeeId = sp.get('employeeId')
    if (!accountId && !partnerId && !employeeId) {
      return NextResponse.json(
        { error: 'حدد الحساب أو ملف الطرف أو ملف الموظف لعرض الكشف الموحد' },
        { status: 400 },
      )
    }
    const statement = await buildUnifiedStatement({ accountId, partnerId, employeeId })
    if (!statement) {
      return NextResponse.json(
        { error: 'لم يُعثر على ملف طرف أو موظف مرتبط بهذا الحساب' },
        { status: 404 },
      )
    }
    return NextResponse.json(statement)
  } catch (error) {
    console.error('GET /api/unified-party/statement error:', error)
    return NextResponse.json({ error: 'فشل بناء كشف الطرف الموحد' }, { status: 500 })
  }
}
