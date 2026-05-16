import https from "https";

function httpsPost(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function readBody(request) {
  return new Promise((resolve) => {
    if (request.body && typeof request.body === "object") return resolve(request.body);
    let raw = "";
    request.on("data", (c) => (raw += c));
    request.on("end", () => {
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return response.status(503).json({ error: "Gemini API key not configured" });
  }

  const body = await readBody(request);
  const { image, mimeType = "image/png" } = body;

  if (!image) {
    return response.status(400).json({ error: "Missing image field" });
  }

  const prompt = `Extract the financial table from this image. Return ONLY valid JSON, no markdown fences:
{"columns":["Mar 2025","Mar 2024"],"rows":[{"label":"NON-CURRENT ASSETS","note":null,"values":[null,null],"is_bold":true,"row_type":"header"},{"label":"Property, Plant & Equipment","note":"1","values":[40563.52,34436.76],"is_bold":false,"row_type":"line_item"}]}
Rules: columns=year headers; note=note number or null; values=numbers per column (null if blank, NO commas in numbers); is_bold=true for ALL-CAPS headers/totals/subtotals; row_type=header|total|subtotal|line_item. Include ALL rows.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: image } }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 8192 },
    };

    const result = await httpsPost(url, payload);

    if (result.status !== 200) {
      return response.status(502).json({ error: `Gemini ${result.status}`, detail: result.body.slice(0, 300) });
    }

    const data = JSON.parse(result.body);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { return response.status(502).json({ error: "Non-JSON from Gemini", raw: text.slice(0, 300) }); }

    return response.status(200).json(parsed);
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}
