import express from "express";
import cors from "cors";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "20mb" }));

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

  app.get("/api/config", (_req, res) => {
    res.json({ geminiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "" });
  });

  app.post("/api/gemini-extract", async (request, response) => {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) return response.status(503).json({ error: "Gemini API key not configured" });

    const { image, mimeType = "image/png" } = request.body || {};
    if (!image) return response.status(400).json({ error: "Missing image field" });

    const prompt = `Extract the financial table from this image. Return ONLY valid JSON, no markdown fences:
{"columns":["Mar 2025","Mar 2024"],"rows":[{"label":"NON-CURRENT ASSETS","note":null,"values":[null,null],"is_bold":true,"row_type":"header"},{"label":"Property, Plant & Equipment","note":"1","values":[40563.52,34436.76],"is_bold":false,"row_type":"line_item"}]}
Rules: columns=year headers; note=note number string or null; values=numbers per column (null if blank, no commas); is_bold=true for ALL-CAPS headers/totals/subtotals; row_type=header|total|subtotal|line_item. Include ALL rows.`;

    try {
      const { default: https } = await import("https");
      const body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: image } }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 8192 },
      });

      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: "generativelanguage.googleapis.com",
          path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, (res) => {
          let data = "";
          res.on("data", c => data += c);
          res.on("end", () => resolve({ status: res.statusCode, body: data }));
        });
        req.on("error", reject);
        req.write(body);
        req.end();
      });

      if (result.status !== 200) {
        return response.status(502).json({ error: `Gemini API ${result.status}`, detail: result.body.slice(0, 300) });
      }

      const data = JSON.parse(result.body);
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

      try {
        return response.status(200).json(JSON.parse(clean));
      } catch {
        return response.status(502).json({ error: "Non-JSON from Gemini", raw: text.slice(0, 300) });
      }
    } catch (err) {
      return response.status(500).json({ error: err.message });
    }
  });

  return app;
}
