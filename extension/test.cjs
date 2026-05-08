// test.js — Node.js self-test suite
// Run: node extension/test.js
// All tests must pass before any push.

"use strict";

const { JSDOM } = require("jsdom");
let passed = 0, failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else           { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

// ── Mock Screener.in HTML ─────────────────────────────────────────────────────
const MOCK_HTML = `
<!DOCTYPE html><html><body>
<h1 class="margin-0">Reliance Industries</h1>
<section id="profit-loss">
  <div class="sub">Consolidated Figures in Rs. Crores</div>
  <table>
    <thead><tr>
      <th></th><th>Mar 2022</th><th>Mar 2023</th><th>Mar 2024</th><th>Mar 2025</th><th>TTM</th>
    </tr></thead>
    <tbody>
      <tr><td>Sales +</td><td>7,21,634</td><td>8,76,922</td><td>9,00,468</td><td>10,09,179</td><td>10,19,312</td></tr>
      <tr><td>Expenses +</td><td>6,14,279</td><td>7,51,456</td><td>7,67,438</td><td>8,53,428</td><td>8,62,103</td></tr>
      <tr><td>Operating Profit</td><td>1,07,355</td><td>1,25,466</td><td>1,33,030</td><td>1,55,751</td><td>1,57,209</td></tr>
      <tr><td>OPM %</td><td>15%</td><td>14%</td><td>15%</td><td>15%</td><td>15%</td></tr>
      <tr><td>Other Income +</td><td>14,434</td><td>21,217</td><td>28,473</td><td>35,376</td><td>36,841</td></tr>
      <tr><td>Interest</td><td>19,673</td><td>19,823</td><td>21,973</td><td>24,513</td><td>25,003</td></tr>
      <tr><td>Depreciation</td><td>31,376</td><td>38,257</td><td>45,001</td><td>51,834</td><td>52,782</td></tr>
      <tr><td>Profit before tax</td><td>70,740</td><td>88,603</td><td>94,529</td><td>1,14,780</td><td>1,16,265</td></tr>
      <tr><td>Tax %</td><td>24%</td><td>24%</td><td>23%</td><td>22%</td><td>22%</td></tr>
      <tr><td>Net Profit +</td><td>55,104</td><td>69,621</td><td>79,020</td><td>93,540</td><td>94,009</td></tr>
      <tr><td>EPS in Rs</td><td>8.15</td><td>10.22</td><td>11.63</td><td>13.75</td><td>13.82</td></tr>
      <tr><td>Dividend Payout %</td><td>13%</td><td>11%</td><td>11%</td><td>9%</td><td></td></tr>
    </tbody>
  </table>
</section>

<section id="balance-sheet">
  <div class="sub">Consolidated Figures in Rs. Crores</div>
  <table>
    <thead><tr>
      <th></th><th>Mar 2022</th><th>Mar 2023</th><th>Mar 2024</th><th>Mar 2025</th>
    </tr></thead>
    <tbody>
      <tr><td>Equity Capital</td><td>6,760</td><td>6,766</td><td>6,766</td><td>6,766</td></tr>
      <tr><td>Reserves</td><td>4,38,948</td><td>5,12,036</td><td>6,03,298</td><td>7,02,454</td></tr>
      <tr><td>Borrowings</td><td>2,51,990</td><td>2,84,960</td><td>3,06,950</td><td>3,17,400</td></tr>
      <tr><td>Total Liabilities</td><td>12,36,820</td><td>14,07,126</td><td>16,05,152</td><td>18,24,918</td></tr>
    </tbody>
  </table>
</section>
</body></html>`;

// ── Simulate content.js DOM extraction ───────────────────────────────────────
function extractSection(document, sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return null;
  const table = section.querySelector("table");
  if (!table) return null;
  const headerCells = table.querySelectorAll("thead tr th, thead tr td");
  const headers = [...headerCells].map(th => th.textContent.trim());
  if (headers.length < 2) return null;
  const rows = [];
  table.querySelectorAll("tbody tr").forEach(tr => {
    const cells = [...tr.querySelectorAll("td, th")];
    if (!cells.length) return;
    const values = cells.map(td => td.textContent.trim());
    if (values.every(v => !v)) return;
    rows.push(values);
  });
  const unitEl = section.querySelector(".sub, .note");
  const unit = unitEl ? unitEl.textContent.trim() : null;
  return { headers, rows, unit };
}

// ── Simulate exporter.js logic ────────────────────────────────────────────────
const TOTAL_KW = ["total","net profit","gross profit","operating profit",
  "profit before tax","profit after tax","ebitda","net income","net loss","profit before","net worth","total assets"];
function isTotal(l) { return TOTAL_KW.some(k => (l||"").toLowerCase().includes(k)); }
function cleanNum(val) {
  if (!val) return "";
  const s = String(val).trim();
  if (s.endsWith("%")) return s;
  const n = parseFloat(s.replace(/,/g, ""));
  return isNaN(n) ? s : n;
}

// ── TEST SUITE ────────────────────────────────────────────────────────────────
const dom = new JSDOM(MOCK_HTML);
const { document } = dom.window;

console.log("\n── Section extraction ──");
const pl = extractSection(document, "profit-loss");
assert(pl !== null, "P&L section found");
assert(pl.headers.length === 6, `P&L headers: expected 6 (incl empty first), got ${pl.headers.length}`);
assert(pl.headers[0] === "", `First header is empty (label col), got '${pl.headers[0]}'`);
assert(pl.headers[5] === "TTM", `Last header is 'TTM', got '${pl.headers[5]}'`);
assert(pl.rows.length === 12, `P&L has 12 rows, got ${pl.rows.length}`);
assert(pl.unit === "Consolidated Figures in Rs. Crores", "Unit extracted correctly");

const bs = extractSection(document, "balance-sheet");
assert(bs !== null, "Balance Sheet section found");
assert(bs.headers.length === 5, `BS headers: 5 (incl empty first), got ${bs.headers.length}`);

const missing = extractSection(document, "cash-flow");
assert(missing === null, "Cash Flow not present → returns null");

console.log("\n── Row content ──");
const salesRow = pl.rows.find(r => r[0].startsWith("Sales"));
assert(salesRow !== undefined, "Sales row found");
assert(salesRow[1] === "7,21,634", `Sales Mar 2022 = 7,21,634, got ${salesRow[1]}`);
assert(salesRow[5] === "10,19,312", `Sales TTM = 10,19,312, got ${salesRow[5]}`);

const epsRow = pl.rows.find(r => r[0].startsWith("EPS"));
assert(epsRow !== undefined, "EPS row found (not skipped)");

const taxRow = pl.rows.find(r => r[0].startsWith("Tax"));
assert(taxRow !== undefined, "Tax % row found (not skipped)");
assert(taxRow[1] === "24%", `Tax Mar 2022 = '24%', got '${taxRow[1]}'`);

const opmRow = pl.rows.find(r => r[0].startsWith("OPM"));
assert(opmRow !== undefined, "OPM % row found");

console.log("\n── cleanNum ──");
assert(cleanNum("7,21,634") === 721634, "Comma number parsed: 7,21,634 → 721634");
assert(cleanNum("15%") === "15%",       "Percentage kept as string: '15%'");
assert(cleanNum("8.15") === 8.15,       "Decimal parsed: 8.15");
assert(cleanNum("") === "",             "Empty string → empty string");

console.log("\n── isTotal ──");
assert(isTotal("Net Profit +"),    "Net Profit → total");
assert(isTotal("Profit before tax"), "Profit before tax → total");
assert(isTotal("Operating Profit"), "Operating Profit → total");
assert(!isTotal("Sales"),           "Sales → not total");
assert(!isTotal("EPS in Rs"),       "EPS → not total");

console.log("\n── Company metadata ──");
const nameEl = document.querySelector("h1.margin-0");
assert(nameEl?.textContent?.trim() === "Reliance Industries", "Company name extracted");

console.log("\n── Edge cases ──");
// Empty cell should not break
const divRow = pl.rows.find(r => r[0].startsWith("Dividend"));
assert(divRow !== undefined, "Dividend row exists");
assert(divRow[5] === "", "Dividend TTM is empty string (not undefined)");

// All rows present: Sales, Expenses, Op Profit, OPM%, Other Income, Interest,
// Depreciation, PBT, Tax%, Net Profit, EPS, Dividend = 12
assert(pl.rows.length === 12, "All 12 P&L rows present including % rows");

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  |  Failed: ${failed}`);
if (failed > 0) { console.error("❌ Tests failed — DO NOT push"); process.exit(1); }
else { console.log("✅ All tests passed — safe to push"); }
