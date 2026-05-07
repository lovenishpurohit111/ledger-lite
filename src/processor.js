import { createWorker } from "tesseract.js";
import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const MONTH_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i;
const YEAR_RE  = /^\d{4}$/;
const PCT_RE   = /%/;

const TOTAL_KW = ["total","net profit","gross profit","operating profit",
  "profit before tax","profit after tax","ebitda","net income","net loss","profit before"];
const SKIP_RE  = /^(consolidated|standalone|rs\.?\s*crore|particulars|description|view standalone)/i;

const SECTION_MAP = {
  Revenue:     ["sales","revenue","turnover","income from operation"],
  Expenses:    ["expense","cost of","depreciation","amortization","interest"],
  Profit:      ["profit","ebitda","ebit","other income","earnings"],
  Assets:      ["asset","investment","receivable","inventory","cash and"],
  Liabilities: ["liabilit","borrowing","payable","provision"],
  Equity:      ["equity","retained earning","reserve","share capital"]
};

// ─────────────────────────────────────────────────────────────────────────────
// TSV PARSER — word-level positions without relying on data.words
// TSV columns (level=5 is word):
//   level | page | block | par | line | word | left | top | width | height | conf | text
// ─────────────────────────────────────────────────────────────────────────────
function parseTSV(tsv) {
  if (!tsv) return [];
  const words = [];
  for (const line of tsv.split("\n")) {
    const cols = line.split("\t");
    if (cols.length < 12) continue;
    const [level,,,,,,left, top, width, height, conf, ...rest] = cols;
    if (Number(level) !== 5) continue;       // word level only
    const text = rest.join("\t").trim();
    if (!text) continue;
    const l = Number(left), t = Number(top), w = Number(width), h = Number(height);
    words.push({ text, conf: Number(conf),
      bbox: { x0: l, y0: t, x1: l + w, y1: t + h } });
  }
  return words;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function classify(label) {
  const l = label.toLowerCase();
  if (TOTAL_KW.some(k => l.includes(k))) return "total";
  if (l.startsWith("sub-total") || l.startsWith("subtotal")) return "subtotal";
  return "line_item";
}
function getSection(label) {
  const l = label.toLowerCase();
  for (const [sec, kws] of Object.entries(SECTION_MAP))
    if (kws.some(k => l.includes(k))) return sec;
  return null;
}
function stmtType(text) {
  const l = text.toLowerCase();
  if (["balance sheet","assets","liabilities","equity"].filter(k=>l.includes(k)).length>=2)
    return "Balance Sheet";
  if (["cash flow","operating activities","financing activities"].some(k=>l.includes(k)))
    return "Cash Flow";
  return "Profit & Loss";
}
function safeParse(t) {
  const n = parseFloat((t||"").replace(/,/g,""));
  return isNaN(n) ? null : n;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — cluster words into visual rows (by y-centre)
// ─────────────────────────────────────────────────────────────────────────────
function toRows(words, yTol = 10) {
  const rows = [];
  for (const w of [...words].sort((a,b) => a.bbox.y0 - b.bbox.y0)) {
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    const row = rows.find(r => Math.abs(r.cy - cy) < yTol);
    if (row) {
      row.words.push(w);
      row.cy = row.words.reduce((s,x)=>s+(x.bbox.y0+x.bbox.y1)/2,0)/row.words.length;
    } else rows.push({ cy, words: [w] });
  }
  rows.forEach(r => r.words.sort((a,b) => a.bbox.x0 - b.bbox.x0));
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — detect column headers (Mar YYYY … TTM)
// ─────────────────────────────────────────────────────────────────────────────
function detectCols(rows) {
  for (let ri = 0; ri < rows.length; ri++) {
    const ws = rows[ri].words;
    if (!ws.some(w => MONTH_RE.test(w.text) || /^TTM$/i.test(w.text))) continue;
    const cols = [];
    for (let i = 0; i < ws.length; i++) {
      if (MONTH_RE.test(ws[i].text) && ws[i+1] && YEAR_RE.test(ws[i+1].text)) {
        cols.push({ header: `${ws[i].text} ${ws[i+1].text}`,
          cx: (ws[i].bbox.x0 + ws[i+1].bbox.x1)/2 });
        i++;
      } else if (/^TTM$/i.test(ws[i].text)) {
        cols.push({ header: "TTM", cx: (ws[i].bbox.x0+ws[i].bbox.x1)/2 });
      }
    }
    if (cols.length >= 2) return { hri: ri, cols };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — assign numbers in a row to nearest column
// ─────────────────────────────────────────────────────────────────────────────
function assign(rowWords, cols, cutX) {
  const span = cols[cols.length-1].cx - cols[0].cx;
  const tol  = Math.max(40, (span / Math.max(cols.length-1,1)) * 0.6);
  const res  = cols.map(() => null);
  const used = new Set();
  for (const w of rowWords) {
    if (PCT_RE.test(w.text)) continue;
    const cx = (w.bbox.x0 + w.bbox.x1)/2;
    if (cx < cutX - 5) continue;
    const n = safeParse(w.text.replace(/%/g,""));
    if (n === null) continue;
    let best=-1, bd=tol;
    cols.forEach((c,i)=>{ if(!used.has(i)){const d=Math.abs(cx-c.cx); if(d<bd){bd=d;best=i;}} });
    if (best>=0) { res[best]=n; used.add(best); }
  }
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — build table rows
// ─────────────────────────────────────────────────────────────────────────────
function buildTable(words, text) {
  if (!words.length) return null;
  const rows = toRows(words);
  const ci   = detectCols(rows);
  if (!ci || ci.cols.length < 2) return null;

  const { hri, cols } = ci;
  const cutX = cols[0].cx - (cols[1] ? (cols[1].cx - cols[0].cx)*0.5 : 60);
  let section = "General";
  const trows = [];

  for (let ri = 0; ri < rows.length; ri++) {
    if (ri <= hri) continue;
    const rw = rows[ri].words;
    if (!rw.length) continue;

    const label = rw.filter(w=>(w.bbox.x0+w.bbox.x1)/2 < cutX)
      .map(w=>w.text).join(" ").replace(/[+*©®™|<>:]+$/,"").replace(/\s+/g," ").trim();

    if (!label || label.length < 2 || /^\d+$/.test(label) || SKIP_RE.test(label)) continue;

    const vals = assign(rw, cols, cutX);
    if (!vals.some(v=>v!==null)) continue;

    const sec = getSection(label);
    if (sec) section = sec;

    trows.push({ id: crypto.randomUUID(), label, section,
      row_type: classify(label), values: vals,
      amount: [...vals].reverse().find(v=>v!==null)||0,
      level: 1, confidence: 0.9, issues: [] });
  }

  return trows.length ? { columns: cols.map(c=>c.header), rows: trows } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: processImages — uses TSV for reliable word positions
// ─────────────────────────────────────────────────────────────────────────────
export async function processImages(files, onProgress) {
  // Simple worker — no second/third args that vary between versions
  const worker = await createWorker("eng", 1, {
    logger: m => { if (m.status === "recognizing text") onProgress?.(Math.round(m.progress*100)); }
  });

  const all = [];

  for (const file of files) {
    const url = URL.createObjectURL(file);
    try {
      // Request both text (for stmt type detection) and TSV (for positions)
      const { data } = await worker.recognize(url, {}, { text: true, tsv: true });
      const text  = data?.text  || "";
      const words = parseTSV(data?.tsv || "");

      const td = words.length ? buildTable(words, text) : null;

      if (td && td.rows.length > 0) {
        all.push({ id: crypto.randomUUID(), statement_type: stmtType(text), rows: td.rows, tableData: td });
      } else {
        throw new Error("Could not detect a financial table. Try a clearer screenshot with the full header row visible.");
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  await worker.terminate();
  if (!all.length) throw new Error("No financial data extracted. Ensure the image is a clear screenshot.");
  return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: exportToExcel — full multi-year layout
// ─────────────────────────────────────────────────────────────────────────────
export function exportToExcel(statements) {
  const wb = XLSX.utils.book_new();

  for (const stmt of statements) {
    const td  = stmt.tableData;
    const yrs = td ? td.columns : ["Amount (₹ Cr)"];
    const hdr = ["Line Item", ...yrs];
    const body = (td ? td.rows : stmt.rows).map(r =>
      [r.label, ...(td ? r.values.map(v => v ?? "") : [r.amount])]
    );

    const ws = XLSX.utils.aoa_to_sheet([hdr, ...body]);
    ws["!cols"] = [{ wch: 28 }, ...yrs.map(() => ({ wch: 11 }))];
    XLSX.utils.book_append_sheet(wb, ws, stmt.statement_type.substring(0, 31));
  }

  XLSX.writeFile(wb, "financials-export.xlsx");
}
