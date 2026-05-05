import express from "express";
import cors from "cors";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, app: "Financials Conversion", ai: "Gemini", claude: false });
  });

  app.get("/api/defaults", (_request, response) => {
    response.json({
      app: "Financials Conversion",
      supportedStatements: ["Profit & Loss", "Balance Sheet", "Cash Flow"],
      supportedFiles: ["JPG", "PNG", "WEBP", "PDF", "Clipboard screenshots"],
      pipeline: ["Preprocess", "OCR", "Gemini reconstruction", "Validate", "Excel export"]
    });
  });

  app.get("/api/diagnostics", (_request, response) => {
    response.json({
      ok: true,
      runtime: "vercel-node",
      conversionJobs: false,
      ocrAvailable: false,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      message: "The static Vercel deployment is reachable, but the Python conversion worker is not attached to this production route.",
      hint: "Run the FastAPI backend locally with npm run dev, or deploy the backend as a dedicated service/API before using Convert in production."
    });
  });

  return app;
}
