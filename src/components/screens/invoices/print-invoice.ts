// طباعة الفاتورة — نافذة جديدة بكود HTML أنيق (RTL + خط Cairo) ثم استدعاء الطباعة
// القالب بنفس هوية print-voucher مع رأس شركة متمركز بالشعار + تفقيط الإجمالي
// البيانات تُقرأ متزامنة من كاش companyInfo (localStorage) فلا تأخير شبكة قبل الطباعة

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
import {
  AR_INVOICE_STATUS,
  AR_INVOICE_TYPE,
  AR_METHOD,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtNumber,
  fmtUSD,
} from '@/lib/format'
import { tafqitSYP } from '@/lib/tafqit'
import { groupBundleLines, type BundleGroup } from './bundle-groups'
import type { InvoiceDetail } from './types'

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** لون الهوية حسب نوع الفاتورة — عائلة البيع زمردية وعائلة الشراء عنبرية */
const KIND_ACCENT: Record<string, { main: string; bg: string; border: string }> = {
  SALE: { main: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  SALES_RETURN: { main: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  PURCHASE: { main: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  PURCHASE_RETURN: { main: '#b45309', bg: '#fffbeb', border: '#fde68a' },
}

/** ترجمة عربية لحالة السداد مع لون خفيف */
function statusLabel(status: string): string {
  return AR_INVOICE_STATUS[status] ?? status
}

/** ترجع false إذا فشل فتح النافذة (حجب النوافذ المنبثقة) */
export function printInvoice(d: InvoiceDetail): boolean {
  const company = getCachedCompanyInfo()
  const tpl = getCachedPrintTemplate() // Task 26: قالب الطباعة القابل للتخصيص
  const signBoxes = signatureBoxesHtml(tpl)
  const subLine = systemSubLine(tpl, 'فواتير المبيعات والمشتريات')
  const accent = (KIND_ACCENT[d.type] ?? KIND_ACCENT.SALE).main
  const accentBg = (KIND_ACCENT[d.type] ?? KIND_ACCENT.SALE).bg
  const accentBorder = (KIND_ACCENT[d.type] ?? KIND_ACCENT.SALE).border
  const remaining = Math.max(0, d.total - d.paid)
  const isSalesFamily = d.type === 'SALE' || d.type === 'SALES_RETURN'
  const docTitle = `${AR_INVOICE_TYPE[d.type] ?? d.type}` // «بيع» — العنوان الرئيسي يوضّح «فاتورة»

  // القسم العلوي المُجمل (Task 36): البنود العادية بالشكل التقليدي القديم، وكل سلة
  // تُطبع سطراً واحداً: «سلة عروض: [الاسم]» بعدد السلال وفي خانة الإجمالي السعر بعد الخصومات —
  // والتفصيل الكامل لموجودات السلال في الملحق السفلي
  const grouped = groupBundleLines(d.lines)
  const hasBundles = grouped.some((r) => r.kind === 'bundle')
  const bundleGroups = grouped.filter((r): r is { kind: 'bundle'; group: BundleGroup } => r.kind === 'bundle')

  const rows = grouped
    .map((row, i) => {
      if (row.kind === 'bundle') {
        const g = row.group
        return `<tr style="background:${accentBg}">
  <td class="c num">${i + 1}</td>
  <td><div class="item-name" style="color:${accent}">🧺 سلة عروض: ${escapeHtml(g.name)}</div><div class="item-code" style="direction:rtl">تفاصيل موادها في ملحق سلال العروض أسفل الفاتورة</div></td>
  <td class="muted">مواد السلة من أقسامها</td>
  <td class="c">سلة</td>
  <td class="c num b">${fmtNumber(g.qty)}</td>
  <td class="e num" title="سعر السلة الواحدة بإجمالي موادها">${fmtMoney(g.grossPerUnit)}</td>
  <td class="e num b">${fmtMoney(g.net)}${g.discount > 0 ? `<div class="num" style="font-size:10px;color:#6b7280;font-weight:400"><span style="text-decoration:line-through">${fmtMoney(g.gross)}</span> — حسم السلة ${fmtMoney(g.discount)}</div>` : ''}</td>
</tr>`
      }
      const l = row.line
      return `<tr>
  <td class="c num">${i + 1}</td>
  <td><div class="item-name">${escapeHtml(l.itemName)}</div><div class="item-code num">${escapeHtml(l.itemCode)}</div></td>
  <td>${l.warehouseName ? escapeHtml(l.warehouseName) : '—'}</td>
  <td class="c">${l.unitName ? escapeHtml(l.unitName) : '—'}${l.unitFactor !== 1 ? ` <span class="num" style="font-size:10px;color:#6b7280">×${l.unitFactor}</span>` : ''}</td>
  <td class="c num b">${fmtNumber(l.quantity)}</td>
  <td class="e num">${fmtMoney(l.unitPrice)}</td>
  <td class="e num b">${fmtMoney(l.total)}</td>
</tr>`
    })
    .join('')

  // الملحق السفلي (Task 36): موجودات وأصناف كل سلة مباعة ليراها العميل بوضوح —
  // كمية كل مادة داخل السلة الواحدة + الكمية الكلية الخارجة من المخزون + القيمة
  const bundleAppendixHtml = !hasBundles
    ? ''
    : `<h3 class="sec-title" style="color:${accent}">ملحق سلال العروض — تفاصيل المواد المباعة</h3>
${bundleGroups
  .map((r) => {
    const g = r.group
    return `<div style="margin-bottom:12px">
  <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;border:1px solid ${accentBorder};border-bottom:none;border-radius:6px 6px 0 0;background:${accentBg};padding:6px 10px;font-size:12px">
    <span style="font-weight:700;color:${accent}">🧺 سلة عروض: ${escapeHtml(g.name)}</span>
    <span class="num" style="color:#374151">عدد السلال: <b>${fmtNumber(g.qty)}</b> · سعر السلة الواحدة: <b>${fmtMoney(g.grossPerUnit)} ل.س</b>${g.discount > 0 ? ` · حسم السلة: <b style="color:#b45309">${fmtMoney(g.discount)} ل.س</b> · الصافي: <b style="color:#047857">${fmtMoney(g.net)} ل.س</b>` : ''}</span>
  </div>
  <table class="grid" style="margin-bottom:0">
    <thead><tr><th style="width:30px">م</th><th>المادة</th><th class="w-s">القسم المخزني</th><th style="width:60px">الوحدة</th><th style="width:74px">كمية السلة الواحدة</th><th style="width:74px">الكمية الكلية</th><th class="w-m">سعر الوحدة</th><th class="w-m">القيمة الكلية</th></tr></thead>
    <tbody>
      ${g.items
        .map(
          (it, k) => `<tr>
  <td class="c num">${k + 1}</td>
  <td><div class="item-name">${it.gift ? '🎁 ' : ''}${escapeHtml(it.name)}${it.gift ? ' <span style="font-size:10px;font-weight:700;color:#b45309">(هدية مجانية)</span>' : ''}</div><div class="item-code num">${escapeHtml(it.code)}</div></td>
  <td class="muted">${it.warehouseName ? escapeHtml(it.warehouseName) : '—'}</td>
  <td class="c">${it.unitName ? escapeHtml(it.unitName) : '—'}</td>
  <td class="c num">${fmtNumber(it.qtyPerUnit)}</td>
  <td class="c num b">${fmtNumber(Math.round(it.qtyPerUnit * g.qty * 100) / 100)}</td>
  <td class="e num">${fmtMoney(it.price)}</td>
  <td class="e num b">${fmtMoney(it.lineTotal)}</td>
</tr>`,
        )
        .join('')}
    </tbody>
  </table>
</div>`
  })
  .join('')}`

  const paymentsHtml =
    d.payments.length === 0
      ? ''
      : `<h3 class="sec-title">دفعات الفاتورة (سندات VCH)</h3>
<table class="grid">
  <thead><tr><th class="w-s">السند</th><th class="w-s">التاريخ</th><th class="w-s">الطريقة</th><th class="w-m">المبلغ</th><th>ملاحظة</th></tr></thead>
  <tbody>
    ${d.payments
      .map(
        (p) => `<tr>
  <td class="num b" style="color:${accent}">${escapeHtml(p.number)}</td>
  <td class="num c">${fmtDate(p.date)}</td>
  <td class="c">${AR_METHOD[p.method] ?? p.method}</td>
  <td class="e num b">${fmtMoney(p.amount)}</td>
  <td class="muted">${p.notes ? escapeHtml(p.notes) : '—'}</td>
</tr>`,
      )
      .join('')}
  </tbody>
</table>`

  const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>فاتورة ${escapeHtml(docTitle)} — ${escapeHtml(d.number)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #1f2937; padding: 22px 30px; font-size: 13px; background: #fff }
  /* الترويسة الموحدة: اسم الشركة يميناً + الشعار 4× متمركز + تاريخ ووقت الطباعة يساراً — على صف واحد */
  .head { text-align: center; border-bottom: 3px double ${accent}; padding-bottom: 10px }
  .head-row { display: flex; align-items: center; gap: 16px }
  .co { width: 30%; text-align: right }
  .company { font-size: 19px; font-weight: 800; color: ${accent} }
  .company-sub { font-size: 11px; color: #6b7280; margin-top: 2px }
  .head-logo-wrap { flex: 1; display: flex; justify-content: center }
  ${printHeaderCss(tpl)}
  .head-logo { height: ${logoHeightPx(tpl)}px; max-width: 60%; object-fit: contain }
  .print-stamp { width: 30%; text-align: left; font-size: 11px; color: #374151; line-height: 1.9 }
  .print-stamp .lbl { color: #6b7280 }
  h2.doc-title { display: block; text-align: center; margin: 16px 0 12px }
  h2.doc-title span { display: inline-block; font-size: 16px; font-weight: 700; border: 1.5px solid ${accentBorder}; border-radius: 6px; padding: 6px 30px; background: ${accentBg}; color: ${accent} }
  h2.doc-title .no { font-weight: 800; font-variant-numeric: tabular-nums; margin-inline-start: 8px }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px }
  .meta-item { border: 1px solid #e5e7eb; border-radius: 6px; padding: 5px 10px }
  .meta-item .lbl { font-size: 10px; color: #6b7280 }
  .meta-item .val { font-weight: 700; font-size: 12.5px; margin-top: 1px }
  table.grid { width: 100%; border-collapse: collapse; margin-bottom: 14px }
  table.grid th, table.grid td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: start; vertical-align: middle }
  table.grid th { background: #f9fafb; font-size: 11px; color: #374151; font-weight: 700 }
  table.grid td { font-size: 12px }
  .sec-title { font-size: 13px; font-weight: 700; color: #374151; margin: 14px 0 6px }
  .item-name { font-weight: 700 }
  .item-code { font-size: 10px; color: #9ca3af; direction: ltr; text-align: right }
  .c { text-align: center } .e { text-align: left } .b { font-weight: 700 } .muted { color: #6b7280; font-size: 11px }
  .num { direction: ltr; unicode-bidi: embed; font-variant-numeric: tabular-nums; white-space: nowrap }
  .w-s { width: 90px } .w-m { width: 130px }
  .bottom { display: flex; gap: 14px; align-items: stretch; margin: 4px 0 6px }
  .totals { flex: 1; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px }
  .totals .row { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; font-size: 12.5px }
  .totals .row .lbl { color: #6b7280 }
  .totals .row.grand { border-top: 2px solid ${accentBorder}; margin-top: 4px; padding-top: 6px; font-size: 15px; font-weight: 800; color: ${accent} }
  .totals .usd { font-size: 10.5px; font-weight: 400; color: #9ca3af }
  .tafqit { flex: 1.2; padding: 10px 14px; display: flex; flex-direction: column; justify-content: center }
  .tafqit .lbl { font-size: 10px; color: #6b7280 }
  .tafqit .words { font-size: 12.5px; font-weight: 700; color: #374151; line-height: 1.8; margin-top: 2px }
  .notes { border: 1px solid #e5e7eb; border-radius: 6px; padding: 7px 10px; margin-bottom: 12px; background: #fafafa; font-size: 12px }
  .notes .lbl { font-size: 10px; color: #6b7280 }
  .sign { display: flex; justify-content: space-between; margin-top: 44px; padding: 0 30px }
  .sign-box { width: 200px; text-align: center }
  .sign-box .line { border-top: 1.5px dashed #9ca3af; padding-top: 6px; font-weight: 700; color: #374151; margin-top: 30px }
  .foot { margin-top: 26px; font-size: 10px; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 8px }
  /* هامش صفر يلغي ترويسة المتصفح التلقائية (عنوان + تاريخ) — والهامش العلوي الداخلي أدنى حد (4mm) */
  @page { size: A4; margin: 0 }
  /* انكسار الطباعة (طلب صريح): سطر جدول واحد لا يُقطع بين ورقتين، ورأس الجدول
     يتكرر إن امتد الجدول لأكثر من ورقة، وكتل الإجمالي/التفقيط/التواقيع لا تنقسم
     منتصفها — كل ذلك بلا أثر على المعاينة الشاشية (break-inside لا يعمل إلا وقت الطباعة) */
  table.grid thead { display: table-header-group }
  table.grid tfoot { display: table-footer-group }
  table.grid tr { break-inside: avoid; page-break-inside: avoid }
  .bottom, .notes, .sign { break-inside: avoid; page-break-inside: avoid }
  h3.sec-title { break-after: avoid; page-break-after: avoid }
  @media print {
    body { padding: 4mm 10mm 10mm }
    /* مسافات مصغّرة عند الطباعة فقط — فاتورة متصلة الشكل بلا فجوات بين أقسامها */
    h2.doc-title { margin: 10px 0 8px }
    .meta { margin-bottom: 7px }
    .sec-title { margin: 9px 0 4px }
    table.grid { margin-bottom: 9px }
    .bottom { margin: 3px 0 4px }
    .notes { margin-bottom: 8px }
    .sign { margin-top: 28px }
    .foot { margin-top: 16px; padding-top: 6px }
  }
  ${tpl.pageNumbers ? PRINT_PAGINATION_CSS : ''}
</style>
</head>
<body>
  <div id="doc-root" data-company="${escapeHtml(company.companyName)}" data-doc-title="${escapeHtml(`فاتورة ${docTitle} ${d.number}`)}" data-accent="${accent}">
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
        <div><span class="lbl">تاريخ الطباعة:</span> <span class="num">${fmtDateTime(new Date())}</span></div>
        <div><span class="lbl">الساعة:</span> <span class="num">${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}</span></div>
      </div>
    </div>
  </div>

  <h2 class="doc-title"><span>فاتورة ${escapeHtml(docTitle)}<span class="no num">${escapeHtml(d.number)}</span></span></h2>

  <div class="meta">
    <div class="meta-item"><div class="lbl">التاريخ</div><div class="val num">${fmtDate(d.date)}</div></div>
    <div class="meta-item"><div class="lbl">${isSalesFamily ? 'العميل' : 'المورد'}</div><div class="val">${escapeHtml(d.partner.name)} <span class="num" style="color:#6b7280;font-size:11px">${escapeHtml(d.partner.code)}</span></div></div>
    <div class="meta-item"><div class="lbl">هاتف الطرف</div><div class="val num">${d.partner.phone ? escapeHtml(d.partner.phone) : '—'}</div></div>
    <div class="meta-item"><div class="lbl">حالة السداد</div><div class="val" style="color:${accent}">${statusLabel(d.status)}</div></div>
  </div>

  <table class="grid" data-print-main>
    <thead>
      <tr><th style="width:34px">م</th><th>المادة</th><th>القسم المخزني</th><th style="width:70px">الوحدة</th><th style="width:64px">العدد</th><th class="w-m">سعر الوحدة</th><th class="w-m">الإجمالي</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="bottom">
    <div class="totals">
      <div class="row"><span class="lbl">المجموع</span><span class="num b">${fmtMoney(d.subtotal)}</span></div>
      <div class="row"><span class="lbl">الضريبة${d.taxRate > 0 ? ` (<span class="num">${fmtNumber(d.taxRate)}%</span>)` : ''}</span><span class="num b">${fmtMoney(d.tax)}</span></div>
      <div class="row"><span class="lbl">${isSalesFamily ? 'الحسم الممنوح' : 'الحسم المكتسب'}</span><span class="num b">${fmtMoney(d.discount)}</span></div>
      ${
        d.type === 'SALE' && (d.loyaltyRedeemValue ?? 0) > 0
          ? `<div class="row"><span class="lbl">حسم نقاط الولاء${(d.loyaltyPointsRedeemed ?? 0) > 0 ? ` (<span class="num">${fmtNumber(d.loyaltyPointsRedeemed ?? 0)}</span> نقطة)` : ''}</span><span class="num b">−${fmtMoney(d.loyaltyRedeemValue ?? 0)}</span></div>`
          : ''
      }
      <div class="row grand"><span>الإجمالي</span><span class="num">${fmtMoney(d.total)} <span class="usd num">≈ ${fmtUSD(d.total)}</span></span></div>
      <div class="row"><span class="lbl">المسدد</span><span class="num b" style="color:#047857">${fmtMoney(d.paid)}</span></div>
      <div class="row"><span class="lbl">المتبقي</span><span class="num b" style="color:#b45309">${fmtMoney(remaining)}</span></div>
    </div>
    <div class="tafqit">
      <div class="lbl">تفقيط القيم</div>
      <div class="words">الإجمالي: ${escapeHtml(tafqitSYP(d.total))}</div>
      ${d.paid > 0 ? `<div class="words" style="margin-top:4px">المسدد: ${escapeHtml(tafqitSYP(d.paid))}</div>` : ''}
      ${remaining > 0 ? `<div class="words" style="margin-top:4px">المتبقي: ${escapeHtml(tafqitSYP(remaining))}</div>` : ''}
    </div>
  </div>

  ${d.notes ? `<div class="notes"><div class="lbl">ملاحظات الفاتورة</div>${escapeHtml(d.notes)}</div>` : ''}

  ${paymentsHtml}

  ${bundleAppendixHtml}

  <div class="sign">
    <div class="sign-box"><div class="line">${isSalesFamily ? 'المستلم' : 'المستلِم'}</div></div>
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
