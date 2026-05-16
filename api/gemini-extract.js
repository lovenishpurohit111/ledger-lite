// Vercel serverless function — body parser limit raised to 20mb for base64 images
export const config = { api: { bodyParser: { sizeLimit: "20mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Gemini API key not configured" });

  const { image, mimeType = "image/png" } = req.body || {};
  if (!image) return res.status(400).json({ error: "Missing image" });

  const prompt = `Extract the financial table from this image. Return ONLY valid JSON (no markdown):
{"columns":["Mar 2025","Mar 2024"],"rows":[{"label":"NON-CURRENT ASSETS","note":null,"values":[null,null],"is_bold":true,"row_type":"header"},{"label":"Property, Plant & Equipment","note":"1","values":[40563.52,34436.76],"is_bold":false,"row_type":"line_item"}]}
Rules: columns=year headers; note=note number string or null; values=numbers per column (null if blank, no commas); is_bold=true for ALL-CAPS headers/totals/subtotals; row_type=header|total|subtotal|line_item. Include ALL rows.`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: image } }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 8192 },
        }),
      }
    );
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: "Gemini error", detail: data });
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    try { return res.status(200).json(JSON.parse(clean)); }
    catch { return res.status(502).json({ error: "Non-JSON from Gemini", raw: text.slice(0, 300) }); }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
