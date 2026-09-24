// طباعة كشف مستندات الطرف الموحد — نفس هوية مطبوعات كشوف الحسابات
// الترويسة الموحدة: اسم الشركة يميناً + الشعار بالمنتصف + وقت وتاريخ الطباعة يساراً

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
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, fmtUSD } from '@/lib/format'
import { tafqitSYP } from '@/lib/tafqit'
import type { UnifiedStatement } from '@/lib/unified-party-types'

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const ACCENT = '#a16207' // ذهبي داكن — هوية الشركة
const ACCENT_BG = '#fffbeb'
const ACCENT_BORDER = '#fde68a'

function dirLabel(signed: number): string {
  if (Math.abs(signed) < 0.005) return 'صفر'
  return signed > 0 ? 'مدين لنا' : 'دائن له'
}

/** يرجع false إذا فشل فتح النافذة (حجب النوافذ المنبثقة) */
export function printUnifiedPartyStatement(d: UnifiedStatement): boolean {
  const company = getCachedCompanyInfo()
  const tpl = getCachedPrintTemplate()
  const signBoxes = signatureBoxesHtml(tpl)
  const subLine = systemSubLine(tpl)
  const now = new Date()
  const title = 'كشف مستندات الطرف الموحد'

  const roleBadges = d.person.roles
    .map((r) => `<span class="role">${escapeHtml(r.label)} ${escapeHtml(r.fileCode)}</span>`)
    .join(' ')

  // بطاقة «محصلة الحساب الموحدة» — الصافي النهائي التراكمي لكل أدوار الشخص معاً
  // (طلب صريح) — تصميم رمادي/ذهبي مميز يظهر في ترويسة التقرير فوق جدول الحركات،
  // نفس الرقم المعروض في البطاقة الشاشية المقابلة (person.combinedBalance)
  const combined = d.person.combinedBalance
  const combinedAbs = Math.abs(combined)
  const combinedHtml = `<div class="combined-card">
    <div class="combined-lbl">محصلة الحساب الموحدة</div>
    <div class="combined-val num">${fmtMoney(combinedAbs)} <span class="dir">${dirLabel(combined)}</span></div>
    <div class="combined-usd num">≈ ${fmtUSD(combinedAbs)}</div>
    <div class="combined-tafqit">${escapeHtml(tafqitSYP(combinedAbs))}</div>
  </div>`

  const balances = d.person.roles
    .map(
      (r) => `<div class="meta-item">
        <div class="lbl">${escapeHtml(r.label)} — ${escapeHtml(r.accountCode ?? '—')} ${escapeHtml(r.accountName ?? '')}</div>
        <div class="val num">${fmtMoney(Math.abs(r.balance))} <span class="dir">${dirLabel(r.balance)}</span></div>
      </div>`,
    )
    .join('')

  const docRows = d.docs
    .map(
      (doc) => `<tr>
  <td class="c num">${fmtDate(doc.date)}</td>
  <td class="c">${escapeHtml(doc.docType)}</td>
  <td class="c num b">${escapeHtml(doc.number)}</td>
  <td>${escapeHtml(doc.description)}</td>
  <td class="c">${escapeHtml(doc.roleLabel)} <span class="dir num">${escapeHtml(doc.accountCode ?? '')}</span></td>
  <td class="e num">${doc.debit ? fmtMoney(doc.debit) : '—'}</td>
  <td class="e num">${doc.credit ? fmtMoney(doc.credit) : '—'}</td>
</tr>`,
    )
    .join('')

  const invoiceRows = d.invoices
    .map(
      (inv) => `<tr>
  <td class="c num b">${escapeHtml(inv.number)}</td>
  <td class="c num">${fmtDate(inv.date)}</td>
  <td class="c">${escapeHtml(inv.typeLabel)}</td>
  <td class="e num">${fmtMoney(inv.total)}</td>
  <td class="e num">${fmtMoney(inv.paid)}</td>
  <td class="c">${escapeHtml(inv.hasBundle ? 'سلة عروض' : '')}${inv.hasBundle && inv.loyaltyPointsRedeemed > 0 ? ' + ' : ''}${escapeHtml(inv.loyaltyPointsRedeemed > 0 ? 'استرداد نقاط ولاء' : '') || '—'}</td>
</tr>`,
    )
    .join('')

  const hrSection =
    d.hr.isEmployee || d.hr.advances.length > 0
      ? `<h3 class="sec-title">السلف والرواتب</h3>
  <div class="meta">
    <div class="meta-item"><div class="lbl">رواتب مدفوعة</div><div class="val num">${fmtNumber(d.hr.salaries.count)} — ${fmtMoney(d.hr.salaries.totalPaid)}</div></div>
    <div class="meta-item"><div class="lbl">عدد السلف</div><div class="val num">${fmtNumber(d.hr.advances.length)}</div></div>
    ${d.hr.advances
      .map(
        (a) =>
          `<div class="meta-item"><div class="lbl">سلفة ${fmtDate(a.date)} (${escapeHtml(a.status === 'PAID' ? 'مسددة' : a.status === 'UNPAID' ? 'غير مسددة' : 'مسددة بالاستقطاع')})</div><div class="val num">${fmtMoney(a.amount)}</div></div>`,
      )
      .join('')}
  </div>`
      : ''

  const loyaltySection =
    d.loyalty.length > 0
      ? `<h3 class="sec-title">نقاط الولاء</h3>
  <table class="grid">
    <thead><tr><th style="width:110px">الملف</th><th>العميل</th><th style="width:120px">الرصيد (نقطة)</th><th style="width:90px">الحركات</th><th style="width:120px">آخر حركة</th></tr></thead>
    <tbody>
      ${d.loyalty
        .map(
          (l) => `<tr>
        <td class="c num">${escapeHtml(l.fileCode)}</td>
        <td>${escapeHtml(l.customerName)}</td>
        <td class="e num b">${fmtNumber(l.balance)}</td>
        <td class="c num">${fmtNumber(l.movements)}</td>
        <td class="c num">${l.lastDate ? fmtDateTime(l.lastDate) : '—'}</td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>`
      : ''

  const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} — ${escapeHtml(d.person.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #1f2937; padding: 22px 30px; font-size: 13px; background: #fff }
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
  h2.doc-title { display: block; text-align: center; margin: 14px 0 8px }
  h2.doc-title span { display: inline-block; font-size: 15px; font-weight: 700; border: 1.5px solid ${ACCENT_BORDER}; border-radius: 6px; padding: 6px 26px; background: ${ACCENT_BG}; color: ${ACCENT} }
  h2.doc-title .acc { font-weight: 800; font-variant-numeric: tabular-nums; margin-inline-start: 8px }
  .roles { text-align: center; margin-bottom: 12px }
  .roles .role { display: inline-block; border: 1px solid #e5e7eb; border-radius: 999px; padding: 2px 12px; font-size: 11px; font-weight: 700; color: #374151; margin: 0 3px; background: #f9fafb }
  /* بطاقة «محصلة الحساب الموحدة» — رمادي/ذهبي، بارزة في الترويسة فوق جدول الحركات */
  .combined-card { text-align: center; margin: 0 auto 14px; max-width: 360px; border: 1.5px solid #d4af5a; border-radius: 10px; padding: 10px 18px; background: linear-gradient(135deg, #f1f5f9 0%, #f8fafc 55%, #fef9ec 100%); break-inside: avoid; page-break-inside: avoid }
  .combined-lbl { font-size: 11px; font-weight: 700; color: #78716c }
  .combined-val { font-size: 19px; font-weight: 800; color: #1f2937; margin-top: 2px }
  .combined-val .dir { font-size: 10.5px; font-weight: 400; color: #6b7280; margin-inline-start: 6px }
  .combined-usd { font-size: 10.5px; color: #9ca3af; margin-top: 1px }
  .combined-tafqit { font-size: 11px; font-weight: 600; color: #92400e; margin-top: 6px; border-top: 1px dashed #d4af5a; padding-top: 5px }
  h3.sec-title { font-size: 13px; font-weight: 800; color: ${ACCENT}; margin: 16px 0 8px; border-inline-start: 3px solid ${ACCENT}; padding-inline-start: 8px }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px }
  .meta-item { border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 10px }
  .meta-item .lbl { font-size: 10px; color: #6b7280 }
  .meta-item .val { font-weight: 700; font-size: 12.5px; margin-top: 1px }
  .meta-item .dir { font-size: 10px; color: #6b7280; font-weight: 400 }
  table.grid { width: 100%; border-collapse: collapse; margin-bottom: 14px }
  table.grid th, table.grid td { border: 1px solid #e5e7eb; padding: 5px 8px; text-align: start; vertical-align: middle }
  table.grid th { background: #f9fafb; font-size: 11px; color: #374151; font-weight: 700; text-align: center }
  table.grid td { font-size: 11.5px }
  tfoot td { background: #f9fafb; font-weight: 700 }
  .c { text-align: center } .e { text-align: left } .b { font-weight: 700 }
  .dir { font-size: 9.5px; color: #6b7280; font-weight: 400 }
  .num { direction: ltr; unicode-bidi: embed; font-variant-numeric: tabular-nums; white-space: nowrap }
  .empty { padding: 26px; text-align: center; color: #6b7280; border: 1px dashed #e5e7eb; border-radius: 8px; margin-bottom: 14px }
  .sign { display: flex; justify-content: space-between; margin-top: 40px; padding: 0 30px }
  .tafqit-line { border: 1px solid #e5d3b3; border-radius: 6px; padding: 8px 12px; margin-top: 10px; background: #fffbeb; font-size: 12.5px; font-weight: 600; color: #374151 }
  .tafqit-line .lbl { color: #92400e; font-weight: 700 }
  .foot { margin-top: 22px; font-size: 10px; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 8px }
  @page { size: A4; margin: 0 }
  @media print { body { padding: 4mm 10mm 10mm } }
  ${tpl.pageNumbers ? PRINT_PAGINATION_CSS : ''}
</style>
</head>
<body>
  <div id="doc-root" data-company="${escapeHtml(company.companyName)}" data-doc-title="${escapeHtml(`${title} — ${d.person.name}`)}" data-accent="${ACCENT}">
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

  <h2 class="doc-title"><span>${escapeHtml(title)}<span class="acc">${escapeHtml(d.person.name)}</span></span></h2>
  <div class="roles">${roleBadges}</div>

  ${combinedHtml}

  <h3 class="sec-title">أرصدة الأدوار</h3>
  <div class="meta">${balances}</div>

  <h3 class="sec-title">كشف الحركة الموحد (${fmtNumber(d.totals.count)} حركة)</h3>
  ${
    d.docs.length === 0
      ? `<div class="empty">لا توجد حركات على أي من أدوار هذا الشخص بعد</div>`
      : `<table class="grid" data-print-main>
    <thead>
      <tr>
        <th style="width:74px">التاريخ</th>
        <th style="width:86px">المستند</th>
        <th style="width:80px">الرقم</th>
        <th>البيان</th>
        <th style="width:96px">الدور / الحساب</th>
        <th style="width:95px">مدين</th>
        <th style="width:95px">دائن</th>
      </tr>
    </thead>
    <tbody>${docRows}</tbody>
    <tfoot>
      <tr>
        <td class="c" colspan="5">الإجمالي (${fmtNumber(d.totals.count)} حركة)</td>
        <td class="e num">${fmtMoney(d.totals.debit)}</td>
        <td class="e num">${fmtMoney(d.totals.credit)}</td>
      </tr>
    </tfoot>
  </table>`
  }

  ${
    d.invoices.length > 0
      ? `<h3 class="sec-title">الفواتير (${fmtNumber(d.invoicesTotals.count)} — إجمالي ${fmtMoney(d.invoicesTotals.total)} ل.س)</h3>
  <table class="grid">
    <thead><tr><th style="width:90px">الرقم</th><th style="width:74px">التاريخ</th><th style="width:86px">النوع</th><th style="width:100px">الإجمالي</th><th style="width:100px">المسدد</th><th>وسوم</th></tr></thead>
    <tbody>${invoiceRows}</tbody>
  </table>`
      : ''
  }

  ${hrSection}
  ${loyaltySection}

  ${
    d.totals.debit - d.totals.credit !== 0
      ? `<div class="tafqit-line"><span class="lbl">صافي الحركة (${dirLabel(d.totals.debit - d.totals.credit)}):</span> ${escapeHtml(tafqitSYP(Math.abs(d.totals.debit - d.totals.credit)))}</div>`
      : ''
  }

  ${signBoxes ? `<div class="sign">${signBoxes}</div>` : ''}

  <div class="foot">${escapeHtml(company.companyName)} © — طُبع بتاريخ <span class="num">${fmtDateTime(now)}</span></div>
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
  }, tpl.pageNumbers ? 1100 : 600)
  return true
}
