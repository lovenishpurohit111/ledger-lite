export default function handler(_request, response) {
  response.status(200).json({
    app: "Financials Conversion",
    supportedStatements: ["Profit & Loss", "Balance Sheet", "Cash Flow"],
    supportedFiles: ["JPG", "PNG", "WEBP", "PDF", "Clipboard screenshots"],
    pipeline: ["Preprocess", "OCR", "Gemini reconstruction", "Validate", "Excel export"]
  });
}
