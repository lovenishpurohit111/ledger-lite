export default function handler(_request, response) {
  response.status(501).json({
    ok: false,
    error: "Conversion worker unavailable",
    message: "This Vercel frontend does not currently have the Python OCR/Gemini conversion worker attached to /api/jobs.",
    hint: "The file paste worked. The failure is backend deployment, not your screenshot. Run npm run dev locally for the full FastAPI pipeline or deploy the backend worker."
  });
}
