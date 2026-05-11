
function cleanHeader(h) { return (h||'').replace(/^[`'"\s´]+|[`'"\s´]+$/g,'').trim(); }
// pdf-extractor.js — position-aware PDF table extractor

const PERIOD_RE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[,.\s]*['`]?\s*\d{2,4}\b|\bFY\s*\d{2,4}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[,.\s]*\d{4}\b|\b20\d{2}\b|\b(TTM|LTM)\b|\b\d+\s*mths?\b/i;

const STMT_PATTERNS = [
  { re: /(?:statement\s+of\s+)?profit\s+(?:and|&)\s+loss|income\s+statement/i, name: "Profit & Loss"      },
  { re: /balance\s+sheet|statement\s+of\s+financial\s+position/i,              name: "Balance Sheet"      },
  { re: /cash\s+flow/i,                                                           name: "Cash Flow"          },
  { re: /(?:statement\s+of\s+)?changes\s+in\s+equity|statement.*equity/i,      name: "Changes in Equity"  },
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
  const vp = page.getViewport({ scale: 1 });
  const isLandscape = vp.width > vp.height * 1.2;
  const content = await page.getTextContent();
  return content.items
    .filter(i => i.str.trim())
    .map(i => ({
      text: i.str.trim(),
      x: Math.round(i.transform[4]),
      y: Math.round(i.transform[5]),
      w: Math.round(Math.abs(i.width)),
      isLandscape
    }));
}

// Cluster items into visual rows by y-position
function clusterRows(items, yTol) {
  if (yTol === undefined) yTol = items.some(i => i.isLandscape) ? 4 : 5;
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

      merged.push({ header: cleanHeader(fullText), cx });
    }

    if (merged.length >= 2) return { colRowIdx: ri, columns: merged };

    // Also detect plain years (2024, 2025) as columns
    const yearItems = row.items.filter(i => /^20\d{2}$/.test(i.text));
    if (yearItems.length >= 2) {
      return { colRowIdx: ri, columns: yearItems.map(i => ({ header: cleanHeader(i.text), cx: i.x + i.w/2 })) };
    }
  }
  return null;
}

// Assign numbers in a row to nearest column
function assignToColumns(rowItems, cols, labelCutX, noteColRange) {
  const span = cols[cols.length-1].cx - cols[0].cx;
  const colGap = span / Math.max(cols.length-1,1);
  const tol = Math.max(30, colGap * (cols.length > 8 ? 0.55 : 0.75));
  const result = cols.map(() => null);
  const used = new Set();

  for (const item of rowItems) {
    const cx = item.x + item.w/2;
    if (cx < labelCutX - 10) continue;

    // Skip note reference numbers
    if (noteColRange && cx >= noteColRange.min && cx <= noteColRange.max) continue;
    if (NOTE_REF.test(item.text)) continue;

    const rawNum = item.text.replace(/,/g,"");
    let num;
    if (/^\([\d.]+\)$/.test(rawNum)) num = -parseFloat(rawNum.replace(/[()]/g,""));
    else num = parseFloat(rawNum);
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

  // Merge orphan continuation rows (e.g. "income" on its own line after a data row)
  const merged = [];
  for (const row of tableRows) {
    const prev = merged[merged.length - 1];
    const isOrphan = row.row_type !== "header" && !row.values.some(v => v !== null)
      && row.label.length < 30 && /^[a-z]/.test(row.label);
    if (isOrphan && prev && prev.row_type !== "header") {
      prev.label = prev.label + " " + row.label;
    } else {
      merged.push(row);
    }
  }

  return merged.length >= 2 ? { columns: columns.map(c => cleanHeader(c.header)), rows: merged } : null;
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

async function extractPDF(url, fromPage = 1, toPage = null, geminiKey = "", onProgress = null) {
  const lib = await loadPDFJS();
  const pdf = await lib.getDocument({ data: await fetchPDF(url) }).promise;
  const endPage = toPage ? Math.min(toPage, pdf.numPages) : Math.min(pdf.numPages, fromPage + 49);

  // ── Gemini Vision path ────────────────────────────────────────────────────
  if (geminiKey) {
    const base64Images = [];
    for (let p = fromPage; p <= endPage; p++) {
      if (typeof onProgress === "function") onProgress(`Rendering page ${p}…`);
      base64Images.push(await renderPageToBase64(pdf, p));
      if (base64Images.length === 16) break;
    }
    if (typeof onProgress === "function") onProgress("Sending to Gemini API…");
    // Let Gemini errors propagate — user needs to see quota/key errors
    const result = await extractWithGemini(base64Images, geminiKey);
    if (!result.ok) throw new Error("Gemini returned no financial tables. Try including more pages.");
    const firstItems = await getPageItems(pdf, fromPage);
    const firstLines = clusterRows(firstItems).map(r => r.items.map(i=>i.text).join(" "));
    const co = firstLines.find(l => /Ltd|Limited|Industries|Bank|Corp|Inc/i.test(l) && l.length < 80);
    return { ok: true, meta: { name: co || "Company", ticker: "" }, statements: result.statements };
  }

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

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI VISION EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

async function renderPageToBase64(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const vp = page.getViewport({ scale: 2.5 }); // 2.5x for clarity
  const canvas = document.createElement("canvas");
  canvas.width = vp.width;
  canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
  return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
}

async function extractWithGemini(base64Images, apiKey) {
  const prompt = `You are a financial statement expert. These are pages from an annual report PDF.
Extract ALL financial tables visible (P&L, Balance Sheet, Cash Flow, Changes in Equity, etc.).

Return ONLY valid JSON with this structure — no markdown, no explanation:
{
  "statements": [
    {
      "name": "Balance Sheet",
      "columns": ["As at 31st March 2025", "As at 31st March 2024"],
      "rows": [
        { "label": "Property Plant and Equipment", "values": [17428.89, 23082.33], "row_type": "line_item" },
        { "label": "TOTAL ASSETS", "values": [88090.68, 91826.16], "row_type": "total" }
      ],
      "unit": "Rs. Crores"
    }
  ]
}

Rules:
- row_type: "header" for section titles (ASSETS, LIABILITIES etc), "total" for TOTAL rows, "line_item" for everything else
- Parenthetical values like (1510.46) = negative: -1510.46
- Include ALL rows including section headers
- For Changes in Equity: flatten multi-level headers into single column names
- Skip note reference numbers (3A, 22, etc.) from values
- Include ALL statements visible across ALL pages provided`;

  const parts = [
    { text: prompt },
    ...base64Images.map(b64 => ({ inlineData: { mimeType: "image/jpeg", data: b64 } }))
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
      })
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const clean = text.replace(/```json\n?|\n?```/g, "").trim();

  const parsed = JSON.parse(clean);
  const statements = {};
  for (const stmt of parsed.statements || []) {
    const key = (stmt.name || "statement").toLowerCase().replace(/[^a-z]/g, "-");
    statements[key] = stmt;
  }
  return { ok: Object.keys(statements).length > 0, statements };
}
