// طباعة بطاقة عميل/مورد — نفس هوية طباعة السندات (RTL + Cairo + هوية الشركة)
import {
  AR_INVOICE_STATUS,
  AR_METHOD,
  AR_PARTNER_TYPE,
  fmtDate,
  fmtDateTime,
  fmtMoney as money,
} from '@/lib/format'
import { getCachedCompanyInfo } from '@/lib/company'
import {
  PRINT_PAGINATION_CSS,
  getCachedPrintTemplate,
  logoHeightPx,
  printHeaderCss,
  printPaginationScript,
  systemSubLine,
} from '@/lib/print-template'
import { tafqitSYP } from '@/lib/tafqit'
import type { PartnerDetail } from './types'

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** ترجع false إذا فشل فتح النافذة (حجب النوافذ المنبثقة) */
export function printPartner(p: {
  code: string
  name: string
  type: string
  phone: string | null
  address: string | null
  notes: string | null
  isActive: boolean
  createdAt: string
  balance: number
  invoices: PartnerDetail['invoices']
  vouchers: PartnerDetail['vouchers']
}): boolean {
  const company = getCachedCompanyInfo()
  const tpl = getCachedPrintTemplate() // Task 26: قالب الطباعة القابل للتخصيص
  const subLine = systemSubLine(tpl, 'ملفات الأطراف')
  const isCustomer = p.type === 'CUSTOMER'
  const accent = isCustomer ? '#047857' : '#b45309'
  const accentBg = isCustomer ? '#ecfdf5' : '#fffbeb'
  const accentBorder = isCustomer ? '#a7f3d0' : '#fde68a'

  const invoiceRows = p.invoices
    .map(
      (inv) => `<tr>
    <td class="num">${escapeHtml(inv.number)}</td>
    <td class="num">${fmtDate(inv.date)}</td>
    <td>${AR_INVOICE_STATUS[inv.status] ?? inv.status}</td>
    <td class="num">${money(inv.total)}</td>
    <td class="num">${money(inv.paid)}</td>
  </tr>`,
    )
    .join('')

  const voucherRows = p.vouchers
    .map(
      (v) => `<tr>
    <td class="num">${escapeHtml(v.number)}</td>
    <td class="num">${fmtDate(v.date)}</td>
    <td>${AR_METHOD[v.method] ?? v.method}</td>
    <td>${v.invoice ? `مرتبط بفاتورة <span class="num">${escapeHtml(v.invoice.number)}</span>` : 'حساب عام'}</td>
    <td class="num">${money(v.amount)}</td>
  </tr>`,
    )
    .join('')

  const balanceLabel =
    p.balance > 0
      ? isCustomer
        ? 'الرصيد المدين — على العميل لنا'
        : 'الرصيد الدائن — علينا للمورد'
      : p.balance < 0
        ? 'دفعات مقدم تفوق الفواتير'
        : 'الحساب مسدد بالكامل'

  const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>بطاقة ${AR_PARTNER_TYPE[p.type] ?? p.type} — ${escapeHtml(p.code)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #1f2937; padding: 22px 30px; font-size: 13px; background: #fff }
  .head { border-bottom: 3px double ${accent}; padding-bottom: 10px }
  /* الترويسة الموحدة: الشركة يميناً + الشعار 4× متمركز + كود الطرف ووقت الطباعة يساراً — على صف واحد */
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
  h2.doc-title { display: block; text-align: center; margin: 16px 0 14px }
  h2.doc-title span { display: inline-block; font-size: 16px; font-weight: 700; border: 1.5px solid ${accentBorder}; border-radius: 6px; padding: 6px 30px; background: ${accentBg}; color: ${accent} }
  .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 12px }
  .meta-item { border: 1px solid #e5e7eb; border-radius: 6px; padding: 5px 10px }
  .meta-item .lbl { font-size: 10px; color: #6b7280 }
  .meta-item .val { font-weight: 700; font-size: 12.5px; margin-top: 1px }
  .amount-box { border: 2px solid ${accent}; border-radius: 8px; padding: 12px 18px; margin: 12px 0; text-align: center; background: ${accentBg} }
  .amount-box .lbl { font-size: 11px; color: #6b7280 }
  .amount-box .val { font-size: 24px; font-weight: 800; color: ${accent}; font-variant-numeric: tabular-nums; margin-top: 3px }
  h3 { font-size: 13px; font-weight: 800; margin: 14px 0 6px; color: #374151 }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px }
  th { background: #f9fafb; color: #6b7280; font-weight: 700; text-align: right; padding: 5px 8px; border: 1px solid #e5e7eb; font-size: 10.5px }
  td { padding: 5px 8px; border: 1px solid #e5e7eb }
  .empty { color: #9ca3af; text-align: center; padding: 10px; border: 1px dashed #e5e7eb; border-radius: 6px; font-size: 11.5px }
  .notes { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; margin-top: 12px; background: #fafafa; font-size: 12px }
  .foot { margin-top: 26px; font-size: 10px; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 8px }
  .num { direction: ltr; text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap }
  /* هامش صفر يلغي ترويسة المتصفح التلقائية (عنوان + تاريخ) — والهامش العلوي الداخلي أدنى حد (4mm) */
  @page { size: A4; margin: 0 }
  @media print { body { padding: 4mm 10mm 10mm } }
  ${tpl.pageNumbers ? PRINT_PAGINATION_CSS : ''}
</style>
</head>
<body>
  <div id="doc-root" data-company="${escapeHtml(company.companyName)}" data-doc-title="${escapeHtml(`بطاقة ${AR_PARTNER_TYPE[p.type] ?? p.type} — ${p.name}`)}" data-accent="${accent}">
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
          <div class="lbl">كود الطرف</div>
          <div class="val">${escapeHtml(p.code)}</div>
        </div>
        <div class="print-stamp">
          <div><span class="lbl">تاريخ الطباعة:</span> <span class="num">${fmtDateTime(new Date())}</span></div>
          <div><span class="lbl">الساعة:</span> <span class="num">${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}</span></div>
        </div>
      </div>
    </div>
  </div>

  <h2 class="doc-title"><span>بطاقة ${AR_PARTNER_TYPE[p.type] ?? p.type}</span></h2>

  <div class="meta">
    <div class="meta-item"><div class="lbl">الاسم</div><div class="val">${escapeHtml(p.name)}</div></div>
    <div class="meta-item"><div class="lbl">الحالة</div><div class="val">${p.isActive ? 'نشط' : 'موقوف'}</div></div>
    <div class="meta-item"><div class="lbl">الهاتف</div><div class="val num">${p.phone ? escapeHtml(p.phone) : '—'}</div></div>
    <div class="meta-item"><div class="lbl">العنوان</div><div class="val">${p.address ? escapeHtml(p.address) : '—'}</div></div>
    <div class="meta-item"><div class="lbl">تاريخ الإنشاء</div><div class="val num">${fmtDate(p.createdAt)}</div></div>
    <div class="meta-item"><div class="lbl">عدد الفواتير / السندات</div><div class="val num">${p.invoices.length > 0 ? escapeHtml(String(p.invoices.length)) : '0'} / ${p.vouchers.length > 0 ? escapeHtml(String(p.vouchers.length)) : '0'}</div></div>
  </div>

  <div class="amount-box">
    <div class="lbl">${balanceLabel}</div>
    <div class="val">${money(p.balance)}</div>
    ${p.balance !== 0 ? `<div class="words" style="font-size:12px;font-weight:600;color:#374151;margin-top:3px">${escapeHtml(tafqitSYP(Math.abs(p.balance)))}</div>` : ''}
  </div>

  <h3>${isCustomer ? 'أحدث فواتير البيع' : 'أحدث فواتير الشراء'}</h3>
  ${
    p.invoices.length === 0
      ? '<div class="empty">لا توجد فواتير مسجلة</div>'
      : `<table data-print-main>
    <thead><tr><th>الرقم</th><th>التاريخ</th><th>الحالة</th><th>الإجمالي</th><th>المسدد</th></tr></thead>
    <tbody>${invoiceRows}</tbody>
  </table>`
  }

  <h3>${isCustomer ? 'أحدث سندات القبض' : 'أحدث سندات الدفع'}</h3>
  ${
    p.vouchers.length === 0
      ? '<div class="empty">لا توجد سندات مسجلة</div>'
      : `<table>
    <thead><tr><th>الرقم</th><th>التاريخ</th><th>الطريقة</th><th>البيان</th><th>المبلغ</th></tr></thead>
    <tbody>${voucherRows}</tbody>
  </table>`
  }

  ${p.notes ? `<div class="notes"><span style="color:#6b7280;font-size:10px">ملاحظات: </span>${escapeHtml(p.notes)}</div>` : ''}

  <div class="foot">${escapeHtml(company.companyName)} © — طُبع بتاريخ <span class="num">${fmtDateTime(new Date())}</span></div>
  </div>
  ${tpl.pageNumbers ? printPaginationScript() : ''}
</body>
</html>`

  const win = window.open('', '_blank', 'width=880,height=760')
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
