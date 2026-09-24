// طباعة كشف حساب نقاط الولاء — قالب A4 رسمي بترويسة ماركت الأمل التفاعلية المحمية
// نفس آلية print-invoice حرفياً: نافذة جديدة بكود HTML (RTL + خط Cairo) ثم استدعاء الطباعة
// + الميكانيكية المنجزة سابقاً: التقسيم والترقيم التلقائي «صفحة X من Y» أسفل كل ورقة
// الجدول بأعمدته المطلوبة حرفياً: رقم الفاتورة/السند | التاريخ | البيان والسبب | مضافة (+) | مخصومة (−) | الرصيد المتبقي
// تجميلي وطباعي حصراً — لا يمس المعادلة الرياضية الخلفية ولا قيود المعاملات الذرية إطلاقاً

import { getCachedCompanyInfo } from '@/lib/company'
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format'
import type { LoyaltySettingsData, LoyaltyStatementRow } from '@/lib/loyalty'
import {
  PRINT_PAGINATION_CSS,
  getCachedPrintTemplate,
  logoHeightPx,
  printHeaderCss,
  printPaginationScript,
  signatureBoxesHtml,
  systemSubLine,
} from '@/lib/print-template'

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** الهوية الذهبية لنقاط الولاء — عائلة لونية مستقلة عن هوية الفواتير الزمردية/العنبرية */
const ACCENT = { main: '#a16207', bg: '#fffbeb', border: '#fde68a' }

/** عقد الإدخال — يطابق استجابة /api/loyalty/statement بنيوياً */
export interface LoyaltyStatementPrintInput {
  customer: { name: string; code: string; phone: string | null }
  points: { available: number; redeemed: number; earned: number }
  rows: LoyaltyStatementRow[]
}

/** ترجع false إذا فشل فتح النافذة (حجب النوافذ المنبثقة) */
export function printLoyaltyStatement(
  d: LoyaltyStatementPrintInput,
  settings?: Pick<LoyaltySettingsData, 'pointPrice'> | null,
): boolean {
  const company = getCachedCompanyInfo()
  const tpl = getCachedPrintTemplate() // قالب الطباعة القابل للتخصيص (Task 26)
  const signBoxes = signatureBoxesHtml(tpl)
  const subLine = systemSubLine(tpl, 'كشوف حساب نقاط الولاء')
  const showValue = (settings?.pointPrice ?? 0) > 0
  const valueOfBalance = showValue ? (settings?.pointPrice ?? 0) * d.points.available : 0

  // سطور الكشف — بترتيبه الكرونولوجي ذاته المعروض على الشاشة وبأعمدته الستة حرفياً
  const rowsHtml =
    d.rows.length === 0
      ? `<tr><td colspan="6" class="c muted" style="padding:28px 0;font-size:12px">لا توجد حركات نقاط مسجلة لهذا العميل بعد — ستُوثق آلياً مع أول فاتورة مبيعات مؤهلة</td></tr>`
      : d.rows
          .map(
            (r) => `<tr>
  <td class="c num b" style="color:${ACCENT.main}">${escapeHtml(r.refNumber ?? '—')}</td>
  <td class="c num">${fmtDate(r.createdAt)}</td>
  <td><span class="type-chip">${escapeHtml(r.typeLabel)}</span><span class="reason">${escapeHtml(r.reason)}</span></td>
  <td class="c num b" style="color:${r.points > 0 ? '#047857' : '#9ca3af'}">${r.points > 0 ? `+${fmtNumber(r.points)}` : '—'}</td>
  <td class="c num b" style="color:${r.points < 0 ? '#b91c1c' : '#9ca3af'}">${r.points < 0 ? `−${fmtNumber(Math.abs(r.points))}` : '—'}</td>
  <td class="c num b">${fmtNumber(r.balanceAfter)}</td>
</tr>`,
          )
          .join('')

  // صافي الحركات + الرصيد النهائي (مطابق لآخر balanceAfter في الكشف)
  const totalAdded = d.rows.reduce((s, r) => s + Math.max(0, r.points), 0)
  const totalDeducted = d.rows.reduce((s, r) => s + Math.max(0, -r.points), 0)
  const closingBalance = d.rows.length > 0 ? d.rows[d.rows.length - 1].balanceAfter : d.points.available
  const tfootHtml =
    d.rows.length === 0
      ? ''
      : `<tfoot><tr>
  <td colspan="3" class="c">إجمالي الحركات — عدد الحركات: <span class="num">${fmtNumber(d.rows.length)}</span></td>
  <td class="c num" style="color:#047857">+${fmtNumber(totalAdded)}</td>
  <td class="c num" style="color:#b91c1c">−${fmtNumber(totalDeducted)}</td>
  <td class="c num" style="color:${ACCENT.main}">${fmtNumber(closingBalance)}</td>
</tr></tfoot>`

  const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>كشف حساب نقاط الولاء — ${escapeHtml(d.customer.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #1f2937; padding: 22px 30px; font-size: 13px; background: #fff }
  /* الترويسة الموحدة: اسم الشركة يميناً + الشعار متمركز + تاريخ ووقت الطباعة يساراً — على صف واحد */
  .head { text-align: center; border-bottom: 3px double ${ACCENT.main}; padding-bottom: 10px }
  .head-row { display: flex; align-items: center; gap: 16px }
  .co { width: 30%; text-align: right }
  .company { font-size: 19px; font-weight: 800; color: ${ACCENT.main} }
  .company-sub { font-size: 11px; color: #6b7280; margin-top: 2px }
  .head-logo-wrap { flex: 1; display: flex; justify-content: center }
  ${printHeaderCss(tpl)}
  .head-logo { height: ${logoHeightPx(tpl)}px; max-width: 60%; object-fit: contain }
  .print-stamp { width: 30%; text-align: left; font-size: 11px; color: #374151; line-height: 1.9 }
  .print-stamp .lbl { color: #6b7280 }
  h2.doc-title { display: block; text-align: center; margin: 16px 0 12px }
  h2.doc-title span { display: inline-block; font-size: 16px; font-weight: 700; border: 1.5px solid ${ACCENT.border}; border-radius: 6px; padding: 6px 30px; background: ${ACCENT.bg}; color: ${ACCENT.main} }
  h2.doc-title .no { font-weight: 800; margin-inline-start: 8px }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px }
  .meta-item { border: 1px solid #e5e7eb; border-radius: 6px; padding: 5px 10px }
  .meta-item .lbl { font-size: 10px; color: #6b7280 }
  .meta-item .val { font-weight: 700; font-size: 12.5px; margin-top: 1px }
  .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px }
  .summary.has-value { grid-template-columns: repeat(4, 1fr) }
  .sum-box { border: 1px solid ${ACCENT.border}; border-radius: 6px; padding: 7px 10px; text-align: center; background: ${ACCENT.bg} }
  .sum-box .lbl { font-size: 10px; color: #6b7280 }
  .sum-box .val { font-weight: 800; font-size: 15px; margin-top: 2px; color: ${ACCENT.main} }
  .sum-box .val.plain { color: #374151 }
  table.grid { width: 100%; border-collapse: collapse }
  table.grid th, table.grid td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: start; vertical-align: middle }
  table.grid th { background: #f9fafb; font-size: 11px; color: #374151; font-weight: 700 }
  table.grid td { font-size: 12px }
  table.grid tfoot td { background: #f9fafb; font-weight: 800; font-size: 12px; border-top: 2px solid ${ACCENT.border} }
  .c { text-align: center } .b { font-weight: 700 } .muted { color: #6b7280; font-size: 11px }
  .num { direction: ltr; unicode-bidi: embed; font-variant-numeric: tabular-nums; white-space: nowrap }
  .type-chip { display: inline-block; border: 1px solid ${ACCENT.border}; background: ${ACCENT.bg}; color: ${ACCENT.main}; border-radius: 4px; padding: 0.5px 6px; font-size: 9.5px; font-weight: 700; margin-inline-end: 5px; white-space: nowrap }
  .reason { color: #374151 }
  .sign { display: flex; justify-content: space-between; margin-top: 44px; padding: 0 30px }
  .sign-box { width: 200px; text-align: center }
  .sign-box .line { border-top: 1.5px dashed #9ca3af; padding-top: 6px; font-weight: 700; color: #374151; margin-top: 30px }
  .foot { margin-top: 26px; font-size: 10px; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 8px }
  /* هامش صفر يلغي ترويسة المتصفح التلقائية (عنوان + تاريخ) — والهامش العلوي الداخلي أدنى حد (4mm) */
  @page { size: A4; margin: 0 }
  @media print { body { padding: 4mm 10mm 10mm } }
  ${tpl.pageNumbers ? PRINT_PAGINATION_CSS : ''}
</style>
</head>
<body>
  <div id="doc-root" data-company="${escapeHtml(company.companyName)}" data-doc-title="${escapeHtml(`كشف حساب نقاط الولاء — ${d.customer.name}`)}" data-accent="${ACCENT.main}">
  <div class="head">
    <div class="head-row">
      <div class="co">
        <div class="company">${escapeHtml(company.companyName)}</div>
        ${company.companyPhone ? `<div class="company-sub">هاتف: <span class="num">${escapeHtml(company.companyPhone)}</span></div>` : ''}
        ${company.companyEmail ? `<div class="company-sub">بريد: <span class="num">${escapeHtml(company.companyEmail)}</span></div>` : ''}
        ${subLine ? `<div class="company-sub">${escapeHtml(subLine)}</div>` : ''}
      </div>
      <div class="head-logo-wrap">
        ${company.companyLogo ? `<img class="head-logo" src="${company.companyLogo}" alt="شعار ${escapeHtml(company.companyName)}" />` : ''}
      </div>
      <div class="print-stamp">
        <div><span class="lbl">تاريخ الطباعة:</span> <span class="num">${fmtDateTime(new Date())}</span></div>
        <div><span class="lbl">الساعة:</span> <span class="num">${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}</span></div>
      </div>
    </div>
  </div>

  <h2 class="doc-title"><span>كشف حساب نقاط الولاء<span class="no">${escapeHtml(d.customer.name)}</span></span></h2>

  <div class="meta">
    <div class="meta-item"><div class="lbl">العميل</div><div class="val">${escapeHtml(d.customer.name)}</div></div>
    <div class="meta-item"><div class="lbl">كود العميل</div><div class="val num">${escapeHtml(d.customer.code)}</div></div>
    <div class="meta-item"><div class="lbl">الهاتف</div><div class="val num">${d.customer.phone ? escapeHtml(d.customer.phone) : '—'}</div></div>
    <div class="meta-item"><div class="lbl">عدد الحركات</div><div class="val num">${fmtNumber(d.rows.length)}</div></div>
  </div>

  <div class="summary${showValue ? ' has-value' : ''}">
    <div class="sum-box"><div class="lbl">الرصيد المتاح</div><div class="val num">${fmtNumber(d.points.available)}</div></div>
    <div class="sum-box"><div class="lbl">المسترد سابقاً</div><div class="val plain num">${fmtNumber(d.points.redeemed)}</div></div>
    <div class="sum-box"><div class="lbl">المكتسب كلياً</div><div class="val plain num">${fmtNumber(d.points.earned)}</div></div>
    ${
      showValue
        ? `<div class="sum-box"><div class="lbl">القيمة النقدية للرصيد</div><div class="val num">${fmtMoney(valueOfBalance)} ل.س</div></div>`
        : ''
    }
  </div>

  <table class="grid" data-print-main>
    <thead>
      <tr><th style="width:104px">رقم الفاتورة/السند</th><th style="width:80px">التاريخ</th><th>البيان والسبب</th><th style="width:76px" class="c">نقاط مضافة (+)</th><th style="width:76px" class="c">نقاط مخصومة (−)</th><th style="width:90px" class="c">الرصيد المتبقي</th></tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    ${tfootHtml}
  </table>

  <div class="sign">
    <div class="sign-box"><div class="line">توقيع العميل</div></div>
    ${signBoxes}
  </div>

  <div class="foot">${escapeHtml(company.companyName)} © — طُبع بتاريخ <span class="num">${fmtDateTime(new Date())}</span></div>
  </div>
  ${tpl.pageNumbers ? printPaginationScript() : ''}
</body>
</html>`

  const win = window.open('', '_blank', 'width=900,height=760')
  if (!win) return false
  win.document.open()
  win.document.write(html)
  win.document.close()
  window.setTimeout(() => {
    try {
      win.focus()
      win.print()
    } catch {
      // تجاهل — بعض المتصفحات تمنع الطباعة التلقائية
    }
  }, tpl.pageNumbers ? 1100 : 600) // مع الترقيم: انتظار أطول حتى يكتمل تقسيم الأوراق قبل الطباعة
  return true
}
