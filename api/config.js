export default function handler(_req, res) {
  res.status(200).json({
    geminiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ""
  });
}
