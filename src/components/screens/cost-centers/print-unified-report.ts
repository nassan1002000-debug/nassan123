// طباعة التقرير الموحد لمراكز التكلفة — نافذة مستقلة بكود HTML أنيق (RTL + خط Cairo) ثم طباعة تلقائية
// نفس أسلوب print-cost-center — جداول كاملة بلا تقطيع كلمات أو أرقام عبر الصفحات

import { fmtDate, fmtDateTime } from '@/lib/format'
import { fmtMoney as money } from '@/lib/format'
import { fmtNumber } from '@/lib/format'
import { getCachedCompanyInfo } from '@/lib/company'
import {
  PRINT_PAGINATION_CSS,
  getCachedPrintTemplate,
  logoHeightPx,
  printHeaderCss,
  printPaginationScript,
  systemSubLine,
} from '@/lib/print-template'

export interface PrintUnifiedRow {
  code: string
  name: string
  isActive: boolean
  entriesCount: number
  totalDebit: number
  totalCredit: number
  net: number
}

export interface PrintUnifiedReport {
  rows: PrintUnifiedRow[]
  entriesCount: number
  totalDebit: number
  totalCredit: number
  net: number
  from: string
  to: string
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** ترجع false إذا فشل فتح النافذة (حجب النوافذ المنبثقة) */
export function printUnifiedCostCentersReport(r: PrintUnifiedReport): boolean {
  const company = getCachedCompanyInfo()
  const tpl = getCachedPrintTemplate() // Task 26: قالب الطباعة القابل للتخصيص
  const subLine = systemSubLine(tpl, 'مراكز التكلفة')
  const rows = r.rows
    .map(
      (c) => `
        <tr>
          <td class="num">${escapeHtml(c.code)}</td>
          <td>${escapeHtml(c.name)}${c.isActive ? '' : ' <span class="inact">(موقوف)</span>'}</td>
          <td class="num">${fmtNumber(c.entriesCount)}</td>
          <td class="num">${c.totalDebit ? money(c.totalDebit) : '—'}</td>
          <td class="num">${c.totalCredit ? money(c.totalCredit) : '—'}</td>
          <td class="num${c.net < 0 ? ' neg' : ''}">${money(c.net)}</td>
        </tr>`,
    )
    .join('')

  const rangeLabel = `من ${fmtDate(r.from)} إلى ${fmtDate(r.to)}`

  const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>التقرير الموحد لمراكز التكلفة</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #1f2937; padding: 22px 30px; font-size: 13px; background: #fff }
  .head { border-bottom: 3px double #b45309; padding-bottom: 10px }
  /* الترويسة الموحدة: الشركة يميناً + الشعار 4× متمركز + عدّاد ووقت الطباعة يساراً — على صف واحد */
  .head-row { display: flex; align-items: center; gap: 16px }
  .co { width: 30%; text-align: right }
  .company { font-size: 19px; font-weight: 800; color: #92400e }
  .company-sub { font-size: 11px; color: #6b7280; margin-top: 2px }
  .head-logo-wrap { flex: 1; display: flex; justify-content: center }
  ${printHeaderCss(tpl)}
  .head-logo { height: ${logoHeightPx(tpl)}px; max-width: 60%; object-fit: contain }
  .stamp-col { width: 30%; text-align: left }
  .print-stamp { font-size: 11px; color: #374151; line-height: 1.9; margin-top: 6px }
  .print-stamp .lbl { color: #6b7280 }
  .doc-no { text-align: left }
  .doc-no .lbl { font-size: 10px; color: #6b7280 }
  .doc-no .val { font-weight: 800; font-size: 16px; color: #92400e; font-variant-numeric: tabular-nums }
  h2.doc-title { display: block; text-align: center; margin: 18px 0 14px }
  h2.doc-title span { display: inline-block; font-size: 16px; font-weight: 700; border: 1.5px solid #e5d3b3; border-radius: 6px; padding: 6px 30px; background: #fffbeb; color: #78350f }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px }
  .meta-item { border: 1px solid #e5e7eb; border-radius: 6px; padding: 5px 10px }
  .meta-item .lbl { font-size: 10px; color: #6b7280 }
  .meta-item .val { font-weight: 700; font-size: 12.5px; margin-top: 1px }
  table { width: 100%; border-collapse: collapse }
  th, td { border: 1px solid #d1d5db; padding: 7px 9px; text-align: right; font-size: 12.5px; vertical-align: middle }
  thead th { background: #fef3c7; color: #78350f; font-weight: 700; font-size: 12px }
  tbody tr:nth-child(even) { background: #fafafa }
  .num { direction: ltr; text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap }
  td.num, th.num { text-align: left }
  .neg { color: #b91c1c }
  .inact { color: #6b7280; font-size: 10px }
  tfoot td { background: #fffbeb; font-weight: 800; font-size: 13px }
  .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px }
  .summary .meta-item .val { color: #78350f }
  .foot { margin-top: 30px; font-size: 10px; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 8px }
  /* هامش صفر يلغي ترويسة المتصفح التلقائية (عنوان + تاريخ) — والهامش العلوي الداخلي أدنى حد (4mm) */
  @page { size: A4; margin: 0 }
  @media print { body { padding: 4mm 10mm 10mm } }
  ${tpl.pageNumbers ? PRINT_PAGINATION_CSS : ''}
</style>
</head>
<body>
  <div id="doc-root" data-company="${escapeHtml(company.companyName)}" data-doc-title="التقرير الموحد لمراكز التكلفة" data-accent="#b45309">
  <div class="head">
    <div class="head-row">
      <div class="co">
        <div class="company">${escapeHtml(company.companyName)}</div>
        ${company.companyPhone ? `<div class="company-sub">هاتف: <span class="num">${escapeHtml(company.companyPhone)}</span></div>` : ''}
        ${company.companyEmail ? `<div class="company-sub company-email">بريد: <span class="num">${escapeHtml(company.companyEmail)}</span></div>` : ''}
        ${subLine ? `<div class="company-sub company-sys">${escapeHtml(subLine)}</div>` : ''}
      </div>
      <div class="head-logo-wrap">
        ${company.companyLogo ? `<img class="head-logo" src="${company.companyLogo}" alt="شعار ${escapeHtml(company.companyName)}" />` : ''}
      </div>
      <div class="stamp-col">
        <div class="doc-no">
          <div class="lbl">عدد المراكز</div>
          <div class="val">${fmtNumber(r.rows.length)}</div>
        </div>
        <div class="print-stamp">
          <div><span class="lbl">تاريخ الطباعة:</span> <span class="num">${fmtDateTime(new Date())}</span></div>
          <div><span class="lbl">الساعة:</span> <span class="num">${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}</span></div>
        </div>
      </div>
    </div>
  </div>

  <h2 class="doc-title"><span>التقرير الموحد لمراكز التكلفة</span></h2>

  <div class="meta">
    <div class="meta-item"><div class="lbl">الفترة</div><div class="val">${rangeLabel}</div></div>
    <div class="meta-item"><div class="lbl">عدد القيود</div><div class="val num">${fmtNumber(r.entriesCount)}</div></div>
    <div class="meta-item"><div class="lbl">عدد المراكز</div><div class="val num">${fmtNumber(r.rows.length)}</div></div>
  </div>

  <table data-print-main>
    <thead>
      <tr>
        <th style="width:11%">الكود</th>
        <th>المركز</th>
        <th class="num" style="width:11%">عدد القيود</th>
        <th class="num" style="width:16%">مدين</th>
        <th class="num" style="width:16%">دائن</th>
        <th class="num" style="width:16%">صافي</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#6b7280">لا توجد حركات على المراكز ضمن الفترة</td></tr>'}</tbody>
    <tfoot>
      <tr>
        <td colspan="2" style="text-align:center">الإجمالي</td>
        <td class="num">${fmtNumber(r.entriesCount)}</td>
        <td class="num">${money(r.totalDebit)}</td>
        <td class="num">${money(r.totalCredit)}</td>
        <td class="num${r.net < 0 ? ' neg' : ''}">${money(r.net)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="summary">
    <div class="meta-item"><div class="lbl">إجمالي المدين</div><div class="val num">${money(r.totalDebit)}</div></div>
    <div class="meta-item"><div class="lbl">إجمالي الدائن</div><div class="val num">${money(r.totalCredit)}</div></div>
    <div class="meta-item"><div class="lbl">الصافي (مدين − دائن)</div><div class="val num${r.net < 0 ? ' neg' : ''}">${money(r.net)}</div></div>
  </div>

  <div class="foot">${escapeHtml(company.companyName)} © — طُبع بتاريخ <span class="num">${fmtDateTime(new Date())}</span></div>
  </div>
  ${tpl.pageNumbers ? printPaginationScript() : ''}
</body>
</html>`

  const win = window.open('', '_blank', 'width=960,height=720')
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
