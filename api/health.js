export default function handler(_request, response) {
  response.status(200).json({ ok: true, app: "Financials Conversion", ai: "Gemini", claude: false });
}
