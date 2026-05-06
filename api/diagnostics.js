export default function handler(_request, response) {
  response.status(200).json({
    ok: true,
    runtime: "vercel-node",
    conversionJobs: true,
    ocrAvailable: false,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    message: "Gemini-powered conversion worker is available.",
    hint: "Upload an image and click Convert. The Node.js worker will send it to Gemini for extraction."
  });
}
