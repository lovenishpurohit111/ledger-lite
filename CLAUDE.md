# CLAUDE.md — FinXport (Financial-Convertor)

## Project Overview
**FinXport** converts financial statements (P&L, Balance Sheet, Cash Flow, Changes in Equity) from screenshots, PDFs, and financial websites into clean Excel workbooks. It ships as two products:

1. **Web App** — `ledger-lite-two.vercel.app` (React PWA, installable on Android)
2. **Browser Extension** — Published on Firefox Add-ons (v1.2.0 submitted 🔄), Chrome load-unpacked

---

## Tech Stack

### Web App
| Layer | Technology |
|---|---|
| Frontend | React + Vite + Tailwind CSS |
| OCR | Tesseract.js v7 (runs in browser, TSV output for word positions) |
| Excel Export | SheetJS (xlsx) — fully client-side |
| Deployment | Vercel |
| PWA | manifest.json + service worker (installable on Android) |

### Browser Extension (`/extension`)
| Layer | Technology |
|---|---|
| DOM Extraction | Vanilla JS content script — reads HTML tables directly |
| PDF Extraction | PDF.js (loaded via module shim in popup.html) |
| AI Vision | Gemini API (optional — user provides key, stored in chrome.storage) |
| Excel Export | SheetJS bundled in extension |
| Testing | `test.cjs` — 39+ assertions, runs before every push |

---

## Project Structure
```
/
├── src/                    # React frontend
│   ├── main.jsx            # Main app component
│   └── processor.js        # Tesseract OCR + financial table parsing
├── extension/              # Browser extension
│   ├── manifest.json       # MV3 manifest (Firefox + Chrome)
│   ├── content.js          # Universal DOM table extractor
│   ├── popup.html/js       # Extension popup UI
│   ├── exporter.js         # Excel builder (handles web + PDF formats)
│   ├── pdf-extractor.js    # PDF.js + Gemini Vision extraction
│   ├── pdf.min.mjs         # PDF.js library
│   ├── pdf.worker.min.mjs  # PDF.js worker
│   ├── xlsx.min.js         # SheetJS
│   └── test.cjs            # Self-test suite (run before every push)
├── public/                 # PWA assets
│   ├── manifest.json       # Web app manifest
│   ├── sw.js               # Service worker
│   └── icons/              # PWA icons
├── api/                    # Vercel serverless functions
│   ├── health.js
│   └── diagnostics.js
├── .github/workflows/      # GitHub Actions (Telegram bot pipeline — NOT for Firefox)
│   └── publish-extension.yml
└── index.html              # PWA entry point
```

---

## Web App — How It Works

1. **Upload** — Drop JPG/PNG/PDF screenshot
2. **Preprocess** — 2.5× upscale, shadow removal, contrast stretch, unsharp mask
3. **OCR** — Tesseract.js v7 with TSV output (word bounding boxes)
4. **Table Reconstruction** — Clusters words by Y-position, detects year columns (Mar 2024, FY24, TTM), assigns values to columns
5. **Review** — Multi-column editable spreadsheet view (Line Item | Mar 2014 | ... | TTM)
6. **Export** — SheetJS generates .xlsx in browser

### Key OCR Notes
- Use `data.tsv` NOT `data.words` (doesn't exist in Tesseract.js v7)
- TSV columns: `level | page | block | par | line | word | left | top | width | height | conf | text`
- Level 5 = word level
- Parenthetical negatives `(1510.46)` → `-1510.46`
- Percentage values `31%` kept as string `"31%"`

---

## Extension — How It Works

### Supported Sites
- **Screener.in** — reads `#profit-loss`, `#balance-sheet`, `#cash-flow`, `#quarters` section IDs
- **Tickertape** — tries `__NEXT_DATA__` JSON first, falls back to DOM table scan
- **Moneycontrol** — universal table scanner (headers: "12 mths", "MAR 26" etc.)
- **Any financial site** — universal PERIOD_RE scans for date/year patterns in table headers

### PERIOD_RE Pattern
```javascript
/\b(Jan|Feb|Mar|...)['`]?\s*\d{2,4}\b|\bFY\s*\d{2,4}\b|\b(TTM|LTM)\b|\b\d+\s*mths?\b/i
```

### PDF Extraction
- PDF.js loaded via `<script type="module">` shim in popup.html → `window._pdfjsLib`
- Position-aware extraction: clusters text items by Y-position, detects column X-centers
- Detects Note column (3A, 22A etc.) and excludes from values
- Merges multi-line headers ("As at\n31st March, 2025")
- Handles landscape pages (Changes in Equity)
- **Gemini Vision fallback**: renders pages at 2.5× → sends to Gemini API
  - Model chain: `gemini-2.5-flash-lite` → `gemini-1.5-flash` → `gemini-1.5-flash-8b`
  - Key stored in `chrome.storage.local`

### YoY Growth Rows
- Only added for **Profit & Loss** sheets
- Only for: Sales, Revenue, Net Profit, Operating Profit, EBITDA, PBT, PAT
- Never for Balance Sheet or Cash Flow

---

## Extension — Self-Testing Policy
**Run `node extension/test.cjs` before every push. Never push if tests fail.**

The test suite covers:
- Screener.in DOM extraction (headers, data rows, Tax%, EPS, OPM%)
- Tickertape DOM table detection
- Tickertape `__NEXT_DATA__` JSON parsing
- Moneycontrol "12 mths" header format
- Moneycontrol "MAR 26" header format
- cleanNum() helper (commas, percentages, decimals)
- PERIOD_RE pattern matching

---

## Firefox Extension Status
- **v1.2.0 submitted** 🔄 on addons.mozilla.org (v1.1.0 previously approved ✅)
- Extension ID: `finxport@lovenishpurohit`
- Strict min version: Firefox 140, Firefox for Android 142
- `data_collection_permissions.required: ["none"]`
- ZIP packaged manually: `cd extension && zip -r ../FinXport-v1.2.0.zip . --exclude "test.cjs"`

## What Changed in v1.2.0
**New Features**
- PDF support — extract financial tables from PDFs via PDF.js, with page range picker
- Gemini Vision — send PDF pages as images to Gemini AI for better accuracy (user provides key)
- Changes in Equity sheet — detects and exports this statement including landscape page layouts

**Improvements**
- Gemini model chain: auto-falls back through `gemini-2.5-flash-lite` → `gemini-1.5-flash` → `gemini-1.5-flash-8b`
- Clearer Gemini error messages: 429 (rate limit), 400 (bad key), 403 (no permission)
- PDF column detection is position-aware — handles annual report formats ("31st March 2025")
- Merges split labels, parses `(1510.46)` as negative, excludes Note reference columns

**Bug Fixes**
- YoY growth rows now only appear on P&L — never Balance Sheet or Cash Flow
- YoY checkbox was not wired correctly — now actually toggles growth rows
- PDF.js loading fixed in Firefox (dynamic `import()` replaced with module shim)
- Export handles both PDF `{columns+object rows}` and web `{headers+array rows}` formats
- Fixed missing `try{` before Gemini fetch loop (caused Firefox validation error)

## GitHub Actions
`.github/workflows/publish-extension.yml` — **Note: this workflow is wired to the Telegram bot pipeline, NOT the Firefox extension.** Do NOT rely on it to publish to Firefox. Package and upload the ZIP manually:
```bash
node extension/test.cjs        # must show 0 failures
cd extension && zip -r ../FinXport-vX.X.X.zip . --exclude "test.cjs"
# Upload ZIP at addons.mozilla.org → Manage Submissions → Submit New Version
```

---

## Environment & Deployment

### Vercel
- Frontend auto-deploys from GitHub `main` branch
- Empty commit to trigger: `git commit --allow-empty -m "trigger redeploy"`
- No environment variables required (all processing is client-side)

### Git Workflow
```bash
# Clone with PAT
git clone https://{PAT}@github.com/lovenishpurohit111/Financial-Convertor.git

# Before pushing extension changes
node extension/test.cjs   # must show 0 failures

# Repackage extension ZIP
cd extension && zip -r ../FinXport-vX.X.X.zip . --exclude "test.cjs"
```

---

## Known Quirks & Hard-Won Lessons
- **Tesseract.js v7**: no `data.words` — use `data.tsv` with level=5 filter
- **PDF.js in Firefox popup**: dynamic `import()` fails — use `<script type="module">` shim in popup.html
- **Gemini 2.0 Flash retired** March 2026 — use `gemini-1.5-flash` or `gemini-2.5-flash-lite`
- **Firefox manifest**: needs `data_collection_permissions`, `strict_min_version: "140.0"`, `gecko_android.strict_min_version: "142.0"`
- **ZIP packaging**: must zip FROM INSIDE `extension/` directory so `manifest.json` is at root
- **Extension statement keys**: popup, content.js, and exporter.js all use dynamic keys — never hardcode `["profit-loss","balance-sheet"]` only
- **YoY rows**: never add to Balance Sheet/Cash Flow — only P&L and only for key metrics
- **GitHub Action**: publish-extension.yml is for Telegram bot — do NOT use it to publish to Firefox
