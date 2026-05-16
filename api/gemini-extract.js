function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

// Model chain per CLAUDE.md
const MODELS = [
  "gemini-2.5-flash-lite-preview-06-17",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Gemini API key not configured" });

  const body = await parseBody(req);
  const { image, mimeType = "image/png" } = body;
  if (!image) return res.status(400).json({ error: "Missing image" });

  const prompt = `Extract the financial table from this image. Return ONLY valid JSON (no markdown):
{"columns":["Mar 2025","Mar 2024"],"rows":[{"label":"NON-CURRENT ASSETS","note":null,"values":[null,null],"is_bold":true,"row_type":"header"},{"label":"Property, Plant & Equipment","note":"1","values":[40563.52,34436.76],"is_bold":false,"row_type":"line_item"}]}
Rules: columns=year headers; note=note number string or null; values=numbers per column (null if blank, no commas); is_bold=true for ALL-CAPS headers/totals/subtotals; row_type=header|total|subtotal|line_item. Include ALL rows.`;

  for (const model of MODELS) {
    let response, ok = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 3000));
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: image } }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 8192 },
            }),
          }
        );
      } catch (e) { break; }
      if (response.status === 429) continue;           // retry once
      if ([400, 403, 404].includes(response.status)) break; // skip model
      if (response.ok) { ok = true; break; }
      break;
    }
    if (!ok || !response?.ok) continue;

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    try {
      const parsed = JSON.parse(clean);
      if (!parsed.columns || !parsed.rows) continue;
      return res.status(200).json(parsed);
    } catch { continue; }
  }

  return res.status(502).json({ error: "All Gemini models failed or unavailable" });
}
