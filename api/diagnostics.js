const GEMINI_MODELS = [
  "gemini-2.5-flash-lite-preview-06-17",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
];

async function testGeminiKey(apiKey) {
  for (const model of GEMINI_MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "Reply with the single word: OK" }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 5 },
          }),
        }
      );
      if (r.ok) return { ok: true, model };
      if (r.status === 429) return { ok: false, reason: "rate_limit", model };
      if ([400, 403].includes(r.status)) return { ok: false, reason: "invalid_key", model };
      // 404 = model not available on this key — try next
    } catch (e) {
      return { ok: false, reason: "network", model };
    }
  }
  return { ok: false, reason: "no_models_available" };
}

export default async function handler(_request, response) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const keyPresent = Boolean(apiKey);

  let geminiConfigured = false;
  let geminiStatus = "not_configured";
  let geminiModel = null;

  if (keyPresent) {
    const result = await testGeminiKey(apiKey);
    geminiConfigured = result.ok;
    geminiStatus = result.ok ? "ok" : result.reason;
    geminiModel = result.model || null;
  }

  response.status(200).json({
    ok: true,
    runtime: "vercel-node",
    conversionJobs: true,
    ocrAvailable: false,
    geminiConfigured,
    geminiStatus,
    geminiModel,
    message: geminiConfigured
      ? `Gemini ready (${geminiModel}).`
      : keyPresent
        ? `Gemini key present but not working: ${geminiStatus}.`
        : "No Gemini key configured.",
    hint: "Upload an image and click Convert.",
  });
}
