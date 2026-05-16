/**
 * POST /api/gemini-extract
 * Body: { image: "<base64 PNG/JPG>", mimeType: "image/png" }
 * Returns: { columns: string[], rows: [{label, note, values, is_bold, row_type}] }
 */
export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return response.status(503).json({ error: "Gemini API key not configured" });
  }

  const { image, mimeType = "image/png" } = request.body || {};
  if (!image) {
    return response.status(400).json({ error: "Missing image field" });
  }

  const prompt = `You are a financial data extraction expert. Extract the financial table from this image.

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{
  "columns": ["Mar 2025", "Mar 2024"],
  "rows": [
    {
      "label": "Non-Current Assets",
      "note": null,
      "values": [null, null],
      "is_bold": true,
      "row_type": "header"
    },
    {
      "label": "Property, Plant & Equipment",
      "note": "1",
      "values": [40563.52, 34436.76],
      "is_bold": false,
      "row_type": "line_item"
    }
  ]
}

Rules:
- "columns": array of year/period headers found in the table (e.g. "Mar 2025", "Mar 2024")
- "rows": every row in the table including section headers, line items, subtotals, totals
- "label": the row description text
- "note": the note number (e.g. "1", "2A") or null if not present
- "values": numeric values for each column (null if blank/dash), NO commas in numbers
- "is_bold": true for section headers (ALL CAPS), totals, subtotals
- "row_type": "header" for ALL-CAPS section headers, "total" for totals, "subtotal" for subtotals, "line_item" for everything else
- Preserve ALL rows exactly as shown including blank-value section headers
- Do not skip any rows`;

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: image } }
            ]
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 8192 }
        })
      }
    );

    if (!geminiResponse.ok) {
      const err = await geminiResponse.text();
      return response.status(502).json({ error: `Gemini API error: ${err.slice(0, 200)}` });
    }

    const data = await geminiResponse.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Strip markdown fences if present
    const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      return response.status(502).json({ error: "Gemini returned non-JSON", raw: text.slice(0, 500) });
    }

    return response.status(200).json(parsed);
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}
