// pdf-extractor.js — position-aware PDF table extractor

const PERIOD_RE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[,.\s]*['`]?\s*\d{2,4}\b|\bFY\s*\d{2,4}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[,.\s]*\d{4}\b|\b20\d{2}\b|\b(TTM|LTM)\b|\b\d+\s*mths?\b/i;

const STMT_PATTERNS = [
  { re: /(?:statement\s+of\s+)?profit\s+(?:and|&)\s+loss|income\s+statement/i, name: "Profit & Loss"  },
  { re: /balance\s+sheet|statement\s+of\s+financial\s+position/i,              name: "Balance Sheet"  },
  { re: /cash\s+flow/i,                                                         name: "Cash Flow"      },
];

const TOTAL_KW = ["total","net profit","gross profit","operating profit",
  "profit before","profit after","ebitda","total assets","total liabilities",
  "total equity","net worth","net cash"];

const SECTION_HEADERS = /^(assets|liabilities|equity|non-current|current assets|current liabilities|shareholders|income|expenses|revenue|inflow|outflow)/i;
const NOTE_REF = /^\d{1,2}[A-Z]?$|^\([ivx]+\)$/i; // "3A", "22", "(i)", "(ii)"

function isTotal(label) {
  const l = (label||"").toLowerCase();
  return TOTAL_KW.some(k => l.startsWith(k) || l.includes(k));
}

async function loadPDFJS() {
  const lib = await import(chrome.runtime.getURL("pdf.min.mjs"));
  lib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");
  return lib;
}

async function fetchPDF(url) {
  const res = await fetch(url);
  return res.arrayBuffer();
}

async function getPDFPageCount(url) {
  const lib = await loadPDFJS();
  const pdf = await lib.getDocument({ data: await fetchPDF(url) }).promise;
  return pdf.numPages;
}

async function getPageItems(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const content = await page.getTextContent();
  return content.items
    .filter(i => i.str.trim())
    .map(i => ({ text: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round(i.transform[5]), w: Math.round(Math.abs(i.width)) }));
}

// Cluster items into visual rows by y-position
function clusterRows(items, yTol = 5) {
  const rows = [];
  for (const item of [...items].sort((a,b) => b.y - a.y)) {
    const row = rows.find(r => Math.abs(r.y - item.y) < yTol);
    if (row) { row.items.push(item); row.y = row.items.reduce((s,i)=>s+i.y,0)/row.items.length; }
    else rows.push({ y: item.y, items: [item] });
  }
  rows.forEach(r => r.items.sort((a,b) => a.x - b.x));
  return rows.sort((a,b) => b.y - a.y);
}

// Detect the "Note" column x-range so we can exclude those reference numbers
function detectNoteColumn(rows) {
  const xs = [];
  for (const row of rows) {
    for (const item of row.items) {
      if (NOTE_REF.test(item.text) && !PERIOD_RE.test(item.text)) xs.push(item.x);
    }
  }
  if (xs.length < 3) return null;
  const sorted = [...xs].sort((a,b)=>a-b);
  const med = sorted[Math.floor(sorted.length/2)];
  return { min: med - 40, max: med + 40 };
}

// Detect column headers — merge multi-line header cells (e.g. "As at\n31st March, 2025\n(₹ in Crores)")
function detectColumns(rows) {
  // Scan up to 5 rows looking for period patterns; merge text from adjacent rows by x-position
  const candidates = [];

  for (let ri = 0; ri < Math.min(rows.length, 20); ri++) {
    const row = rows[ri];
    const periodItems = row.items.filter(i => PERIOD_RE.test(i.text));
    if (periodItems.length === 0) continue;

    // Found period items — try to build column definitions
    // Also look 1-2 rows above/below to merge multi-line headers
    const merged = [];
    for (const item of row.items) {
      if (!PERIOD_RE.test(item.text)) continue;
      const cx = item.x + item.w / 2;
      let fullText = item.text;

      // Scan adjacent rows for more text at same x (multi-line header)
      for (let dr = -2; dr <= 2; dr++) {
        if (dr === 0) continue;
        const adj = rows[ri + dr];
        if (!adj) continue;
        const nearby = adj.items.find(i => Math.abs((i.x + i.w/2) - cx) < 40 && !PERIOD_RE.test(i.text) && !/^\(/.test(i.text));
        if (nearby) fullText = nearby.text + " " + fullText;
      }

      merged.push({ header: fullText.trim(), cx });
    }

    if (merged.length >= 2) return { colRowIdx: ri, columns: merged };

    // Also detect plain years (2024, 2025) as columns
    const yearItems = row.items.filter(i => /^20\d{2}$/.test(i.text));
    if (yearItems.length >= 2) {
      return { colRowIdx: ri, columns: yearItems.map(i => ({ header: i.text, cx: i.x + i.w/2 })) };
    }
  }
  return null;
}

// Assign numbers in a row to nearest column
function assignToColumns(rowItems, cols, labelCutX, noteColRange) {
  const span = cols[cols.length-1].cx - cols[0].cx;
  const tol = Math.max(50, (span / Math.max(cols.length-1,1)) * 0.75);
  const result = cols.map(() => null);
  const used = new Set();

  for (const item of rowItems) {
    const cx = item.x + item.w/2;
    if (cx < labelCutX - 10) continue;

    // Skip note reference numbers
    if (noteColRange && cx >= noteColRange.min && cx <= noteColRange.max) continue;
    if (NOTE_REF.test(item.text)) continue;

    const num = parseFloat(item.text.replace(/,/g,""));
    if (isNaN(num)) continue;

    let best = -1, bd = tol;
    cols.forEach((c,i) => { if(!used.has(i)){const d=Math.abs(cx-c.cx); if(d<bd){bd=d;best=i;}} });
    if (best >= 0) { result[best] = num; used.add(best); }
  }
  return result;
}

function cleanLabel(text) {
  return text
    .replace(/^\([a-zA-Z]+\)\s+/, "")   // remove (a), (b), (iv)
    .replace(/\s+\d{1,2}[A-Z]?\s*$/, "") // remove trailing note refs "3A"
    .replace(/\s+\d{1,2}\s*$/, "")       // remove trailing single digits
    .trim();
}

function extractTablesFromItems(allItems) {
  const rows = clusterRows(allItems);
  const colInfo = detectColumns(rows);
  if (!colInfo || colInfo.columns.length < 2) return null;

  const { colRowIdx, columns } = colInfo;
  const noteColRange = detectNoteColumn(rows);
  const labelCutX = columns[0].cx - (columns.length > 1 ? (columns[1].cx - columns[0].cx) * 0.5 : 60);
  const tableRows = [];

  for (let ri = 0; ri < rows.length; ri++) {
    if (ri === colRowIdx) continue; // skip header row itself

    const row = rows[ri];
    const labelParts = row.items
      .filter(i => {
        const cx = i.x + i.w/2;
        return cx < labelCutX && !(noteColRange && cx >= noteColRange.min && cx <= noteColRange.max);
      })
      .map(i => i.text);

    const label = cleanLabel(labelParts.join(" "));
    if (!label || label.length < 2) continue;

    const vals = assignToColumns(row.items, columns, labelCutX, noteColRange);
    const hasValues = vals.some(v => v !== null);

    // Include section headers (no values) if they look like section labels
    if (!hasValues) {
      if (SECTION_HEADERS.test(label) || (label === label.toUpperCase() && label.length > 3)) {
        tableRows.push({ label, values: columns.map(() => null), row_type: "header" });
      }
      continue;
    }

    tableRows.push({
      label,
      values: vals,
      row_type: isTotal(label) ? "total" : "line_item"
    });
  }

  return tableRows.length >= 3 ? { columns: columns.map(c => c.header), rows: tableRows } : null;
}

function detectStmtName(items) {
  const lines = clusterRows(items).map(r => r.items.map(i=>i.text).join(" "));
  for (const line of lines) {
    for (const { re, name } of STMT_PATTERNS) if (re.test(line)) return name;
  }
  return null;
}

function detectUnit(items) {
  const text = items.map(i => i.text).join(" ");
  const m = text.match(/(?:Rs\.?|INR|₹)\s*(?:in\s+)?(?:Crore|Lakh|Million|Billion)s?/i);
  return m ? m[0].trim() : null;
}

async function extractPDF(url, fromPage = 1, toPage = null) {
  const lib = await loadPDFJS();
  const pdf = await lib.getDocument({ data: await fetchPDF(url) }).promise;
  const endPage = toPage ? Math.min(toPage, pdf.numPages) : Math.min(pdf.numPages, fromPage + 49);

  const statements = {};
  let currentStmt = null;
  let accItems = [];

  for (let p = fromPage; p <= endPage; p++) {
    const items = await getPageItems(pdf, p);
    const stmtName = detectStmtName(items);

    if (stmtName && stmtName !== currentStmt) {
      if (currentStmt && accItems.length > 0) {
        const table = extractTablesFromItems(accItems);
        if (table) {
          const key = currentStmt.toLowerCase().replace(/[^a-z]/g,"-");
          if (!statements[key] || table.rows.length > statements[key].rows.length)
            statements[key] = { name: currentStmt, ...table, unit: detectUnit(accItems) };
        }
      }
      currentStmt = stmtName;
      accItems = [];
    }

    accItems.push(...items);

    if (currentStmt) {
      const table = extractTablesFromItems(accItems);
      if (table && table.rows.length >= 3) {
        const key = currentStmt.toLowerCase().replace(/[^a-z]/g,"-");
        if (!statements[key] || table.rows.length > statements[key].rows.length)
          statements[key] = { name: currentStmt, ...table, unit: detectUnit(accItems) };
      }
    }
  }

  const firstItems = await getPageItems(pdf, fromPage);
  const firstLines = clusterRows(firstItems).map(r => r.items.map(i=>i.text).join(" "));
  const co = firstLines.find(l => /Ltd|Limited|Industries|Bank|Corp|Inc/i.test(l) && l.length < 80);

  return { ok: Object.keys(statements).length > 0, meta: { name: co || "Company", ticker: "" }, statements };
}

window.extractPDF = extractPDF;
window.getPDFPageCount = getPDFPageCount;
