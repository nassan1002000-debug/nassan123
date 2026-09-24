// تحقق ما بعد القفل النهائي — القاعدة الحية + الأرشيف
import { Database } from 'bun:sqlite'

const live = new Database('db/custom.db', { readonly: true })
const arch = new Database('db/periods/period-2026-09-10_23-58-12.db', { readonly: true })
const q = (d: Database, sql: string): unknown[] => d.query(sql).all() as unknown[]

console.log('===== LIVE =====')
console.log('--- entries (should be 1 = opening):')
console.log(q(live, `SELECT number, date, source, status, refType, ROUND(totalDebit,2) dr, ROUND(totalCredit,2) cr FROM JournalEntry`))

console.log('--- trial balance live:')
console.log(q(live, `SELECT ROUND(SUM(l.debit),2) debit, ROUND(SUM(l.credit),2) credit FROM JournalEntryLine l`))

console.log('--- balance sheet live (from opening entry):')
console.log(q(live, `
SELECT
  ROUND(SUM(CASE WHEN a.type='ASSET' THEN l.debit - l.credit ELSE 0 END),2) assets,
  ROUND(SUM(CASE WHEN a.type='LIABILITY' THEN l.credit - l.debit ELSE 0 END),2) liabilities,
  ROUND(SUM(CASE WHEN a.type='EQUITY' THEN l.credit - l.debit ELSE 0 END),2) equity
FROM JournalEntryLine l JOIN Account a ON l.accountId=a.id
`))

console.log('--- P&L live (should be zero):')
console.log(q(live, `
SELECT ROUND(SUM(CASE WHEN a.type='REVENUE' THEN l.credit - l.debit ELSE 0 END),2) revenue,
       ROUND(SUM(CASE WHEN a.type='EXPENSE' THEN l.debit - l.credit ELSE 0 END),2) expense
FROM JournalEntryLine l JOIN Account a ON l.accountId=a.id
`))

console.log('--- retained earnings 3200 line:')
console.log(q(live, `SELECT a.code, a.name, l.debit, l.credit, substr(l.description,1,80) d FROM JournalEntryLine l JOIN Account a ON l.accountId=a.id WHERE a.code='3200'`))

console.log('--- opening entry line count + top lines:')
console.log(q(live, `SELECT COUNT(*) n FROM JournalEntryLine`))
console.log(q(live, `SELECT a.code, l.debit, l.credit FROM JournalEntryLine l JOIN Account a ON l.accountId=a.id WHERE a.code IN ('1110','1120','1140','1130','2110','3100','1220') ORDER BY a.code`))

console.log('--- PeriodClose record:')
console.log(q(live, `SELECT label, closingDate, openingDate, openingEntryNumber, retainedEarningsCode, snapshotFile, rotatedEntries, closedBy FROM PeriodClose`))

console.log('--- doc counts live:')
for (const t of ['Invoice', 'InvoiceLine', 'Payment', 'StockMovement', 'Stocktaking', 'Salary', 'Advance', 'BonusDeduction', 'LoyaltyTransaction', 'ItemBalance', 'Bundle', 'Account', 'Partner', 'Employee', 'Warehouse', 'Item', 'JournalEntryLine']) {
  try {
    console.log(t, (q(live, `SELECT COUNT(*) n FROM ${t}`) as { n: number }[])[0].n)
  } catch {
    console.log(t, 'N/A')
  }
}

console.log('--- item balances (sum qty + value):')
console.log(q(live, `SELECT ROUND(SUM(quantity),2) qty, COUNT(*) n FROM ItemBalance`))

console.log('--- loyalty balances preserved:')
console.log(q(live, `SELECT COUNT(*) n, ROUND(SUM(points),0) pts FROM LoyaltyTransaction`))

console.log('--- bundle stats reset:')
console.log(q(live, `SELECT name, totalSales, saleCount, totalDiscount FROM Bundle`))

console.log('--- seq floors:')
console.log(q(live, `SELECT key, value FROM Setting WHERE key LIKE 'seq_floor%'`))

console.log('===== ARCHIVE (pre-close snapshot) =====')
console.log('--- max JE number pre-close:')
console.log(q(arch, `SELECT number FROM JournalEntry WHERE number LIKE 'JE-%' ORDER BY CAST(substr(number,4) AS INTEGER) DESC LIMIT 1`))
console.log('--- archive totals:')
console.log(q(arch, `SELECT (SELECT COUNT(*) FROM JournalEntry) entries, (SELECT COUNT(*) FROM Invoice) invoices, (SELECT COUNT(*) FROM Payment) payments`))

live.close()
arch.close()
