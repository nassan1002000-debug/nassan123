// طباعة دفتر الأستاذ وكشف الحساب والكشف التفصيلي من شجرة الحسابات
// الترويسة الموحدة: اسم الشركة يميناً على صف الشعار المتمركز + تاريخ ووقت الطباعة يساراً
// الهامش العلوي في الطباعة أدنى حد (4mm) — وطُلب إظهار ساعة وتاريخ الطباعة دائماً

import { getCachedCompanyInfo } from '@/lib/company'
import {
  PRINT_PAGINATION_CSS,
  getCachedPrintTemplate,
  logoHeightPx,
  printHeaderCss,
  printPaginationScript,
  signatureBoxesHtml,
  systemSubLine,
} from '@/lib/print-template'
import { AR_ACCOUNT_TYPE, fmtDate, fmtDateTime, fmtMoney } from '@/lib/format'
import { tafqitSYP } from '@/lib/tafqit'
import type { LedgerResponse } from './types'

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const REPORT_TITLES: Record<string, string> = {
  ledger: 'دفتر الأستاذ',
  summary: 'كشف الحساب (ملخص)',
  detail: 'كشف الحساب التفصيلي',
}

const AR_SOURCE_LABEL: Record<string, string> = {
  MANUAL: 'يدوي',
  SALES: 'مبيعات',
  PURCHASE: 'مشتريات',
  RECEIPT: 'سند قبض',
  PAYMENT: 'سند دفع',
  SALARY: 'رواتب',
  EXPENSE: 'مصروف',
  OPENING: 'افتتاحي',
  ADVANCE: 'سلفة',
  BONUS: 'مكافأة/حسم',
}

const ACCENT = '#a16207' // ذهبي داكن — هوية الشركة
const ACCENT_BG = '#fffbeb'
const ACCENT_BORDER = '#fde68a'

function dirLabel(dir: string): string {
  if (dir === 'ZERO') return 'صفر'
  return dir === 'DEBIT' ? 'مدين' : 'دائن'
}

/**
 * صف بنود فاتورة مصغّر — يُطبع مباشرة تحت سطر الفاتورة عند طلب «طباعة تفصيلية للبنود»
 * (يُزاح للداخل وله حدّ منقّط يميّزه بصرياً كتفصيل تابع لا حركة مستقلة)
 */
function itemsSubRowHtml(items: NonNullable<LedgerResponse['lines'][number]['items']>, colspan: number): string {
  const itemRows = items
    .map(
      (it) => `<tr>
    <td>${escapeHtml(it.itemName)}</td>
    <td class="c num">${it.quantity}</td>
    <td class="e num">${fmtMoney(it.unitPrice)}</td>
    <td class="e num b">${fmtMoney(it.total)}</td>
  </tr>`,
    )
    .join('')
  return `<tr class="items-row"><td colspan="${colspan}">
  <table class="items-grid">
    <thead><tr><th>المادة</th><th style="width:70px">الكمية</th><th style="width:100px">السعر</th><th style="width:110px">الإجمالي</th></tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
</td></tr>`
}

/**
 * يرجع false إذا فشل فتح النافذة (حجب النوافذ المنبثقة)
 * expandItems: طباعة تفصيلية للبنود — يُدرج جدول مواد مصغّر تحت كل سطر فاتورة له بنود
 */
export function printAccountReport(d: LedgerResponse, mode: string, expandItems = false): boolean {
  const company = getCachedCompanyInfo()
  const tpl = getCachedPrintTemplate() // Task 26: قالب الطباعة القابل للتخصيص
  const signBoxes = signatureBoxesHtml(tpl)
  const subLine = systemSubLine(tpl)
  const now = new Date()
  const isDetail = mode === 'detail'
  const title = REPORT_TITLES[mode] ?? 'كشف الحساب'
  const colCount = isDetail ? 7 : 5

  const rows = d.lines
    .map(
      (l) => `<tr>
  <td class="c num b">${escapeHtml(l.entryNumber)}</td>
  <td class="c num">${fmtDate(l.date)}</td>
  <td>${escapeHtml(l.description)}</td>
  ${isDetail ? `<td class="c">${l.costCenterName ? escapeHtml(l.costCenterName) : '—'}</td><td class="c">${AR_SOURCE_LABEL[l.source] ?? escapeHtml(l.source)}</td>` : ''}
  <td class="e num">${l.debit ? fmtMoney(l.debit) : '—'}</td>
  <td class="e num">${l.credit ? fmtMoney(l.credit) : '—'}</td>
  <td class="e num b">${fmtMoney(l.balance)} <span class="dir">${dirLabel(l.balanceDirection)}</span></td>
</tr>${expandItems && l.items && l.items.length > 0 ? itemsSubRowHtml(l.items, colCount) : ''}`,
    )
    .join('')

  const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} — ${escapeHtml(d.account.code)} ${escapeHtml(d.account.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #1f2937; padding: 22px 30px; font-size: 13px; background: #fff }
  /* الترويسة الموحدة: الشركة يميناً + الشعار 4× بمنتصف الصفحة + وقت وتاريخ الطباعة يساراً — على صف واحد */
  .head { border-bottom: 3px double ${ACCENT}; padding-bottom: 10px }
  .head-row { display: flex; align-items: center; gap: 16px }
  .co { width: 30%; text-align: right }
  .company { font-size: 19px; font-weight: 800; color: ${ACCENT} }
  .company-sub { font-size: 11px; color: #6b7280; margin-top: 2px }
  .head-logo-wrap { flex: 1; display: flex; justify-content: center }
  ${printHeaderCss(tpl)}
  .head-logo { height: ${logoHeightPx(tpl)}px; max-width: 60%; object-fit: contain }
  .print-stamp { width: 30%; text-align: left; font-size: 11px; color: #374151; line-height: 1.9 }
  .print-stamp .lbl { color: #6b7280 }
  h2.doc-title { display: block; text-align: center; margin: 14px 0 12px }
  h2.doc-title span { display: inline-block; font-size: 15px; font-weight: 700; border: 1.5px solid ${ACCENT_BORDER}; border-radius: 6px; padding: 6px 26px; background: ${ACCENT_BG}; color: ${ACCENT} }
  h2.doc-title .acc { font-weight: 800; font-variant-numeric: tabular-nums; margin-inline-start: 8px }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px }
  .meta-item { border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 10px }
  .meta-item .lbl { font-size: 10px; color: #6b7280 }
  .meta-item .val { font-weight: 700; font-size: 12.5px; margin-top: 1px }
  .meta-item .dir { font-size: 10px; color: #6b7280; font-weight: 400 }
  table.grid { width: 100%; border-collapse: collapse; margin-bottom: 14px }
  table.grid th, table.grid td { border: 1px solid #e5e7eb; padding: 5px 8px; text-align: start; vertical-align: middle }
  table.grid th { background: #f9fafb; font-size: 11px; color: #374151; font-weight: 700; text-align: center }
  table.grid td { font-size: 11.5px }
  tr.opening td { background: #f9fafb; font-size: 11px; color: #374151 }
  tfoot td { background: #f9fafb; font-weight: 700 }
  /* بنود الفاتورة المفكَّكة — مزاحة للداخل بحدّ منقّط يميّزها كتفصيل تابع لا حركة مستقلة،
     ولا تُقطع بين صفحتين (طلب صريح) */
  tr.items-row td { padding: 4px 8px 8px 28px; background: #fafafa; border-top: none }
  tr.items-row { break-inside: avoid; page-break-inside: avoid }
  table.items-grid { width: 100%; border-collapse: collapse; border: 1px dashed #d1d5db; border-radius: 4px; overflow: hidden }
  table.items-grid th, table.items-grid td { border: none; border-bottom: 1px solid #e5e7eb; padding: 3px 8px; font-size: 10.5px }
  table.items-grid th { background: #f3f4f6; color: #6b7280; font-weight: 700; text-align: center }
  table.items-grid tbody tr:last-child td { border-bottom: none }
  .c { text-align: center } .e { text-align: left } .b { font-weight: 700 }
  .dir { font-size: 9.5px; color: #6b7280; font-weight: 400 }
  .num { direction: ltr; unicode-bidi: embed; font-variant-numeric: tabular-nums; white-space: nowrap }
  .empty { padding: 26px; text-align: center; color: #6b7280; border: 1px dashed #e5e7eb; border-radius: 8px; margin-bottom: 14px }
  .sign { display: flex; justify-content: space-between; margin-top: 40px; padding: 0 30px }
  .tafqit-line { border: 1px solid #e5d3b3; border-radius: 6px; padding: 8px 12px; margin-top: 10px; background: #fffbeb; font-size: 12.5px; font-weight: 600; color: #374151 }
  .tafqit-line .lbl { color: #92400e; font-weight: 700 }
  .sign-box { width: 200px; text-align: center }
  .sign-box .line { border-top: 1.5px dashed #9ca3af; padding-top: 6px; font-weight: 700; color: ${'#374151'}; margin-top: 28px }
  .foot { margin-top: 22px; font-size: 10px; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 8px }
  /* هامش صفر يلغي ترويسة المتصفح التلقائية — والهامش العلوي الداخلي أدنى حد (4mm) */
  @page { size: A4; margin: 0 }
  @media print { body { padding: 4mm 10mm 10mm } }
  ${tpl.pageNumbers ? PRINT_PAGINATION_CSS : ''}
</style>
</head>
<body>
  <div id="doc-root" data-company="${escapeHtml(company.companyName)}" data-doc-title="${escapeHtml(`${title} — ${d.account.code} ${d.account.name}`)}" data-accent="${ACCENT}">
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
      <div class="print-stamp">
        <div><span class="lbl">تاريخ الطباعة:</span> <span class="num">${fmtDateTime(now)}</span></div>
        <div><span class="lbl">الساعة:</span> <span class="num">${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}</span></div>
      </div>
    </div>
  </div>

  <h2 class="doc-title"><span>${escapeHtml(title)}<span class="acc num">${escapeHtml(d.account.code)} — ${escapeHtml(d.account.name)}</span></span></h2>
  ${
    d.basedOn === 'DOCUMENTS'
      ? `<div style="text-align:center; font-size:11px; color:#065f46; margin:-6px 0 10px">كشف من مستندات الطرف — فواتيره ومردوداته وسنداته وسلفه (دفتر الفرع)</div>`
      : ''
  }

  <div class="meta">
    <div class="meta-item"><div class="lbl">${escapeHtml(d.totals.openingRef ?? 'الرصيد الافتتاحي')}</div><div class="val num">${fmtMoney(d.totals.opening)} <span class="dir">${dirLabel(d.totals.openingDirection)}</span></div></div>
    <div class="meta-item"><div class="lbl">إجمالي المدين</div><div class="val num">${fmtMoney(d.totals.totalDebit)}</div></div>
    <div class="meta-item"><div class="lbl">إجمالي الدائن</div><div class="val num">${fmtMoney(d.totals.totalCredit)}</div></div>
    <div class="meta-item"><div class="lbl">الرصيد الختامي</div><div class="val num">${fmtMoney(d.totals.closing)} <span class="dir">${dirLabel(d.totals.closingDirection)}</span></div></div>
  </div>

  ${
    d.lines.length === 0
      ? `<div class="empty">${d.basedOn === 'DOCUMENTS' ? 'لا توجد فواتير أو سندات على هذا الطرف بعد' : 'لا توجد حركات مُرحّلة على هذا الحساب'}</div>`
      : `<table class="grid" data-print-main>
    <thead>
      <tr>
        <th style="width:60px">القيد</th>
        <th style="width:74px">التاريخ</th>
        <th>البيان</th>
        ${isDetail ? '<th style="width:84px">مركز التكلفة</th><th style="width:62px">المصدر</th>' : ''}
        <th style="width:95px">مدين</th>
        <th style="width:95px">دائن</th>
        <th style="width:110px">الرصيد</th>
      </tr>
    </thead>
    <tbody>
      <tr class="opening">
        <td class="c" colspan="${isDetail ? 5 : 3}">${escapeHtml(d.totals.openingRef ?? 'رصيد ما قبل الحركة (افتتاحي)')}</td>
        <td class="e">—</td>
        <td class="e">—</td>
        <td class="e num">${fmtMoney(d.totals.opening)} <span class="dir">${dirLabel(d.totals.openingDirection)}</span></td>
      </tr>
      ${rows}
    </tbody>
    <tfoot>
      <tr>
        <td class="c" colspan="${isDetail ? 5 : 3}">الإجمالي (${d.totals.count} حركة)</td>
        <td class="e num">${fmtMoney(d.totals.totalDebit)}</td>
        <td class="e num">${fmtMoney(d.totals.totalCredit)}</td>
        <td class="e num">${fmtMoney(d.totals.closing)} <span class="dir">${dirLabel(d.totals.closingDirection)}</span></td>
      </tr>
    </tfoot>
  </table>`
  }

  ${
    d.totals.closing !== 0
      ? `<div class="tafqit-line"><span class="lbl">تفقيط الرصيد الختامي (${dirLabel(d.totals.closingDirection)}):</span> ${escapeHtml(tafqitSYP(Math.abs(d.totals.closing)))}</div>`
      : ''
  }

  ${signBoxes ? `<div class="sign">
    ${signBoxes}
  </div>` : ''}

  <div class="foot">${escapeHtml(company.companyName)} © — طُبع بتاريخ <span class="num">${fmtDateTime(now)}</span> — ${AR_ACCOUNT_TYPE[d.account.type] ?? d.account.type}</div>
  </div>
  ${tpl.pageNumbers ? printPaginationScript() : ''}
</body>
</html>`

  const win = window.open('', '_blank', 'width=980,height=780')
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
