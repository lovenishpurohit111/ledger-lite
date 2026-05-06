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

async function extractWithGroq(base64, mimeType) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured.");

  const prompt = `You are a financial statement expert. Analyze this image and extract ALL financial data.

Return ONLY valid JSON — no markdown, no explanation — with this exact structure:
{
  "statements": [
    {
      "statement_type": "Profit & Loss",
      "rows": [
        { "label": "Sales", "amount": 35306, "level": 1, "section": "Revenue", "row_type": "line_item", "confidence": 0.97 }
      ]
    }
  ]
}

Rules:
- statement_type: "Profit & Loss", "Balance Sheet", or "Cash Flow"
- row_type: "header", "line_item", "subtotal", or "total"
- level: 1 for top-level, 2 for sub-items
- amount: number only, negative for deductions
- Skip percentage rows (OPM%, Tax%, EPS, Dividend%)
- If multiple years shown, extract the most recent column only`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "llama-3.2-11b-vision-preview",
      max_tokens: 4096,
      temperature: 0.1,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: "text", text: prompt }
        ]
      }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error ${response.status}: ${err.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "";
  const clean = text.replace(/```json\n?|\n?```/g, "").trim();

  try {
    return JSON.parse(clean);
  } catch {
    throw new Error(`Could not parse AI response: ${clean.slice(0, 300)}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const files = await parseFiles(req);
    if (!files.length) return res.status(400).json({ error: "No image files received." });

    const allStatements = [];
    for (const file of files) {
      const base64 = file.data.toString("base64");
      const mimeType = file.type?.startsWith("image/") ? file.type : "image/png";
      const extracted = await extractWithGroq(base64, mimeType);
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
      stmt.rows.filter((r) => r.confidence < 0.8).map((r) => ({
        code: "LOW_CONFIDENCE", severity: "medium",
        message: `"${r.label}" has low confidence (${Math.round(r.confidence * 100)}%). Please verify.`
      }))
    );

    res.status(200).json({
      job_id: randomUUID(),
      status: "completed",
      message: `Extracted ${allStatements.length} statement(s) using Groq AI.`,
      statements: allStatements,
      validation: { issues: validationIssues, summary: { high: 0, medium: validationIssues.length, low: 0 } },
      pipeline: [
        { name: "Upload", status: "completed" },
        { name: "Groq AI Extraction", status: "completed" },
        { name: "Validation", status: "completed" }
      ]
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Conversion failed", message: err.message });
  }
}
