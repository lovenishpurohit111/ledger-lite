// pdf-extractor.js — extracts financial data from PDF files
// Uses PDF.js for text extraction + same parsing logic as content.js

const PERIOD_RE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*['`]?\s*\d{2,4}\b|\bFY\s*\d{2,4}\b|\bQ[1-4]\s*(?:FY)?\s*\d{2,4}\b|\b(TTM|LTM)\b|\b20\d{2}\b|\b\d+\s*mths?\b/i;

const STMT_PATTERNS = [
  { re: /profit\s*[&and]+\s*loss|income\s*statement|p\s*[&]\s*l/i, name: "Profit & Loss"  },
  { re: /balance\s*sheet/i,                                          name: "Balance Sheet"  },
  { re: /cash\s*flow/i,                                              name: "Cash Flow"      },
];

const TOTAL_KW = ["total","net profit","gross profit","operating profit",
  "profit before tax","profit after tax","ebitda","total assets","total liabilities","net worth"];

function classifyRow(label) {
  const l = (label||"").toLowerCase();
  if (TOTAL_KW.some(k => l.includes(k))) return "total";
  return "line_item";
}

function detectStmtType(text) {
  for (const { re, name } of STMT_PATTERNS) if (re.test(text)) return name;
  return "Financial Statement";
}

function parseFinancialText(pages) {
  // Flatten all page text into lines
  const lines = pages
    .join("\n")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const statements = {};
  let currentStmt = null;
  let headers = null;
  let rows = [];
  let unit = null;

  for (const line of lines) {
    // Detect unit
    if (/crore|lakh|million|rs\.?\s*in/i.test(line) && line.length < 80) {
      unit = line;
    }

    // Detect statement heading
    for (const { re, name } of STMT_PATTERNS) {
      if (re.test(line) && line.length < 100) {
        // Save previous statement
        if (currentStmt && rows.length > 0) {
          statements[currentStmt.toLowerCase().replace(/[^a-z]/g,"-")] = {
            name: currentStmt, headers: headers || [], rows, unit
          };
        }
        currentStmt = name;
        headers = null;
        rows = [];
        break;
      }
    }

    // Detect header row (contains year patterns)
    if (!headers && PERIOD_RE.test(line)) {
      const cols = line.split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean);
      if (cols.filter(c => PERIOD_RE.test(c)).length >= 2) {
        headers = ["", ...cols.filter(c => PERIOD_RE.test(c))];
        continue;
      }
    }

    // Parse data row: label followed by numbers
    if (currentStmt) {
      const numbers = [...line.matchAll(/-?[\d,]+(?:\.\d+)?/g)]
        .map(m => parseFloat(m[0].replace(/,/g,"")))
        .filter(n => !isNaN(n));

      if (numbers.length >= 1) {
        const firstNumIdx = line.search(/-?[\d,]+/);
        const label = line.substring(0, firstNumIdx).trim()
          .replace(/^[a-z\(\)]\s+/, "")  // strip "(a)", "(b)" etc
          .replace(/\s+\d+[A-Z]?\s*$/, "") // strip note refs
          .trim();

        if (label && label.length > 1 && label.length < 80) {
          // Match numbers to year columns
          const vals = headers ? headers.slice(1).map(() => null) : [];
          numbers.slice(0, vals.length || numbers.length).forEach((n, i) => {
            if (vals[i] !== undefined) vals[i] = n;
          });
          rows.push([label, ...vals]);
        }
      }
    }
  }

  // Save last statement
  if (currentStmt && rows.length > 0) {
    statements[currentStmt.toLowerCase().replace(/[^a-z]/g,"-")] = {
      name: currentStmt, headers: headers || [], rows, unit
    };
  }

  return statements;
}

// Main: extract text from PDF URL using PDF.js
async function getPDFPageCount(url) {
  const pdfjsLib = await import(chrome.runtime.getURL("pdf.min.mjs"));
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  return pdf.numPages;
}

async function extractPDF(url, fromPage = 1, toPage = null) {
  const pdfjsLib = await import(chrome.runtime.getURL("pdf.min.mjs"));
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");

  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const pages = [];
  const endPage = toPage ? Math.min(toPage, pdf.numPages) : Math.min(pdf.numPages, 50);
  for (let i = fromPage; i <= endPage; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Sort items by y then x for proper reading order
    const items = content.items
      .sort((a, b) => Math.round(b.transform[5]/5)*5 - Math.round(a.transform[5]/5)*5
                   || a.transform[4] - b.transform[4]);
    pages.push(items.map(item => item.str).join(" "));
  }

  const statements = parseFinancialText(pages);
  const companyGuess = pages[0]?.match(/^([A-Z][A-Za-z\s&]+(?:Ltd|Limited|Inc|Corp))/m)?.[1]?.trim() || "Company";

  return {
    ok: Object.keys(statements).length > 0,
    meta: { name: companyGuess, ticker: "" },
    statements
  };
}

window.extractPDF = extractPDF;
window.getPDFPageCount = getPDFPageCount;
