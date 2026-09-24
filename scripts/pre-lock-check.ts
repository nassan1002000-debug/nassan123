// فحص ما قبل القفل النهائي — قراءة فقط
import { Database } from 'bun:sqlite'

const db = new Database('db/custom.db', { readonly: true })

const q = (sql: string): unknown[] => db.query(sql).all() as unknown[]

console.log('--- entries by status:')
console.log(q(`SELECT status, COUNT(*) n FROM JournalEntry GROUP BY status`))

console.log('--- date range:')
console.log(q(`SELECT MIN(date) minD, MAX(date) maxD FROM JournalEntry`))

console.log('--- drafts before/on 2026-08-31:')
console.log(q(`SELECT COUNT(*) n FROM JournalEntry WHERE status='DRAFT' AND date <= '2026-08-31T23:59:59.999Z'`))

console.log('--- entries AFTER 2026-08-31 (would stay live):')
console.log(q(`SELECT COUNT(*) n FROM JournalEntry WHERE date > '2026-08-31T23:59:59.999Z'`))

console.log('--- periodClose rows:')
console.log(q(`SELECT COUNT(*) n FROM PeriodClose`))

console.log('--- JE-0108 exists?')
console.log(q(`SELECT number, date, source, status, substr(description,1,60) d FROM JournalEntry WHERE number='JE-0108'`))

console.log('--- max entry number:')
console.log(q(`SELECT number, date FROM JournalEntry ORDER BY number DESC LIMIT 1`))

console.log('--- trial balance (POSTED):')
console.log(q(`SELECT ROUND(SUM(l.debit),2) debit, ROUND(SUM(l.credit),2) credit FROM JournalEntryLine l JOIN JournalEntry e ON l.entryId=e.id WHERE e.status='POSTED'`))

console.log('--- doc counts (live):')
for (const t of ['Invoice', 'Payment', 'StockMovement', 'Stocktaking', 'Salary', 'Advance', 'LoyaltyTransaction', 'ItemBalance', 'Bundle']) {
  try {
    console.log(t, (q(`SELECT COUNT(*) n FROM ${t}`) as { n: number }[])[0].n)
  } catch {
    console.log(t, 'N/A')
  }
}

console.log('--- P&L totals (POSTED, by account prefix):')
console.log(q(`
SELECT
  ROUND(SUM(CASE WHEN a.code LIKE '4%' THEN l.credit - l.debit ELSE 0 END),2) revenue,
  ROUND(SUM(CASE WHEN a.code LIKE '5%' THEN l.debit - l.credit ELSE 0 END),2) expense
FROM JournalEntryLine l
JOIN JournalEntry e ON l.entryId=e.id
JOIN Account a ON l.accountId=a.id
WHERE e.status='POSTED' AND (a.code LIKE '4%' OR a.code LIKE '5%')
`))

console.log('--- balance sheet core (POSTED):')
console.log(q(`
SELECT
  ROUND(SUM(CASE WHEN a.type='ASSET' THEN l.debit - l.credit ELSE 0 END),2) assets,
  ROUND(SUM(CASE WHEN a.type='LIABILITY' THEN l.credit - l.debit ELSE 0 END),2) liabilities,
  ROUND(SUM(CASE WHEN a.type='EQUITY' THEN l.credit - l.debit ELSE 0 END),2) equity
FROM JournalEntryLine l
JOIN JournalEntry e ON l.entryId=e.id
JOIN Account a ON l.accountId=a.id
WHERE e.status='POSTED'
`))

db.close()
