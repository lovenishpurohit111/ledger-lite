# Financials Conversion

Financials Conversion turns scanned financial statements into reviewed, clean Excel workbooks. It is built around a cost-conscious hybrid pipeline:

1. Upload JPG, PNG, WEBP, scanned PDF, multi-page PDF files, or paste a screenshot from the clipboard.
2. Preprocess pages locally with deskewing, denoising, sharpening, contrast enhancement, orientation/page-boundary correction, and perspective repair when OpenCV is available.
3. Run local OCR and layout extraction with Tesseract/Pytesseract.
4. Send compact OCR and layout metadata to Gemini for statement classification, financial interpretation, table reconstruction, terminology normalization, and ambiguity resolution.
5. Validate totals, duplicate lines, missing values, suspicious OCR rows, and row confidence.
6. Let users review and correct extracted rows.
7. Export a polished Excel workbook with separate Profit & Loss, Balance Sheet, and Cash Flow sheets.

No Claude integration is present or required.

## Tech Stack

- Frontend: React + Vite + Tailwind CSS
- Backend: Python FastAPI
- OCR: Tesseract through `pytesseract`
- Image processing: OpenCV
- AI reasoning: Gemini API through `google-genai`
- Excel generation: `openpyxl`

The OCR and preprocessing dependencies are optional at runtime so the app can still start in a development environment. Production deployments should install everything in `requirements.txt` and set `GEMINI_API_KEY`.

## Run Locally

```bash
npm install
python -m pip install -r requirements.txt
$env:GEMINI_API_KEY="your-key"
npm run dev
```

Frontend: `http://localhost:5173`

Backend health check: `http://localhost:3001/api/health`

For test tooling:

```bash
python -m pip install -r requirements-dev.txt
python -m pytest backend/tests
```

## Sample Assets

Text sidecars in `samples/input` simulate OCR-readable statements for deterministic testing. Generate the example workbook with:

```bash
python samples/generate_example.py
```

The output is written to `samples/output/financials-conversion-example.xlsx`.

## Production Notes

- Install the native Tesseract binary and Poppler for full OCR/PDF rasterization.
- Keep Gemini prompts compact by sending OCR tokens, bounding boxes, page metadata, and extracted table candidates rather than raw images.
- Store uploads outside the repository in production object storage.
- Add authentication and database-backed job tracking before opening this as a SaaS product.
- Treat the review screen as mandatory for quality control; low-confidence cells and validation warnings are surfaced before export.

## Screenshot Paste

Take a screenshot of a Profit & Loss, Balance Sheet, or Cash Flow statement, then open the app and press `Ctrl+V` or `Cmd+V`. You can also use the **Paste screenshot from clipboard** button in the upload panel. Pasted screenshots are converted into image files and sent through the same preprocessing, OCR, Gemini reconstruction, validation, and Excel export pipeline.
