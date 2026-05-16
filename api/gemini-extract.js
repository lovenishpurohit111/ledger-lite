export default async function handler(req, res) {
  res.status(200).json({ 
    method: req.method,
    bodyType: typeof req.body,
    bodyKeys: req.body ? Object.keys(req.body) : [],
    imageLength: req.body?.image?.length || 0,
    hasKey: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
  });
}
