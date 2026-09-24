// طباعة سند مقاصة MC-xxxx — نافذة جديدة بكود HTML أنيق (RTL + خط Cairo) ثم استدعاء الطباعة
// القالب منسوخ من print-voucher (نفس هوية الشركة) مع تكييف خاص بالمقاصة — لهج ذهبي كهرماني

import { fmtDate, fmtDateTime, fmtMoney as money } from '@/lib/format'
import { getCachedCompanyInfo } from '@/lib/company'
import { tafqitSYP } from '@/lib/tafqit'
import {
  PRINT_PAGINATION_CSS,
  getCachedPrintTemplate,
  logoHeightPx,
  printHeaderCss,
  printPaginationScript,
  signatureBoxesHtml,
  systemSubLine,
} from '@/lib/print-template'
import type { ClearingVoucherRow } from './types'

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** ترجع false إذا فشل فتح النافذة (حجب النوافذ المنبثقة) */
export function printClearing(v: ClearingVoucherRow): boolean {
  const company = getCachedCompanyInfo()
  const tpl = getCachedPrintTemplate()
  const signBoxes = signatureBoxesHtml(tpl)
  const subLine = systemSubLine(tpl, 'سندات المقاصة')
  const isPosted = v.status === 'POSTED'
  const accent = '#b45309' // كهرماني داكن — هوية المقاصة (بلا نيلي/أزرق)
  const accentBg = '#fffbeb'
  const accentBorder = '#fde68a'

  const rows = v.lines
    .map(
      (l, i) => `<tr>
  <td class="c num">${i + 1}</td>
  <td>${escapeHtml(l.accountName)} <span class="code num">${escapeHtml(l.accountCode)}</span></td>
  <td class="num">${l.debit ? money(l.debit) : '—'}</td>
  <td class="num">${l.credit ? money(l.credit) : '—'}</td>
  <td class="why">${escapeHtml(l.description ?? '—')}</td>
</tr>`,
    )
    .join('\n')

  const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>سند مقاصة — ${escapeHtml(v.number)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #1f2937; padding: 22px 30px; font-size: 13px; background: #fff }
  .head { border-bottom: 3px double ${accent}; padding-bottom: 10px }
  .head-row { display: flex; align-items: center; gap: 16px }
  .co { width: 30%; text-align: right }
  .company { font-size: 19px; font-weight: 800; color: ${accent} }
  .company-sub { font-size: 11px; color: #6b7280; margin-top: 2px }
  .head-logo-wrap { flex: 1; display: flex; justify-content: center }
  ${printHeaderCss(tpl)}
  .head-logo { height: ${logoHeightPx(tpl)}px; max-width: 60%; object-fit: contain }
  .stamp-col { width: 30%; text-align: left }
  .print-stamp { font-size: 11px; color: #374151; line-height: 1.9; margin-top: 6px }
  .print-stamp .lbl { color: #6b7280 }
  .doc-no { text-align: left }
  .doc-no .lbl { font-size: 10px; color: #6b7280 }
  .doc-no .val { font-weight: 800; font-size: 16px; color: ${accent}; font-variant-numeric: tabular-nums }
  h2.doc-title { display: block; text-align: center; margin: 18px 0 14px }
  h2.doc-title span { display: inline-block; font-size: 16px; font-weight: 700; border: 1.5px solid ${accentBorder}; border-radius: 6px; padding: 6px 30px; background: ${accentBg}; color: ${accent} }
  .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px }
  .meta-item { border: 1px solid #e5e7eb; border-radius: 6px; padding: 5px 10px }
  .meta-item .lbl { font-size: 10px; color: #6b7280 }
  .meta-item .val { font-weight: 700; font-size: 12.5px; margin-top: 1px }
  .amount-box { border: 2px solid ${accent}; border-radius: 8px; padding: 12px 18px; margin: 12px 0; text-align: center; background: ${accentBg} }
  .amount-box .lbl { font-size: 11px; color: #6b7280 }
  .amount-box .val { font-size: 24px; font-weight: 800; color: ${accent}; font-variant-numeric: tabular-nums; margin: 2px 0 }
  .amount-box .words { font-size: 12px; font-weight: 600; color: #374151 }
  table.lines { width: 100%; border-collapse: collapse; margin: 10px 0 14px }
  table.lines th, table.lines td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: right; font-size: 12px }
  table.lines th { background: ${accentBg}; color: ${accent}; font-weight: 700; font-size: 11px }
  table.lines td.num, table.lines th.num { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap }
  table.lines td.c { text-align: center }
  table.lines .code { color: #6b7280; font-size: 10.5px }
  table.lines td.why { font-size: 11px; color: #374151 }
  table.lines tfoot td { font-weight: 800; background: #fafafa }
  .desc { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; margin-bottom: 14px; background: #fafafa }
  .desc .lbl { font-size: 10px; color: #6b7280 }
  .sign { display: flex; justify-content: space-between; margin-top: 40px; padding: 0 30px }
  .sign-box { width: 210px; text-align: center }
  .sign-box .line { border-top: 1.5px dashed #9ca3af; padding-top: 6px; font-weight: 700; color: #374151; margin-top: 34px }
  .foot { margin-top: 30px; font-size: 10px; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 8px }
  .num { direction: ltr; text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap }
  @page { size: A4; margin: 0 }
  @media print { body { padding: 4mm 10mm 10mm } }
  ${tpl.pageNumbers ? PRINT_PAGINATION_CSS : ''}
</style>
</head>
<body>
  <div id="doc-root" data-company="${escapeHtml(company.companyName)}" data-doc-title="${escapeHtml(`سند مقاصة ${v.number}`)}" data-accent="${accent}">
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
          <div class="lbl">رقم السند</div>
          <div class="val">${escapeHtml(v.number)}</div>
        </div>
        <div class="print-stamp">
          <div><span class="lbl">تاريخ الطباعة:</span> <span class="num">${fmtDateTime(new Date())}</span></div>
          <div><span class="lbl">الساعة:</span> <span class="num">${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}</span></div>
        </div>
      </div>
    </div>
  </div>

  <h2 class="doc-title"><span>سند مقاصة ذمم</span></h2>

  <div class="meta">
    <div class="meta-item"><div class="lbl">التاريخ</div><div class="val num">${fmtDate(v.date)}</div></div>
    <div class="meta-item"><div class="lbl">عدد الأزواج</div><div class="val num">${v.lines.length / 2}</div></div>
    <div class="meta-item"><div class="lbl">الحالة</div><div class="val">${isPosted ? 'مُرحّل' : 'ملغى'}</div></div>
  </div>

  <div class="amount-box">
    <div class="lbl">إجمالي المبلغ المقاص</div>
    <div class="val">${money(v.total)}</div>
    <div class="words">${escapeHtml(tafqitSYP(v.total))}</div>
  </div>

  <table class="lines">
    <thead>
      <tr>
        <th class="c" style="width:34px">ت</th>
        <th>الحساب</th>
        <th class="num" style="width:130px">مدين (ل.س)</th>
        <th class="num" style="width:130px">دائن (ل.س)</th>
        <th>البيان</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="2">الإجمالي</td>
        <td class="num">${money(v.total)}</td>
        <td class="num">${money(v.total)}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  <div class="desc"><div class="lbl">البيان العام</div>${escapeHtml(v.description || '—')}</div>

  <div class="sign">
    <div class="sign-box"><div class="line">المحاسب</div></div>
    ${signBoxes}
  </div>

  <div class="foot">${escapeHtml(company.companyName)} © — طُبع بتاريخ <span class="num">${fmtDateTime(new Date())}</span></div>
  </div>
  ${tpl.pageNumbers ? printPaginationScript() : ''}
</body>
</html>`

  const win = window.open('', '_blank', 'width=860,height=720')
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
  }, tpl.pageNumbers ? 1100 : 600)
  return true
}
