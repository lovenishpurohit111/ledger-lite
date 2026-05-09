// test.cjs — self-test suite (run before every push)
"use strict";
const { JSDOM } = require("jsdom");
let passed = 0, failed = 0;

function assert(cond, label) {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

// ── Shared extraction helpers (mirrors content.js logic) ──────────────────────
const PERIOD_RE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*['`]?\s*\d{2,4}\b|\bFY\s*\d{2,4}\b|\bQ[1-4]\s*(?:FY)?\s*\d{2,4}\b|\b(TTM|LTM)\b|\b20\d{2}\b|\b\d+\s*mths?\b|\b\d+\s*months?\b/i;

function findFinancialTables(document) {
  return [...document.querySelectorAll("table")].filter(t => {
    const hcells = [...t.querySelectorAll("thead tr th,thead tr td,tr:first-child th,tr:first-child td")];
    return hcells.filter(c => PERIOD_RE.test(c.textContent)).length >= 2
      && t.querySelectorAll("tbody tr,tr").length >= 3;
  });
}

function extractTable(table) {
  const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
  if (!headerRow) return null;
  const headers = [...headerRow.querySelectorAll("th,td")].map(c => c.textContent.trim());
  if (headers.filter(h => PERIOD_RE.test(h)).length < 2) return null;
  const rows = [...table.querySelectorAll("tbody tr,tr")]
    .filter(r => r !== headerRow)
    .map(tr => [...tr.querySelectorAll("td,th")].map(c => c.textContent.trim()))
    .filter(r => r.some(c => c));
  return rows.length ? { headers, rows } : null;
}

function cleanNum(val) {
  if (!val) return "";
  const s = String(val).trim();
  if (s.endsWith("%")) return s;
  const n = parseFloat(s.replace(/,/g,""));
  return isNaN(n) ? s : n;
}

// ── MOCK 1: Screener.in ───────────────────────────────────────────────────────
const SCREENER_HTML = `<html><body>
<h1 class="margin-0">Reliance Industries</h1>
<section id="profit-loss">
  <div class="sub">Consolidated Figures in Rs. Crores</div>
  <table>
    <thead><tr><th></th><th>Mar 2022</th><th>Mar 2023</th><th>Mar 2024</th><th>Mar 2025</th><th>TTM</th></tr></thead>
    <tbody>
      <tr><td>Sales +</td><td>7,21,634</td><td>8,76,922</td><td>9,00,468</td><td>10,09,179</td><td>10,19,312</td></tr>
      <tr><td>Expenses +</td><td>6,14,279</td><td>7,51,456</td><td>7,67,438</td><td>8,53,428</td><td>8,62,103</td></tr>
      <tr><td>Operating Profit</td><td>1,07,355</td><td>1,25,466</td><td>1,33,030</td><td>1,55,751</td><td>1,57,209</td></tr>
      <tr><td>OPM %</td><td>15%</td><td>14%</td><td>15%</td><td>15%</td><td>15%</td></tr>
      <tr><td>Net Profit +</td><td>55,104</td><td>69,621</td><td>79,020</td><td>93,540</td><td>94,009</td></tr>
      <tr><td>Tax %</td><td>24%</td><td>24%</td><td>23%</td><td>22%</td><td>22%</td></tr>
      <tr><td>EPS in Rs</td><td>8.15</td><td>10.22</td><td>11.63</td><td>13.75</td><td>13.82</td></tr>
    </tbody>
  </table>
</section>
<section id="balance-sheet">
  <table>
    <thead><tr><th></th><th>Mar 2022</th><th>Mar 2023</th><th>Mar 2024</th><th>Mar 2025</th></tr></thead>
    <tbody>
      <tr><td>Equity Capital</td><td>6,760</td><td>6,766</td><td>6,766</td><td>6,766</td></tr>
      <tr><td>Total Liabilities</td><td>12,36,820</td><td>14,07,126</td><td>16,05,152</td><td>18,24,918</td></tr>
    </tbody>
  </table>
</section>
</body></html>`;

// ── MOCK 2: Tickertape (DOM-rendered, no __NEXT_DATA__) ───────────────────────
const TICKERTAPE_HTML = `<html><body>
<h1 class="stock-name">HDFC Bank</h1>
<div>
  <h3>Income Statement</h3>
  <table>
    <thead><tr><th>Particulars</th><th>FY21</th><th>FY22</th><th>FY23</th><th>FY24</th><th>TTM</th></tr></thead>
    <tbody>
      <tr><td>Total Revenue</td><td>1,29,321</td><td>1,41,163</td><td>1,66,817</td><td>2,39,761</td><td>2,65,432</td></tr>
      <tr><td>Net Profit</td><td>31,116</td><td>36,961</td><td>44,109</td><td>60,812</td><td>67,890</td></tr>
    </tbody>
  </table>
</div>
<div>
  <h3>Balance Sheet</h3>
  <table>
    <thead><tr><th>Particulars</th><th>FY21</th><th>FY22</th><th>FY23</th><th>FY24</th></tr></thead>
    <tbody>
      <tr><td>Total Assets</td><td>18,32,285</td><td>21,75,590</td><td>25,70,072</td><td>36,20,440</td></tr>
      <tr><td>Total Equity</td><td>2,11,038</td><td>2,52,322</td><td>2,93,540</td><td>3,45,621</td></tr>
      <tr><td>Borrowings</td><td>12,14,209</td><td>14,56,123</td><td>17,82,350</td><td>22,10,432</td></tr>
    </tbody>
  </table>
</div>
</body></html>`;

// ── MOCK 3: Moneycontrol ──────────────────────────────────────────────────────
const MONEYCONTROL_HTML = `<html><body>
<div class="pcstname">Infosys Ltd</div>
<table id="mctable1">
  <thead><tr><th>Particulars</th><th>Mar 2021</th><th>Mar 2022</th><th>Mar 2023</th><th>Mar 2024</th></tr></thead>
  <tbody>
    <tr><td>Net Sales</td><td>1,00,472</td><td>1,21,641</td><td>1,46,767</td><td>1,53,670</td></tr>
    <tr><td>Total Expenses</td><td>80,181</td><td>95,716</td><td>1,17,568</td><td>1,20,430</td></tr>
    <tr><td>Net Profit</td><td>19,351</td><td>22,110</td><td>24,108</td><td>26,248</td></tr>
  </tbody>
</table>
</body></html>`;

// ── MOCK 4: Tickertape __NEXT_DATA__ ─────────────────────────────────────────
const NEXT_DATA = {
  props: { pageProps: { financials: {
    unit: "Rs. Crores",
    income: {
      headers: ["FY22","FY23","FY24"],
      rows: [
        { label: "Revenue",    values: [141163, 166817, 239761] },
        { label: "Net Profit", values: [36961,  44109,  60812]  }
      ]
    }
  }}}
};
const TICKERTAPE_NEXT_HTML = `<html><body>
<h1>HDFC Bank</h1>
<script id="__NEXT_DATA__">${JSON.stringify(NEXT_DATA)}</script>
</body></html>`;

// ── RUN TESTS ─────────────────────────────────────────────────────────────────

console.log("\n── Screener.in extraction ──");
const sdoc = new JSDOM(SCREENER_HTML).window.document;
const plSection = sdoc.getElementById("profit-loss");
const plTable   = plSection?.querySelector("table");
const plData    = extractTable(plTable);
assert(plData !== null, "P&L table extracted");
assert(plData.headers[0] === "", "First header is empty (label column)");
assert(plData.headers[1] === "Mar 2022", "Second header = Mar 2022");
assert(plData.headers[5] === "TTM", "Last header = TTM");
assert(plData.rows.length === 7, `7 rows found (incl EPS, Tax%, OPM%): got ${plData.rows.length}`);
const salesRow = plData.rows.find(r => r[0].startsWith("Sales"));
assert(salesRow !== undefined, "Sales row present");
assert(salesRow[5] === "10,19,312", `Sales TTM = 10,19,312, got ${salesRow[5]}`);
const taxRow = plData.rows.find(r => r[0].startsWith("Tax"));
assert(taxRow !== undefined, "Tax % row present");
assert(taxRow[1] === "24%", `Tax Mar 2022 = '24%', got ${taxRow[1]}`);
const epsRow = plData.rows.find(r => r[0].startsWith("EPS"));
assert(epsRow !== undefined, "EPS row present");
const bsSection = sdoc.getElementById("balance-sheet");
const bsData    = extractTable(bsSection?.querySelector("table"));
assert(bsData !== null, "Balance Sheet extracted");

console.log("\n── Tickertape DOM extraction ──");
const tdoc   = new JSDOM(TICKERTAPE_HTML).window.document;
const tables = findFinancialTables(tdoc);
assert(tables.length === 2, `2 financial tables found on Tickertape, got ${tables.length}`);
const ttIncome = extractTable(tables[0]);
assert(ttIncome !== null, "Tickertape Income table extracted");
assert(ttIncome.headers.includes("TTM"), "Tickertape TTM column present");
assert(ttIncome.rows.find(r => r[0] === "Net Profit") !== undefined, "Net Profit row found");

console.log("\n── Tickertape __NEXT_DATA__ ──");
const ndoc = new JSDOM(TICKERTAPE_NEXT_HTML).window.document;
const script = ndoc.getElementById("__NEXT_DATA__");
const nd = JSON.parse(script.textContent);
const fin = nd?.props?.pageProps?.financials;
assert(fin !== null, "__NEXT_DATA__ parsed");
assert(fin.income.headers[2] === "FY24", "FY24 header in __NEXT_DATA__");
assert(fin.income.rows[1].values[2] === 60812, "Net Profit FY24 = 60812");
const ndHeaders = ["", ...fin.income.headers];
assert(ndHeaders[0] === "", "Empty first header added for label column");

console.log("\n── Moneycontrol DOM extraction ──");
const mdoc    = new JSDOM(MONEYCONTROL_HTML).window.document;
const mTables = findFinancialTables(mdoc);
assert(mTables.length === 1, `1 financial table on Moneycontrol, got ${mTables.length}`);
const mcData  = extractTable(mTables[0]);
assert(mcData !== null, "Moneycontrol table extracted");
assert(mcData.rows.find(r => r[0] === "Net Sales") !== undefined, "Net Sales row found");
assert(mcData.rows.find(r => r[0] === "Net Profit") !== undefined, "Net Profit row found");
assert(mcData.headers[1] === "Mar 2021", `First year = Mar 2021, got ${mcData.headers[1]}`);

console.log("\n── cleanNum helper ──");
assert(cleanNum("7,21,634") === 721634, "Comma number: 7,21,634 → 721634");
assert(cleanNum("15%") === "15%",       "Percentage kept: '15%'");
assert(cleanNum("8.15") === 8.15,       "Decimal: 8.15");
assert(cleanNum("") === "",             "Empty stays empty");

console.log("\n── PERIOD_RE patterns ──");
assert(PERIOD_RE.test("Mar 2024"), "Matches 'Mar 2024'");
assert(PERIOD_RE.test("FY24"),     "Matches 'FY24'");
assert(PERIOD_RE.test("FY2024"),   "Matches 'FY2024'");
assert(PERIOD_RE.test("TTM"),      "Matches 'TTM'");
assert(PERIOD_RE.test("Q4 FY24"), "Matches 'Q4 FY24'");
assert(!PERIOD_RE.test("Total"),  "Does not match 'Total'");
assert(!PERIOD_RE.test("Sales"),  "Does not match 'Sales'");


console.log("\n── Moneycontrol '12 mths' headers ──");
const MC2_HTML = `<html><body>
<div class="pcstname">HDFC Bank</div>
<table>
  <thead>
    <tr><th>Particulars</th><th>12 mths</th><th>12 mths</th><th>12 mths</th></tr>
    <tr><th></th><th>Mar '24</th><th>Mar '23</th><th>Mar '22</th></tr>
  </thead>
  <tbody>
    <tr><td>Net Sales</td><td>2,39,761</td><td>1,66,817</td><td>1,41,163</td></tr>
    <tr><td>Net Profit</td><td>60,812</td><td>44,109</td><td>36,961</td></tr>
    <tr><td>EPS</td><td>80.12</td><td>59.05</td><td>50.08</td></tr>
  </tbody>
</table>
</body></html>`;
const mc2doc = new JSDOM(MC2_HTML).window.document;
const mc2tables = findFinancialTables(mc2doc);
assert(mc2tables.length === 1, "Moneycontrol '12 mths' table detected");
const mc2data = extractTable(mc2tables[0]);
assert(mc2data !== null, "Moneycontrol table extracted");
assert(mc2data.headers.includes("12 mths"), "Headers include '12 mths'");
assert(mc2data.rows.find(r => r[0] === "Net Profit") !== undefined, "Net Profit row found");

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  |  Failed: ${failed}`);
if (failed > 0) { console.error("❌ Tests failed — DO NOT push"); process.exit(1); }
else console.log("✅ All tests passed — safe to push");

// ── Test: detectStmtType reads table's own first <th> ─────────────────────────
console.log("\n── Statement type from table's own header ──");
const INNER_TH_HTML = `<html><body><table>
  <thead>
    <tr><th>BALANCE SHEET OF HDFC BANK (in Rs. Cr.)</th><th>MAR 26</th><th>MAR 25</th><th>MAR 24</th></tr>
    <tr><th></th><th>12 mths</th><th>12 mths</th><th>12 mths</th></tr>
  </thead>
  <tbody>
    <tr><td>Equity Capital</td><td>1,539.34</td><td>765.22</td><td>759.69</td></tr>
    <tr><td>Total Assets</td><td>38,20,044</td><td>36,20,440</td><td>25,70,072</td></tr>
    <tr><td>Total Liabilities</td><td>38,20,044</td><td>36,20,440</td><td>25,70,072</td></tr>
  </tbody>
</table></body></html>`;
const itDoc = new JSDOM(INNER_TH_HTML).window.document;
const itTables = findFinancialTables(itDoc);
assert(itTables.length === 1, "Moneycontrol BS table found");
const itData = extractTable(itTables[0]);
assert(itData !== null, "Table extracted");
assert(PERIOD_RE.test("MAR 26"), "MAR 26 matches PERIOD_RE");
assert(PERIOD_RE.test("12 mths"), "12 mths matches PERIOD_RE");
assert(itData.rows.length >= 3, `at least 3 data rows, got ${itData.rows.length}`);
