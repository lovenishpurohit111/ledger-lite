# CLAUDE.md — Financial-Convertor

## Project Overview
**Financials Conversion** converts scanned financial statements (JPG, PNG, WEBP, PDF) into clean, reviewed Excel workbooks. It uses a hybrid pipeline: local OCR → Gemini AI reasoning → user review → Excel export.

Live app: https://ledger-lite-two.vercel.app

---

## Tech Stack
| Layer | Technology |
|---|---|
| Frontend | React + Vite + Tailwind CSS |
| Backend | Python FastAPI |
| OCR | Tesseract / pytesseract |
| Image Processing | OpenCV |
| AI Reasoning | Gemini API (`google-genai`) |
| Excel Export | openpyxl |
| Deployment | Vercel |

---

## Project Structure
```
/
├── src/          # React frontend source
├── backend/      # Python FastAPI backend
├── api/          # API route handlers (Vercel serverless)
├── samples/      # Sample inputs/outputs for testing
│   ├── input/    # Text sidecars simulating OCR-readable statements
│   └── output/   # Generated example workbooks
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── requirements.txt
├── requirements-dev.txt
└── vercel.json
```

---

## Setup & Running Locally

### 1. Install dependencies
```bash
npm install
python -m pip install -r requirements.txt
```

### 2. Set environment variable
```bash
# Windows PowerShell
$env:GEMINI_API_KEY="your-key"

# macOS/Linux
export GEMINI_API_KEY="your-key"
```

### 3. Run dev servers
```bash
npm run dev
```
- Frontend: http://localhost:5173
- Backend health: http://localhost:3001/api/health

### 4. Run tests
```bash
python -m pip install -r requirements-dev.txt
python -m pytest backend/tests
```

### 5. Generate sample workbook
```bash
python samples/generate_example.py
# Output: samples/output/financials-conversion-example.xlsx
```

---

## Pipeline Flow
1. **Upload** — JPG, PNG, WEBP, scanned/multi-page PDF, or paste screenshot (Ctrl+V / Cmd+V)
2. **Preprocess** — deskew, denoise, sharpen, contrast, orientation/perspective fix (OpenCV)
3. **OCR** — local text + layout extraction (Tesseract)
4. **AI Reasoning** — send compact OCR tokens + bounding boxes to Gemini for classification, table reconstruction, normalization
5. **Validation** — check totals, duplicates, missing values, row confidence
6. **Review** — user reviews/corrects rows in UI (mandatory for quality)
7. **Export** — Excel workbook with P&L, Balance Sheet, and Cash Flow sheets

---

## Key Notes for Development
- **No Claude/Anthropic API** is used — AI layer is Gemini only
- OCR and OpenCV dependencies are **optional at dev time** (app starts without them)
- Production requires native **Tesseract binary** and **Poppler** installed
- Uploads should be stored in **object storage** (not the repo) in production
- The **review screen is mandatory** — low-confidence cells and warnings must be surfaced before export
- Add **auth + DB-backed job tracking** before any SaaS launch

---

## Environment Variables
| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes (prod) | Google Gemini API key |
