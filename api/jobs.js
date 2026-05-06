import busboy from "busboy";
import { randomUUID } from "crypto";

function parseFiles(req) {
  return new Promise((resolve, reject) => {
    const files = [];
    const bb = busboy({ headers: req.headers, limits: { fileSize: 15 * 1024 * 1024 } });
    bb.on("file", (_name, stream, info) => {
      const chunks = [];
      stream.on("data", (d) => chunks.push(d));
      stream.on("end", () => {
        files.push({ name: info.filename, type: info.mimeType, data: Buffer.concat(chunks) });
      });
    });
    bb.on("finish", () => resolve(files));
    bb.on("error", reject);
    req.pipe(bb);
  });
}

async function extractWithClaude(base64, mimeType) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const prompt = `You are a financial statement expert. Analyze this image and extract ALL financial data.

Return ONLY valid JSON — no markdown, no explanation — with this exact structure:
{
  "statements": [
    {
      "statement_type": "Profit & Loss",
      "rows": [
        {
          "label": "Sales",
          "amount": 35306,
          "level": 1,
          "section": "Revenue",
          "row_type": "line_item",
          "confidence": 0.97
        }
      ]
    }
  ]
}

Rules:
- statement_type must be one of: "Profit & Loss", "Balance Sheet", "Cash Flow"
- row_type: "header" for section headers, "line_item" for data rows, "subtotal" for sub-totals, "total" for grand totals
- level: 1 for top-level rows, 2 for indented sub-items
- amount: numeric value only (no commas, no currency symbols). Use negative for deductions.
- confidence: 0.95+ for clearly visible, 0.7-0.85 for uncertain text
- Skip percentage-only rows (OPM%, Tax%, EPS, Dividend Payout)
- If multiple years shown, extract the most recent column only`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
          { type: "text", text: prompt }
        ]
      }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "";
  const clean = text.replace(/```json\n?|\n?```/g, "").trim();

  try {
    return JSON.parse(clean);
  } catch {
    throw new Error(`Could not parse AI response: ${clean.slice(0, 300)}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const files = await parseFiles(req);
    if (!files.length) return res.status(400).json({ error: "No image files received." });

    const allStatements = [];
    for (const file of files) {
      const base64 = file.data.toString("base64");
      const mimeType = file.type?.startsWith("image/") ? file.type : "image/png";
      const extracted = await extractWithClaude(base64, mimeType);
      for (const stmt of extracted.statements || []) {
        allStatements.push({
          id: randomUUID(),
          statement_type: stmt.statement_type || "Financial Statement",
          rows: (stmt.rows || []).map((row) => ({
            id: randomUUID(),
            label: row.label || "",
            amount: Number(row.amount) || 0,
            level: Number(row.level) || 1,
            section: row.section || "General",
            row_type: row.row_type || "line_item",
            confidence: Number(row.confidence) || 0.9,
            issues: []
          }))
        });
      }
    }

    const validationIssues = allStatements.flatMap((stmt) =>
      stmt.rows
        .filter((row) => row.confidence < 0.8)
        .map((row) => ({
          code: "LOW_CONFIDENCE",
          severity: "medium",
          message: `"${row.label}" has low confidence (${Math.round(row.confidence * 100)}%). Please verify.`
        }))
    );

    res.status(200).json({
      job_id: randomUUID(),
      status: "completed",
      message: `Extracted ${allStatements.length} statement(s) using Claude AI.`,
      statements: allStatements,
      validation: { issues: validationIssues, summary: { high: 0, medium: validationIssues.length, low: 0 } },
      pipeline: [
        { name: "Upload", status: "completed" },
        { name: "Claude AI Extraction", status: "completed" },
        { name: "Validation", status: "completed" }
      ]
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Conversion failed", message: err.message });
  }
}
