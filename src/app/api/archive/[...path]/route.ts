// المرآة الأرشيفية الكاملة — /api/archive/<نفس-مسار-النظام-الحي>  (الشرط 4: Full Replica)
// ---------------------------------------------------------------------------------------
// الفكرة المعمارية: مسارات GET الحية نفسها تُستدعى حرفياً لكن داخل سياق أرشيفي
// (runInArchive) فيقرأ وكيل db كل البيانات من نسخة الفترة المقفلة — تطابق تام في
// الأشكال والمنطق بلا أي ازدواجية كود. الكتابة مستحيلة على ثلاث طبقات:
//   1) البوابة (proxy.ts): كل طرق الكتابة محجوبة أثناء وضع الاستعراض أصلاً
//   2) هذا المسار: GET فقط — لا يصدّر أي دالة كتابة إطلاقاً
//   3) وكيل db: أي دالة كتابة داخل سياق الأرشيف ترمي ArchiveReadOnlyError
import { NextResponse, type NextRequest } from 'next/server'
import { dbLive, runInArchive, ArchiveReadOnlyError } from '@/lib/db'
import { snapshotPath } from '@/lib/period-server'
import { VIEW_PERIOD_COOKIE } from '@/lib/session'

export const dynamic = 'force-dynamic'

// سياق المسار يختلف بين المسارات الثابتة وتفصيل المعرف ({ params }) — النوع تساهلي مقصود:
// المرآة تمرر mirrorCtx مطابقاً لما يعرّفه كل مسار حي حرفياً، والحرس الفعلي في الخريطة الصريحة وrunInArchive
type LiveGet = (req: NextRequest, ctx?: any) => Promise<Response>

// ==================== خريطة المسارات الحية المسموح استدعاؤها عبر المرآة ====================
// استيراد ساكن صريح — لا ديناميكية مسارات (حماية من أي اجتياز)، والمسار الوحيد المقبول
// هو الموجود في هذه الخريطة بالضبط، وما عدا ذلك يُرجع 404
import * as DashboardRoutes from '@/app/api/dashboard/route'
import * as TreasuryRoutes from '@/app/api/treasury/route'
import * as AccountsRoutes from '@/app/api/accounts/route'
import * as AccountsIdRoutes from '@/app/api/accounts/[id]/route'
import * as AccountsLedgerRoutes from '@/app/api/accounts/[id]/ledger/route'
import * as JournalRoutes from '@/app/api/journal/route'
import * as JournalIdRoutes from '@/app/api/journal/[id]/route'
import * as InvoicesRoutes from '@/app/api/invoices/route'
import * as InvoicesIdRoutes from '@/app/api/invoices/[id]/route'
import * as PaymentsRoutes from '@/app/api/payments/route'
import * as ClearingsRoutes from '@/app/api/clearings/route'
import * as WarehousesRoutes from '@/app/api/warehouses/route'
import * as ItemsRoutes from '@/app/api/items/route'
import * as StockMovementsRoutes from '@/app/api/stock-movements/route'
import * as StocktakingRoutes from '@/app/api/stocktaking/route'
import * as StocktakingIdRoutes from '@/app/api/stocktaking/[id]/route'
import * as StockDamageRoutes from '@/app/api/stock-damage/route'
import * as BundlesRoutes from '@/app/api/bundles/route'
import * as BundlesIdRoutes from '@/app/api/bundles/[id]/route'
import * as LoyaltyRoutes from '@/app/api/loyalty/route'
import * as LoyaltyStatementRoutes from '@/app/api/loyalty/statement/route'
import * as LoyaltySummaryRoutes from '@/app/api/loyalty/summary/route'
import * as PartnersRoutes from '@/app/api/partners/route'
import * as PartnersIdRoutes from '@/app/api/partners/[id]/route'
import * as EmployeesRoutes from '@/app/api/employees/route'
import * as EmployeesIdRoutes from '@/app/api/employees/[id]/route'
import * as SalariesRoutes from '@/app/api/salaries/route'
import * as AdvancesRoutes from '@/app/api/advances/route'
import * as LeavesRoutes from '@/app/api/leaves/route'
import * as AttendanceRoutes from '@/app/api/attendance/route'
import * as BonusesRoutes from '@/app/api/bonuses/route'
import * as CostCentersRoutes from '@/app/api/cost-centers/route'
import * as CostCentersIdRoutes from '@/app/api/cost-centers/[id]/route'
import * as CostCentersReportRoutes from '@/app/api/cost-centers/report/route'
import * as AuditLogRoutes from '@/app/api/audit-log/route'
import * as UsersRoutes from '@/app/api/users/route'
import * as ReportsRoutes from '@/app/api/reports/route'
import * as UnifiedPartyRoutes from '@/app/api/unified-party/route'
import * as UnifiedPartyStatementRoutes from '@/app/api/unified-party/statement/route'

/** مسارات بمقطع واحد: /api/archive/<resource> */
const STATIC_ROUTES: Record<string, LiveGet | undefined> = {
  dashboard: DashboardRoutes.GET,
  treasury: TreasuryRoutes.GET,
  accounts: AccountsRoutes.GET,
  journal: JournalRoutes.GET,
  invoices: InvoicesRoutes.GET,
  payments: PaymentsRoutes.GET,
  clearings: ClearingsRoutes.GET,
  warehouses: WarehousesRoutes.GET,
  items: ItemsRoutes.GET,
  'stock-movements': StockMovementsRoutes.GET,
  stocktaking: StocktakingRoutes.GET,
  'stock-damage': StockDamageRoutes.GET,
  bundles: BundlesRoutes.GET,
  loyalty: LoyaltyRoutes.GET,
  partners: PartnersRoutes.GET,
  employees: EmployeesRoutes.GET,
  salaries: SalariesRoutes.GET,
  advances: AdvancesRoutes.GET,
  leaves: LeavesRoutes.GET,
  attendance: AttendanceRoutes.GET,
  bonuses: BonusesRoutes.GET,
  'cost-centers': CostCentersRoutes.GET,
  'audit-log': AuditLogRoutes.GET,
  users: UsersRoutes.GET,
  reports: ReportsRoutes.GET,
  'unified-party': UnifiedPartyRoutes.GET,
}

/** مسارات بمقطعين ثابتين: /api/archive/<a>/<b> (وليس معرفاً) */
const NESTED_FIXED: Record<string, LiveGet | undefined> = {
  'cost-centers/report': CostCentersReportRoutes.GET,
  'loyalty/statement': LoyaltyStatementRoutes.GET,
  'loyalty/summary': LoyaltySummaryRoutes.GET,
  'unified-party/statement': UnifiedPartyStatementRoutes.GET,
}

/** مسارات تفصيل بمعرف: /api/archive/<resource>/<id> — فقط ما يصدّر GET فعلاً (المسارات الكتابية تفصيلياً لا تُستعرض) */
const ID_ROUTES: Record<string, LiveGet | undefined> = {
  accounts: AccountsIdRoutes.GET,
  journal: JournalIdRoutes.GET,
  invoices: InvoicesIdRoutes.GET,
  stocktaking: StocktakingIdRoutes.GET,
  bundles: BundlesIdRoutes.GET,
  partners: PartnersIdRoutes.GET,
  employees: EmployeesIdRoutes.GET,
  'cost-centers': CostCentersIdRoutes.GET,
}

/** مسارات فرعية تحت معرف: /api/archive/<a>/<id>/<b> */
const NESTED_ID: Record<string, LiveGet | undefined> = {
  'accounts/ledger': AccountsLedgerRoutes.GET,
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  // 1) فك المقاطع — حرس صارم على الشكل
  const { path: segs } = await ctx.params
  if (!segs || segs.length === 0 || segs.length > 3) {
    return NextResponse.json({ error: 'مسار أرشيفي غير معروف' }, { status: 404 })
  }

  // 2) وضع الاستعراض مفعل بكوكي سليم + الفترة موجودة بالقاعدة الحية وأرشيفها موجود فعلاً
  const vpId = req.cookies.get(VIEW_PERIOD_COOKIE)?.value?.trim()
  if (!vpId) {
    return NextResponse.json(
      { error: 'وضع استعراض الفترة المقفلة غير مفعل — لا يمكن قراءة الأرشيف' },
      { status: 403 },
    )
  }
  let snapshotFile = ''
  try {
    const period = await dbLive.periodClose.findUnique({ where: { id: vpId } })
    const full = period ? snapshotPath(period.snapshotFile) : null
    if (!period || !full) {
      return NextResponse.json(
        { error: 'الفترة المطلوبة أو نسختها الأرشيفية غير متاحة' },
        { status: 404 },
      )
    }
    snapshotFile = period.snapshotFile
  } catch (error) {
    console.error('archive mirror period check error:', error)
    return NextResponse.json({ error: 'تعذر التحقق من الفترة المقفلة' }, { status: 500 })
  }

  // 3) تحديد المسار الحي المقابل — من الخريطة الصريحة فقط
  let handler: LiveGet | undefined
  let mirrorCtx: unknown = undefined
  if (segs.length === 1) {
    handler = STATIC_ROUTES[segs[0]]
  } else if (segs.length === 2) {
    const fixed = NESTED_FIXED[`${segs[0]}/${segs[1]}`]
    if (fixed) {
      handler = fixed
    } else {
      handler = ID_ROUTES[segs[0]]
      if (handler) mirrorCtx = { params: Promise.resolve({ id: segs[1] }) }
    }
  } else {
    handler = NESTED_ID[`${segs[0]}/${segs[2]}`]
    if (handler) mirrorCtx = { params: Promise.resolve({ id: segs[1] }) }
  }
  if (typeof handler !== 'function') {
    return NextResponse.json({ error: 'مسار أرشيفي غير معروف' }, { status: 404 })
  }

  // 4) تنفيذ المسار الحي نفسه داخل سياق الأرشيف — القراءة من نسخة الفترة حصراً
  try {
    return await runInArchive(snapshotFile, () => handler!(req, mirrorCtx))
  } catch (error) {
    if (error instanceof ArchiveReadOnlyError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error('archive mirror handler error:', segs.join('/'), error)
    return NextResponse.json({ error: 'تعذر قراءة بيانات الفترة المقفلة' }, { status: 500 })
  }
}
