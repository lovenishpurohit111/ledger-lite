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
      supportedFiles: ["JPG", "PNG", "PDF"],
      pipeline: ["Preprocess", "OCR", "Gemini reconstruction", "Validate", "Excel export"]
    });
  });

  return app;
}
