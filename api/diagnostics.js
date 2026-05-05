export default function handler(_request, response) {
  response.status(200).json({
    ok: true,
    runtime: "vercel-node",
    conversionJobs: false,
    ocrAvailable: false,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    message: "The static Vercel deployment is reachable, but the Python conversion worker is not attached to this production route.",
    hint: "Run the FastAPI backend locally with npm run dev, or deploy the backend as a dedicated service/API before using Convert in production."
  });
}
